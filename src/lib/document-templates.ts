/**
 * Page templates for project Documents: a title and real, structured content written only with the blocks every
 * page editor loads (StarterKit headings, paragraphs, lists, quotes, code blocks and dividers; task lists; tables)
 * plus the documents-only workflow block. The HTML is what Tiptap reads and writes, so a page created from a
 * template saves and reloads exactly like one written by hand.
 *
 * Italic-only paragraphs are author guidance. The Agent Skill template relies on that: the skill publisher
 * (`agent/api/core/document_skills.py`) leaves italic-only paragraphs out of the published skill.
 *
 * Pure (relative imports only) so node:test can run it.
 */
import type { WorkflowGraph } from './workflow.ts'

export type TemplateCategory = 'Basics' | 'Meetings & updates' | 'Product & engineering' | 'Planning' | 'Personal' | 'Agents'
/** Icon names the gallery maps to lucide icons. */
export type TemplateIcon =
  | 'file' | 'users' | 'target' | 'clipboard' | 'cpu' | 'refresh' | 'activity' | 'scale' | 'bug' | 'search'
  | 'sun' | 'flag' | 'book' | 'ren'

export interface DocumentTemplate {
  id: string
  name: string
  description: string
  category: TemplateCategory
  icon: TemplateIcon
  keywords: string[]
  /** Where the structure comes from, for templates that follow a published format. */
  source?: string
  /** The new page's title ('' leaves the title for the author to write). */
  title: (now: Date) => string
  /** The new page's Tiptap HTML. `newId` names blocks that need a unique id (workflows). */
  content: (now: Date, newId: () => string) => string
}

export const TEMPLATE_CATEGORIES: TemplateCategory[] = ['Basics', 'Meetings & updates', 'Product & engineering', 'Planning', 'Personal', 'Agents']

const escapeHtml = (value: string) =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

const day = (now: Date) => now.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
const isoDay = (now: Date) =>
  `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
/** Monday of `now`'s week. */
const weekOf = (now: Date) => {
  const monday = new Date(now)
  monday.setDate(now.getDate() - ((now.getDay() + 6) % 7))
  return day(monday)
}

// --- Block builders (the HTML Tiptap's schema parses) ------------------------------------------

const h2 = (text: string) => `<h2>${escapeHtml(text)}</h2>`
const h3 = (text: string) => `<h3>${escapeHtml(text)}</h3>`
const p = (html = '') => `<p>${html}</p>`
/** Author guidance: an italic-only paragraph. */
const note = (text: string) => p(`<em>${escapeHtml(text)}</em>`)
const ul = (items: string[]) => `<ul>${items.map((item) => `<li>${p(item)}</li>`).join('')}</ul>`
const ol = (items: string[]) => `<ol>${items.map((item) => `<li>${p(item)}</li>`).join('')}</ol>`
const tasks = (items: string[]) =>
  `<ul data-type="taskList">${items.map((item) => `<li data-type="taskItem" data-checked="false">${p(item)}</li>`).join('')}</ul>`
const quote = (html: string) => `<blockquote>${p(html)}</blockquote>`
const code = (language: string, text: string) => `<pre><code class="language-${language}">${escapeHtml(text)}</code></pre>`
const hr = '<hr>'
/** A table with a header row; `rows` are cell HTML. */
const table = (headers: string[], rows: string[][]) =>
  `<table><tbody><tr>${headers.map((cell) => `<th>${p(escapeHtml(cell))}</th>`).join('')}</tr>${
    rows.map((row) => `<tr>${row.map((cell) => `<td>${p(cell)}</td>`).join('')}</tr>`).join('')}</tbody></table>`
/** Label/value rows (a properties table), labels bold. */
const properties = (rows: [string, string][]) =>
  `<table><tbody>${rows.map(([label, value]) => `<tr><th>${p(escapeHtml(label))}</th><td>${p(value)}</td></tr>`).join('')}</tbody></table>`
/** The documents-only workflow block (`WorkflowBlockExtension`), with its ordered-list fallback. */
const workflow = (id: string, title: string, graph: WorkflowGraph) =>
  `<workflow-block data-id="${escapeHtml(id)}" data-title="${escapeHtml(title)}" data-graph="${escapeHtml(JSON.stringify(graph))}"><ol>${
    graph.steps.map((step) => `<li>${escapeHtml(step.label)}</li>`).join('')}</ol></workflow-block>`

const blankRows = (columns: number, count: number) => Array.from({ length: count }, () => Array.from({ length: columns }, () => ''))

// --- Templates ---------------------------------------------------------------------------------

export const DOCUMENT_TEMPLATES: DocumentTemplate[] = [
  {
    id: 'blank', name: 'Blank page', category: 'Basics', icon: 'file', keywords: ['empty', 'new', 'page'],
    description: 'An empty page. Type / for headings, tables, a workflow and more.',
    title: () => '',
    content: () => '',
  },
  {
    id: 'meeting-notes', name: 'Meeting notes', category: 'Meetings & updates', icon: 'users',
    keywords: ['meeting', 'agenda', 'minutes', 'action items', 'decisions', 'attendees'],
    description: 'Agenda, attendees, discussion, decisions and owned action items for one meeting.',
    source: 'Atlassian meeting notes template (goals, discussion items, action items, decisions)',
    title: (now) => `Meeting notes · ${day(now)}`,
    content: (now) => [
      properties([['Date', escapeHtml(day(now))], ['Attendees', ''], ['Facilitator', ''], ['Note taker', '']]),
      h2('Goals'),
      note('What this meeting must decide or produce. If there is nothing to decide, it may not need to be a meeting.'),
      ul(['']),
      h2('Agenda'),
      table(['Time', 'Topic', 'Owner', 'Notes'], blankRows(4, 3)),
      h2('Discussion'),
      p(),
      h2('Decisions'),
      note('Each decision with the reason it was made, so people who were not here can follow it.'),
      ul(['']),
      h2('Action items'),
      note('One owner and a due date per item.'),
      tasks(['']),
    ].join(''),
  },
  {
    id: 'weekly-status', name: 'Weekly status update', category: 'Meetings & updates', icon: 'activity',
    keywords: ['status', 'report', 'weekly', 'update', 'progress', 'rag', 'stakeholders'],
    description: 'Overall status, progress against goals, risks, next week and the help you need.',
    title: (now) => `Status update · week of ${weekOf(now)}`,
    content: () => [
      properties([['Overall status', 'On track / At risk / Off track'], ['Reporting period', ''], ['Owner', '']]),
      h2('Summary'),
      note('Two or three sentences a stakeholder can read in ten seconds: where things stand and why.'),
      p(),
      h2('Progress against goals'),
      table(['Goal', 'Status', 'This week', 'Next milestone'], blankRows(4, 3)),
      h2('Highlights'),
      ul(['']),
      h2('Risks and blockers'),
      table(['Risk or blocker', 'Impact', 'Mitigation', 'Owner'], blankRows(4, 2)),
      h2('Next week'),
      tasks(['']),
      h2('Asks'),
      note('Decisions or help you need, and from whom.'),
      ul(['']),
    ].join(''),
  },
  {
    id: 'retrospective', name: 'Sprint retrospective', category: 'Meetings & updates', icon: 'refresh',
    keywords: ['retro', 'retrospective', 'sprint', 'agile', 'scrum', 'lessons learned'],
    description: 'What went well, what to improve and the actions the team commits to next sprint.',
    source: 'Scrum Guide 2020 (Sprint Retrospective) and the Atlassian retrospective play',
    title: (now) => `Sprint retrospective · ${day(now)}`,
    content: () => [
      properties([['Sprint', ''], ['Sprint goal', ''], ['Goal met?', 'Yes / Partly / No'], ['Participants', '']]),
      note('Inspect how the sprint went for people, interactions, processes, tools and the Definition of Done. Keep it blameless.'),
      h2('What went well'),
      ul(['']),
      h2('What could be improved'),
      ul(['']),
      h2('What we learned'),
      ul(['']),
      h2('Action items'),
      note('Pick the few most helpful changes. Each gets an owner and goes into the next sprint.'),
      tasks(['']),
      h2('Follow-up on last retro'),
      table(['Action', 'Owner', 'Done?', 'Effect'], blankRows(4, 2)),
    ].join(''),
  },
  {
    id: 'project-brief', name: 'Project brief', category: 'Planning', icon: 'target',
    keywords: ['one-pager', 'brief', 'charter', 'kickoff', 'proposal', 'scope'],
    description: 'A one-page case for a project: problem, goals, scope, success metrics, timeline and risks.',
    title: () => 'Project brief',
    content: () => [
      properties([['Owner', ''], ['Stakeholders', ''], ['Status', 'Draft'], ['Target date', '']]),
      h2('Problem'),
      note('Who has the problem, how often, and what it costs them today. Evidence over opinion.'),
      p(),
      h2('Goals'),
      ul(['']),
      h2('Non-goals'),
      note('What this project deliberately will not do, so scope stays honest.'),
      ul(['']),
      h2('Scope'),
      table(['In scope', 'Out of scope'], blankRows(2, 3)),
      h2('Success metrics'),
      table(['Metric', 'Baseline', 'Target', 'How measured'], blankRows(4, 2)),
      h2('Timeline'),
      table(['Milestone', 'Date', 'Owner'], blankRows(3, 3)),
      h2('Risks and assumptions'),
      ul(['']),
      h2('Open questions'),
      tasks(['']),
    ].join(''),
  },
  {
    id: 'okrs', name: 'OKRs', category: 'Planning', icon: 'flag',
    keywords: ['okr', 'objectives', 'key results', 'goals', 'quarter', 'planning'],
    description: 'An objective with measurable key results, baselines, targets, confidence and initiatives.',
    source: 'John Doerr, Measure What Matters: objectives say what, key results say how (measurable, 3–5 each)',
    title: (now) => `OKRs · Q${Math.floor(now.getMonth() / 3) + 1} ${now.getFullYear()}`,
    content: () => [
      note('An objective is qualitative and inspiring. Each key result is a number with a deadline; 3–5 per objective. Score 0.0–1.0 at the end of the period.'),
      h2('Objective 1'),
      p(),
      table(['Key result', 'Baseline', 'Target', 'Current', 'Confidence'], blankRows(5, 3)),
      h3('Initiatives'),
      ul(['']),
      h2('Objective 2'),
      p(),
      table(['Key result', 'Baseline', 'Target', 'Current', 'Confidence'], blankRows(5, 3)),
      h3('Initiatives'),
      ul(['']),
      h2('Check-ins'),
      table(['Date', 'Progress', 'Confidence change', 'Notes'], blankRows(4, 2)),
    ].join(''),
  },
  {
    id: 'prd', name: 'Product requirements (PRD)', category: 'Product & engineering', icon: 'clipboard',
    keywords: ['prd', 'spec', 'feature', 'requirements', 'user stories', 'product'],
    description: 'Objective, success metrics, assumptions, prioritized requirements, design, open questions and what is not being done.',
    source: 'Atlassian product requirements template',
    title: () => 'Feature spec',
    content: () => [
      properties([['Target release', ''], ['Epic', ''], ['Document status', 'Draft'], ['Document owner', ''], ['Designer', ''], ['Engineering', ''], ['QA', '']]),
      h2('Objective'),
      note('The problem this feature solves for which users, and why now.'),
      p(),
      h2('Success metrics'),
      table(['Goal', 'Metric'], blankRows(2, 2)),
      h2('Assumptions'),
      ul(['']),
      h2('Requirements'),
      table(['#', 'Requirement', 'User story', 'Importance', 'Notes'], [['1', '', '', 'Must have', ''], ['2', '', '', 'Should have', ''], ['3', '', '', 'Nice to have', '']]),
      h2('User interaction and design'),
      note('Link designs and describe the main flows and edge cases.'),
      p(),
      h2('Open questions'),
      table(['Question', 'Answer', 'Date answered'], blankRows(3, 2)),
      h2('Not doing'),
      ul(['']),
    ].join(''),
  },
  {
    id: 'design-doc', name: 'Technical design doc', category: 'Product & engineering', icon: 'cpu',
    keywords: ['design doc', 'rfc', 'architecture', 'technical', 'system design', 'engineering'],
    description: 'Context, goals and non-goals, the design with a system diagram, alternatives and cross-cutting concerns.',
    source: 'Malte Ubl, “Design Docs at Google” (industrialempathy.com)',
    title: () => 'Design doc',
    content: (_now, newId) => [
      properties([['Authors', ''], ['Reviewers', ''], ['Status', 'Draft'], ['Last updated', '']]),
      h2('Context and scope'),
      note('An overview of the landscape the new system is built in and what is being built. Facts, not requirements.'),
      p(),
      h2('Goals and non-goals'),
      h3('Goals'),
      ul(['']),
      h3('Non-goals'),
      note('Things that could reasonably be goals but are explicitly chosen not to be.'),
      ul(['']),
      h2('The actual design'),
      h3('System context'),
      workflow(newId(), 'System context', {
        steps: [
          { id: 'client', label: 'Client', description: 'Who calls the system', kind: 'start' },
          { id: 'service', label: 'New service', description: 'What it does', kind: 'step' },
          { id: 'store', label: 'Data store', description: 'What it keeps', kind: 'data' },
          { id: 'result', label: 'Response', description: 'What the caller gets', kind: 'end' },
        ],
        connections: [
          { id: 'client->service', source: 'client', target: 'service', type: 'animated' },
          { id: 'service->store', source: 'service', target: 'store', type: 'animated' },
          { id: 'service->result', source: 'service', target: 'result', type: 'animated' },
        ],
      }),
      h3('APIs'),
      code('http', 'GET /resource/{id}\n200 {"id": "...", "status": "..."}'),
      h3('Data storage'),
      table(['Entity', 'Fields', 'Store', 'Retention'], blankRows(4, 2)),
      h3('Degree of constraint'),
      note('What is fixed (existing systems, compliance) versus open for this design.'),
      p(),
      h2('Alternatives considered'),
      table(['Alternative', 'Trade-offs', 'Why not chosen'], blankRows(3, 2)),
      h2('Cross-cutting concerns'),
      table(['Concern', 'How the design addresses it'], [['Security', ''], ['Privacy', ''], ['Observability', ''], ['Rollout and rollback', '']]),
    ].join(''),
  },
  {
    id: 'adr', name: 'Decision record (ADR)', category: 'Product & engineering', icon: 'scale',
    keywords: ['adr', 'architecture decision record', 'decision', 'context', 'consequences'],
    description: 'One architecturally significant decision: its context, the decision and its consequences.',
    source: 'Michael Nygard, “Documenting Architecture Decisions” (2011)',
    title: () => 'ADR: ',
    content: (now) => [
      properties([['Status', 'Proposed / Accepted / Deprecated / Superseded by …'], ['Date', escapeHtml(isoDay(now))], ['Deciders', '']]),
      h2('Context'),
      note('The forces at play: technical, political, social and project constraints. Neutral language, facts only.'),
      p(),
      h2('Decision'),
      note('Full sentences in active voice: “We will …”.'),
      p(),
      h2('Consequences'),
      note('Everything that follows from the decision, good and bad. These become the context for later decisions.'),
      ul(['']),
      h2('Alternatives considered'),
      ul(['']),
    ].join(''),
  },
  {
    id: 'bug-report', name: 'Bug report', category: 'Product & engineering', icon: 'bug',
    keywords: ['bug', 'defect', 'issue', 'repro', 'steps to reproduce', 'qa'],
    description: 'Environment, exact steps to reproduce, expected versus actual result, impact and logs.',
    title: () => 'Bug: ',
    content: () => [
      properties([['Severity', 'Critical / Major / Minor / Trivial'], ['Priority', ''], ['Reported by', ''], ['Build / version', ''], ['Environment', 'OS, browser, device']]),
      h2('Summary'),
      note('One sentence: what breaks, where, for whom.'),
      p(),
      h2('Steps to reproduce'),
      ol(['', '', '']),
      h2('Expected result'),
      p(),
      h2('Actual result'),
      p(),
      h2('Frequency and impact'),
      note('Every time or intermittent? How many users, and is there a workaround?'),
      p(),
      h2('Logs and screenshots'),
      code('text', 'Paste the error or console output here'),
      h2('Notes'),
      p(),
    ].join(''),
  },
  {
    id: 'research-notes', name: 'Research notes', category: 'Personal', icon: 'search',
    keywords: ['research', 'notes', 'sources', 'findings', 'literature', 'investigation'],
    description: 'A research question, sources with takeaways, findings, evidence, open questions and next steps.',
    title: () => 'Research: ',
    content: () => [
      h2('Research question'),
      note('The one question these notes answer. Narrow beats broad.'),
      p(),
      h2('Sources'),
      table(['Source', 'Link', 'Key takeaway', 'Reliability'], blankRows(4, 3)),
      h2('Findings'),
      ul(['']),
      h2('Evidence'),
      quote(''),
      h2('Open questions'),
      tasks(['']),
      h2('Next steps'),
      tasks(['']),
    ].join(''),
  },
  {
    id: 'daily-plan', name: 'Daily plan', category: 'Personal', icon: 'sun',
    keywords: ['daily', 'plan', 'journal', 'today', 'priorities', 'schedule', 'reflection'],
    description: 'Today’s top three, a time-blocked schedule, tasks, notes and an end-of-day reflection.',
    title: (now) => `Daily plan · ${now.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric', year: 'numeric' })}`,
    content: () => [
      h2('Top three'),
      note('If only these get done, today was a good day.'),
      tasks(['', '', '']),
      h2('Schedule'),
      table(['Time', 'Block'], [['9:00', ''], ['11:00', ''], ['13:00', ''], ['15:00', ''], ['17:00', '']]),
      h2('Other tasks'),
      tasks(['']),
      h2('Notes'),
      p(),
      hr,
      h2('End of day'),
      h3('What went well'),
      p(),
      h3('What to change'),
      p(),
      h3('Tomorrow'),
      tasks(['']),
    ].join(''),
  },
  {
    id: 'reading-notes', name: 'Reading notes', category: 'Personal', icon: 'book',
    keywords: ['reading', 'book', 'article', 'paper', 'summary', 'quotes', 'highlights'],
    description: 'What you read, a three-sentence summary, key ideas, quotes and how you will use it.',
    title: () => 'Reading notes: ',
    content: () => [
      properties([['Title', ''], ['Author', ''], ['Link', ''], ['Finished', ''], ['Rating', '']]),
      h2('Summary in three sentences'),
      p(),
      h2('Key ideas'),
      ul(['']),
      h2('Quotes'),
      quote(''),
      h2('How I will use this'),
      tasks(['']),
      h2('Related reading'),
      ul(['']),
    ].join(''),
  },
  {
    id: 'agent-skill', name: 'Agent Skill', category: 'Agents', icon: 'ren',
    keywords: ['skill', 'agent', 'ron', 'automation', 'sop', 'workflow', 'teach'],
    description: 'Write a skill Ren can run: description, inputs, ordered steps with @ references, and completion criteria. Publish it from the page.',
    source: 'AgentSkills.io SKILL.md (name + description) compiled with a native Agent SOP',
    title: () => '',
    content: () => [
      note('Name this page: its title becomes the skill’s name. Italic notes like this one are guidance and are left out of the published skill. Type @ to reference a page, tool, agent, MCP server or skill.'),
      h2('Description'),
      note('One or two sentences: what the skill does and when Ren should use it. Ren reads this to decide whether to pick the skill.'),
      p(),
      h2('When to use'),
      note('The requests or situations that should trigger it, and when it should not be used.'),
      p(),
      h2('Inputs'),
      note('What Ren needs before it starts, one per line, for example “topic: what to research”.'),
      ul(['']),
      h2('Steps'),
      note('One heading per step, in order. Say what Ren does and with what (@ a tool, MCP server, agent, skill or page), then what done looks like.'),
      h3(''),
      p(),
      p('Done when:&nbsp;'),
      h3(''),
      p(),
      p('Done when:&nbsp;'),
      h2('Completion criteria'),
      note('How Ren checks the whole result before it reports back.'),
      tasks(['']),
    ].join(''),
  },
]

export const findTemplate = (id: string) => DOCUMENT_TEMPLATES.find((template) => template.id === id)

/** Templates matching a search, in gallery order. Every word of the query must prefix a word of the template. */
export function searchTemplates(query: string, templates: DocumentTemplate[] = DOCUMENT_TEMPLATES): DocumentTemplate[] {
  const needles = query.toLowerCase().split(/\s+/).filter(Boolean)
  if (!needles.length) return templates
  return templates.filter((template) => {
    const words = [template.name, template.description, template.category, ...template.keywords]
      .join(' ').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean)
    return needles.every((needle) => words.some((word) => word.startsWith(needle)))
  })
}

/** A new page from a template: its title and HTML. */
export function instantiateTemplate(template: DocumentTemplate, now = new Date(),
  newId: () => string = () => Math.random().toString(36).slice(2, 12)): { title: string; content: string } {
  return { title: template.title(now), content: template.content(now, newId) }
}

/**
 * An Agent Skill page: a Description and a Steps section (H1/H2), the structure the skill publisher reads.
 * Matches pages made from the template and pages written by hand in the same shape.
 */
export function isSkillDocument(html: string): boolean {
  const headings = [...html.matchAll(/<h[12][^>]*>([\s\S]*?)<\/h[12]>/gi)]
    .map((match) => match[1].replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').trim().toLowerCase().replace(/:$/, ''))
  return headings.some((text) => text === 'description' || text === 'summary')
    && headings.some((text) => text === 'steps' || text === 'workflow' || text === 'procedure')
}
