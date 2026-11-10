import { useId, useState } from 'react'
import { motion, useReducedMotion } from 'framer-motion'
import { ArrowRight } from 'lucide-react'
import { useAuthStore } from '@/stores/authStore'
import { cn } from '@/utils/cn'

// Ren's house curve (docs/brand.md § Shape and depth: ease-out-expo)
const EASE = [0.19, 1, 0.22, 1] as const

// Provider marks are drawn in currentColor so they sit in the ink system on every theme.
function GoogleIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden focusable="false">
      <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
      <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
      <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
      <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
    </svg>
  )
}

function GitHubIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden focusable="false">
      <path d="M12 .5a11.5 11.5 0 0 0-3.64 22.41c.58.1.79-.25.79-.56v-2c-3.2.7-3.88-1.37-3.88-1.37-.53-1.33-1.28-1.69-1.28-1.69-1.05-.71.08-.7.08-.7 1.16.08 1.77 1.19 1.77 1.19 1.03 1.77 2.71 1.26 3.37.96.1-.75.4-1.26.73-1.55-2.55-.29-5.24-1.28-5.24-5.69 0-1.26.45-2.29 1.19-3.09-.12-.29-.52-1.46.11-3.05 0 0 .97-.31 3.17 1.18a11 11 0 0 1 5.77 0c2.2-1.49 3.17-1.18 3.17-1.18.63 1.59.23 2.76.11 3.05.74.8 1.19 1.83 1.19 3.09 0 4.42-2.69 5.39-5.26 5.68.41.36.78 1.06.78 2.14v3.17c0 .31.21.67.8.56A11.5 11.5 0 0 0 12 .5Z" />
    </svg>
  )
}

function MicrosoftIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden focusable="false">
      <path d="M1 1h10v10H1z" />
      <path d="M1 13h10v10H1z" />
      <path d="M13 1h10v10H13z" />
      <path d="M13 13h10v10H13z" />
    </svg>
  )
}

const inputClass = 'block h-11 w-full rounded-lg border border-surface-200 bg-surface-0 px-3.5 text-[14px] text-ink placeholder:text-ink-muted transition-colors duration-150 hover:border-surface-300 focus:border-blurple-500 focus:outline-none dark:border-surface-800 dark:bg-surface-900 dark:text-ink-inverse dark:placeholder:text-ink-inverse-muted dark:hover:border-surface-700 dark:focus:border-blurple-400'

export function SignInPage({ onContinueAsGuest }: { onContinueAsGuest?: () => void } = {}) {
  const [isSignUp, setIsSignUp] = useState(false)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')
  const [isFocused, setIsFocused] = useState<string | null>(null)
  const { login, signup, loginWithOAuth, isLoading, error, clearError } = useAuthStore()
  const reduceMotion = useReducedMotion()
  const fieldId = useId()

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (isSignUp) {
      await signup(email, password, name)
    } else {
      await login(email, password)
    }
  }

  const toggleMode = () => {
    setIsSignUp(!isSignUp)
    clearError()
    // Reset form but keep email if anticipated
    if (!isSignUp) {
      // Switching to Sign Up
      setPassword('')
    } else {
      // Switching to Sign In
      setPassword('')
      setName('')
    }
  }

  const rise = (delay: number) => ({
    initial: { opacity: 0, y: reduceMotion ? 0 : 12 },
    animate: { opacity: 1, y: 0 },
    transition: { duration: 0.5, delay, ease: EASE },
  })

  // The focused field's label turns volt.
  const labelClass = (field: string) => cn(
    'block font-mono text-[11px] font-medium uppercase tracking-[0.08em] transition-colors duration-150',
    isFocused === field ? 'text-blurple-700 dark:text-blurple-300' : 'text-ink-secondary dark:text-ink-inverse-secondary',
  )

  return (
    <div className="space-y-7">
      {/* Header */}
      <motion.div {...rise(0)} key={isSignUp ? 'signup-header' : 'signin-header'}>
        <h2 className="font-display text-display-sm font-extrabold tracking-[-0.035em] text-ink dark:text-ink-inverse">
          {isSignUp ? 'Create your account' : 'Welcome back'}
        </h2>
        <p className="mt-2 text-[14px] leading-relaxed text-ink-secondary dark:text-ink-inverse-secondary">
          {isSignUp ? 'Keep your agents, music and projects in one place.' : 'Sign in to pick up where you left off.'}
        </p>
      </motion.div>

      {/* Error message */}
      {error && (
        <motion.div
          className="rounded-lg border border-red-200 bg-red-50 px-3.5 py-3 text-[13px] leading-relaxed text-red-700 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-300"
          initial={{ opacity: 0, y: reduceMotion ? 0 : -4 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.2, ease: EASE }}
        >
          {error.message}
        </motion.div>
      )}

      {/* Sign in/up form */}
      <motion.form onSubmit={handleSubmit} className="space-y-4" {...rise(0.08)}>
        {/* Name field (Sign Up only) */}
        {isSignUp && (
          <motion.div
            className="space-y-2"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
          >
            <label htmlFor={`${fieldId}-name`} className={labelClass('name')}>
              Name
            </label>
            <input
              id={`${fieldId}-name`}
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onFocus={() => setIsFocused('name')}
              onBlur={() => setIsFocused(null)}
              placeholder="Your name"
              required={isSignUp}
              className={inputClass}
            />
          </motion.div>
        )}

        {/* Email field */}
        <div className="space-y-2">
          <label htmlFor={`${fieldId}-email`} className={labelClass('email')}>
            Email
          </label>
          <input
            id={`${fieldId}-email`}
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            onFocus={() => setIsFocused('email')}
            onBlur={() => setIsFocused(null)}
            placeholder="you@example.com"
            required
            className={inputClass}
          />
        </div>

        {/* Password field */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <label htmlFor={`${fieldId}-password`} className={labelClass('password')}>
              Password
            </label>
            {!isSignUp && (
              <a href="#" className="text-[12px] font-medium text-blurple-700 underline-offset-2 hover:underline dark:text-blurple-300">
                Forgot password?
              </a>
            )}
          </div>
          <input
            id={`${fieldId}-password`}
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onFocus={() => setIsFocused('password')}
            onBlur={() => setIsFocused(null)}
            placeholder="••••••••"
            required
            className={inputClass}
          />
        </div>

        {/* Submit button */}
        <button
          type="submit"
          disabled={isLoading}
          className="!mt-6 inline-flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-blurple-600 px-4 text-[14px] font-semibold text-white transition-colors duration-150 hover:bg-blurple-700 active:translate-y-px active:bg-blurple-800 disabled:pointer-events-none disabled:opacity-40 dark:bg-blurple-400 dark:text-ink dark:hover:bg-blurple-300"
        >
          {isLoading ? (
            <span className="flex items-center justify-center gap-2">
              <motion.span
                aria-hidden
                className="h-4 w-4 rounded-full border-2 border-current border-r-transparent"
                animate={{ rotate: 360 }}
                transition={{ duration: 0.9, repeat: Infinity, ease: 'linear' }}
              />
              {isSignUp ? 'Creating your account…' : 'Signing in…'}
            </span>
          ) : (
            isSignUp ? 'Create account' : 'Sign in'
          )}
        </button>
      </motion.form>

      {/* Divider */}
      <motion.div
        className="flex items-center gap-3"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.5, delay: 0.16, ease: EASE }}
      >
        <span className="h-px flex-1 bg-surface-200 dark:bg-surface-800" />
        <span className="font-mono text-[11px] font-medium uppercase tracking-[0.08em] text-ink-secondary dark:text-ink-inverse-muted">
          Or continue with
        </span>
        <span className="h-px flex-1 bg-surface-200 dark:bg-surface-800" />
      </motion.div>

      {/* OAuth buttons */}
      <motion.div className="flex gap-2.5" {...rise(0.22)}>
        {[
          { provider: 'google' as const, icon: GoogleIcon, label: 'Google' },
          { provider: 'github' as const, icon: GitHubIcon, label: 'GitHub' },
          // Only providers enabled in the Supabase project (Authentication -> Providers).
          // Microsoft (Supabase "azure") is not configured yet; flip VITE_AUTH_MICROSOFT=1 when it is.
          ...(import.meta.env.VITE_AUTH_MICROSOFT === '1'
            ? [{ provider: 'microsoft' as const, icon: MicrosoftIcon, label: 'Microsoft' }]
            : []),
        ].map(({ provider, icon: Icon, label }) => (
          <button
            key={provider}
            type="button"
            onClick={() => loginWithOAuth(provider)}
            className="inline-flex h-11 min-w-0 flex-1 items-center justify-center gap-2 rounded-lg border border-surface-200 bg-surface-0 px-3 text-[13px] font-semibold text-ink transition-colors duration-150 hover:border-surface-300 hover:bg-surface-50 active:translate-y-px dark:border-surface-800 dark:bg-surface-900 dark:text-ink-inverse dark:hover:border-surface-700 dark:hover:bg-surface-850"
            aria-label={`Sign in with ${label}`}
          >
            <Icon className="h-4 w-4 flex-shrink-0" />
            <span className="truncate">{label}</span>
          </button>
        ))}
      </motion.div>

      {/* Sign up/in toggle link */}
      <motion.p
        className="text-[13px] text-ink-secondary dark:text-ink-inverse-secondary"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.5, delay: 0.3, ease: EASE }}
      >
        {isSignUp ? 'Already have an account? ' : 'New to Ren? '}
        <button
          type="button"
          onClick={toggleMode}
          className="rounded font-semibold text-blurple-700 underline-offset-2 hover:underline dark:text-blurple-300"
        >
          {isSignUp ? 'Sign in' : 'Create an account'}
        </button>
      </motion.p>

      {onContinueAsGuest && <motion.div
        className="border-t border-surface-200 pt-6 dark:border-surface-800"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.5, delay: 0.38, ease: EASE }}
      >
        <button
          type="button"
          onClick={onContinueAsGuest}
          className="group inline-flex h-11 w-full items-center justify-center gap-2 rounded-lg border border-dashed border-surface-300 px-4 text-[13px] font-semibold text-ink-secondary transition-colors duration-150 hover:border-blurple-500 hover:text-ink dark:border-surface-700 dark:text-ink-inverse-secondary dark:hover:border-blurple-400 dark:hover:text-ink-inverse"
        >
          Continue as guest
          <ArrowRight className="h-4 w-4 transition-transform duration-200 ease-out group-hover:translate-x-0.5" />
        </button>
        <p className="mt-2.5 text-center text-[12px] leading-relaxed text-ink-secondary dark:text-ink-inverse-muted">
          Guests can browse and talk to Ren. Saving songs, playlists and specialists needs an account.
        </p>
      </motion.div>}
    </div>
  )
}
