/**
 * Backdrop for the search page. The redesign drops the hue-keyed orbs and grid:
 * the page is plain paper/graphite with one faint warm wash under the header.
 * `hue` is kept on the contract for callers.
 */
export function SearchBackdrop({ hue: _hue }: { hue: string }) {
  return (
    <div className="pointer-events-none absolute inset-x-0 top-0 h-40 overflow-hidden" aria-hidden>
      <div className="absolute inset-0 bg-gradient-to-b from-surface-50/80 via-surface-50/30 to-transparent dark:from-surface-850/50 dark:via-surface-850/20" />
    </div>
  )
}
