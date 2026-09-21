import { useMemo, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'

type CalendarMode = 'quarter' | 'month' | 'week' | 'day'

// Sophisticated easing
const EASE = [0.16, 1, 0.3, 1] as const

interface CalendarViewProps {
  mode: CalendarMode
  onModeChange?: (mode: CalendarMode) => void
}

export function CalendarView({ mode, onModeChange }: CalendarViewProps) {
  const [currentDate, setCurrentDate] = useState(new Date())

  const navigatePrev = () => {
    setCurrentDate(prev => {
      const d = new Date(prev)
      if (mode === 'day') d.setDate(d.getDate() - 1)
      else if (mode === 'week') d.setDate(d.getDate() - 7)
      else if (mode === 'month') d.setMonth(d.getMonth() - 1)
      else d.setMonth(d.getMonth() - 3)
      return d
    })
  }

  const navigateNext = () => {
    setCurrentDate(prev => {
      const d = new Date(prev)
      if (mode === 'day') d.setDate(d.getDate() + 1)
      else if (mode === 'week') d.setDate(d.getDate() + 7)
      else if (mode === 'month') d.setMonth(d.getMonth() + 1)
      else d.setMonth(d.getMonth() + 3)
      return d
    })
  }

  const goToToday = () => setCurrentDate(new Date())

  return (
    <motion.div 
      className="
        h-full flex flex-col 
        rounded-xl overflow-hidden
        bg-surface-0 dark:bg-surface-850
        border border-surface-200 dark:border-surface-700
        shadow-soft dark:shadow-dark-soft
      "
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.5, ease: EASE }}
    >
      {/* Calendar Header */}
      <CalendarHeader
        currentDate={currentDate}
        mode={mode}
        onModeChange={onModeChange}
        onPrev={navigatePrev}
        onNext={navigateNext}
        onToday={goToToday}
      />

      {/* Calendar Body */}
      <div className="flex-1 overflow-hidden">
        <AnimatePresence mode="wait" initial={false}>
          {mode === 'day' && (
            <motion.div
              key={`day-${currentDate.toISOString()}`}
              className="h-full"
              initial={{ opacity: 0, x: 32 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -32 }}
              transition={{ duration: 0.35, ease: EASE }}
            >
              <DayView date={currentDate} />
            </motion.div>
          )}
          {mode === 'week' && (
            <motion.div
              key={`week-${currentDate.toISOString()}`}
              className="h-full"
              initial={{ opacity: 0, x: 32 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -32 }}
              transition={{ duration: 0.35, ease: EASE }}
            >
              <WeekView date={currentDate} />
            </motion.div>
          )}
          {mode === 'quarter' && (
            <motion.div
              key={`quarter-${currentDate.toISOString()}`}
              className="h-full"
              initial={{ opacity: 0, x: 32 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -32 }}
              transition={{ duration: 0.35, ease: EASE }}
            >
              <QuarterView date={currentDate} />
            </motion.div>
          )}
          {mode === 'month' && (
            <motion.div
              key={`month-${currentDate.toISOString()}`}
              className="h-full"
              initial={{ opacity: 0, x: 32 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -32 }}
              transition={{ duration: 0.35, ease: EASE }}
            >
              <MonthView date={currentDate} />
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </motion.div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// CALENDAR HEADER
// ─────────────────────────────────────────────────────────────────────────────

interface CalendarHeaderProps {
  currentDate: Date
  mode: CalendarMode
  onPrev: () => void
  onNext: () => void
  onToday: () => void
  onModeChange?: (mode: CalendarMode) => void
}

function CalendarHeader({ currentDate, mode, onPrev, onNext, onToday }: CalendarHeaderProps) {
  const displayText = useMemo(() => {
    if (mode === 'quarter') {
      const qStart = new Date(currentDate)
      qStart.setMonth(Math.floor(qStart.getMonth() / 3) * 3)
      const qEnd = new Date(qStart)
      qEnd.setMonth(qEnd.getMonth() + 2)
      return `${qStart.toLocaleDateString('en-US', { month: 'short' })} – ${qEnd.toLocaleDateString('en-US', { month: 'short', year: 'numeric' })} (Q${Math.floor(qStart.getMonth() / 3) + 1})`
    } else if (mode === 'month') {
      return currentDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
    } else if (mode === 'week') {
      const start = new Date(currentDate)
      start.setDate(start.getDate() - start.getDay())
      const end = new Date(start)
      end.setDate(end.getDate() + 6)
      return `${start.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} – ${end.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`
    } else {
      return currentDate.toLocaleDateString('en-US', { 
        weekday: 'long', 
        month: 'long', 
        day: 'numeric',
        year: 'numeric'
      })
    }
  }, [currentDate, mode])

  const isToday = useMemo(() => {
    const today = new Date()
    if (mode === 'day') return currentDate.toDateString() === today.toDateString()
    if (mode === 'week') {
      const start = new Date(currentDate)
      start.setDate(start.getDate() - start.getDay())
      const end = new Date(start)
      end.setDate(end.getDate() + 6)
      return today >= start && today <= end
    }
    if (mode === 'quarter') {
      const qMonth = Math.floor(currentDate.getMonth() / 3) * 3
      return today.getFullYear() === currentDate.getFullYear() && today.getMonth() >= qMonth && today.getMonth() < qMonth + 3
    }
    return currentDate.getMonth() === today.getMonth() && currentDate.getFullYear() === today.getFullYear()
  }, [currentDate, mode])

  return (
    <div className="flex-shrink-0 px-6 py-5 border-b border-surface-200 dark:border-surface-700">
      <div className="flex items-center justify-between">
        {/* Date Display */}
        <motion.h2
          key={displayText}
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, ease: EASE }}
          className="text-body-xl font-display text-ink dark:text-ink-inverse"
        >
          {displayText}
        </motion.h2>

        {/* Navigation Controls */}
        <div className="flex items-center gap-3">
          <AnimatePresence>
            {!isToday && (
              <motion.button
                initial={{ opacity: 0, scale: 0.9, x: 8 }}
                animate={{ opacity: 1, scale: 1, x: 0 }}
                exit={{ opacity: 0, scale: 0.9, x: 8 }}
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                onClick={onToday}
                className="
                  px-4 py-2
                  text-label uppercase tracking-wider
                  text-accent dark:text-accent-light
                  bg-accent/5 dark:bg-accent-light/5
                  hover:bg-accent/10 dark:hover:bg-accent-light/10
                  border border-accent/20 dark:border-accent-light/20
                  rounded-lg
                  transition-colors duration-200
                "
              >
                Today
              </motion.button>
            )}
          </AnimatePresence>
          
          <div className="flex items-center p-1 rounded-lg bg-surface-100 dark:bg-surface-800">
            <NavButton direction="prev" onClick={onPrev} />
            <NavButton direction="next" onClick={onNext} />
          </div>
        </div>
      </div>
    </div>
  )
}

function NavButton({ direction, onClick }: { direction: 'prev' | 'next'; onClick: () => void }) {
  return (
    <motion.button
      whileHover={{ scale: 1.1 }}
      whileTap={{ scale: 0.9 }}
      onClick={onClick}
      className="
        w-8 h-8
        flex items-center justify-center
        text-ink-muted dark:text-ink-inverse-muted
        hover:text-ink dark:hover:text-ink-inverse
        hover:bg-surface-200 dark:hover:bg-surface-700
        rounded-md
        transition-all duration-200
      "
    >
      <svg 
        viewBox="0 0 24 24" 
        fill="none" 
        stroke="currentColor" 
        strokeWidth="2" 
        strokeLinecap="round" 
        strokeLinejoin="round"
        className={`w-4 h-4 ${direction === 'next' ? 'rotate-180' : ''}`}
      >
        <polyline points="15 18 9 12 15 6" />
      </svg>
    </motion.button>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// DAY VIEW
// ─────────────────────────────────────────────────────────────────────────────

function DayView({ date }: { date: Date }) {
  const hours = Array.from({ length: 24 }, (_, i) => i)
  const isToday = date.toDateString() === new Date().toDateString()
  const currentHour = new Date().getHours()
  const currentMinutes = new Date().getMinutes()

  return (
    <div className="h-full overflow-y-auto scrollbar-thin relative">
      {/* Current Time Indicator */}
      {isToday && (
        <motion.div 
          className="absolute left-0 right-4 z-10 pointer-events-none"
          style={{ top: `${(currentHour + currentMinutes / 60) * 52 + 16}px` }}
          initial={{ opacity: 0, scaleX: 0 }}
          animate={{ opacity: 1, scaleX: 1 }}
          transition={{ delay: 0.5, duration: 0.6, ease: EASE }}
        >
          <div className="flex items-center">
            <div className="w-3 h-3 rounded-full bg-accent dark:bg-accent-light shadow-glow-accent" />
            <div className="flex-1 h-[2px] bg-gradient-to-r from-accent dark:from-accent-light to-transparent" />
          </div>
        </motion.div>
      )}
      
      <div className="min-h-full p-4">
        {hours.map((hour, index) => (
          <motion.div
            key={hour}
            initial={{ opacity: 0, x: -16 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ 
              duration: 0.4, 
              delay: index * 0.015,
              ease: EASE
            }}
            className={`
              flex items-stretch h-[52px]
              border-b border-surface-100 dark:border-surface-700/50
              ${isToday && hour === currentHour ? 'bg-accent/5 dark:bg-accent-light/5' : ''}
            `}
          >
            {/* Time Label */}
            <div className="flex-shrink-0 w-20 py-2 pr-4 flex items-start justify-end">
              <span className={`
                text-label tracking-wide
                ${isToday && hour === currentHour 
                  ? 'text-accent dark:text-accent-light font-bold' 
                  : 'text-ink-muted dark:text-ink-inverse-muted'
                }
              `}>
                {hour === 0 ? '12 AM' : hour < 12 ? `${hour} AM` : hour === 12 ? '12 PM' : `${hour - 12} PM`}
              </span>
            </div>

            {/* Hour Slot */}
            <div className="flex-1 py-1.5 pl-4 border-l border-surface-200 dark:border-surface-700">
              {/* Tasks would render here */}
            </div>
          </motion.div>
        ))}
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// WEEK VIEW
// ─────────────────────────────────────────────────────────────────────────────

function WeekView({ date }: { date: Date }) {
  const weekDays = useMemo(() => {
    const startOfWeek = new Date(date)
    startOfWeek.setDate(startOfWeek.getDate() - startOfWeek.getDay())
    
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(startOfWeek)
      d.setDate(d.getDate() + i)
      return d
    })
  }, [date])

  const today = new Date()

  return (
    <div className="h-full flex flex-col">
      {/* Day Headers */}
      <div className="flex-shrink-0 grid grid-cols-7 border-b border-surface-200 dark:border-surface-700">
        {weekDays.map((day, index) => {
          const isToday = day.toDateString() === today.toDateString()
          const isWeekend = index === 0 || index === 6
          return (
            <motion.div
              key={day.toISOString()}
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: index * 0.03, duration: 0.3, ease: EASE }}
              className={`
                py-4 text-center
                ${index < 6 ? 'border-r border-surface-200 dark:border-surface-700' : ''}
              `}
            >
              <p className={`
                text-label uppercase tracking-wider
                ${isWeekend 
                  ? 'text-ink-muted/50 dark:text-ink-inverse-muted/50' 
                  : 'text-ink-muted dark:text-ink-inverse-muted'
                }
              `}>
                {day.toLocaleDateString('en-US', { weekday: 'short' })}
              </p>
              <motion.div 
                className={`
                  mt-2 mx-auto w-9 h-9 rounded-full flex items-center justify-center
                  ${isToday 
                    ? 'bg-accent dark:bg-accent-light text-white' 
                    : ''
                  }
                `}
                initial={isToday ? { scale: 0 } : {}}
                animate={isToday ? { scale: 1 } : {}}
                transition={{ delay: 0.2, type: 'spring', stiffness: 400, damping: 20 }}
              >
                <span className={`
                  text-body-md font-display
                  ${isToday 
                    ? 'text-white font-semibold' 
                    : isWeekend 
                      ? 'text-ink-muted dark:text-ink-inverse-muted' 
                      : 'text-ink dark:text-ink-inverse'
                  }
                `}>
                  {day.getDate()}
                </span>
              </motion.div>
            </motion.div>
          )
        })}
      </div>

      {/* Time Grid */}
      <div className="flex-1 min-h-0 overflow-y-auto scrollbar-thin">
        <div className="h-full grid grid-cols-7">
          {weekDays.map((day, dayIndex) => {
            const isToday = day.toDateString() === today.toDateString()
            const isWeekend = dayIndex === 0 || dayIndex === 6
            return (
              <motion.div
                key={day.toISOString()}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: dayIndex * 0.03, duration: 0.3 }}
                className={`
                  h-full p-2
                  ${dayIndex < 6 ? 'border-r border-surface-200 dark:border-surface-700' : ''}
                  ${isToday ? 'bg-accent/5 dark:bg-accent-light/5' : ''}
                  ${isWeekend ? 'bg-surface-50/50 dark:bg-surface-800/30' : ''}
                `}
              >
                {/* Tasks would render here */}
              </motion.div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// MONTH VIEW
// ─────────────────────────────────────────────────────────────────────────────

function MonthView({ date }: { date: Date }) {
  const calendarDays = useMemo(() => {
    const year = date.getFullYear()
    const month = date.getMonth()
    
    const firstDay = new Date(year, month, 1)
    
    const startDate = new Date(firstDay)
    startDate.setDate(startDate.getDate() - startDate.getDay())
    
    const days: Date[] = []
    const current = new Date(startDate)
    for (let i = 0; i < 42; i++) {
      days.push(new Date(current))
      current.setDate(current.getDate() + 1)
    }
    
    return { days, month }
  }, [date])

  const today = new Date()
  const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

  return (
    <div className="h-full flex flex-col p-5">
      {/* Day Name Headers */}
      <div className="flex-shrink-0 grid grid-cols-7 mb-3">
        {dayNames.map((name, i) => (
          <motion.div 
            key={name} 
            className="text-center py-2"
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.03, duration: 0.3 }}
          >
            <span className={`
              text-label uppercase tracking-wider
              ${i === 0 || i === 6 
                ? 'text-ink-muted/50 dark:text-ink-inverse-muted/50' 
                : 'text-ink-muted dark:text-ink-inverse-muted'
              }
            `}>
              {name}
            </span>
          </motion.div>
        ))}
      </div>

      {/* Calendar Grid */}
      <div className="flex-1 grid grid-cols-7 grid-rows-6 gap-1">
        {calendarDays.days.map((day, index) => {
          const isCurrentMonth = day.getMonth() === calendarDays.month
          const isToday = day.toDateString() === today.toDateString()
          const isWeekend = day.getDay() === 0 || day.getDay() === 6
          
          return (
            <motion.div
              key={day.toISOString()}
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ 
                duration: 0.25, 
                delay: index * 0.006,
                ease: EASE
              }}
              whileHover={{ 
                scale: isCurrentMonth ? 1.05 : 1,
                backgroundColor: isCurrentMonth 
                  ? 'rgba(99, 102, 241, 0.05)' 
                  : 'transparent'
              }}
              className={`
                relative p-2
                rounded-lg
                transition-colors duration-200
                cursor-pointer
                group
                ${!isCurrentMonth && 'opacity-30'}
                ${isToday 
                  ? 'bg-accent/10 dark:bg-accent-light/10 ring-2 ring-accent/30 dark:ring-accent-light/30' 
                  : ''
                }
              `}
            >
              {/* Date Number */}
              <div 
                className={`
                  w-8 h-8 rounded-full flex items-center justify-center mx-auto
                  ${isToday ? 'bg-accent dark:bg-accent-light' : ''}
                  transition-all duration-200
                `}
              >
                <span className={`
                  text-body-sm
                  ${isToday 
                    ? 'font-semibold text-white' 
                    : isCurrentMonth 
                      ? isWeekend 
                        ? 'text-ink-muted dark:text-ink-inverse-muted' 
                        : 'text-ink dark:text-ink-inverse' 
                      : 'text-ink-muted dark:text-ink-inverse-muted'
                  }
                `}>
                  {day.getDate()}
                </span>
              </div>

              {/* Task indicator dots placeholder */}
              <div className="absolute bottom-1.5 left-1/2 -translate-x-1/2 flex gap-0.5">
                {/* Dots will go here */}
              </div>
            </motion.div>
          )
        })}
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// QUARTER VIEW — 3 mini months side-by-side
// ─────────────────────────────────────────────────────────────────────────────

function QuarterView({ date }: { date: Date }) {
  const quarterStart = Math.floor(date.getMonth() / 3) * 3
  const months = [0, 1, 2].map(offset => {
    const d = new Date(date.getFullYear(), quarterStart + offset, 1)
    return d
  })

  const today = new Date()
  const dayNames = ['S', 'M', 'T', 'W', 'T', 'F', 'S']

  return (
    <div className="h-full flex flex-col p-5">
      <div className="flex-1 grid grid-cols-3 gap-6">
        {months.map((monthDate, mIdx) => {
          const year = monthDate.getFullYear()
          const month = monthDate.getMonth()
          const firstDay = new Date(year, month, 1)
          const startDate = new Date(firstDay)
          startDate.setDate(startDate.getDate() - startDate.getDay())

          const days: Date[] = []
          const current = new Date(startDate)
          for (let i = 0; i < 42; i++) {
            days.push(new Date(current))
            current.setDate(current.getDate() + 1)
          }

          return (
            <motion.div
              key={monthDate.toISOString()}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: mIdx * 0.08, duration: 0.35, ease: EASE }}
              className="flex flex-col"
            >
              {/* Month title */}
              <h3 className="text-sm font-semibold text-ink dark:text-ink-inverse mb-3 text-center">
                {monthDate.toLocaleDateString('en-US', { month: 'long' })}
              </h3>

              {/* Day name headers */}
              <div className="grid grid-cols-7 mb-1">
                {dayNames.map((name, i) => (
                  <div key={`${mIdx}-${name}-${i}`} className="text-center">
                    <span className="text-[10px] uppercase tracking-wider text-ink-muted dark:text-ink-inverse-muted">
                      {name}
                    </span>
                  </div>
                ))}
              </div>

              {/* Day grid */}
              <div className="grid grid-cols-7 gap-px flex-1">
                {days.map((day, idx) => {
                  const isCurrentMonth = day.getMonth() === month
                  const isToday = day.toDateString() === today.toDateString()

                  return (
                    <div
                      key={idx}
                      className={`
                        flex items-center justify-center py-0.5
                        ${!isCurrentMonth ? 'opacity-20' : ''}
                      `}
                    >
                      <span
                        className={`
                          w-6 h-6 rounded-full flex items-center justify-center text-xs
                          ${isToday
                            ? 'bg-gradient-to-br from-indigo-500 to-violet-500 text-white font-bold shadow-[0_0_8px_rgba(99,102,241,0.4)]'
                            : isCurrentMonth
                              ? 'text-ink dark:text-ink-inverse'
                              : 'text-ink-muted dark:text-ink-inverse-muted'
                          }
                        `}
                      >
                        {day.getDate()}
                      </span>
                    </div>
                  )
                })}
              </div>
            </motion.div>
          )
        })}
      </div>
    </div>
  )
}
