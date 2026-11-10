/**
 * Ren brand constants (docs/brand.md). The product and its agent share one human name.
 *
 * Internal identifiers keep their historical `ron` spelling on purpose: the `ron://` scheme,
 * `ron-*` storage keys, `RON_*` environment variables and API routes are persisted or wired
 * into other processes, so renaming them would lose user state. Only what people read changes.
 */
export const BRAND = {
  /** Product and agent name, as people read it. */
  name: 'Ren',
  /** Lowercase wordmark text; the volt full stop is drawn by RenWordmark. */
  wordmark: 'ren',
  tagline: 'The browser that builds.',
  /** The Build agent's hero line. */
  buildHook: 'Let Ren cook.',
} as const
