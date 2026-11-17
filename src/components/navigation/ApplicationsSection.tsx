/**
 * Applications — the apps OpenCode built for the signed-in account (the Context Agent's `register_application`,
 * `GET /context/applications`). A web app opens in a new tab; an Android app shows where its APK is.
 * Hidden for guests and while the list is empty.
 */
import { useEffect, useState } from 'react'
import { AppWindow, Smartphone, X } from 'lucide-react'
import { API_BASE_URL } from '@/lib/api-base'
import { isGuestUserId } from '@/lib/sign-in'
import { useAuthStore } from '@/stores/authStore'
import { useTabStore } from '@/stores/tabStore'
import { cn } from '@/utils/cn'

export interface Application {
  id: string
  name: string
  kind: 'web' | 'android'
  location: string
  description: string
  created_at: number
}

const REFRESH_MS = 60_000

function endpoint(path: string, userId: string): string {
  return `${API_BASE_URL.replace(/\/$/, '')}/context/applications${path}?user_id=${encodeURIComponent(userId)}`
}

export function ApplicationsSection({ label, rowClassName }: { label: React.ReactNode; rowClassName: string }) {
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
    return () => {
      controller.abort()
      window.clearInterval(timer)
      window.removeEventListener('focus', load)
    }
  }, [userId])

  const remove = async (application: Application) => {
    const response = await fetch(endpoint(`/${encodeURIComponent(application.id)}`, userId), { method: 'DELETE' })
    if (response.ok) setApplications((await response.json() as { applications: Application[] }).applications)
  }

  if (applications.length === 0) return null
  return (
    <nav aria-label="Applications" className="no-drag">
      {label}
      <ul className="flex flex-col gap-px">
        {applications.map((application) => {
          const Icon = application.kind === 'web' ? AppWindow : Smartphone
          return (
            <li key={application.id} className="group relative">
              <button
                type="button"
                onClick={application.kind === 'web' ? () => useTabStore.getState().createTab(application.location) : undefined}
                title={application.kind === 'web' ? application.description : `${application.description}\n${application.location}`}
                className={cn(
                  'flex h-8 w-full items-center gap-2.5 rounded-lg px-2.5 pr-8 text-[13px] text-ink-secondary transition-colors duration-150 ease-out focus-visible:ring-offset-0 dark:text-ink-inverse-secondary',
                  rowClassName,
                )}
              >
                <Icon className="h-4 w-4 flex-shrink-0 opacity-80" strokeWidth={1.75} aria-hidden />
                <span className="truncate">{application.name}</span>
              </button>
              <button
                type="button"
                onClick={() => { void remove(application) }}
                aria-label={`Remove ${application.name} from Applications`}
                className="absolute right-1.5 top-1/2 flex h-5 w-5 -translate-y-1/2 items-center justify-center rounded-md text-ink-muted opacity-0 transition-opacity duration-150 hover:text-ink focus-visible:opacity-100 group-hover:opacity-100 dark:text-ink-inverse-muted dark:hover:text-ink-inverse"
              >
                <X className="h-3 w-3" strokeWidth={2.25} aria-hidden />
              </button>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
