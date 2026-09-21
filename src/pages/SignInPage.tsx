import { useState } from 'react'
import { motion } from 'framer-motion'
import { useAuthStore } from '@/stores/authStore'
import { useOnboardingStore } from '@/stores/onboardingStore'

// Sophisticated easing
const EASE = [0.16, 1, 0.3, 1] as const

// Brand icons with refined styling
function GoogleIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24">
      <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
      <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
      <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
      <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
    </svg>
  )
}

function AppleIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.81-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M13 3.5c.73-.83 1.94-1.46 2.94-1.5.13 1.17-.34 2.35-1.04 3.19-.69.85-1.83 1.51-2.95 1.42-.15-1.15.41-2.35 1.05-3.11z" />
    </svg>
  )
}

function MicrosoftIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24">
      <path fill="#F25022" d="M1 1h10v10H1z" />
      <path fill="#00A4EF" d="M1 13h10v10H1z" />
      <path fill="#7FBA00" d="M13 1h10v10H13z" />
      <path fill="#FFB900" d="M13 13h10v10H13z" />
    </svg>
  )
}

export function SignInPage() {
  const [isSignUp, setIsSignUp] = useState(false)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')
  const [isFocused, setIsFocused] = useState<string | null>(null)
  const { login, signup, loginWithOAuth, isLoading, error, clearError } = useAuthStore()

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

  return (
    <div className="space-y-8">
      {/* Header */}
      <motion.div 
        className="text-center"
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, ease: EASE }}
        key={isSignUp ? 'signup-header' : 'signin-header'}
      >
        <h2 className="text-display-sm font-display text-ink dark:text-ink-inverse">
          {isSignUp ? 'Create an account' : 'Welcome back'}
        </h2>
        <p className="mt-3 text-body-md text-ink-secondary dark:text-ink-inverse-secondary">
          {isSignUp ? 'Join us to start your journey' : 'Sign in to continue your journey'}
        </p>
      </motion.div>

      {/* Error message */}
      {error && (
        <motion.div 
          className="p-4 rounded-xl bg-danger/10 border border-danger/20 text-danger text-body-sm"
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.3, ease: EASE }}
        >
          {error.message}
        </motion.div>
      )}

      {/* Sign in/up form */}
      <motion.form 
        onSubmit={handleSubmit} 
        className="space-y-5"
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, delay: 0.1, ease: EASE }}
      >
        {/* Name field (Sign Up only) */}
        {isSignUp && (
          <motion.div
            className="space-y-2"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
          >
            <label className="block text-label text-ink-secondary dark:text-ink-inverse-secondary uppercase tracking-wider">
              Full Name
            </label>
            <div className="relative">
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                onFocus={() => setIsFocused('name')}
                onBlur={() => setIsFocused(null)}
                placeholder="John Doe"
                required={isSignUp}
                className="input"
              />
              <motion.div 
                className="absolute bottom-0 left-0 right-0 h-0.5 bg-accent dark:bg-accent-light rounded-full"
                initial={{ scaleX: 0 }}
                animate={{ scaleX: isFocused === 'name' ? 1 : 0 }}
                transition={{ duration: 0.3, ease: EASE }}
              />
            </div>
          </motion.div>
        )}

        {/* Email field */}
        <div className="space-y-2">
          <label className="block text-label text-ink-secondary dark:text-ink-inverse-secondary uppercase tracking-wider">
            Email
          </label>
          <div className="relative">
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              onFocus={() => setIsFocused('email')}
              onBlur={() => setIsFocused(null)}
              placeholder="you@example.com"
              required
              className="input"
            />
            <motion.div 
              className="absolute bottom-0 left-0 right-0 h-0.5 bg-accent dark:bg-accent-light rounded-full"
              initial={{ scaleX: 0 }}
              animate={{ scaleX: isFocused === 'email' ? 1 : 0 }}
              transition={{ duration: 0.3, ease: EASE }}
            />
          </div>
        </div>

        {/* Password field */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <label className="block text-label text-ink-secondary dark:text-ink-inverse-secondary uppercase tracking-wider">
              Password
            </label>
            {!isSignUp && (
              <a href="#" className="text-body-xs text-accent dark:text-accent-light hover:underline">
                Forgot?
              </a>
            )}
          </div>
          <div className="relative">
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onFocus={() => setIsFocused('password')}
              onBlur={() => setIsFocused(null)}
              placeholder="••••••••"
              required
              className="input"
            />
            <motion.div 
              className="absolute bottom-0 left-0 right-0 h-0.5 bg-accent dark:bg-accent-light rounded-full"
              initial={{ scaleX: 0 }}
              animate={{ scaleX: isFocused === 'password' ? 1 : 0 }}
              transition={{ duration: 0.3, ease: EASE }}
            />
          </div>
        </div>

        {/* Submit button */}
        <motion.button
          type="submit"
          disabled={isLoading}
          className="
            w-full py-4 px-6 mt-2
            bg-accent hover:bg-accent-light
            dark:bg-accent-light dark:hover:bg-accent-muted
            text-white text-body-md font-semibold
            rounded-xl
            transition-all duration-300 ease-smooth
            disabled:opacity-50 disabled:cursor-not-allowed
            hover:shadow-glow-accent
            active:scale-[0.98]
          "
          whileHover={{ y: -1 }}
          whileTap={{ scale: 0.98 }}
        >
          {isLoading ? (
            <span className="flex items-center justify-center gap-2">
              <motion.span 
                className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full"
                animate={{ rotate: 360 }}
                transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
              />
              {isSignUp ? 'Creating Account...' : 'Signing in...'}
            </span>
          ) : (
            isSignUp ? 'Sign Up' : 'Sign In'
          )}
        </motion.button>
      </motion.form>

      {/* Divider */}
      <motion.div 
        className="relative"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.6, delay: 0.2, ease: EASE }}
      >
        <div className="absolute inset-0 flex items-center">
          <div className="w-full border-t border-surface-200 dark:border-surface-700" />
        </div>
        <div className="relative flex justify-center">
          <span className="px-4 bg-surface-0 dark:bg-surface-850 text-body-xs text-ink-muted dark:text-ink-inverse-muted uppercase tracking-wider">
            Or continue with
          </span>
        </div>
      </motion.div>

      {/* OAuth buttons */}
      <motion.div 
        className="flex justify-center gap-4"
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, delay: 0.3, ease: EASE }}
      >
        {[
          { provider: 'google' as const, icon: GoogleIcon, label: 'Google' },
          { provider: 'apple' as const, icon: AppleIcon, label: 'Apple' },
          { provider: 'microsoft' as const, icon: MicrosoftIcon, label: 'Microsoft' },
        ].map(({ provider, icon: Icon, label }) => (
          <motion.button
            key={provider}
            onClick={() => loginWithOAuth(provider)}
            className="
              p-4 rounded-xl
              bg-surface-50 dark:bg-surface-800
              border border-surface-200 dark:border-surface-700
              hover:border-accent/30 dark:hover:border-accent-light/30
              hover:bg-surface-100 dark:hover:bg-surface-700
              transition-all duration-200
              group
            "
            whileHover={{ y: -2, scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            aria-label={`Sign in with ${label}`}
        >
            <Icon className={`w-5 h-5 ${provider === 'apple' ? 'text-ink dark:text-ink-inverse' : ''}`} />
          </motion.button>
        ))}
      </motion.div>

      {/* Sign up/in toggle link */}
      <motion.p 
        className="text-center text-body-sm text-ink-secondary dark:text-ink-inverse-secondary"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.6, delay: 0.4, ease: EASE }}
      >
        {isSignUp ? 'Already have an account? ' : "Don't have an account? "}
        <button
          onClick={toggleMode}
          className="text-accent dark:text-accent-light font-medium hover:underline focus:outline-none"
        >
          {isSignUp ? 'Sign in' : 'Create one'}
        </button>
      </motion.p>

      {/* Dev: Skip auth button */}
      <motion.div 
        className="pt-6 border-t border-surface-200 dark:border-surface-700"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.6, delay: 0.5, ease: EASE }}
      >
        <button
          onClick={() => {
            // Set authenticated but DO NOT complete onboarding
            // This will redirect to onboarding questions
            useAuthStore.setState({
              isAuthenticated: true,
              user: {
                id: 'dev-user',
                email: 'dev@ron.ai',
                name: 'Guest',
                tenantId: 'dev-user',
                preferences: {
                  theme: 'dark',
                  interactionMode: 'type',
                  searchMode: 'ai-web',
                  contentDensity: 'comfortable',
                  showAnimations: true,
                  reduceMotion: false,
                },
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
              }
            })
            // Reset onboarding to start fresh
            useOnboardingStore.setState({
              isComplete: false,
              currentStep: 'mode-selection',
              currentQuestionIndex: 0,
              answers: [],
            })
          }}
          className="
            w-full py-3.5 px-4
            text-body-sm text-ink-muted dark:text-ink-inverse-muted
            rounded-xl
            border border-dashed border-surface-200 dark:border-surface-700
            hover:border-accent hover:text-accent 
            dark:hover:border-accent-light dark:hover:text-accent-light
            transition-all duration-200
            group
          "
        >
          <span className="flex items-center justify-center gap-2">
            Continue without signing in
            <motion.span 
              className="inline-block"
              initial={{ x: 0 }}
              whileHover={{ x: 4 }}
              transition={{ duration: 0.2 }}
            >
              →
            </motion.span>
          </span>
        </button>
      </motion.div>
    </div>
  )
}
