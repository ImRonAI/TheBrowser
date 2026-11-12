import type { Config } from 'tailwindcss'
import plugin from 'tailwindcss/plugin'

// Ren colour story (docs/brand.md): ink + paper neutrals with one electric accent,
// "volt" blurple, generated in OKLCH (hue 277) so every step is perceptually even.
// 600 is the light-mode primary (5.8:1 on white); 400 is the dark-mode primary (7.5:1 on ink).
const BLURPLE = {
  '50': '#F5F6FE',
  '100': '#E9ECFE',
  '200': '#D3DAFE',
  '300': '#B3BDFF',
  '400': '#8D98FE',
  '500': '#676AFE',
  '600': '#5543FF',
  '700': '#4533D8',
  '800': '#3429A7',
  '900': '#251F78',
  '950': '#130F4B',
}

// Ink neutrals: cool paper whites in Light (50-300, chroma <= 0.01), then colourless greys
// down to black and charcoal for Dark (400-950, chroma 0). Dark mode is never blue.
const INK = {
  '50': '#F9FAFC',
  '100': '#F3F3F7',
  '200': '#E6E7ED',
  '300': '#D3D4DC',
  '400': '#A3A3A3',
  '500': '#737373',
  '600': '#525252',
  '700': '#2C2C2C',
  '800': '#1E1E1E',
  '900': '#0C0C0C',
  '950': '#050505',
}

// Warnings are yellow, never orange: amber, orange and yellow classes all resolve here.
const SIGNAL = {
  '50': '#FEFCE1',
  '100': '#FDF6BF',
  '200': '#FCEC8A',
  '300': '#F9DF4F',
  '400': '#F3D117',
  '500': '#E6C103',
  '600': '#BA9C04',
  '700': '#8C7605',
  '800': '#6A5A02',
  '900': '#534805',
  '950': '#2D2600',
}

const config: Config = {
  // `dark:` is the .dark class (the installed `class` strategy, `&:is(.dark *)`). In Glass every text
  // field (`.ron-field`) is also a Dark island, in both inks (src/index.css § Fields). `:where()` keeps
  // the island selectors at the specificity of the class strategy.
  darkMode: ['variant', ['&:is(.dark *)', '&:is(:where(html.glass) .ron-field)', '&:is(:where(html.glass) .ron-field *)']],
  content: [
    './index.html',
    './src/**/*.{ts,tsx,jsx}',
    './src/components/catalyst/**/*.{ts,tsx,jsx}',
    '!./src/**/node_modules/**',
  ],
  theme: {
    extend: {
      borderRadius: {
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 2px)',
        sm: 'calc(var(--radius) - 4px)',
      },
      colors: {
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        card: {
          DEFAULT: 'hsl(var(--card))',
          foreground: 'hsl(var(--card-foreground))',
        },
        popover: {
          DEFAULT: 'hsl(var(--popover))',
          foreground: 'hsl(var(--popover-foreground))',
        },
        primary: {
          DEFAULT: 'hsl(var(--primary))',
          foreground: 'hsl(var(--primary-foreground))',
        },
        secondary: {
          DEFAULT: 'hsl(var(--secondary))',
          foreground: 'hsl(var(--secondary-foreground))',
        },
        muted: {
          DEFAULT: 'hsl(var(--muted))',
          foreground: 'hsl(var(--muted-foreground))',
        },
        destructive: {
          DEFAULT: 'hsl(var(--destructive))',
          foreground: 'hsl(var(--destructive-foreground))',
        },
        border: 'hsl(var(--border))',
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',
        // Every legacy scale resolves to the Ren palette so existing classes inherit it:
        // indigo/violet/purple -> blurple, zinc/slate/gray/neutral/stone -> ink,
        // amber/orange/yellow -> signal yellow.
        accent: {
          DEFAULT: '#5543FF',
          foreground: 'hsl(var(--accent-foreground))',
        },
        'accent-indigo': '#5543FF',
        'accent-light': '#8D98FE',
        'accent-muted': '#B3BDFF',
        'accent-subtle': '#D3DAFE',
        blurple: BLURPLE,
        volt: BLURPLE,
        // The former accent scale's class name; kept so existing `ember-*` classes resolve to volt.
        ember: BLURPLE,
        indigo: BLURPLE,
        violet: BLURPLE,
        purple: BLURPLE,
        zinc: INK,
        slate: INK,
        gray: INK,
        neutral: INK,
        stone: INK,
        amber: SIGNAL,
        orange: SIGNAL,
        yellow: SIGNAL,
        surface: {
          '0': '#FFFFFF',
          '50': '#F9FAFC',
          '100': '#F3F3F7',
          '200': '#E6E7ED',
          '300': '#D3D4DC',
          '400': '#A3A3A3',
          '500': '#737373',
          '600': '#525252',
          '700': '#2C2C2C',
          '800': '#1E1E1E',
          '850': '#141414',
          '900': '#0C0C0C',
          '950': '#050505',
        },
        ink: {
          DEFAULT: '#0B0C17',
          secondary: '#4A4C58',
          muted: '#72747E',
          ghost: '#D3D4DC',
          inverse: '#F5F5F5',
          'inverse-secondary': '#BDBDBD',
          'inverse-muted': '#919191',
        },
        success: '#01B568',
        warning: '#E6C103',
        danger: '#EF2D4A',
        info: '#676AFE',
        royal: {
          DEFAULT: '#5543FF',
          light: '#8D98FE',
          dark: '#3429A7',
          purple: '#251F78',
        },
        'ron-white': '#FFFFFF',
        'ron-text': '#0B0C17',
        'ron-black': '#0C0C0C',
        'ron-smoke': '#141414',
      },
      fontFamily: {
        // Display: Bricolage Grotesque (opsz + wdth + wght). UI: Inter. Code + tag labels: JetBrains Mono.
        display: ['Bricolage Grotesque Variable', 'Inter Variable', 'system-ui', 'sans-serif'],
        sans: ['Inter Variable', '-apple-system', 'BlinkMacSystemFont', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'ui-monospace', 'Menlo', 'monospace'],
        georgia: ['Bricolage Grotesque Variable', 'Inter Variable', 'sans-serif'],
        raleway: ['Inter Variable', 'system-ui', 'sans-serif'],
      },
      fontWeight: {
        // Hairline weights were illegible on body copy; the floor is now 300.
        thin: '300',
        extralight: '300',
        light: '350',
        normal: '400',
        medium: '500',
        semibold: '600',
        bold: '700',
        extrabold: '800',
        black: '900',
        'raleway-thin': '300',
        'raleway-extralight': '300',
        'raleway-light': '350',
        'raleway-bold': '600',
      },
      fontSize: {
        // Poster scale: heavy, tight, set in the display face (h1-h4 pick it up in index.css).
        'display-2xl': ['4.5rem', { lineHeight: '0.95', letterSpacing: '-0.045em', fontWeight: '800' }],
        'display-xl': ['3.75rem', { lineHeight: '0.98', letterSpacing: '-0.04em', fontWeight: '800' }],
        'display-lg': ['3rem', { lineHeight: '1', letterSpacing: '-0.035em', fontWeight: '750' }],
        'display-md': ['2.25rem', { lineHeight: '1.05', letterSpacing: '-0.03em', fontWeight: '700' }],
        'display-sm': ['1.875rem', { lineHeight: '1.1', letterSpacing: '-0.025em', fontWeight: '700' }],
        'body-xl': ['1.25rem', { lineHeight: '1.75', fontWeight: '400' }],
        'body-lg': ['1.125rem', { lineHeight: '1.75', fontWeight: '400' }],
        'body-md': ['1rem', { lineHeight: '1.625', fontWeight: '400' }],
        'body-sm': ['0.875rem', { lineHeight: '1.5', fontWeight: '400' }],
        'body-xs': ['0.75rem', { lineHeight: '1.5', fontWeight: '500' }],
        label: ['0.6875rem', { lineHeight: '1', letterSpacing: '0.08em', fontWeight: '600' }],
      },
      spacing: {
        '18': '4.5rem',
        '88': '22rem',
        '112': '28rem',
        '128': '32rem',
      },
      boxShadow: {
        subtle: '0 1px 2px 0 rgb(11 12 23 / 0.04)',
        soft: '0 2px 8px -2px rgb(11 12 23 / 0.08)',
        medium: '0 4px 16px -4px rgb(11 12 23 / 0.1)',
        bold: '0 8px 32px -8px rgb(11 12 23 / 0.16)',
        dramatic: '0 24px 64px -16px rgb(11 12 23 / 0.26)',
        // Floating layers (menus, dialogs, panels): one shadow, ink-tinted.
        float: '0 18px 48px -18px rgb(11 12 23 / 0.32)',
        // Street detail: hard offset "sticker" shadows (light ink / volt).
        sticker: '2px 2px 0 0 #0B0C17',
        'sticker-inverse': '2px 2px 0 0 #F5F5F5',
        'sticker-volt': '3px 3px 0 0 #5543FF',
        'glow-accent': '0 0 24px -6px rgb(85 67 255 / 0.45)',
        'glow-accent-lg': '0 0 56px -12px rgb(85 67 255 / 0.5)',
        'dark-subtle': '0 1px 2px 0 rgb(0 0 0 / 0.25)',
        'dark-soft': '0 2px 8px -2px rgb(0 0 0 / 0.45)',
        'dark-medium': '0 4px 16px -4px rgb(0 0 0 / 0.55)',
        'dark-bold': '0 8px 32px -8px rgb(0 0 0 / 0.65)',
        'inner-soft': 'inset 0 2px 4px 0 rgb(11 12 23 / 0.04)',
        'inner-dark': 'inset 0 2px 4px 0 rgb(0 0 0 / 0.25)',
        glass: '0 8px 32px 0 rgba(0, 0, 0, 0.10)',
        'glass-hover': '0 12px 48px 0 rgba(0, 0, 0, 0.16)',
        'glass-dark': '0 8px 32px 0 rgba(0, 0, 0, 0.5)',
      },
      animation: {
        'fade-in': 'fadeIn 0.5s cubic-bezier(0.16, 1, 0.3, 1)',
        'fade-up': 'fadeUp 0.6s cubic-bezier(0.16, 1, 0.3, 1)',
        'fade-down': 'fadeDown 0.6s cubic-bezier(0.16, 1, 0.3, 1)',
        'scale-in': 'scaleIn 0.4s cubic-bezier(0.16, 1, 0.3, 1)',
        'slide-in-right': 'slideInRight 0.5s cubic-bezier(0.16, 1, 0.3, 1)',
        'slide-in-left': 'slideInLeft 0.5s cubic-bezier(0.16, 1, 0.3, 1)',
        'pulse-subtle': 'pulseSubtle 3s ease-in-out infinite',
        'pulse-glow': 'pulseGlow 2s ease-in-out infinite',
        shimmer: 'shimmer 2s linear infinite',
        'slide-in': 'slideIn 400ms cubic-bezier(0.16, 1, 0.3, 1)',
        glow: 'glow 2s ease-in-out infinite',
        'accordion-down': 'accordion-down 0.2s ease-out',
        'accordion-up': 'accordion-up 0.2s ease-out',
      },
      keyframes: {
        fadeIn: { '0%': { opacity: '0' }, '100%': { opacity: '1' } },
        fadeUp: { '0%': { opacity: '0', transform: 'translateY(16px)' }, '100%': { opacity: '1', transform: 'translateY(0)' } },
        fadeDown: { '0%': { opacity: '0', transform: 'translateY(-16px)' }, '100%': { opacity: '1', transform: 'translateY(0)' } },
        scaleIn: { '0%': { opacity: '0', transform: 'scale(0.95)' }, '100%': { opacity: '1', transform: 'scale(1)' } },
        slideInRight: { '0%': { opacity: '0', transform: 'translateX(24px)' }, '100%': { opacity: '1', transform: 'translateX(0)' } },
        slideInLeft: { '0%': { opacity: '0', transform: 'translateX(-24px)' }, '100%': { opacity: '1', transform: 'translateX(0)' } },
        pulseSubtle: { '0%, 100%': { opacity: '1' }, '50%': { opacity: '0.7' } },
        pulseGlow: {
          '0%, 100%': { boxShadow: '0 0 32px -4px rgba(85, 67, 255, 0.4)' },
          '50%': { boxShadow: '0 0 48px -2px rgba(85, 67, 255, 0.55)' },
        },
        shimmer: { '0%': { backgroundPosition: '-200% 0' }, '100%': { backgroundPosition: '200% 0' } },
        slideIn: { '0%': { transform: 'translateX(100%)', opacity: '0' }, '100%': { transform: 'translateX(0)', opacity: '1' } },
        glow: { '0%, 100%': { opacity: '0.5' }, '50%': { opacity: '1' } },
        'accordion-down': { from: { height: '0' }, to: { height: 'var(--radix-accordion-content-height)' } },
        'accordion-up': { from: { height: 'var(--radix-accordion-content-height)' }, to: { height: '0' } },
      },
      transitionTimingFunction: {
        smooth: 'cubic-bezier(0.16, 1, 0.3, 1)',
        'bounce-soft': 'cubic-bezier(0.34, 1.56, 0.64, 1)',
        'ease-out-expo': 'cubic-bezier(0.19, 1, 0.22, 1)',
      },
      transitionDuration: {
        '250': '250ms',
        '350': '350ms',
        '400': '400ms',
        '450': '450ms',
        '600': '600ms',
      },
      backdropBlur: {
        xs: '2px',
        glass: '40px',
        'glass-light': '20px',
      },
    },
  },
  plugins: [
    plugin(function ({ addUtilities, addBase, theme }) {
      addBase({
        html: {
          '-webkit-font-smoothing': 'antialiased',
          '-moz-osx-font-smoothing': 'grayscale',
          'text-rendering': 'optimizeLegibility',
        },
      })

      addUtilities({
        '.surface-primary': {
          'background-color': theme('colors.surface.0'),
          '@apply dark:bg-surface-900': {},
        },
        '.surface-elevated': {
          'background-color': theme('colors.surface.50'),
          '@apply dark:bg-surface-850': {},
        },
        '.surface-card': {
          'background-color': theme('colors.surface.0'),
          border: `1px solid ${theme('colors.surface.200')}`,
          '@apply dark:bg-surface-850 dark:border-surface-800': {},
        },
        '.text-primary': {
          color: theme('colors.ink.DEFAULT'),
          '@apply dark:text-ink-inverse': {},
        },
        '.text-secondary': {
          color: theme('colors.ink.secondary'),
          '@apply dark:text-ink-inverse-secondary': {},
        },
        '.text-muted': {
          color: theme('colors.ink.muted'),
          '@apply dark:text-ink-inverse-muted': {},
        },
        '.interactive': {
          transition: 'all 200ms cubic-bezier(0.16, 1, 0.3, 1)',
          '&:hover': { transform: 'translateY(-1px)' },
          '&:active': { transform: 'translateY(0) scale(0.98)' },
        },
        '.focus-ring': {
          '&:focus-visible': {
            outline: 'none',
            'box-shadow': `0 0 0 2px ${theme('colors.surface.0')}, 0 0 0 4px ${theme('colors.accent.DEFAULT')}`,
          },
        },
        '.dark .focus-ring': {
          '&:focus-visible': {
            'box-shadow': `0 0 0 2px ${theme('colors.surface.900')}, 0 0 0 4px ${theme('colors.accent.light')}`,
          },
        },
        '.text-gradient': {
          background: `linear-gradient(135deg, ${theme('colors.blurple.600')} 0%, ${theme('colors.blurple.400')} 100%)`,
          '-webkit-background-clip': 'text',
          '-webkit-text-fill-color': 'transparent',
          'background-clip': 'text',
        },
        '.divider-horizontal': {
          height: '1px',
          background: `linear-gradient(90deg, transparent, ${theme('colors.surface.200')}, transparent)`,
          '@apply dark:from-transparent dark:via-surface-700 dark:to-transparent': {},
        },
        '.scrollbar-none': {
          '-ms-overflow-style': 'none',
          'scrollbar-width': 'none',
          '&::-webkit-scrollbar': { display: 'none' },
        },
        '.scrollbar-thin': {
          'scrollbar-width': 'thin',
          '&::-webkit-scrollbar': { width: '6px', height: '6px' },
          '&::-webkit-scrollbar-track': { background: 'transparent' },
          '&::-webkit-scrollbar-thumb': { background: theme('colors.surface.200'), 'border-radius': '3px' },
          '&::-webkit-scrollbar-thumb:hover': { background: theme('colors.surface.300') },
        },
        '.dark .scrollbar-thin': {
          '&::-webkit-scrollbar-thumb': { background: theme('colors.surface.700') },
          '&::-webkit-scrollbar-thumb:hover': { background: theme('colors.surface.600') },
        },
        // Legacy glass utilities, colourless like the Glass theme (no hue, no saturation boost).
        // New surfaces use the surface tokens instead; the Glass theme veils those itself.
        '.glass-bold': {
          background: 'rgba(255, 255, 255, 0.82)',
          'backdrop-filter': 'blur(24px)',
          '-webkit-backdrop-filter': 'blur(24px)',
          border: '1px solid rgba(0, 0, 0, 0.08)',
          'box-shadow': 'inset 0 1px 0 rgba(255, 255, 255, 0.6), 0 8px 28px -10px rgba(0, 0, 0, 0.22)',
        },
        '.dark .glass-bold': {
          background: 'rgba(20, 20, 20, 0.82)',
          border: '1px solid rgba(255, 255, 255, 0.08)',
          'box-shadow': 'inset 0 1px 0 rgba(255, 255, 255, 0.06), 0 8px 32px -10px rgba(0, 0, 0, 0.6)',
        },
        '.glass-card': {
          background: 'rgba(255, 255, 255, 0.72)',
          'backdrop-filter': 'blur(18px)',
          '-webkit-backdrop-filter': 'blur(18px)',
          border: '1px solid rgba(0, 0, 0, 0.07)',
          'border-radius': '20px',
        },
        '.dark .glass-card': {
          background: 'rgba(255, 255, 255, 0.035)',
          border: '1px solid rgba(255, 255, 255, 0.07)',
        },
        '.glass-subtle': {
          background: 'rgba(0, 0, 0, 0.03)',
          'backdrop-filter': 'blur(12px)',
          '-webkit-backdrop-filter': 'blur(12px)',
          border: '1px solid rgba(0, 0, 0, 0.06)',
        },
        '.dark .glass-subtle': {
          background: 'rgba(255, 255, 255, 0.04)',
          border: '1px solid rgba(255, 255, 255, 0.06)',
        },
        '.elevated': {
          transform: 'translateY(-2px)',
          'box-shadow': '0 12px 40px -8px rgba(11, 12, 23, 0.2), inset 0 1px 0 rgba(255, 255, 255, 0.1)',
        },
        '.glass-ultra': {
          background: 'rgba(255, 255, 255, 0.86)',
          'backdrop-filter': 'blur(24px)',
          '-webkit-backdrop-filter': 'blur(24px)',
          border: '1px solid rgba(11, 12, 23, 0.06)',
        },
        '.dark .glass-ultra': {
          background: 'rgba(12, 12, 12, 0.9)',
          border: '1px solid rgba(255, 255, 255, 0.06)',
        },
        '.glass-frosted': {
          background: 'rgba(255, 255, 255, 0.72)',
          'backdrop-filter': 'blur(16px)',
          '-webkit-backdrop-filter': 'blur(16px)',
          border: '1px solid rgba(11, 12, 23, 0.05)',
        },
        '.dark .glass-frosted': {
          background: 'rgba(20, 20, 20, 0.82)',
          border: '1px solid rgba(255, 255, 255, 0.05)',
        },
        '.drag-region': {
          '-webkit-app-region': 'drag',
        },
        '.no-drag': {
          '-webkit-app-region': 'no-drag',
        },
        '.no-select': {
          '-webkit-user-select': 'none',
          '-moz-user-select': 'none',
          '-ms-user-select': 'none',
          'user-select': 'none',
        },
      })
    }),
  ],
}

export default config
