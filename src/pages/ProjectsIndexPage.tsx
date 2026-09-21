import { useMemo, useState } from 'react'
import { Grid2x2, List, Plus } from 'lucide-react'
import { useProjectsStore } from '@/stores/projectsStore'
import { ProjectTypeBadge } from '@/components/projects/badges'
import { CreateProjectDialog } from '@/components/projects/dialogs'
import { Button } from '@catalyst/button'
import { PageBackground } from '@/components/shared/PageBackground'
import { cn } from '@/utils/cn'

export function ProjectsIndexPage() {
  const { projects, issues } = useProjectsStore()
  const [view, setView] = useState<'grid' | 'list'>('grid')
  const [showCreate, setShowCreate] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')

  const metrics = useMemo(() => {
    return projects.map((project) => {
      const projectIssues = issues.filter((issue) => issue.projectId === project.id)
      const openIssues = projectIssues.filter((issue) => issue.status !== 'done').length
      const blocked = projectIssues.filter((issue) => issue.status === 'blocked').length
      const dueSoon = projectIssues.filter((issue) => {
        if (!issue.dueDate) return false
        const dueTs = new Date(issue.dueDate).getTime()
        return dueTs < Date.now() + 1000 * 60 * 60 * 24 * 7
      }).length

      return { project, openIssues, blocked, dueSoon }
    })
  }, [projects, issues])

  const navigateInternal = (url: string) => {
    if (typeof window !== 'undefined' && window.electron?.browser) {
      window.electron.browser.navigate(url)
    }
  }

  const filteredMetrics = metrics.filter(({ project }) => {
    if (!searchQuery.trim()) return true
    const value = searchQuery.trim().toLowerCase()
    return (
      project.name.toLowerCase().includes(value) ||
      project.key.toLowerCase().includes(value) ||
      (project.summary || '').toLowerCase().includes(value)
    )
  })

  return (
    <div className="min-h-full relative overflow-hidden bg-surface-0 dark:bg-surface-900">
      <PageBackground />
      <div className="relative z-10 px-10 py-8 space-y-8">
        <div className="rounded-3xl glass-card border border-white/10 p-8 shadow-soft">
          <div className="flex flex-wrap items-center justify-between gap-6">
            <div>
              <p className="text-xs uppercase tracking-[0.35em] text-ink-muted dark:text-ink-inverse-muted">Projects</p>
              <h1 className="mt-2 text-3xl font-display text-ink dark:text-ink-inverse">Projects Index</h1>
              <p className="mt-2 text-body-sm text-ink-secondary dark:text-ink-inverse-secondary">
                Organize work into structured containers and navigate by type, status, and urgency.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search projects"
                className="rounded-full glass-subtle border border-white/10 dark:border-white/10 px-4 py-2 text-body-xs text-ink dark:text-ink-inverse placeholder:text-ink-muted"
              />
              <div className="flex items-center gap-1 rounded-full glass-subtle border border-white/10 dark:border-white/10 p-1">
                <button
                  onClick={() => setView('grid')}
                  title="Grid view"
                  className={cn(
                    'p-2 rounded-full transition-colors',
                    view === 'grid'
                      ? 'bg-accent/20 text-accent dark:text-accent-light'
                      : 'text-ink-muted dark:text-ink-inverse-muted'
                  )}
                >
                  <Grid2x2 className="w-4 h-4" />
                </button>
                <button
                  onClick={() => setView('list')}
                  title="List view"
                  className={cn(
                    'p-2 rounded-full transition-colors',
                    view === 'list'
                      ? 'bg-accent/20 text-accent dark:text-accent-light'
                      : 'text-ink-muted dark:text-ink-inverse-muted'
                  )}
                >
                  <List className="w-4 h-4" />
                </button>
              </div>
              <Button color="indigo" onClick={() => setShowCreate(true)}>
                <Plus data-slot="icon" />
                New Project
              </Button>
            </div>
          </div>
        </div>

        <div className={cn(
          'gap-6',
          view === 'grid' ? 'grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3' : 'flex flex-col'
        )}>
        {filteredMetrics.map(({ project, openIssues, blocked, dueSoon }) => (
          <button
            key={project.id}
            onClick={() => navigateInternal(`ron://project/${project.key.toLowerCase()}`)}
            className={cn(
              'group relative overflow-hidden rounded-3xl glass-card border border-white/10 p-6 text-left transition',
              'hover:border-accent/40 dark:hover:border-accent-light/40 hover:shadow-soft'
            )}
          >
            <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-500 bg-gradient-to-tr from-accent/5 via-transparent to-accent-light/5 pointer-events-none rounded-3xl" />
            <div className="flex items-center justify-between">
              <ProjectTypeBadge type={project.type} />
              <span className="text-[11px] uppercase tracking-widest text-ink-muted dark:text-ink-inverse-muted">
                {project.key}
              </span>
            </div>
            <h3 className="mt-4 text-lg font-semibold text-ink dark:text-ink-inverse">
              {project.name}
            </h3>
            <p className="mt-2 text-body-xs text-ink-secondary dark:text-ink-inverse-secondary line-clamp-2">
              {project.summary || 'No summary yet.'}
            </p>
            <div className="mt-6 grid grid-cols-3 gap-3">
              <ProjectStat label="Open" value={openIssues} />
              <ProjectStat label="Blocked" value={blocked} />
              <ProjectStat label="Due Soon" value={dueSoon} />
            </div>
          </button>
        ))}
        </div>

        <CreateProjectDialog isOpen={showCreate} onClose={() => setShowCreate(false)} />
      </div>
    </div>
  )
}

function ProjectStat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-2xl glass-subtle border border-white/10 dark:border-white/10 px-3 py-3 text-center">
      <p className="text-xs font-semibold text-ink dark:text-ink-inverse">{value}</p>
      <p className="mt-1 text-[10px] uppercase tracking-wider text-ink-muted dark:text-ink-inverse-muted">
        {label}
      </p>
    </div>
  )
}
