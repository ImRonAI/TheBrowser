import { motion, AnimatePresence } from 'framer-motion'
import { InterestNode, getCategoryColor } from '@/stores/interestsStore'
import { useInterestDiscoveryStore } from '@/stores/interestDiscoveryStore'
import { useUserPreferencesStore } from '@/stores/userPreferencesStore'
import { cn } from '@/utils/cn'

interface InterestNodeProps {
  node: InterestNode
  isHovered: boolean
  isSelected: boolean
  isConnected: boolean
  onHover: (nodeId: string | null) => void
  onClick: (nodeId: string) => void
  canvasWidth: number
  canvasHeight: number
}

// Convert hex to RGB for color manipulation
function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex)
  return result ? {
    r: parseInt(result[1], 16),
    g: parseInt(result[2], 16),
    b: parseInt(result[3], 16)
  } : { r: 100, g: 100, b: 200 }
}

// Lighten a color
function lightenColor(hex: string, amount: number): string {
  const { r, g, b } = hexToRgb(hex)
  const lighten = (c: number) => Math.min(255, Math.floor(c + (255 - c) * amount))
  return `rgb(${lighten(r)}, ${lighten(g)}, ${lighten(b)})`
}

// Darken a color
function darkenColor(hex: string, amount: number): string {
  const { r, g, b } = hexToRgb(hex)
  const darken = (c: number) => Math.floor(c * (1 - amount))
  return `rgb(${darken(r)}, ${darken(g)}, ${darken(b)})`
}

export function InterestNodeComponent({
  node,
  isHovered,
  isSelected,
  isConnected,
  onHover,
  onClick,
  canvasWidth,
  canvasHeight
}: InterestNodeProps) {
  const { selectInterest } = useInterestDiscoveryStore()
  const { theme } = useUserPreferencesStore()
  
  // Determine effective theme
  const isDark = theme === 'dark' || (theme === 'system' && typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches)
  const isGlass = theme === 'glass'
  // Note: isLight available for future use: const isLight = !isDark && !isGlass
  
  // Calculate node size based on weight (min 56px, max 96px) - larger for better presence
  const baseSize = 56 + node.weight * 40
  const size = isHovered || isSelected ? baseSize * 1.06 : baseSize
  
  // Get category color and variants
  const categoryColor = getCategoryColor(node.category)
  const { r, g, b } = hexToRgb(categoryColor)
  const lightHighlight = lightenColor(categoryColor, 0.6)
  const darkShadow = darkenColor(categoryColor, 0.5)
  
  // Calculate position as percentage of canvas
  const leftPercent = (node.position.x / canvasWidth) * 100
  const topPercent = (node.position.y / canvasHeight) * 100
  
  // Determine if we should show label above or below the node
  const isNearBottom = topPercent > 60
  
  // Determine visual state
  const isActive = isHovered || isSelected
  const isDimmed = !isActive && !isConnected && (isHovered !== null || isSelected !== null)

  // Theme-adaptive colors
  const getNodeStyles = () => {
    if (isDark) {
      return {
        // Deep, rich sphere with inner glow
        background: `
          radial-gradient(ellipse 60% 50% at 35% 25%, ${lightHighlight} 0%, transparent 50%),
          radial-gradient(ellipse 80% 70% at 50% 50%, rgba(${r},${g},${b},0.9) 0%, rgba(${r},${g},${b},0.6) 50%, ${darkShadow} 100%),
          radial-gradient(circle at 70% 80%, rgba(0,0,0,0.4) 0%, transparent 50%)
        `,
        border: `1.5px solid rgba(${r},${g},${b},0.6)`,
        boxShadow: isActive
          ? `
            0 4px 20px rgba(${r},${g},${b},0.5),
            0 8px 40px rgba(${r},${g},${b},0.3),
            inset 0 1px 2px rgba(255,255,255,0.2),
            inset 0 -2px 6px rgba(0,0,0,0.3)
          `
          : `
            0 2px 12px rgba(${r},${g},${b},0.35),
            0 4px 24px rgba(${r},${g},${b},0.15),
            inset 0 1px 2px rgba(255,255,255,0.15),
            inset 0 -2px 4px rgba(0,0,0,0.2)
          `,
        textColor: 'rgba(255,255,255,0.95)',
        textShadow: '0 1px 3px rgba(0,0,0,0.5)',
      }
    } else if (isGlass) {
      return {
        // Translucent glass orb - lets wallpaper show through with color tint
        background: `
          radial-gradient(ellipse 55% 45% at 30% 22%, rgba(255,255,255,0.7) 0%, transparent 45%),
          radial-gradient(ellipse 85% 75% at 50% 50%, rgba(${r},${g},${b},0.5) 0%, rgba(${r},${g},${b},0.3) 55%, rgba(${r},${g},${b},0.15) 100%),
          radial-gradient(circle at 68% 78%, rgba(0,0,0,0.08) 0%, transparent 45%),
          rgba(255,255,255,0.15)
        `,
        border: `1.5px solid rgba(${r},${g},${b},0.5)`,
        boxShadow: isActive
          ? `
            0 4px 24px rgba(${r},${g},${b},0.5),
            0 8px 40px rgba(0,0,0,0.12),
            inset 0 2px 4px rgba(255,255,255,0.5),
            inset 0 -2px 6px rgba(${r},${g},${b},0.2)
          `
          : `
            0 3px 16px rgba(${r},${g},${b},0.35),
            0 6px 28px rgba(0,0,0,0.08),
            inset 0 2px 3px rgba(255,255,255,0.4),
            inset 0 -1px 4px rgba(${r},${g},${b},0.12)
          `,
        textColor: 'rgba(255,255,255,0.95)',
        textShadow: '0 1px 3px rgba(0,0,0,0.4)',
      }
    } else {
      // Light mode - crisp, elevated orbs
      return {
        background: `
          radial-gradient(ellipse 55% 45% at 32% 22%, rgba(255,255,255,0.95) 0%, transparent 45%),
          radial-gradient(ellipse 85% 75% at 50% 50%, rgba(${r},${g},${b},0.45) 0%, rgba(${r},${g},${b},0.25) 55%, rgba(${r},${g},${b},0.1) 100%),
          radial-gradient(circle at 68% 78%, rgba(0,0,0,0.08) 0%, transparent 45%),
          linear-gradient(145deg, rgba(255,255,255,0.9) 0%, rgba(250,250,252,0.95) 100%)
        `,
        border: `1.5px solid rgba(${r},${g},${b},0.35)`,
        boxShadow: isActive
          ? `
            0 6px 24px rgba(${r},${g},${b},0.3),
            0 12px 48px rgba(0,0,0,0.08),
            inset 0 2px 4px rgba(255,255,255,0.9),
            inset 0 -2px 8px rgba(${r},${g},${b},0.12)
          `
          : `
            0 3px 12px rgba(${r},${g},${b},0.18),
            0 6px 24px rgba(0,0,0,0.05),
            inset 0 2px 3px rgba(255,255,255,0.85),
            inset 0 -1px 4px rgba(${r},${g},${b},0.08)
          `,
        textColor: 'rgba(30,30,50,0.9)',
        textShadow: '0 1px 2px rgba(255,255,255,0.6)',
      }
    }
  }

  const styles = getNodeStyles()

  return (
    <motion.div
      className="absolute"
      style={{
        left: `${leftPercent}%`,
        top: `${topPercent}%`,
        transform: 'translate(-50%, -50%)',
        zIndex: isActive ? 30 : isConnected ? 20 : 10
      }}
      initial={{ scale: 0, opacity: 0 }}
      animate={{
        scale: 1,
        opacity: isDimmed ? 0.35 : 1
      }}
      transition={{
        scale: { type: 'spring', stiffness: 400, damping: 25 },
        opacity: { duration: 0.25 }
      }}
    >
      {/* Ambient glow behind node */}
      <motion.div
        className="absolute rounded-full pointer-events-none"
        style={{
          width: size * 1.8,
          height: size * 1.8,
          left: '50%',
          top: '50%',
          transform: 'translate(-50%, -50%)',
          background: `radial-gradient(circle, rgba(${r},${g},${b},${isActive ? 0.4 : 0.2}) 0%, transparent 70%)`
        }}
        animate={{
          scale: isActive ? [1, 1.15, 1] : 1,
          opacity: isActive ? [0.7, 1, 0.7] : 0.5
        }}
        transition={{
          duration: 2.5,
          repeat: isActive ? Infinity : 0,
          ease: 'easeInOut'
        }}
      />

      {/* Main node - 3D sphere */}
      <motion.button
        className={cn(
          "relative rounded-full",
          "cursor-pointer",
          "focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2",
          isDark ? "focus-visible:ring-white/30" : "focus-visible:ring-royal/40"
        )}
        style={{ 
          width: size, 
          height: size,
          background: styles.background,
          border: styles.border,
          boxShadow: styles.boxShadow,
          backdropFilter: isGlass ? 'blur(8px) saturate(150%)' : 'none',
          WebkitBackdropFilter: isGlass ? 'blur(8px) saturate(150%)' : 'none',
        }}
        onMouseEnter={() => onHover(node.id)}
        onMouseLeave={() => onHover(null)}
        onClick={() => {
          onClick(node.id)
          selectInterest(node.id, node.label, node.category)
        }}
        whileHover={{ scale: 1.08, y: -2 }}
        whileTap={{ scale: 0.96 }}
        transition={{ duration: 0.2, ease: 'easeOut' }}
      >
        {/* Specular highlight - top-left shine */}
        <div
          className="absolute rounded-full pointer-events-none"
          style={{
            width: size * 0.35,
            height: size * 0.25,
            left: '18%',
            top: '12%',
            background: `radial-gradient(ellipse, rgba(255,255,255,${isDark ? 0.5 : 0.8}) 0%, transparent 100%)`,
            transform: 'rotate(-20deg)',
            filter: 'blur(1px)'
          }}
        />

        {/* Secondary highlight - smaller, sharper */}
        <div
          className="absolute rounded-full pointer-events-none"
          style={{
            width: size * 0.15,
            height: size * 0.1,
            left: '25%',
            top: '22%',
            background: `radial-gradient(ellipse, rgba(255,255,255,${isDark ? 0.7 : 0.95}) 0%, transparent 100%)`,
            transform: 'rotate(-25deg)'
          }}
        />

        {/* Center label - visible for larger nodes */}
        {size >= 60 && (
          <div className="absolute inset-0 flex items-center justify-center p-2">
            <span 
              className="text-[11px] font-raleway font-semibold text-center leading-tight tracking-tight"
              style={{ 
                maxWidth: size - 16,
                color: styles.textColor,
                textShadow: styles.textShadow
              }}
            >
              {node.label.length > 12 ? node.label.slice(0, 11) + '…' : node.label}
            </span>
          </div>
        )}

        {/* Category indicator - 3D dot */}
        <div
          className="absolute rounded-full"
          style={{
            width: 10,
            height: 10,
            bottom: -2,
            right: -2,
            background: `
              radial-gradient(ellipse 60% 50% at 35% 30%, ${lightenColor(categoryColor, 0.5)} 0%, transparent 50%),
              radial-gradient(circle, ${categoryColor} 0%, ${darkenColor(categoryColor, 0.3)} 100%)
            `,
            boxShadow: `
              0 1px 4px rgba(0,0,0,0.3),
              inset 0 1px 1px rgba(255,255,255,0.4)
            `,
            border: `1px solid rgba(255,255,255,0.3)`
          }}
        />

        {/* Source indicator for browsing-discovered interests */}
        {node.source === 'browsing' && (
          <div
            className="absolute rounded-full"
            style={{
              width: 10,
              height: 10,
              top: -2,
              left: -2,
              background: `
                radial-gradient(ellipse 60% 50% at 35% 30%, #fcd34d 0%, transparent 50%),
                radial-gradient(circle, #f59e0b 0%, #d97706 100%)
              `,
              boxShadow: `
                0 1px 4px rgba(0,0,0,0.3),
                inset 0 1px 1px rgba(255,255,255,0.5)
              `,
              border: `1px solid rgba(255,255,255,0.3)`
            }}
            title="Discovered from browsing"
          />
        )}
      </motion.button>

      {/* Hover/Selection Label */}
      <AnimatePresence>
        {(isHovered || isSelected) && (
          <motion.div
            className={cn(
              "absolute left-1/2",
              "whitespace-nowrap pointer-events-none",
              "px-3 py-1.5 rounded-lg",
              "text-xs font-raleway font-semibold tracking-tight",
              isDark ? "bg-zinc-900/95 text-white border border-zinc-700/50" : 
              isGlass ? "bg-white/85 text-zinc-800 border border-white/60" :
              "bg-white text-zinc-800 border border-zinc-200/80"
            )}
            style={{
              ...(isNearBottom 
                ? { bottom: size / 2 + 14, transform: 'translateX(-50%)' }
                : { top: size / 2 + 14, transform: 'translateX(-50%)' }
              ),
              boxShadow: isDark
                ? `0 4px 20px rgba(0,0,0,0.4), 0 0 0 1px rgba(${r},${g},${b},0.3)`
                : `0 4px 20px rgba(0,0,0,0.1), 0 0 0 1px rgba(${r},${g},${b},0.2)`,
              backdropFilter: 'blur(12px)',
              WebkitBackdropFilter: 'blur(12px)'
            }}
            initial={{ opacity: 0, scale: 0.9, y: isNearBottom ? 6 : -6 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.9, y: isNearBottom ? 6 : -6 }}
            transition={{ duration: 0.15, ease: 'easeOut' }}
          >
            {/* Color accent bar */}
            <div 
              className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-4 rounded-full"
              style={{ backgroundColor: categoryColor, marginLeft: -2 }}
            />
            {node.label}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Selection ring animation */}
      {isSelected && (
        <motion.div
          className="absolute rounded-full pointer-events-none"
          style={{
            width: size + 8,
            height: size + 8,
            left: '50%',
            top: '50%',
            transform: 'translate(-50%, -50%)',
            border: `2px solid ${categoryColor}`,
            boxShadow: `0 0 16px rgba(${r},${g},${b},0.4)`
          }}
          initial={{ opacity: 0, scale: 0.8 }}
          animate={{ 
            opacity: [0.6, 1, 0.6],
            scale: [1, 1.05, 1]
          }}
          transition={{
            duration: 1.5,
            repeat: Infinity,
            ease: 'easeInOut'
          }}
        />
      )}
    </motion.div>
  )
}

