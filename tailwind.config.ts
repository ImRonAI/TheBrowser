import type { Config } from 'tailwindcss'
import plugin from 'tailwindcss/plugin'

const EMBER = {
  '50': '#FBF5F0',
  '100': '#F6E6DA',
  '200': '#EDCBB4',
  '300': '#E1A887',
  '400': '#D6825A',
  '500': '#C26A41',
  '600': '#A9532E',
  '700': '#8A4225',
  '800': '#6B3420',
  '900': '#4E271A',
  '950': '#2C150D',
}

const GRAPHITE = {
  '50': '#F8F7F4',
  '100': '#F1EFEB',
  '200': '#E4E1DB',
  '300': '#D2CEC6',
  '400': '#A8A39A',
  '500': '#7F7971',
  '600': '#5C5750',
  '700': '#45413C',
  '800': '#2A2825',
  '900': '#1C1B19',
  '950': '#131312',
}

const config: Config = {
  darkMode: ['class'],
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
  			sm: 'calc(var(--radius) - 4px)'
  		},
  		colors: {
  			background: 'hsl(var(--background))',
  			foreground: 'hsl(var(--foreground))',
  			card: {
  				DEFAULT: 'hsl(var(--card))',
  				foreground: 'hsl(var(--card-foreground))'
  			},
  			popover: {
  				DEFAULT: 'hsl(var(--popover))',
  				foreground: 'hsl(var(--popover-foreground))'
  			},
  			primary: {
  				DEFAULT: 'hsl(var(--primary))',
  				foreground: 'hsl(var(--primary-foreground))'
  			},
  			secondary: {
  				DEFAULT: 'hsl(var(--secondary))',
  				foreground: 'hsl(var(--secondary-foreground))'
  			},
  			muted: {
  				DEFAULT: 'hsl(var(--muted))',
  				foreground: 'hsl(var(--muted-foreground))'
  			},
  			destructive: {
  				DEFAULT: 'hsl(var(--destructive))',
  				foreground: 'hsl(var(--destructive-foreground))'
  			},
  			border: 'hsl(var(--border))',
  			input: 'hsl(var(--input))',
  			ring: 'hsl(var(--ring))',
  			// Ron 2026 colour story: warm graphite + paper neutrals with a single
  			// ember (burnt copper) accent. The legacy indigo/violet/purple, zinc/slate/gray
  			// scales are remapped here so every existing class inherits the new palette.
  			accent: {
  				DEFAULT: '#A9532E',
  				foreground: 'hsl(var(--accent-foreground))'
  			},
  			'accent-indigo': '#A9532E',
  			'accent-light': '#D6825A',
  			'accent-muted': '#DFA382',
  			'accent-subtle': '#EBC6AE',
  			ember: EMBER,
  			indigo: EMBER,
  			violet: EMBER,
  			purple: EMBER,
  			zinc: GRAPHITE,
  			slate: GRAPHITE,
  			gray: GRAPHITE,
  			surface: {
  				'0': '#FFFEFC',
  				'50': '#F8F7F4',
  				'100': '#F1EFEB',
  				'200': '#E4E1DB',
  				'300': '#D2CEC6',
  				'400': '#A8A39A',
  				'500': '#6F6A63',
  				'600': '#4E4A44',
  				'700': '#2D2B28',
  				'800': '#1F1E1C',
  				'850': '#191817',
  				'900': '#131312',
  				'950': '#0C0C0B'
  			},
  			ink: {
  				DEFAULT: '#1A1917',
  				secondary: '#57524C',
  				muted: '#7F7971',
  				ghost: '#D2CEC6',
  				inverse: '#F3F1ED',
  				'inverse-secondary': '#ADA79F',
  				'inverse-muted': '#86807A'
  			},
  			success: '#4F7A5A',
  			warning: '#B7791F',
  			danger: '#C2413B',
  			info: '#4A6FA5',
  			royal: {
  				DEFAULT: '#A9532E',
  				light: '#D6825A',
  				dark: '#6B3420',
  				purple: '#4E271A'
  			},
  			'ron-white': '#FFFEFC',
  			'ron-text': '#1A1917',
  			'ron-black': '#131312',
  			'ron-smoke': '#191817'
  		},
  		fontFamily: {
  			display: [
  				'Newsreader Variable',
  				'Iowan Old Style',
  				'Georgia',
  				'serif'
  			],
  			sans: [
  				'Inter Variable',
  				'-apple-system',
  				'BlinkMacSystemFont',
  				'system-ui',
  				'sans-serif'
  			],
  			mono: [
  				'JetBrains Mono',
  				'Menlo',
  				'monospace'
  			],
  			georgia: [
  				'Newsreader Variable',
  				'Georgia',
  				'serif'
  			],
  			raleway: [
  				'Inter Variable',
  				'system-ui',
  				'sans-serif'
  			]
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
  			'raleway-bold': '600'
  		},
  		fontSize: {
  			'display-2xl': [
  				'4.5rem',
  				{
  					lineHeight: '1',
  					letterSpacing: '-0.02em',
  					fontWeight: '300'
  				}
  			],
  			'display-xl': [
  				'3.75rem',
  				{
  					lineHeight: '1',
  					letterSpacing: '-0.02em',
  					fontWeight: '300'
  				}
  			],
  			'display-lg': [
  				'3rem',
  				{
  					lineHeight: '1.1',
  					letterSpacing: '-0.015em',
  					fontWeight: '300'
  				}
  			],
  			'display-md': [
  				'2.25rem',
  				{
  					lineHeight: '1.2',
  					letterSpacing: '-0.01em',
  					fontWeight: '400'
  				}
  			],
  			'display-sm': [
  				'1.875rem',
  				{
  					lineHeight: '1.25',
  					letterSpacing: '-0.01em',
  					fontWeight: '400'
  				}
  			],
  			'body-xl': [
  				'1.25rem',
  				{
  					lineHeight: '1.75',
  					fontWeight: '400'
  				}
  			],
  			'body-lg': [
  				'1.125rem',
  				{
  					lineHeight: '1.75',
  					fontWeight: '400'
  				}
  			],
  			'body-md': [
  				'1rem',
  				{
  					lineHeight: '1.625',
  					fontWeight: '400'
  				}
  			],
  			'body-sm': [
  				'0.875rem',
  				{
  					lineHeight: '1.5',
  					fontWeight: '400'
  				}
  			],
  			'body-xs': [
  				'0.75rem',
  				{
  					lineHeight: '1.5',
  					fontWeight: '500'
  				}
  			],
  			label: [
  				'0.6875rem',
  				{
  					lineHeight: '1',
  					letterSpacing: '0.05em',
  					fontWeight: '600'
  				}
  			]
  		},
  		spacing: {
  			'18': '4.5rem',
  			'88': '22rem',
  			'112': '28rem',
  			'128': '32rem'
  		},
  		boxShadow: {
  			subtle: '0 1px 2px 0 rgb(0 0 0 / 0.03)',
  			soft: '0 2px 8px -2px rgb(0 0 0 / 0.08)',
  			medium: '0 4px 16px -4px rgb(0 0 0 / 0.1)',
  			bold: '0 8px 32px -8px rgb(0 0 0 / 0.15)',
  			dramatic: '0 24px 64px -16px rgb(0 0 0 / 0.25)',
  			'glow-accent': '0 0 24px -6px rgb(194 106 65 / 0.35)',
  			'glow-accent-lg': '0 0 48px -10px rgb(194 106 65 / 0.4)',
  			'dark-subtle': '0 1px 2px 0 rgb(0 0 0 / 0.2)',
  			'dark-soft': '0 2px 8px -2px rgb(0 0 0 / 0.4)',
  			'dark-medium': '0 4px 16px -4px rgb(0 0 0 / 0.5)',
  			'dark-bold': '0 8px 32px -8px rgb(0 0 0 / 0.6)',
  			'inner-soft': 'inset 0 2px 4px 0 rgb(0 0 0 / 0.04)',
  			'inner-dark': 'inset 0 2px 4px 0 rgb(0 0 0 / 0.2)',
  			glass: '0 8px 32px 0 rgba(26, 25, 23, 0.06)',
  			'glass-hover': '0 12px 48px 0 rgba(26, 25, 23, 0.10)',
  			'glass-dark': '0 8px 32px 0 rgba(0, 0, 0, 0.3)'
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
  			'accordion-up': 'accordion-up 0.2s ease-out'
  		},
  		keyframes: {
  			fadeIn: {
  				'0%': {
  					opacity: '0'
  				},
  				'100%': {
  					opacity: '1'
  				}
  			},
  			fadeUp: {
  				'0%': {
  					opacity: '0',
  					transform: 'translateY(16px)'
  				},
  				'100%': {
  					opacity: '1',
  					transform: 'translateY(0)'
  				}
  			},
  			fadeDown: {
  				'0%': {
  					opacity: '0',
  					transform: 'translateY(-16px)'
  				},
  				'100%': {
  					opacity: '1',
  					transform: 'translateY(0)'
  				}
  			},
  			scaleIn: {
  				'0%': {
  					opacity: '0',
  					transform: 'scale(0.95)'
  				},
  				'100%': {
  					opacity: '1',
  					transform: 'scale(1)'
  				}
  			},
  			slideInRight: {
  				'0%': {
  					opacity: '0',
  					transform: 'translateX(24px)'
  				},
  				'100%': {
  					opacity: '1',
  					transform: 'translateX(0)'
  				}
  			},
  			slideInLeft: {
  				'0%': {
  					opacity: '0',
  					transform: 'translateX(-24px)'
  				},
  				'100%': {
  					opacity: '1',
  					transform: 'translateX(0)'
  				}
  			},
  			pulseSubtle: {
  				'0%, 100%': {
  					opacity: '1'
  				},
  				'50%': {
  					opacity: '0.7'
  				}
  			},
  			pulseGlow: {
  				'0%, 100%': {
  					boxShadow: '0 0 32px -4px rgba(194, 106, 65, 0.4)'
  				},
  				'50%': {
  					boxShadow: '0 0 48px -2px rgba(194, 106, 65, 0.55)'
  				}
  			},
  			shimmer: {
  				'0%': {
  					backgroundPosition: '-200% 0'
  				},
  				'100%': {
  					backgroundPosition: '200% 0'
  				}
  			},
  			slideIn: {
  				'0%': {
  					transform: 'translateX(100%)',
  					opacity: '0'
  				},
  				'100%': {
  					transform: 'translateX(0)',
  					opacity: '1'
  				}
  			},
  			glow: {
  				'0%, 100%': {
  					opacity: '0.5'
  				},
  				'50%': {
  					opacity: '1'
  				}
  			},
  			'accordion-down': {
  				from: {
  					height: '0'
  				},
  				to: {
  					height: 'var(--radix-accordion-content-height)'
  				}
  			},
  			'accordion-up': {
  				from: {
  					height: 'var(--radix-accordion-content-height)'
  				},
  				to: {
  					height: '0'
  				}
  			}
  		},
  		transitionTimingFunction: {
  			smooth: 'cubic-bezier(0.16, 1, 0.3, 1)',
  			'bounce-soft': 'cubic-bezier(0.34, 1.56, 0.64, 1)',
  			'ease-out-expo': 'cubic-bezier(0.19, 1, 0.22, 1)'
  		},
  		transitionDuration: {
  			'250': '250ms',
  			'350': '350ms',
  			'400': '400ms',
  			'450': '450ms',
  			'600': '600ms'
  		},
  		backdropBlur: {
  			xs: '2px',
  			glass: '40px',
  			'glass-light': '20px'
  		}
  	}
  },
  plugins: [
    plugin(function({ addUtilities, addBase, theme }) {
      addBase({
        'html': {
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
          'border': `1px solid ${theme('colors.surface.200')}`,
          '@apply dark:bg-surface-800 dark:border-surface-700': {},
        },
        '.text-primary': {
          'color': theme('colors.ink.DEFAULT'),
          '@apply dark:text-ink-inverse': {},
        },
        '.text-secondary': {
          'color': theme('colors.ink.secondary'),
          '@apply dark:text-ink-inverse-secondary': {},
        },
        '.text-muted': {
          'color': theme('colors.ink.muted'),
          '@apply dark:text-ink-inverse-muted': {},
        },
        '.interactive': {
          'transition': 'all 200ms cubic-bezier(0.16, 1, 0.3, 1)',
          '&:hover': {
            'transform': 'translateY(-1px)',
          },
          '&:active': {
            'transform': 'translateY(0) scale(0.98)',
          },
        },
        '.focus-ring': {
          '&:focus-visible': {
            'outline': 'none',
            'box-shadow': `0 0 0 2px ${theme('colors.surface.0')}, 0 0 0 4px ${theme('colors.accent.DEFAULT')}`,
          },
        },
        '.dark .focus-ring': {
          '&:focus-visible': {
            'box-shadow': `0 0 0 2px ${theme('colors.surface.900')}, 0 0 0 4px ${theme('colors.accent.light')}`,
          },
        },
        '.text-gradient': {
          'background': `linear-gradient(135deg, ${theme('colors.accent.DEFAULT')} 0%, ${theme('colors.accent.light')} 100%)`,
          '-webkit-background-clip': 'text',
          '-webkit-text-fill-color': 'transparent',
          'background-clip': 'text',
        },
        '.divider-horizontal': {
          'height': '1px',
          'background': `linear-gradient(90deg, transparent, ${theme('colors.surface.200')}, transparent)`,
          '@apply dark:from-transparent dark:via-surface-700 dark:to-transparent': {},
        },
        '.scrollbar-none': {
          '-ms-overflow-style': 'none',
          'scrollbar-width': 'none',
          '&::-webkit-scrollbar': {
            'display': 'none',
          },
        },
        '.scrollbar-thin': {
          'scrollbar-width': 'thin',
          '&::-webkit-scrollbar': {
            'width': '6px',
            'height': '6px',
          },
          '&::-webkit-scrollbar-track': {
            'background': 'transparent',
          },
          '&::-webkit-scrollbar-thumb': {
            'background': theme('colors.surface.200'),
            'border-radius': '3px',
          },
          '&::-webkit-scrollbar-thumb:hover': {
            'background': theme('colors.surface.300'),
          },
        },
        '.dark .scrollbar-thin': {
          '&::-webkit-scrollbar-thumb': {
            'background': theme('colors.surface.700'),
          },
          '&::-webkit-scrollbar-thumb:hover': {
            'background': theme('colors.surface.600'),
          },
        },
        '.glass-bold': {
          'background': 'rgba(255, 255, 255, 0.04)',
          'backdrop-filter': 'blur(40px) saturate(200%)',
          '-webkit-backdrop-filter': 'blur(40px) saturate(200%)',
          'border': '1px solid rgba(255, 255, 255, 0.08)',
          'box-shadow': 'inset 0 1px 1px rgba(255, 255, 255, 0.1), 0 4px 24px rgba(0, 0, 0, 0.15)',
        },
        '.dark .glass-bold': {
          'background': 'rgba(0, 0, 0, 0.3)',
          'border': '1px solid rgba(255, 255, 255, 0.06)',
          'box-shadow': 'inset 0 1px 1px rgba(255, 255, 255, 0.05), 0 8px 32px rgba(0, 0, 0, 0.4)',
        },
        '.glass-card': {
          'background': 'linear-gradient(135deg, rgba(255, 255, 255, 0.1) 0%, rgba(255, 255, 255, 0.05) 100%)',
          'backdrop-filter': 'blur(24px) saturate(180%)',
          '-webkit-backdrop-filter': 'blur(24px) saturate(180%)',
          'border': '1px solid rgba(255, 255, 255, 0.15)',
          'border-radius': '20px',
        },
        '.dark .glass-card': {
          'background': 'linear-gradient(135deg, rgba(255, 255, 255, 0.06) 0%, rgba(255, 255, 255, 0.02) 100%)',
          'border': '1px solid rgba(255, 255, 255, 0.08)',
        },
        '.glass-subtle': {
          'background': 'rgba(255, 255, 255, 0.03)',
          'backdrop-filter': 'blur(12px)',
          '-webkit-backdrop-filter': 'blur(12px)',
          'border': '1px solid rgba(255, 255, 255, 0.05)',
        },
        '.elevated': {
          'transform': 'translateY(-2px)',
          'box-shadow': '0 12px 40px -8px rgba(0, 0, 0, 0.2), inset 0 1px 0 rgba(255, 255, 255, 0.1)',
        },
        '.glass-ultra': {
          'background': 'rgba(255, 255, 255, 0.85)',
          'backdrop-filter': 'blur(24px) saturate(150%)',
          '-webkit-backdrop-filter': 'blur(24px) saturate(150%)',
          'border': '1px solid rgba(0, 0, 0, 0.06)',
        },
        '.dark .glass-ultra': {
          'background': 'rgba(18, 18, 18, 0.9)',
          'border': '1px solid rgba(255, 255, 255, 0.06)',
        },
        '.glass-frosted': {
          'background': 'rgba(255, 255, 255, 0.7)',
          'backdrop-filter': 'blur(16px) saturate(140%)',
          '-webkit-backdrop-filter': 'blur(16px) saturate(140%)',
          'border': '1px solid rgba(0, 0, 0, 0.05)',
        },
        '.dark .glass-frosted': {
          'background': 'rgba(23, 23, 23, 0.8)',
          'border': '1px solid rgba(255, 255, 255, 0.05)',
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
