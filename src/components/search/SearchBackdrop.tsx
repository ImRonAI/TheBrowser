/**
 * Ambient backdrop for the search page: two slow radial orbs keyed to the active
 * tab's hue plus the app's signature hairline grid. The orbs cross-fade (never snap)
 * as the user moves between lenses.
 */
import { motion } from 'framer-motion'
import { hueWash } from './tabs-meta'

export function SearchBackdrop({ hue }: { hue: string }) {
  return (
    <div className="absolute inset-0 overflow-hidden pointer-events-none" aria-hidden>
      <motion.div
        className="absolute -top-[35%] -left-[15%] w-[75%] h-[75%] rounded-full blur-3xl"
        animate={{ background: `radial-gradient(closest-side, ${hueWash(hue, 0.09)}, transparent)` }}
        transition={{ duration: 1.1, ease: [0.16, 1, 0.3, 1] }}
      />
      <motion.div
        className="absolute -bottom-[30%] -right-[15%] w-[65%] h-[65%] rounded-full blur-3xl"
        animate={{ background: `radial-gradient(closest-side, ${hueWash(hue, 0.07)}, transparent)` }}
        transition={{ duration: 1.1, ease: [0.16, 1, 0.3, 1] }}
      />
      <div
        className="absolute inset-0 opacity-[0.02] dark:opacity-[0.035]"
        style={{
          backgroundImage:
            'linear-gradient(rgba(99, 102, 241, 0.4) 1px, transparent 1px),' +
            'linear-gradient(90deg, rgba(99, 102, 241, 0.4) 1px, transparent 1px)',
          backgroundSize: '56px 56px',
        }}
      />
    </div>
  )
}
