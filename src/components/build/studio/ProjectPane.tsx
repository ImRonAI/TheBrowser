/**
 * What the workspace is: where it lives on disk (AI Elements Snippet), its package.json (PackageInfo, scripts as
 * runnable snippets, dependencies) and the environment variable names its .env files define (EnvironmentVariables;
 * the API reports names only, so values never reach the renderer).
 */
import { FolderOpen, KeyRound, Package, Play } from 'lucide-react'
import { EnvironmentVariable, EnvironmentVariableName, EnvironmentVariables, EnvironmentVariablesHeader, EnvironmentVariablesTitle,
  EnvironmentVariablesContent } from '@/components/ai-elements/environment-variables'
import { PackageInfo, PackageInfoContent, PackageInfoDependencies, PackageInfoDependency, PackageInfoDescription, PackageInfoHeader,
  PackageInfoName, PackageInfoVersion } from '@/components/ai-elements/package-info'
import { Snippet, SnippetAddon, SnippetCopyButton, SnippetInput, SnippetText } from '@/components/ai-elements/snippet'
import type { BuildWorkspace } from '@/lib/build-api'
import { StudioEmpty } from './shared'

const card = 'rounded-xl border-surface-200 bg-surface-0 dark:border-surface-800 dark:bg-surface-900'

export function ProjectPane({ workspace, blocked, onRun }: {
  workspace: BuildWorkspace
  /** Why Ren can't take a message right now (it is working, or waiting for the user in the chat); empty when it can. */
  blocked: string
  /** Ask Ren to run a package script. */
  onRun: (script: string) => void
}) {
  const pkg = workspace.package
  const scripts = Object.entries(pkg?.scripts ?? {})
  const dependencies = [...Object.entries(pkg?.dependencies ?? {}), ...Object.entries(pkg?.devDependencies ?? {}).map(([name, version]) => [name, version, 'dev'] as const)]
  return (
    <div className="h-full overflow-y-auto scrollbar-thin">
      <div className="mx-auto max-w-[820px] space-y-7 px-5 py-6">
        <section aria-labelledby="project-location">
          <p id="project-location" className="tag-label tag-label-slash">Workspace</p>
          <Snippet code={workspace.root} className="mt-2.5 h-9 rounded-xl border-surface-200 bg-surface-0 dark:border-surface-800 dark:bg-surface-900">
            <SnippetAddon><SnippetText className="pl-1"><FolderOpen className="h-3.5 w-3.5 text-volt" /></SnippetText></SnippetAddon>
            <SnippetInput className="font-mono text-[12px]" aria-label="Workspace folder" />
            <SnippetAddon align="inline-end"><SnippetCopyButton aria-label="Copy the workspace path" /></SnippetAddon>
          </Snippet>
          <p className="mt-2 text-[12px] text-ink-muted dark:text-ink-inverse-muted">Ren builds here, and only here. Open it in your own editor any time.</p>
        </section>

        {pkg ? (
          <section aria-labelledby="project-package">
            <p id="project-package" className="tag-label tag-label-slash">Package</p>
            <PackageInfo name={pkg.name ?? 'Unnamed package'} currentVersion={pkg.version} className={`${card} mt-2.5`}>
              <PackageInfoHeader>
                <PackageInfoName />
              </PackageInfoHeader>
              {pkg.version && <PackageInfoVersion />}
              {pkg.description && <PackageInfoDescription>{pkg.description}</PackageInfoDescription>}
              {(scripts.length > 0 || dependencies.length > 0) && (
                <PackageInfoContent className="space-y-5">
                  {scripts.length > 0 && (
                    <div className="space-y-2">
                      <span className="font-medium text-[11px] uppercase tracking-wide text-ink-muted dark:text-ink-inverse-muted">Scripts</span>
                      {blocked && <p className="text-[12px] leading-snug text-ink-muted dark:text-ink-inverse-muted">{blocked}</p>}
                      {scripts.map(([name, command]) => (
                        <Snippet key={name} code={`npm run ${name}`} className="h-9 rounded-lg border-surface-200 dark:border-surface-800" title={command}>
                          <SnippetAddon><SnippetText className="font-mono text-[11px] text-ink-muted">$</SnippetText></SnippetAddon>
                          <SnippetInput className="font-mono text-[12px]" aria-label={`npm run ${name}`} />
                          <SnippetAddon align="inline-end">
                            <button type="button" disabled={Boolean(blocked)} onClick={() => onRun(name)} title={blocked || `Ask Ren to run ${name}`}
                              className="inline-flex h-6 items-center gap-1 rounded-md px-1.5 text-[11.5px] font-semibold text-volt transition-colors hover:bg-blurple-50 disabled:opacity-40 dark:hover:bg-blurple-950/50">
                              <Play className="h-3 w-3 fill-current" />Run
                            </button>
                            <SnippetCopyButton aria-label={`Copy npm run ${name}`} />
                          </SnippetAddon>
                        </Snippet>
                      ))}
                    </div>
                  )}
                  {dependencies.length > 0 && (
                    <PackageInfoDependencies>
                      {dependencies.map(([name, version, dev]) => (
                        <PackageInfoDependency key={`${dev ?? ''}${name}`} name={name} version={dev ? `${version} · dev` : version} />
                      ))}
                    </PackageInfoDependencies>
                  )}
                </PackageInfoContent>
              )}
            </PackageInfo>
          </section>
        ) : (
          <div className={`${card} border`}>
            <StudioEmpty icon={Package} title="No package.json" className="min-h-0 py-8">
              A plain static site needs none. Ren adds one when the build needs packages or scripts.
            </StudioEmpty>
          </div>
        )}

        {workspace.env.length > 0 && (
          <section aria-labelledby="project-env">
            <p id="project-env" className="tag-label tag-label-slash">Environment</p>
            <EnvironmentVariables className={`${card} mt-2.5`}>
              <EnvironmentVariablesHeader className="px-4 py-3">
                <EnvironmentVariablesTitle className="flex items-center gap-2 text-[13px]"><KeyRound className="h-3.5 w-3.5 text-volt" />Defined in this workspace</EnvironmentVariablesTitle>
              </EnvironmentVariablesHeader>
              <EnvironmentVariablesContent>
                {workspace.env.map((variable) => (
                  <EnvironmentVariable key={`${variable.file}:${variable.name}`} name={variable.name} value="" className="py-2.5">
                    <EnvironmentVariableName className="text-[12.5px]" />
                    <span className="font-mono text-[11px] text-ink-muted dark:text-ink-inverse-muted">{variable.file}</span>
                  </EnvironmentVariable>
                ))}
              </EnvironmentVariablesContent>
              <p className="border-t border-surface-200/80 px-4 py-2.5 text-[11.5px] text-ink-muted dark:border-surface-800 dark:text-ink-inverse-muted">Values stay in the files on your disk; only the names are shown here.</p>
            </EnvironmentVariables>
          </section>
        )}
      </div>
    </div>
  )
}
