/**
 * Applications — the web apps OpenCode built for the signed-in account (the Context Agent's `register_application`,
 * `GET /context/applications`), as icons: the app's own icon (its `icon.png`, else its site's favicon, else its
 * initial), its name under it. A click opens the app in a new tab. Android apps install from Ren on the phone, whose
 * home lists them. Hidden for guests and while there is no web app.
 */
import { useEffect, useState } from 'react'
import { X } from 'lucide-react'
import { API_BASE_URL } from '@/lib/api-base'
import { APPLICATIONS_CHANGED, type Application } from '@/lib/context-api'
import { isGuestUserId } from '@/lib/sign-in'
import { useAuthStore } from '@/stores/authStore'
import { faviconFor } from '@/stores/favoritesStore'
import { useTabStore } from '@/stores/tabStore'

const REFRESH_MS = 60_000

function endpoint(path: string, userId: string): string {
  return `${API_BASE_URL.replace(/\/$/, '')}/context/applications${path}?user_id=${encodeURIComponent(userId)}`
}

/** The app's icon, then its site's favicon, then its initial on volt. */
function AppIcon({ application }: { application: Application }) {
  const sources = [application.icon, faviconFor(application.location)].filter((source): source is string => Boolean(source))
  const [failed, setFailed] = useState(0)
  const source = sources[failed]
  if (!source) {
    return <span aria-hidden className="flex h-full w-full items-center justify-center bg-volt font-display text-[17px] font-semibold text-white dark:text-ink">
      {application.name.trim().charAt(0).toUpperCase() || '·'}
    </span>
  }
  return <img src={source} alt="" draggable={false} onError={() => setFailed(failed + 1)} className="h-full w-full object-cover" />
}

export function ApplicationsSection({ label }: { label: React.ReactNode }) {
  const userId = useAuthStore((state) => state.isAuthenticated ? state.user?.id ?? '' : '')
  const [applications, setApplications] = useState<Application[]>([])

  useEffect(() => {
    if (!userId || isGuestUserId(userId)) {
      setApplications([])
      return
    }
    const controller = new AbortController()
    const load = async () => {
      try {
        const response = await fetch(endpoint('', userId), { signal: controller.signal })
        if (response.ok) setApplications((await response.json() as { applications: Application[] }).applications)
      } catch (error) {
        if (!controller.signal.aborted) console.warn('[Applications] list failed', error)
      }
    }
    void load()
    const timer = window.setInterval(() => { void load() }, REFRESH_MS)
    window.addEventListener('focus', load)
    window.addEventListener(APPLICATIONS_CHANGED, load)
    return () => {
      controller.abort()
      window.clearInterval(timer)
      window.removeEventListener('focus', load)
      window.removeEventListener(APPLICATIONS_CHANGED, load)
    }
  }, [userId])

  const remove = async (application: Application) => {
    const response = await fetch(endpoint(`/${encodeURIComponent(application.id)}`, userId), { method: 'DELETE' })
    if (response.ok) setApplications((await response.json() as { applications: Application[] }).applications)
  }

  const web = applications.filter((application) => application.kind === 'web')
  if (web.length === 0) return null
  return (
    <nav aria-label="Applications" className="no-drag">
      {label}
      <ul className="grid grid-cols-4 gap-1 px-1">
        {web.map((application) => (
          <li key={application.id} className="group relative">
            <button
              type="button"
              onClick={() => useTabStore.getState().createTab(application.location)}
              title={application.description ? `${application.name}\n${application.description}` : application.name}
              className="flex w-full flex-col items-center gap-1.5 rounded-xl px-1 py-2 transition-colors duration-150 ease-out hover:bg-ink/[0.06] focus-visible:ring-offset-0 dark:hover:bg-ink-inverse/[0.07]"
            >
              <span className="h-10 w-10 overflow-hidden rounded-[12px] border border-surface-200 bg-white dark:border-surface-800 dark:bg-surface-900">
                <AppIcon application={application} />
              </span>
              <span className="w-full truncate text-center text-[11px] leading-tight text-ink-secondary dark:text-ink-inverse-secondary">{application.name}</span>
            </button>
            <button
              type="button"
              onClick={() => { void remove(application) }}
              aria-label={`Remove ${application.name} from Applications`}
              className="absolute right-0.5 top-0.5 flex h-5 w-5 items-center justify-center rounded-md bg-surface-100 text-ink-muted opacity-0 transition-opacity duration-150 hover:text-ink focus-visible:opacity-100 group-hover:opacity-100 dark:bg-surface-850 dark:text-ink-inverse-muted dark:hover:text-ink-inverse"
            >
              <X className="h-3 w-3" strokeWidth={2.25} aria-hidden />
            </button>
          </li>
        ))}
      </ul>
    </nav>
  )
}
