import { useId, useState } from 'react'
import { AudioLinesIcon, BrainIcon, CheckIcon, ChevronDownIcon, MicIcon } from 'lucide-react'
import {
  MicSelector,
  MicSelectorContent,
  MicSelectorEmpty,
  MicSelectorInput,
  MicSelectorItem,
  MicSelectorLabel,
  MicSelectorList,
  MicSelectorTrigger,
  MicSelectorValue,
} from '@/components/ai-elements/mic-selector'
import {
  VoiceSelector,
  VoiceSelectorBullet,
  VoiceSelectorContent,
  VoiceSelectorDescription,
  VoiceSelectorEmpty,
  VoiceSelectorGender,
  VoiceSelectorInput,
  VoiceSelectorItem,
  VoiceSelectorList,
  VoiceSelectorName,
  VoiceSelectorTrigger,
} from '@/components/ai-elements/voice-selector'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import {
  GEMINI_VOICES,
  REASONING_EFFORTS,
  VOICE_MODEL_LABEL,
  isGeminiVoice,
  type GeminiVoiceId,
  type ReasoningEffort,
} from '@/lib/voice-settings'
import { cn } from '@/utils/cn'

// Class constants mirror ModelSelector so the three triggers read as one row.
const focus = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-surface-900'
const trigger = cn('inline-flex h-9 min-w-0 flex-1 items-center gap-2 rounded-xl border border-surface-200/80 bg-white/70 px-2.5 text-xs font-semibold text-ink shadow-sm transition-colors hover:border-indigo-300 dark:border-surface-700 dark:bg-surface-850/80 dark:text-ink-inverse disabled:cursor-not-allowed disabled:opacity-60', focus)
// The mic trigger sits on shadcn's `Button variant="outline"`; these neutralise
// its hover fill / centring / pointer-events so it matches the plain buttons.
const micTrigger = cn(trigger, 'justify-start hover:bg-white/70 hover:text-ink dark:hover:bg-surface-850/80 dark:hover:text-ink-inverse disabled:pointer-events-auto')
const panel = 'z-[100] rounded-xl border-surface-200 bg-white p-0 text-ink shadow-xl dark:border-surface-700 dark:bg-surface-900 dark:text-ink-inverse'
const row = 'flex w-full items-center gap-3 rounded-lg border border-transparent px-3 py-2.5 text-left text-xs transition-colors hover:bg-indigo-50 dark:hover:bg-indigo-950/40'
const rowSelected = 'border-indigo-200 bg-indigo-50 dark:border-indigo-800 dark:bg-indigo-950/40'
const muted = 'text-ink-muted dark:text-ink-inverse-muted'
const cell = 'min-w-[calc(50%-0.1875rem)] sm:min-w-0'

export interface VoiceSettingsProps {
  micDeviceId: string | undefined
  onMicDeviceChange: (id: string | undefined) => void
  micLocked: boolean
  voice: GeminiVoiceId
  onVoiceChange: (voice: GeminiVoiceId) => void
  effort: ReasoningEffort
  onEffortChange: (effort: ReasoningEffort) => void
  /** True while a voice session is connecting/ready. */
  sessionLocked: boolean
  className?: string
}

export function VoiceSettings({
  micDeviceId, onMicDeviceChange, micLocked,
  voice, onVoiceChange,
  effort, onEffortChange,
  sessionLocked, className,
}: VoiceSettingsProps) {
  const [voiceOpen, setVoiceOpen] = useState(false)
  const selected = GEMINI_VOICES.find((item) => item.id === voice) ?? GEMINI_VOICES[0]

  return <div role="group" aria-label="Voice settings" className={cn('flex min-w-0 flex-wrap items-center gap-1.5', className)}>
    <MicSelector value={micDeviceId} onValueChange={onMicDeviceChange}>
      <MicSelectorTrigger className={cn(micTrigger, cell)} disabled={micLocked}
        title={micLocked ? 'Mute the microphone to switch device' : undefined} aria-label="Microphone">
        <MicIcon aria-hidden="true" className="size-4 shrink-0 text-indigo-500" />
        <MicSelectorValue className="truncate" />
      </MicSelectorTrigger>
      <MicSelectorContent popoverOptions={{ align: 'start', sideOffset: 8, collisionPadding: 12, className: cn(panel, 'min-w-[260px] overflow-hidden') }}>
        <MicSelectorInput />
        <MicSelectorEmpty />
        <MicSelectorList>
          {(devices) => devices.map((device) => (
            <MicSelectorItem key={device.deviceId} value={device.deviceId} keywords={[device.label]} className="text-xs">
              <MicSelectorLabel device={device} />
              {device.deviceId === micDeviceId && <CheckIcon aria-hidden="true" className="ml-auto size-4 text-indigo-500" />}
            </MicSelectorItem>
          ))}
        </MicSelectorList>
      </MicSelectorContent>
    </MicSelector>

    <VoiceSelector open={voiceOpen} onOpenChange={setVoiceOpen} value={voice}
      onValueChange={(next) => { if (isGeminiVoice(next)) onVoiceChange(next) }}>
      <VoiceSelectorTrigger asChild>
        <button type="button" className={cn(trigger, cell)} disabled={sessionLocked}
          title={sessionLocked ? 'Applies to the next session' : undefined} aria-label={`Agent voice: ${selected.name}`}>
          <AudioLinesIcon aria-hidden="true" className="size-4 shrink-0 text-indigo-500" />
          <span className="min-w-0 flex-1 truncate text-left">{selected.name}</span>
          <VoiceSelectorDescription className={cn('hidden sm:inline', muted)}>{selected.description}</VoiceSelectorDescription>
          <ChevronDownIcon aria-hidden="true" className="size-4 shrink-0" />
        </button>
      </VoiceSelectorTrigger>
      <VoiceSelectorContent title="Agent voice" showCloseButton={false} className={cn(panel, 'max-w-md overflow-hidden')}
        overlayClassName="z-[100] bg-black/40 backdrop-blur-sm">
        <VoiceSelectorInput placeholder="Search voices..." />
        <VoiceSelectorList>
          <VoiceSelectorEmpty>No voices found.</VoiceSelectorEmpty>
          {GEMINI_VOICES.map((item) => (
            <VoiceSelectorItem key={item.id} value={item.id} className="text-xs"
              onSelect={() => { onVoiceChange(item.id); setVoiceOpen(false) }}>
              <VoiceSelectorName>{item.name}</VoiceSelectorName>
              <VoiceSelectorDescription>{item.description}</VoiceSelectorDescription>
              <VoiceSelectorBullet />
              <VoiceSelectorGender value={item.gender} />
              {item.id === voice && <CheckIcon aria-hidden="true" className="size-4 text-indigo-500" />}
            </VoiceSelectorItem>
          ))}
        </VoiceSelectorList>
        <p className={cn('border-t border-surface-200 px-4 py-2 text-[11px] dark:border-surface-700', muted)}>
          Gemini Live prebuilt voices · {VOICE_MODEL_LABEL}
        </p>
      </VoiceSelectorContent>
    </VoiceSelector>

    <ReasoningEffortSelector value={effort} onChange={onEffortChange} disabled={sessionLocked} className={cell} />
  </div>
}

export function ReasoningEffortSelector({ value, onChange, disabled, className }: {
  value: ReasoningEffort
  onChange: (effort: ReasoningEffort) => void
  disabled?: boolean
  className?: string
}) {
  const [open, setOpen] = useState(false)
  const groupId = useId()
  const label = REASONING_EFFORTS.find((option) => option.id === value)?.label ?? value

  return <Popover open={open} onOpenChange={setOpen}>
    <PopoverTrigger asChild>
      <button type="button" className={cn(trigger, className)} disabled={disabled}
        title={disabled ? 'Applies to the next session' : undefined} aria-label={`Reasoning effort: ${label}`}>
        <BrainIcon aria-hidden="true" className="size-4 shrink-0 text-indigo-500" />
        <span className="min-w-0 flex-1 truncate text-left">{label} effort</span>
        <ChevronDownIcon aria-hidden="true" className="size-4 shrink-0" />
      </button>
    </PopoverTrigger>
    <PopoverContent align="end" sideOffset={8} collisionPadding={12} className={cn(panel, 'w-[300px] max-w-[calc(100vw-24px)]')}>
      <div className="border-b border-surface-200 px-4 py-3 dark:border-surface-700">
        <span className={cn('text-[10px] font-semibold uppercase tracking-wider', muted)}>Extended thinking</span>
        <h3 className="text-sm font-semibold">Choose reasoning effort</h3>
        <p className={cn('mt-1 text-[11px]', muted)}>{VOICE_MODEL_LABEL}</p>
      </div>
      <fieldset className="space-y-1 p-2">
        <legend className="sr-only">Reasoning effort</legend>
        {REASONING_EFFORTS.map((option) => (
          <label key={option.id} className={cn(row, value === option.id && rowSelected)}>
            <input type="radio" name={groupId} value={option.id} checked={value === option.id}
              onChange={() => { onChange(option.id); setOpen(false) }} className={cn('h-3.5 w-3.5 accent-indigo-600', focus)} />
            <span>
              <span className="block font-semibold">{option.label}</span>
              <span className={cn('mt-0.5 block text-[11px]', muted)}>{option.description}</span>
            </span>
          </label>
        ))}
      </fieldset>
    </PopoverContent>
  </Popover>
}
