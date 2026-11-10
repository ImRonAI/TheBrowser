/**
 * Backdrop for the search page: one street detail, a halftone dot field fading out of the
 * header's top-right corner (docs/brand.md § Motifs). Decorative and pointer-safe; the dots
 * are ink at low alpha, so they follow Light, Dark and Glass. `hue` stays on the contract.
 */
export function SearchBackdrop({ hue: _hue }: { hue: string }) {
  return (
    <div className="pointer-events-none absolute inset-x-0 top-0 h-64 overflow-hidden" aria-hidden>
      <div className="halftone absolute -right-12 -top-20 h-80 w-[32rem] max-w-[72%] opacity-80" />
    </div>
  )
}
