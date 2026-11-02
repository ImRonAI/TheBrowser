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
        aria-label="Sign in to Ron"
        className={cn(
          'h-8 rounded-lg px-2.5 text-[12.5px] font-medium transition-colors duration-150',
          'text-ink-secondary hover:bg-surface-200/60 hover:text-ink',
          'dark:text-ink-inverse-secondary dark:hover:bg-surface-800 dark:hover:text-ink-inverse',
        )}
      >
        Sign in
      </button>
    )
  }

  // toggleTheme cycles system → dark → light → system.
  const getThemeLabel = () => {
    switch (theme) {
      case 'system': return 'Theme: System · switch to Dark'
      case 'dark': return 'Theme: Dark · switch to Light'
      default: return 'Theme: Light · switch to System'
    }
  }

  const initial = user?.name?.charAt(0).toUpperCase() || user?.email?.charAt(0).toUpperCase() || 'U'
  const itemClass = 'flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left text-[13px] text-ink transition-colors data-[focus]:bg-surface-100 dark:text-ink-inverse dark:data-[focus]:bg-surface-800'
  const iconClass = 'h-4 w-4 text-ink-muted dark:text-ink-inverse-muted'

  return (
    <Menu as="div" className="relative">
      <MenuButton
        aria-label="Account menu"
        className={cn(
          'flex h-8 items-center gap-1 rounded-lg pl-1 pr-1.5 transition-colors duration-150',
          'hover:bg-surface-200/60 data-[open]:bg-surface-200/60 dark:hover:bg-surface-800 dark:data-[open]:bg-surface-800',
          '[&[data-open]_svg]:rotate-180',
        )}
      >
        <span className="relative flex h-6 w-6 items-center justify-center rounded-full bg-ink text-[11px] font-semibold text-surface-0 dark:bg-ink-inverse dark:text-surface-900">
          {initial}
          {/* Signed-in indicator */}
          <span className="absolute -bottom-px -right-px h-2 w-2 rounded-full border-[1.5px] border-surface-100 bg-success dark:border-surface-900" aria-hidden />
        </span>
        <ChevronDown className="h-3 w-3 text-ink-muted transition-transform duration-200 dark:text-ink-inverse-muted" />
      </MenuButton>

      <MenuItems
        transition
        className={cn(
          'absolute right-0 z-[9999] mt-2 w-64 origin-top-right overflow-hidden rounded-xl p-1 ron-popover',
          'border border-surface-200 bg-surface-0 dark:border-surface-700 dark:bg-surface-850',
          'shadow-[0_18px_48px_-18px_rgb(26_25_23/0.28)] focus:outline-none',
          'transition duration-150 ease-smooth data-[closed]:-translate-y-1 data-[closed]:scale-[0.98] data-[closed]:opacity-0',
        )}
      >
        {/* User info header */}
        <div className="flex items-center gap-3 px-2.5 py-2.5">
          <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-ink font-display text-base text-surface-0 dark:bg-ink-inverse dark:text-surface-900">
            {user?.name?.charAt(0).toUpperCase() || 'U'}
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-[13px] font-medium text-ink dark:text-ink-inverse">{user?.name}</p>
            <p className="truncate text-[12px] text-ink-muted dark:text-ink-inverse-muted">{user?.email}</p>
          </div>
        </div>

        <div className="mx-1 my-1 h-px bg-surface-200 dark:bg-surface-700" />

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

        <div className="mx-1 my-1 h-px bg-surface-200 dark:bg-surface-700" />
        <MenuItem>
          <button
            onClick={logout}
            className="flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left text-[13px] font-medium text-danger transition-colors data-[focus]:bg-danger/10"
          >
            <LogOut className="h-4 w-4" />
            Sign Out
          </button>
        </MenuItem>
      </MenuItems>
    </Menu>
  )
}
