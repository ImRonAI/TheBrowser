import { memo } from 'react'

/**
 * PageBackground: the quiet texture behind full-page surfaces (Execute, Projects).
 *
 * A static, colourless dot grid that fades out down the page. It never moves and never takes a
 * colour (docs/brand.md: no decorative pulsing; volt is the only colour). In Glass it is absent:
 * there the desktop showing through the window is the texture.
 */
export const PageBackground = memo(function PageBackground() {
  return (
    <div
      aria-hidden
      className={[
        'pointer-events-none absolute inset-0 [html.glass_&]:hidden',
        'bg-[radial-gradient(rgb(11_12_23/0.075)_1px,transparent_1.2px)] bg-[length:22px_22px]',
        'dark:bg-[radial-gradient(rgb(255_255_255/0.055)_1px,transparent_1.2px)]',
        '[mask-image:linear-gradient(to_bottom,black,transparent_520px)]',
      ].join(' ')}
    />
  )
})
