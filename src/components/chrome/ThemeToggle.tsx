import { Menu, MenuButton, MenuItem, MenuItems } from '@headlessui/react'
import { Check, Monitor, Moon, Sun, type LucideIcon } from 'lucide-react'
import { useTheme } from '@/hooks/useTheme'
import { THEME_OPTIONS, type ThemeName } from '@/lib/theme'
import { cn } from '@/utils/cn'

/** A frosted pane glyph for Glass (lucide has no exact match). */
function GlassIcon({ className, strokeWidth = 1.75 }: { className?: string; strokeWidth?: number }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      <rect x="3.5" y="3.5" width="17" height="17" rx="4" />
      <path d="M7.5 15.5 15.5 7.5M11 17l6-6" opacity="0.55" />
    </svg>
  )
}

const ICONS: Record<ThemeName, LucideIcon | typeof GlassIcon> = {
  light: Sun,
  dark: Moon,
  glass: GlassIcon,
  system: Monitor,
}

const HINTS: Record<ThemeName, string> = {
  light: 'Warm paper',
  dark: 'Graphite',
  glass: 'Translucent shell over your desktop',
  system: 'Follow macOS appearance',
}

/**
 * Appearance menu in the toolbar: Light, Dark, Glass and System. Glass makes the
 * browser shell (sidebar, toolbar, tab strip, panels, Ron's own pages) translucent
 * over native macOS Liquid Glass (vibrancy before macOS 26); websites stay opaque.
 */
export function ThemeToggle() {
  const { theme, setTheme } = useTheme()
  const Current = ICONS[theme] ?? Moon
  const label = `Appearance: ${THEME_OPTIONS.find((option) => option.id === theme)?.label ?? 'Dark'}`

  return (
    <Menu as="div" className="relative">
      <MenuButton
        aria-label={label}
        title={label}
        className={cn(
          'flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg transition-colors duration-150',
          'text-ink-secondary hover:bg-surface-200/60 hover:text-ink data-[open]:bg-surface-200/60 data-[open]:text-ink',
          'dark:text-ink-inverse-secondary dark:hover:bg-surface-800 dark:hover:text-ink-inverse dark:data-[open]:bg-surface-800 dark:data-[open]:text-ink-inverse',
        )}
      >
        <Current className="h-[17px] w-[17px]" strokeWidth={1.75} />
      </MenuButton>
      <MenuItems
        transition
        anchor={{ to: 'bottom end', gap: 8 }}
        className={cn(
          'z-[9999] w-60 origin-top-right rounded-xl p-1 ron-popover',
          'border border-surface-200 bg-surface-0 dark:border-surface-700 dark:bg-surface-850',
          'shadow-[0_18px_48px_-18px_rgb(26_25_23/0.28)] focus:outline-none',
          'transition duration-150 ease-smooth data-[closed]:-translate-y-1 data-[closed]:scale-[0.98] data-[closed]:opacity-0',
        )}
      >
        <p className="px-2.5 pb-1 pt-1.5 text-[11px] font-medium text-ink-muted dark:text-ink-inverse-muted">Appearance</p>
        {THEME_OPTIONS.map((option) => {
          const Icon = ICONS[option.id]
          const active = theme === option.id
          return (
            <MenuItem key={option.id}>
              <button
                type="button"
                onClick={() => setTheme(option.id)}
                aria-checked={active}
                role="menuitemradio"
                className="flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left transition-colors data-[focus]:bg-surface-100 dark:data-[focus]:bg-surface-800"
              >
                <Icon className="h-4 w-4 flex-shrink-0 text-ink-secondary dark:text-ink-inverse-secondary" strokeWidth={1.75} />
                <span className="min-w-0 flex-1">
                  <span className="block text-[13px] font-medium text-ink dark:text-ink-inverse">{option.label}</span>
                  <span className="block truncate text-[11.5px] text-ink-muted dark:text-ink-inverse-muted">{HINTS[option.id]}</span>
                </span>
                {active && <Check className="h-3.5 w-3.5 flex-shrink-0 text-accent dark:text-accent-light" strokeWidth={2.5} />}
              </button>
            </MenuItem>
          )
        })}
      </MenuItems>
    </Menu>
  )
}
