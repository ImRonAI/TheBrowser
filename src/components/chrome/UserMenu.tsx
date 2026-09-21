import { Menu, MenuButton, MenuItem, MenuItems } from '@headlessui/react'
import { 
  ChevronDown, 
  Settings, 
  LogOut,
  UserCircle,
  Palette
} from 'lucide-react'
import { useAuthStore } from '@/stores/authStore'
import { useUserPreferencesStore } from '@/stores/userPreferencesStore'
import { cn } from '@/utils/cn'

export function UserMenu() {
  const { user, logout } = useAuthStore()
  const { toggleTheme, theme } = useUserPreferencesStore()

  const getThemeLabel = () => {
    switch (theme) {
      case 'dark': return 'Switch to Light'
      case 'glass': return 'Switch to Dark'
      default: return 'Switch to Glass'
    }
  }

  return (
    <Menu as="div" className="relative">
      <MenuButton
        className={cn(
          "flex items-center gap-2 p-1.5 rounded-xl transition-all duration-200",
          "hover:bg-white/60 dark:hover:bg-white/5 glass:hover:bg-white/40",
          "hover:scale-[1.02] active:scale-[0.98]",
          "data-[open]:bg-white/60 dark:data-[open]:bg-white/5 glass:data-[open]:bg-white/40",
          "[&[data-open]_svg]:rotate-180"
        )}
      >
        {/* User Avatar */}
        <div className="relative">
          <div className={cn(
            "w-8 h-8 rounded-full flex items-center justify-center",
            "bg-gradient-to-br from-royal to-royal-purple dark:from-royal-light dark:to-royal-purple",
            "shadow-md"
          )}>
            <span className="text-white text-sm font-georgia">
              {user?.name?.charAt(0).toUpperCase() || 'U'}
            </span>
          </div>
          {/* Online indicator */}
          <div className="absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full bg-emerald-500 border-2 border-white dark:border-ron-black glass:border-white/80" />
        </div>
        <ChevronDown className={cn(
          "w-3 h-3 transition-transform duration-200",
          "text-ron-text/50 dark:text-white/50 glass:text-zinc-500"
        )} />
      </MenuButton>

      <MenuItems
        transition
        className={cn(
          "absolute right-0 mt-3 w-64 origin-top-right z-[9999]",
          "rounded-xl overflow-hidden",
          "bg-white dark:bg-zinc-900",
          "shadow-2xl shadow-black/20 dark:shadow-black/60",
          "border border-black/10 dark:border-white/10",
          "focus:outline-none",
          "transition ease-smooth duration-200 data-[closed]:translate-y-2 data-[closed]:scale-95 data-[closed]:opacity-0"
        )}
      >
        <div className="p-2">
          {/* User info header */}
          <div className="px-3 py-3 mb-2 rounded-lg bg-white/30 dark:bg-white/5 glass:bg-white/20">
            <div className="flex items-center gap-3">
              <div className={cn(
                "w-10 h-10 rounded-full flex items-center justify-center",
                "bg-gradient-to-br from-royal to-royal-purple dark:from-royal-light dark:to-royal-purple"
              )}>
                <span className="text-white text-lg font-georgia">
                  {user?.name?.charAt(0).toUpperCase() || 'U'}
                </span>
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-georgia text-ron-text dark:text-white glass:text-zinc-800 truncate">
                  {user?.name}
                </p>
                <p className="text-xs font-raleway font-raleway-light text-ron-text/50 dark:text-white/50 glass:text-zinc-500 truncate">
                  {user?.email}
                </p>
              </div>
            </div>
          </div>

          {/* Divider */}
          <div className="h-px bg-gradient-to-r from-transparent via-ron-text/10 dark:via-white/10 glass:via-zinc-400/30 to-transparent my-2" />

          {/* Menu items */}
          <MenuItem>
            <button
              onClick={() => console.log('Profile')}
              className={cn(
                'w-full flex items-center gap-3 px-3 py-2.5 rounded-lg transition-colors',
                'bg-transparent data-[focus]:bg-white/50 dark:data-[focus]:bg-white/5 glass:data-[focus]:bg-white/30'
              )}
            >
              <UserCircle className="w-4 h-4 text-ron-text/60 dark:text-white/60 glass:text-zinc-600" />
              <span className="text-sm font-raleway text-ron-text dark:text-white glass:text-zinc-800">
                Profile
              </span>
            </button>
          </MenuItem>

          <MenuItem>
            <button
              onClick={toggleTheme}
              className={cn(
                'w-full flex items-center gap-3 px-3 py-2.5 rounded-lg transition-colors',
                'bg-transparent data-[focus]:bg-white/50 dark:data-[focus]:bg-white/5 glass:data-[focus]:bg-white/30'
              )}
            >
              <Palette className="w-4 h-4 text-ron-text/60 dark:text-white/60 glass:text-zinc-600" />
              <span className="text-sm font-raleway text-ron-text dark:text-white glass:text-zinc-800">
                {getThemeLabel()}
              </span>
            </button>
          </MenuItem>

          <MenuItem>
            <button
              onClick={() => console.log('Settings')}
              className={cn(
                'w-full flex items-center gap-3 px-3 py-2.5 rounded-lg transition-colors',
                'bg-transparent data-[focus]:bg-white/50 dark:data-[focus]:bg-white/5 glass:data-[focus]:bg-white/30'
              )}
            >
              <Settings className="w-4 h-4 text-ron-text/60 dark:text-white/60 glass:text-zinc-600" />
              <span className="text-sm font-raleway text-ron-text dark:text-white glass:text-zinc-800">
                Settings
              </span>
            </button>
          </MenuItem>

          {/* Divider */}
          <div className="h-px bg-gradient-to-r from-transparent via-ron-text/10 dark:via-white/10 glass:via-zinc-400/30 to-transparent my-2" />

          {/* Sign out */}
          <MenuItem>
            <button
              onClick={logout}
              className={cn(
                'w-full flex items-center gap-3 px-3 py-2.5 rounded-lg transition-colors',
                'bg-transparent data-[focus]:bg-red-50 dark:data-[focus]:bg-red-900/20 glass:data-[focus]:bg-red-100/50'
              )}
            >
              <LogOut className="w-4 h-4 text-red-500 dark:text-red-400" />
              <span className="text-sm font-raleway font-raleway-bold text-red-500 dark:text-red-400">
                Sign Out
              </span>
            </button>
          </MenuItem>
        </div>
      </MenuItems>
    </Menu>
  )
}
