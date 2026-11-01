/**
 * Ron wordmark + handlebar moustache.
 *
 * Two transparent PNGs live in `public/`: the glossy black artwork for light
 * mode and the silver emblem for dark mode. Theme selection is class-based
 * (`darkMode: ['class']` in tailwind.config.ts, `.dark` on <html> from
 * `src/lib/theme.ts`), so both images are rendered and Tailwind's `dark:`
 * variants show exactly one — no hook, no flash on theme change.
 */
export const RON_LOGO_LIGHT_SRC = '/ron-logo-light.png'
export const RON_LOGO_DARK_SRC = '/ron-logo-dark.png'

interface RonLogoProps {
  /** Classes applied to both <img> elements (size it here, e.g. `h-8 w-auto`). */
  className?: string
  /** Accessible name; pass an empty string when the mark is purely decorative. */
  alt?: string
}

export function RonLogo({ className = '', alt = 'Ron' }: RonLogoProps) {
  const shared = `select-none object-contain ${className}`.trim()
  const decorative = alt === ''
  return (
    <>
      <img
        src={RON_LOGO_LIGHT_SRC}
        alt={alt}
        aria-hidden={decorative || undefined}
        draggable={false}
        className={`${shared} dark:hidden`}
      />
      <img
        src={RON_LOGO_DARK_SRC}
        alt={alt}
        aria-hidden={decorative || undefined}
        draggable={false}
        className={`${shared} hidden dark:block`}
      />
    </>
  )
}
