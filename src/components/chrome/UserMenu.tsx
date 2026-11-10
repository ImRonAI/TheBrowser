import { Menu, MenuButton, MenuItem, MenuItems } from '@headlessui/react'
import {
  ChevronDown,
  Settings,
  LogOut,
  UserCircle,
  Palette
} from 'lucide-react'
import { useAuthStore } from '@/stores/authStore'
import { openSignIn } from '@/lib/sign-in'
import { useUserPreferencesStore } from '@/stores/userPreferencesStore'
import { cn } from '@/utils/cn'

export function UserMenu() {
  const { user, isAuthenticated, logout } = useAuthStore()
  const { toggleTheme, theme } = useUserPreferencesStore()

  // Guests: a single entry point to the existing SignInPage (App.tsx renders it on `#signin`).
  if (!isAuthenticated) {
    return (
      <button
        type="button"
        onClick={() => openSignIn()}
        aria-label="Sign in to Ren"
        className={cn(
          'h-8 rounded-lg border px-3 text-[13px] font-semibold transition-colors duration-150 ease-out',
          'border-surface-200 bg-surface-0 text-ink hover:border-surface-300 hover:bg-surface-50',
          'dark:border-surface-700 dark:bg-surface-800 dark:text-ink-inverse dark:hover:border-surface-600 dark:hover:bg-surface-850',
        )}
      >
        Sign in
      </button>
    )
  }

  // toggleTheme steps through the appearance order in lib/theme.ts: light → dark → glass → system → light.
  const getThemeLabel = () => {
    switch (theme) {
      case 'light': return 'Theme: Light · switch to Dark'
      case 'dark': return 'Theme: Dark · switch to Glass'
      case 'glass': return 'Theme: Glass · switch to System'
      default: return 'Theme: System · switch to Light'
    }
  }

  const initial = user?.name?.charAt(0).toUpperCase() || user?.email?.charAt(0).toUpperCase() || 'U'
  const itemClass = 'flex h-8 w-full items-center gap-2.5 rounded-lg px-2.5 text-left text-[13px] text-popover-foreground transition-colors duration-150 data-[focus]:bg-muted'
  const iconClass = 'h-4 w-4 flex-shrink-0 text-muted-foreground'

  return (
    <Menu as="div" className="relative">
      <MenuButton
        aria-label="Account menu"
        className={cn(
          'flex h-8 items-center gap-1 rounded-lg pl-1 pr-1.5 transition-colors duration-150 ease-out',
          'hover:bg-ink/[0.06] data-[open]:bg-ink/[0.07] dark:hover:bg-ink-inverse/[0.07] dark:data-[open]:bg-ink-inverse/[0.09]',
          '[&[data-open]_svg]:rotate-180',
        )}
      >
        <span className="relative flex h-6 w-6 items-center justify-center rounded-full bg-ink font-display text-[11px] font-bold text-white dark:bg-ink-inverse dark:text-ink">
          {initial}
          {/* Signed-in indicator */}
          <span className="absolute -bottom-px -right-px h-2 w-2 rounded-full border-[1.5px] border-surface-100 bg-success dark:border-surface-950" aria-hidden />
        </span>
        <ChevronDown className="h-3 w-3 text-ink-secondary transition-transform duration-200 dark:text-ink-inverse-secondary" />
      </MenuButton>

      <MenuItems
        transition
        className={cn(
          'absolute right-0 z-[9999] mt-2 w-64 origin-top-right overflow-hidden rounded-xl border border-border bg-popover p-1 text-popover-foreground shadow-float focus:outline-none',
          'transition duration-150 ease-out data-[closed]:-translate-y-1 data-[closed]:scale-[0.98] data-[closed]:opacity-0',
        )}
      >
        {/* User info header */}
        <div className="flex items-center gap-3 px-2.5 py-2.5">
          <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-ink font-display text-base font-bold text-white dark:bg-ink-inverse dark:text-ink">
            {user?.name?.charAt(0).toUpperCase() || 'U'}
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-[13px] font-semibold text-popover-foreground">{user?.name}</p>
            <p className="truncate text-[12px] text-muted-foreground">{user?.email}</p>
          </div>
        </div>

        <div className="-mx-1 my-1 h-px bg-border" />

        <MenuItem>
          <button onClick={() => console.log('Profile')} className={itemClass}>
            <UserCircle className={iconClass} />
            Profile
          </button>
        </MenuItem>

        <MenuItem>
          <button onClick={toggleTheme} className={itemClass}>
            <Palette className={iconClass} />
            {getThemeLabel()}
          </button>
        </MenuItem>

        <MenuItem>
          <button onClick={() => console.log('Settings')} className={itemClass}>
            <Settings className={iconClass} />
            Settings
          </button>
        </MenuItem>

        <div className="-mx-1 my-1 h-px bg-border" />
        <MenuItem>
          <button
            onClick={logout}
            className="flex h-8 w-full items-center gap-2.5 rounded-lg px-2.5 text-left text-[13px] font-medium text-danger transition-colors duration-150 data-[focus]:bg-red-50 dark:data-[focus]:bg-red-950/40"
          >
            <LogOut className="h-4 w-4 flex-shrink-0" />
            Sign out
          </button>
        </MenuItem>
      </MenuItems>
    </Menu>
  )
}
