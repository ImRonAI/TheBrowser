import { useEffect, useState, type RefObject } from 'react'

/**
 * The element's own content width, kept current by a ResizeObserver; 0 until it has been measured. For layout that
 * follows the space a pane actually has (a split that moves, a resizable panel), not the window's width, which is
 * all a Tailwind breakpoint can see.
 */
export function useElementWidth(ref: RefObject<HTMLElement | null>): number {
  const [width, setWidth] = useState(0)
  useEffect(() => {
    const element = ref.current
    if (!element) return
    const observer = new ResizeObserver(([entry]) => setWidth(Math.round(entry.contentRect.width)))
    observer.observe(element)
    return () => observer.disconnect()
  }, [ref])
  return width
}
