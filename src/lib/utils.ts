import { clsx, type ClassValue } from "clsx"
import { extendTailwindMerge } from "tailwind-merge"

/**
 * The custom `fontSize` keys in tailwind.config.ts. tailwind-merge reads an
 * unknown `text-*` class as a text colour, so without these
 * `cn('text-body-sm', 'text-ink')` dropped the size. Keep the list in step
 * with the config (utils.test.ts checks it).
 */
export const CUSTOM_FONT_SIZES = [
  "display-2xl",
  "display-xl",
  "display-lg",
  "display-md",
  "display-sm",
  "body-xl",
  "body-lg",
  "body-md",
  "body-sm",
  "body-xs",
  "label",
]

const twMerge = extendTailwindMerge({ extend: { theme: { text: CUSTOM_FONT_SIZES } } })

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
