/**
 * What a build outcome's run made (`snapshot.application`, the app the App Builder's `register_application` listed
 * under Applications): a web app or website in a frame, with a way into a browser tab of its own, or an Android app
 * with its APK (`GET /context/applications/<id>/apk`), which Ren on the phone hands to Android's installer.
 */
import { Download, ExternalLink } from 'lucide-react'
import { AppIcon, applicationsUrl } from '@/components/navigation/ApplicationsSection'
import type { Application } from '@/lib/context-api'
import { openSourceInNewTab } from './openSource'

export function DeepResearchApplication({ application, userId }: { application: Application; userId: string }) {
  const web = application.kind === 'web'
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3 rounded-xl border border-surface-200 bg-surface-50/80 px-3.5 py-2.5 dark:border-surface-800 dark:bg-surface-850/80">
        <div className="flex min-w-0 items-center gap-3">
          <span className="h-10 w-10 shrink-0 overflow-hidden rounded-[12px] border border-surface-200 bg-white dark:border-surface-800 dark:bg-surface-900">
            <AppIcon application={application} />
          </span>
          <div className="min-w-0">
            <h2 className="truncate font-display text-[15px] font-semibold tracking-[-0.015em] text-ink dark:text-ink-inverse">
              {application.name}
            </h2>
            <p className="line-clamp-2 font-sans text-[12px] text-ink-secondary dark:text-ink-inverse-secondary">
              {application.description}
            </p>
          </div>
        </div>
        {web ? (
          <button
            type="button"
            onClick={() => openSourceInNewTab(application.location)}
            className="inline-flex shrink-0 items-center gap-1 font-sans text-[12px] font-medium text-volt hover:underline"
          >
            <span>Open in browser tab</span>
            <ExternalLink className="h-3 w-3" aria-hidden />
          </button>
        ) : (
          <a
            href={applicationsUrl(`/${encodeURIComponent(application.id)}/apk`, userId)}
            className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg bg-blurple-600 px-3 font-sans text-[12.5px] font-medium text-white transition-colors hover:bg-blurple-700 dark:bg-blurple-400 dark:text-ink dark:hover:bg-blurple-300"
          >
            <Download className="h-3.5 w-3.5" aria-hidden />
            Install
          </a>
        )}
      </div>

      {web ? (
        <iframe
          src={application.location}
          title={application.name}
          className="h-[calc(100vh-210px)] min-h-[620px] w-full rounded-2xl border border-surface-200 bg-white shadow-soft dark:border-surface-800 dark:shadow-dark-soft"
        />
      ) : (
        <p className="px-1 font-sans text-[13px] leading-relaxed text-ink-secondary dark:text-ink-inverse-secondary">
          It is listed under Applications on Ren&apos;s home on your phone, and installs from there too.
        </p>
      )}
    </div>
  )
}
