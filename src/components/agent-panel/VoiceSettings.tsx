import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ai-elements/select'
import { useAudioDevices } from '@/components/ai-elements/mic-selector'
import {
  GEMINI_VOICES,
  LIVE_MODELS,
  REASONING_EFFORTS,
  isGeminiVoice,
  isLiveModel,
  isReasoningEffort,
  liveModelLabel,
  supportsEffort,
  type GeminiVoiceId,
  type LiveModelId,
  type ReasoningEffort,
} from '@/lib/voice-settings'
import { cn } from '@/utils/cn'

/** Input recipe: hairline field, volt border + ring on focus. */
const trigger = cn(
  'h-9 w-full rounded-lg border-surface-200 bg-surface-0 px-3 text-[13px] text-ink shadow-none transition-colors duration-150',
  'hover:border-surface-300 focus:border-blurple-500 focus:ring-2 focus:ring-blurple-600/25 disabled:opacity-40',
  'dark:border-surface-800 dark:bg-surface-900 dark:text-ink-inverse dark:hover:border-surface-700 dark:focus:border-blurple-400 dark:focus:ring-blurple-400/25',
)
/** Console label above each control; the trigger carries the accessible name. */
const label = 'mb-1.5 block font-mono text-[11px] font-medium uppercase leading-none tracking-[0.08em] text-ink-muted dark:text-ink-inverse-muted'

export interface VoiceSettingsProps {
  micDeviceId: string | undefined
  onMicDeviceChange: (id: string | undefined) => void
  micLocked: boolean
  model: LiveModelId
  onModelChange: (model: LiveModelId) => void
  voice: GeminiVoiceId
  onVoiceChange: (voice: GeminiVoiceId) => void
  effort: ReasoningEffort
  onEffortChange: (effort: ReasoningEffort) => void
  /** True while a voice session is connecting/ready: model/voice/effort apply on the next connect. */
  sessionLocked: boolean
  className?: string
}

export function VoiceSettings({
  micDeviceId, onMicDeviceChange, micLocked,
  model, onModelChange,
  voice, onVoiceChange,
  effort, onEffortChange,
  sessionLocked, className,
}: VoiceSettingsProps) {
  const thinking = supportsEffort(model)
  const { devices, loadDevices } = useAudioDevices()
  const microphones = devices.filter((device) => device.deviceId)
  const selectedVoice = GEMINI_VOICES.find((item) => item.id === voice) ?? GEMINI_VOICES[0]
  const effortLabel = REASONING_EFFORTS.find((option) => option.id === effort)?.label ?? effort
  const micValue = micDeviceId && microphones.some((device) => device.deviceId === micDeviceId) ? micDeviceId : 'default'

  return <div role="group" aria-label="Live settings" className={cn('grid grid-cols-2 gap-x-2 gap-y-3', className)}>
    <div className="min-w-0">
      <span aria-hidden className={label}>Model</span>
      <Select value={model} disabled={sessionLocked} onValueChange={(next) => { if (isLiveModel(next)) onModelChange(next) }}>
        <SelectTrigger className={trigger} aria-label={`Live model: ${liveModelLabel(model)}`} title={sessionLocked ? 'Disconnect Live to change the model' : undefined}>
          <SelectValue placeholder="Model" />
        </SelectTrigger>
        <SelectContent>
          {LIVE_MODELS.map((option) => <SelectItem key={option.id} value={option.id}>{option.label}</SelectItem>)}
        </SelectContent>
      </Select>
    </div>
    <div className="min-w-0">
      <span aria-hidden className={label}>Microphone</span>
      <Select value={micDeviceId || 'default'} disabled={micLocked} onOpenChange={(open) => { if (open) void loadDevices() }}
        onValueChange={(next) => onMicDeviceChange(next === 'default' ? undefined : next)}>
        <SelectTrigger className={trigger} aria-label="Microphone" title={micLocked ? 'Mute the microphone to switch device' : undefined}>
          <SelectValue placeholder="Microphone" />
        </SelectTrigger>
        <SelectContent>
          {micValue === 'default' && <SelectItem value="default">Default microphone</SelectItem>}
          {microphones.map((device) => (
            <SelectItem key={device.deviceId} value={device.deviceId}>{device.label || 'Microphone'}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
    <div className="min-w-0">
      <span aria-hidden className={label}>Voice</span>
      <Select value={voice} disabled={sessionLocked} onValueChange={(next) => { if (isGeminiVoice(next)) onVoiceChange(next) }}>
        <SelectTrigger className={trigger} aria-label={`Agent voice: ${selectedVoice.name}`} title={sessionLocked ? 'Disconnect Live to change the voice' : undefined}>
          <SelectValue placeholder="Voice" />
        </SelectTrigger>
        <SelectContent>
          {GEMINI_VOICES.map((item) => <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>)}
        </SelectContent>
      </Select>
    </div>
    <div className="min-w-0">
      <span aria-hidden className={label}>Effort</span>
      <Select value={effort} disabled={sessionLocked || !thinking} onValueChange={(next) => { if (isReasoningEffort(next)) onEffortChange(next) }}>
        <SelectTrigger className={trigger} aria-label={thinking ? `Reasoning effort: ${effortLabel}` : 'Reasoning effort: not available for this model'}>
          <SelectValue placeholder={thinking ? 'Effort' : 'No thinking config'} />
        </SelectTrigger>
        <SelectContent>
          {REASONING_EFFORTS.map((option) => <SelectItem key={option.id} value={option.id}>{option.label}</SelectItem>)}
        </SelectContent>
      </Select>
    </div>
  </div>
}
