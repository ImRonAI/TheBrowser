import type { Config } from 'tailwindcss'
import plugin from 'tailwindcss/plugin'

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
  			accent: {
  				DEFAULT: '#3730A3',
  				foreground: 'hsl(var(--accent-foreground))'
  			},
  			'accent-indigo': '#3730A3',
  			'accent-light': '#6366F1',
  			'accent-muted': '#818CF8',
  			'accent-subtle': '#C7D2FE',
  			surface: {
  				'0': '#FFFFFF',
  				'50': '#FAFAFA',
  				'100': '#F5F5F5',
  				'200': '#E5E5E5',
  				'300': '#D4D4D4',
  				'400': '#A3A3A3',
  				'500': '#525252',
  				'600': '#404040',
  				'700': '#262626',
  				'800': '#171717',
  				'850': '#121212',
  				'900': '#0A0A0A',
  				'950': '#050505'
  			},
  			ink: {
  				DEFAULT: '#0A0A0A',
  				secondary: '#525252',
  				muted: '#A3A3A3',
  				ghost: '#D4D4D4',
  				inverse: '#FFFFFF',
  				'inverse-secondary': '#A3A3A3',
  				'inverse-muted': '#737373'
  			},
  			success: '#059669',
  			warning: '#D97706',
  			danger: '#DC2626',
  			info: '#0284C7',
  			royal: {
  				DEFAULT: '#3730A3',
  				light: '#6366F1',
  				dark: '#312E81',
  				purple: '#4C1D95'
  			},
  			'ron-white': '#FFFFFF',
  			'ron-text': '#0A0A0A',
  			'ron-black': '#0A0A0A',
  			'ron-smoke': '#121212'
  		},
  		fontFamily: {
  			display: [
  				'Playfair Display',
  				'Georgia',
  				'serif'
  			],
  			sans: [
  				'Raleway',
  				'system-ui',
  				'-apple-system',
  				'sans-serif'
  			],
  			mono: [
  				'JetBrains Mono',
  				'Menlo',
  				'monospace'
  			],
  			georgia: [
  				'Georgia',
  				'serif'
  			],
  			raleway: [
  				'Raleway',
  				'sans-serif'
  			]
  		},
  		fontWeight: {
  			thin: '100',
  			extralight: '200',
  			light: '300',
  			normal: '400',
  			medium: '500',
  			semibold: '600',
  			bold: '700',
  			extrabold: '800',
  			black: '900',
  			'raleway-thin': '100',
  			'raleway-extralight': '200',
  			'raleway-light': '300',
  			'raleway-bold': '700'
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
  			'glow-accent': '0 0 24px -4px rgb(99 102 241 / 0.35)',
  			'glow-accent-lg': '0 0 48px -8px rgb(99 102 241 / 0.4)',
  			'dark-subtle': '0 1px 2px 0 rgb(0 0 0 / 0.2)',
  			'dark-soft': '0 2px 8px -2px rgb(0 0 0 / 0.4)',
  			'dark-medium': '0 4px 16px -4px rgb(0 0 0 / 0.5)',
  			'dark-bold': '0 8px 32px -8px rgb(0 0 0 / 0.6)',
  			'inner-soft': 'inset 0 2px 4px 0 rgb(0 0 0 / 0.04)',
  			'inner-dark': 'inset 0 2px 4px 0 rgb(0 0 0 / 0.2)',
  			glass: '0 8px 32px 0 rgba(55, 48, 163, 0.08)',
  			'glass-hover': '0 12px 48px 0 rgba(55, 48, 163, 0.12)',
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
  					boxShadow: '0 0 32px -4px rgba(139, 92, 246, 0.5)'
  				},
  				'50%': {
  					boxShadow: '0 0 48px -2px rgba(139, 92, 246, 0.7)'
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
