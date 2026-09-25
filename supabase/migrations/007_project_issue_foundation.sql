-- Canonical project issues. Forward-only: legacy tasks remain untouched for a
-- separately reviewed import; never guess task/issue equivalence from titles.
begin;

alter table public.projects add column if not exists lifecycle text not null default 'active'
  check (lifecycle in ('active','paused','completed','archived'));
alter table public.projects add column if not exists version integer not null default 1;
alter table public.projects add column if not exists issue_counter bigint not null default 0;
-- The old project_key had global uniqueness, although keys are user-scoped.
alter table public.projects drop constraint if exists projects_project_key_key;

create or replace function public.default_project_issue_types() returns jsonb
language sql immutable set search_path = public as $$
 select '[{"key":"initiative","label":"Initiative","level":1},
 {"key":"epic","label":"Epic","level":2},{"key":"story","label":"Story","level":3},
 {"key":"task","label":"Task","level":4},{"key":"bug","label":"Bug","level":4},
 {"key":"subtask","label":"Subtask","level":5}]'::jsonb
$$;

update public.projects set settings = settings || jsonb_build_object(
 'issueTypes', public.default_project_issue_types(), 'fields', '[]'::jsonb)
 where not settings ? 'issueTypes';

alter table public.issues add column if not exists number bigint;
alter table public.issues add column if not exists version integer not null default 1;
alter table public.issues add column if not exists custom_fields jsonb not null default '{}';
alter table public.issues add column if not exists work_products jsonb not null default '[]';
with numbered as (
 select id, row_number() over (partition by project_id order by created_at,id) as n from public.issues
) update public.issues i set number=n.n from numbered n where i.id=n.id;
update public.projects p set issue_counter=coalesce((select max(number) from public.issues i where i.project_id=p.id),0);
alter table public.issues alter column number set not null;
create unique index issues_project_number on public.issues(project_id,number);
create index issues_project_rank on public.issues(project_id,rank,id);

-- Security-definer helpers avoid recursive projects <-> members RLS evaluation.
create or replace function public.can_access_project(project uuid) returns boolean
language sql stable security definer set search_path = public as $$
 select auth.uid() is not null and exists (select 1 from public.projects p where p.id=project
 and (p.user_id=auth.uid() or exists (select 1 from public.project_members m
 where m.project_id=p.id and m.user_id=auth.uid())))
$$;
create or replace function public.owns_project(project uuid) returns boolean
language sql stable security definer set search_path = public as $$
 select exists(select 1 from public.projects where id=project and user_id=auth.uid())
$$;
create or replace function public.lock_project_configuration(project uuid) returns jsonb
language plpgsql security definer set search_path=public as $$
declare result jsonb;
begin
 if not public.can_access_project(project) then raise exception 'Project not accessible'; end if;
 select settings into result from public.projects where id=project for update;
 return result;
end $$;
revoke all on function public.can_access_project(uuid), public.owns_project(uuid) from public;
grant execute on function public.can_access_project(uuid), public.owns_project(uuid) to authenticated;
revoke all on function public.lock_project_configuration(uuid) from public;
grant execute on function public.lock_project_configuration(uuid) to authenticated;

drop policy if exists "Projects readable by owner or member" on public.projects;
create policy "Projects readable by owner or member" on public.projects for select
 using (public.can_access_project(id));
drop policy if exists "Projects update by owner or member" on public.projects;
create policy "Projects update by owner" on public.projects for update
 using (public.owns_project(id)) with check (user_id=auth.uid());

-- A single directed edge; inverse labels are a presentation concern.
update public.issue_links set source_id=target_id,target_id=source_id,type='blocks' where type='blocked-by';
update public.issue_links set source_id=least(source_id,target_id),target_id=greatest(source_id,target_id)
 where type in ('relates','duplicates');
delete from public.issue_links a using public.issue_links b
 where a.source_id=b.source_id and a.target_id=b.target_id and a.type=b.type and a.id>b.id;
-- Preserve unknown legacy relations rather than silently deleting them.
alter table public.issue_links add constraint issue_links_no_self check(source_id<>target_id) not valid;
create unique index issue_links_unique_edge on public.issue_links(source_id,target_id,type);
create or replace function public.validate_issue_link() returns trigger
language plpgsql set search_path=public as $$
declare swapped uuid;
begin
 if new.type='blocked-by' then
   swapped:=new.source_id; new.source_id:=new.target_id; new.target_id:=swapped; new.type:='blocks';
 end if;
 if new.type not in ('blocks','enables','implements','fixes','duplicates','discovers','relates') then
   raise exception 'Unknown relationship type';
 end if;
 if new.type in ('relates','duplicates') and new.source_id>new.target_id then
   swapped:=new.source_id; new.source_id:=new.target_id; new.target_id:=swapped;
 end if;
 if tg_op='INSERT' then new.created_by:=auth.uid(); end if;
 return new;
end $$;
create trigger canonical_issue_link before insert or update on public.issue_links
 for each row execute function public.validate_issue_link();
drop policy if exists "Issue links readable by project access" on public.issue_links;
drop policy if exists "Issue links insert by project access" on public.issue_links;
drop policy if exists "Issue links delete by project access" on public.issue_links;
create policy "Issue links both endpoints" on public.issue_links for all
 using (exists(select 1 from public.issues where id=source_id)
    and exists(select 1 from public.issues where id=target_id))
 with check (exists(select 1 from public.issues where id=source_id)
    and exists(select 1 from public.issues where id=target_id));

create table public.issue_events (
 id uuid primary key default gen_random_uuid(),
 issue_id uuid not null references public.issues(id) on delete cascade,
 title text not null check(length(trim(title)) between 1 and 300),
 starts_at timestamptz not null, ends_at timestamptz not null,
 timezone text not null default 'UTC',
 meeting_url text check(meeting_url is null or meeting_url ~ '^https://'),
 agenda text not null default '', participants text[] not null default '{}',
 provider text, external_event_id text,
 created_at timestamptz not null default now(), check(ends_at>starts_at)
);
create index issue_events_issue on public.issue_events(issue_id,starts_at);
alter table public.issue_events enable row level security;
create policy "Issue event project access" on public.issue_events for all
 using(exists(select 1 from public.issues where id=issue_id))
 with check(exists(select 1 from public.issues where id=issue_id));

create or replace function public.validate_project_configuration() returns trigger
language plpgsql set search_path=public as $$
declare definition jsonb; keys text[] := '{}'; field_keys text[] := '{}';
begin
 if jsonb_typeof(new.settings) is distinct from 'object' then raise exception 'Invalid settings'; end if;
 if tg_op='UPDATE' and (new.user_id<>old.user_id or new.key<>old.key or new.owner_id is distinct from old.owner_id) then
   raise exception 'Project ownership and key are immutable';
 end if;
 if tg_op='UPDATE' and new.issue_counter<>old.issue_counter and pg_trigger_depth()<2 then
   raise exception 'Issue counter is server-owned';
 end if;
 if tg_op='INSERT' then new.issue_counter:=0; new.version:=1; end if;
 new.settings := new.settings || jsonb_build_object('issueTypes',
   coalesce(new.settings->'issueTypes',public.default_project_issue_types()),
   'fields',coalesce(new.settings->'fields','[]'::jsonb));
 if jsonb_typeof(new.settings->'issueTypes')<>'array' or jsonb_array_length(new.settings->'issueTypes')=0
 or jsonb_typeof(new.settings->'fields')<>'array' then raise exception 'Invalid project configuration'; end if;
 for definition in select * from jsonb_array_elements(new.settings->'issueTypes') loop
   if coalesce(definition->>'key','') !~ '^[a-z][a-z0-9-]{0,49}$'
   or coalesce(length(trim(definition->>'label')),0)=0
   or coalesce(definition->>'level','') !~ '^[1-5]$'
   or definition->>'key'=any(keys) then raise exception 'Invalid or duplicate issue type'; end if;
   keys:=array_append(keys,definition->>'key');
 end loop;
 for definition in select * from jsonb_array_elements(new.settings->'fields') loop
   if coalesce(definition->>'key','') !~ '^[a-z][a-z0-9-]{0,49}$'
   or coalesce(length(trim(definition->>'label')),0)=0
   or coalesce(definition->>'type','') not in ('text','rich-text','number','currency','checkbox','date','datetime','single-select','multi-select','person','url','issue')
   or definition->>'key'=any(field_keys) then raise exception 'Invalid or duplicate field'; end if;
   if definition->>'type' in ('single-select','multi-select') and
      (jsonb_typeof(definition->'options') is distinct from 'array') then raise exception 'Select fields require options'; end if;
   field_keys:=array_append(field_keys,definition->>'key');
 end loop;
 if tg_op='UPDATE' and new.settings is distinct from old.settings then
   if exists(select 1 from public.issues i where i.project_id=new.id and not i.type=any(keys)) then
     raise exception 'Cannot remove a type used by existing issues';
   end if;
   if exists(select 1 from public.issues i join jsonb_array_elements(old.settings->'issueTypes') o on o->>'key'=i.type
     join jsonb_array_elements(new.settings->'issueTypes') n on n->>'key'=i.type
     where i.project_id=new.id and o->>'level' is distinct from n->>'level') then
     raise exception 'Changing an in-use hierarchy level requires an explicit migration';
   end if;
   if exists(select 1 from jsonb_array_elements(old.settings->'fields') o
      where not exists(select 1 from jsonb_array_elements(new.settings->'fields') n
        where n->>'key'=o->>'key' and n->>'type'=o->>'type')) then
     raise exception 'Archive fields instead of deleting or changing their type';
   end if;
 end if;
 if tg_op='UPDATE' then
   new.version:=old.version+1;
   if new.issue_counter<>old.issue_counter then new.version:=old.version; return new; end if;
 end if;
 new.updated_at:=now();
 return new;
end $$;
create trigger project_configuration before insert or update on public.projects
 for each row execute function public.validate_project_configuration();

create or replace function public.validate_canonical_issue() returns trigger
language plpgsql set search_path=public as $$
declare config jsonb; level integer; parent_level integer; definition jsonb; value jsonb; item jsonb;
begin
 -- Serialize hierarchy checks and numbering within a project, including concurrent reparenting.
 config:=public.lock_project_configuration(new.project_id);
 if config is null then raise exception 'Project not accessible'; end if;
 if tg_op='UPDATE' and (new.project_id<>old.project_id or new.id<>old.id or new.number<>old.number
   or new.created_by is distinct from old.created_by) then raise exception 'Issue identity is immutable'; end if;
 select (t->>'level')::integer into level from jsonb_array_elements(config->'issueTypes') t where t->>'key'=new.type;
 if level is null then raise exception 'Issue type is not configured for this project'; end if;
 if length(trim(new.title))=0 then raise exception 'Title is required'; end if;
 if new.status not in ('backlog','in-progress','review','blocked','done') or
    new.priority not in ('critical','high','medium','low') then raise exception 'Invalid status or priority'; end if;
 if new.estimate<0 then raise exception 'Estimate must be nonnegative'; end if;
 if new.parent_id is null and level=5 then raise exception 'Subtasks require a parent'; end if;
 if new.parent_id is not null then
   select (t->>'level')::integer into parent_level from public.issues p,
     jsonb_array_elements(config->'issueTypes') t
     where p.id=new.parent_id and p.project_id=new.project_id and t->>'key'=p.type;
   if parent_level is null or parent_level+1<>level or new.parent_id=new.id then
     raise exception 'Invalid hierarchy or cross-project parent';
   end if;
   if exists(with recursive ancestors as (
     select id,parent_id from public.issues where id=new.parent_id
     union select i.id,i.parent_id from public.issues i join ancestors a on i.id=a.parent_id
   ) select 1 from ancestors where id=new.id) then raise exception 'Hierarchy cycle'; end if;
 end if;
 if exists(select 1 from public.issues c, jsonb_array_elements(config->'issueTypes') t
   where c.parent_id=new.id and t->>'key'=c.type and (t->>'level')::integer<>level+1) then
   raise exception 'Type change would invalidate children';
 end if;
 if jsonb_typeof(new.custom_fields)<>'object' or jsonb_typeof(new.work_products)<>'array' then
   raise exception 'Invalid issue values'; end if;
 if exists(select 1 from jsonb_object_keys(new.custom_fields) k where not exists(
   select 1 from jsonb_array_elements(config->'fields') f where f->>'key'=k)) then raise exception 'Unknown custom field'; end if;
 for definition in select * from jsonb_array_elements(config->'fields') loop
   value:=new.custom_fields->(definition->>'key');
   if coalesce((definition->>'archived')::boolean,false) then
     if (tg_op='INSERT' and value is not null) or (tg_op='UPDATE' and
       value is distinct from old.custom_fields->(definition->>'key')) then
       raise exception 'Archived field values are read-only';
     end if;
     continue;
   end if;
   if definition ? 'issueTypes' and jsonb_array_length(definition->'issueTypes')>0 and
     not (definition->'issueTypes' ? new.type) then
     if value is not null and value<>'null'::jsonb then raise exception 'Field does not apply to this issue type'; end if;
     continue;
   end if;
   if value is null and tg_op='INSERT' and definition ? 'default' then
     value:=definition->'default'; new.custom_fields:=jsonb_set(new.custom_fields,array[definition->>'key'],value);
   end if;
   if value is null or value='null'::jsonb or value='""'::jsonb then
     if coalesce((definition->>'required')::boolean,false) then raise exception 'Required field: %',definition->>'label'; end if;
     continue;
   end if;
   case definition->>'type'
   when 'number','currency' then
     if jsonb_typeof(value)<>'number' then raise exception 'Expected number: %',definition->>'label'; end if;
   when 'checkbox' then
     if jsonb_typeof(value)<>'boolean' then raise exception 'Expected checkbox: %',definition->>'label'; end if;
   when 'multi-select' then
     if jsonb_typeof(value)<>'array' then raise exception 'Expected options array'; end if;
     for item in select * from jsonb_array_elements(value) loop
       if not (definition->'options' @> jsonb_build_array(item)) then raise exception 'Unknown option'; end if;
     end loop;
   else
     if jsonb_typeof(value)<>'string' then raise exception 'Expected text: %',definition->>'label'; end if;
     if definition->>'type'='single-select' and not (definition->'options' @> jsonb_build_array(value)) then raise exception 'Unknown option'; end if;
     if definition->>'type'='url' and (value#>>'{}') !~ '^https?://' then raise exception 'Expected HTTP(S) URL'; end if;
     if definition->>'type'='date' then perform (value#>>'{}')::date; end if;
     if definition->>'type'='datetime' then perform (value#>>'{}')::timestamptz; end if;
     if definition->>'type'='person' then perform (value#>>'{}')::uuid; end if;
     if definition->>'type'='issue' and not exists(select 1 from public.issues where id=(value#>>'{}')::uuid) then raise exception 'Referenced issue is not accessible'; end if;
   end case;
 end loop;
 if tg_op='INSERT' then
   -- Counter update must work for project members too; use a narrowly scoped definer function.
   new.number:=public.next_project_issue_number(new.project_id);
   new.version:=1; new.created_by:=auth.uid();
 else new.version:=old.version+1;
 end if;
 new.updated_at:=now(); return new;
end $$;

create or replace function public.next_project_issue_number(project uuid) returns bigint
language plpgsql security definer set search_path=public as $$
declare result bigint;
begin
 if not public.can_access_project(project) then raise exception 'Project not accessible'; end if;
 update public.projects set issue_counter=issue_counter+1 where id=project returning issue_counter into result;
 return result;
end $$;
revoke all on function public.next_project_issue_number(uuid) from public;
grant execute on function public.next_project_issue_number(uuid) to authenticated;
create trigger canonical_issue before insert or update on public.issues
 for each row execute function public.validate_canonical_issue();

create or replace function public.audit_canonical_issue() returns trigger
language plpgsql security definer set search_path=public as $$
begin
 insert into public.activity_log(project_id,issue_id,actor_id,actor_type,action,old_value,new_value)
 values(new.project_id,new.id,auth.uid(),'user',case when tg_op='INSERT' then 'Created issue' else 'Updated issue' end,
 case when tg_op='UPDATE' then to_jsonb(old)::text else null end,to_jsonb(new)::text);
 return new;
end $$;
create trigger canonical_issue_audit after insert or update on public.issues
 for each row execute function public.audit_canonical_issue();
-- Only triggers may append audit entries; clients cannot forge history.
drop policy if exists "Activity insert by project access" on public.activity_log;
grant select,insert,update,delete on public.issue_events to authenticated;
commit;