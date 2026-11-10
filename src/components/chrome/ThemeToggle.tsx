import { Menu, MenuButton, MenuItem, MenuItems } from '@headlessui/react'
import { Monitor, Moon, Sun, type LucideIcon } from 'lucide-react'
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
  light: 'Crisp paper, ink type',
  dark: 'Blue-black ink, easy on the eyes',
  glass: 'Blue glass over your desktop. Websites stay opaque.',
  system: 'Follows your system appearance',
}

/**
 * Appearance control in the toolbar: Light, Dark, Glass and System, laid out as a segmented
 * control inside the menu (same menu, radio items and keyboard handling as before). Glass makes
 * the browser shell (sidebar, toolbar, tab strip, panels, Ren's own pages) translucent over native
 * macOS Liquid Glass (vibrancy before macOS 26); websites stay opaque.
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
          'flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg transition-colors duration-150 ease-out',
          'text-ink-secondary hover:bg-ink/[0.06] hover:text-ink data-[open]:bg-ink/[0.07] data-[open]:text-ink',
          'dark:text-ink-inverse-secondary dark:hover:bg-ink-inverse/[0.07] dark:hover:text-ink-inverse dark:data-[open]:bg-ink-inverse/[0.09] dark:data-[open]:text-ink-inverse',
        )}
      >
        <Current className="h-4 w-4" strokeWidth={1.75} />
      </MenuButton>
      <MenuItems
        transition
        anchor={{ to: 'bottom end', gap: 8 }}
        className={cn(
          'z-[9999] w-[324px] origin-top-right rounded-xl border border-border bg-popover p-2 text-popover-foreground shadow-float focus:outline-none',
          'transition duration-150 ease-out data-[closed]:-translate-y-1 data-[closed]:scale-[0.98] data-[closed]:opacity-0',
        )}
      >
        <p className="px-1 pb-2 pt-0.5 font-mono text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">Appearance</p>
        <div className="flex gap-0.5 rounded-full bg-surface-100 p-0.5 dark:bg-surface-950/60">
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
                  title={HINTS[option.id]}
                  className={cn(
                    'flex h-8 min-w-0 flex-1 items-center justify-center gap-1 rounded-full px-1.5 text-[12px] font-medium transition-colors duration-150 ease-out',
                    active
                      ? 'bg-surface-0 text-ink shadow-sm dark:bg-surface-700 dark:text-ink-inverse'
                      : 'text-ink-secondary data-[focus]:bg-surface-0/70 data-[focus]:text-ink dark:text-ink-inverse-secondary dark:data-[focus]:bg-surface-700/60 dark:data-[focus]:text-ink-inverse',
                    'data-[focus]:ring-2 data-[focus]:ring-inset data-[focus]:ring-blurple-600/60 dark:data-[focus]:ring-blurple-400/60',
                  )}
                >
                  <Icon className={cn('h-3.5 w-3.5 flex-shrink-0', active && 'text-volt')} strokeWidth={1.75} />
                  <span className="truncate">{option.label}</span>
                </button>
              </MenuItem>
            )
          })}
        </div>
        <p className="px-1 pb-0.5 pt-2 text-[12px] leading-snug text-muted-foreground">{HINTS[theme]}</p>
      </MenuItems>
    </Menu>
  )
}
