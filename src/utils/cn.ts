/**
 * Utility function to merge Tailwind CSS classes with proper precedence
 * Combines clsx for conditional classes with tailwind-merge for deduplication.
 * The same helper as `@/lib/utils`, so both know the config's custom font sizes.
 */
export { cn } from '../lib/utils.ts'