import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import { ArrowLeftIcon, CheckIcon, ChevronDownIcon, ChevronRightIcon } from '@heroicons/react/24/outline'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { API_BASE_URL } from '@/lib/api-base'
import { cn } from '@/utils/cn'

export interface AgentModelOption {
  id: string
  owned_by?: string
  provider?: string
}

export interface AgentModelSelection {
  model: string
  provider: string
  effort: string
}

// Empty model delegates initial defaults to the backend.
export const DEFAULT_AGENT_MODEL = ''

const API = API_BASE_URL
const PROVIDERS = [
  { id: 'perplexity', label: 'Perplexity' },
  { id: 'openai', label: 'OpenAI' },
  { id: 'anthropic', label: 'Anthropic' },
  { id: 'gemini', label: 'Gemini AI Studio' },
  { id: 'xai', label: 'xAI' },
  { id: 'mistral', label: 'Mistral' },
] as const

function providerLabel(provider: string): string {
  return PROVIDERS.find((item) => item.id === provider)?.label ?? provider
}

export function modelOptionValue(model: Pick<AgentModelOption, 'id' | 'provider'>): string {
  return model.provider ? `${model.provider}::${model.id}` : model.id
}

export function parseModelOptionValue(value: string): { provider: string; id: string } {
  const sep = value.indexOf('::')
  return sep <= 0 ? { provider: '', id: value } : { provider: value.slice(0, sep), id: value.slice(sep + 2) }
}

function readableModelName(id: string): string {
  const rawName = id.includes('/') ? id.split('/').slice(1).join('/') : id
  const words = rawName.split('-')
  const formatted: string[] = []
  for (let index = 0; index < words.length; index += 1) {
    const word = words[index]
    if (/^\d+$/.test(word) && /^\d+$/.test(words[index + 1] ?? '')) {
      const numericParts = [word]
      while (/^\d+$/.test(words[index + 1] ?? '')) numericParts.push(words[++index])
      formatted.push(numericParts.join('.'))
    } else if (['gpt', 'glm'].includes(word.toLowerCase())) formatted.push(word.toUpperCase())
    else formatted.push(word.charAt(0).toUpperCase() + word.slice(1))
  }
  return formatted.join(' ')
}

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function normalizeModels(raw: unknown): AgentModelOption[] {
  if (!Array.isArray(raw)) throw new Error('The model catalogue returned an invalid response.')
  const seen = new Set<string>()
  const models: AgentModelOption[] = []
  for (const item of raw) {
    const entry = record(item)
    const id = typeof item === 'string' ? item : entry.id
    if (typeof id !== 'string' || !id.trim()) continue
    const provider = typeof entry.provider === 'string' ? entry.provider : undefined
    const identity = modelOptionValue({ id, provider })
    if (seen.has(identity)) continue
    seen.add(identity)
    models.push({ id, provider, owned_by: typeof entry.owned_by === 'string' ? entry.owned_by : undefined })
  }
  return models
}

function parseCatalogue(raw: unknown) {
  const data = record(raw)
  return {
    models: normalizeModels(data.data),
    defaultModel: typeof data.default_model === 'string' ? data.default_model : '',
    defaultProvider: typeof data.default_provider === 'string' ? data.default_provider : '',
    providerErrors: Object.fromEntries(Object.entries(record(data.errors)).filter((entry): entry is [string, string] => typeof entry[1] === 'string')),
  }
}

function parseProviders(raw: unknown): Record<string, boolean> {
  const data = record(raw)
  if (!data.providers || typeof data.providers !== 'object' || Array.isArray(data.providers)) {
    throw new Error('Provider configuration returned an invalid response.')
  }
  const providers = record(data.providers)
  return Object.fromEntries(PROVIDERS.map(({ id }) => [id, providers[id] === true]))
}

function parseEfforts(raw: unknown): string[] {
  const data = record(raw)
  if (!Array.isArray(data.efforts) || data.efforts.some((effort) => typeof effort !== 'string' || !effort)) {
    throw new Error('Reasoning capabilities returned an invalid response.')
  }
  return [...new Set(data.efforts as string[])]
}

// Results are keyed by both URL and retry generation. A previous model's
// capabilities can never be used during the render before effect cleanup.
function useResource<T>(url: string | null, parse: (raw: unknown) => T) {
  const [revision, setRevision] = useState(0)
  const [result, setResult] = useState<{ key: string; data?: T; error?: string }>()
  const controller = useRef<AbortController | null>(null)
  const key = `${url ?? ''}:${revision}`
  const refresh = useCallback(() => {
    controller.current?.abort()
    setRevision((current) => current + 1)
  }, [])
  useEffect(() => {
    if (!url) return
    const request = new AbortController()
    controller.current = request
    void (async () => {
      try {
        const response = await fetch(url, { signal: request.signal })
        if (!response.ok) throw new Error(`Request failed (HTTP ${response.status}). Please retry.`)
        const data = parse(await response.json())
        if (!request.signal.aborted) setResult({ key, data })
      } catch (error) {
        if (!request.signal.aborted) setResult({ key, error: error instanceof Error ? error.message : 'Request failed. Please retry.' })
      }
    })()
    return () => request.abort()
  }, [url, key, parse])
  const current = result?.key === key ? result : undefined
  return { data: current?.data, error: current?.error ?? '', loading: Boolean(url && !current), refresh }
}

export function useAgentModels() {
  // Configuration must remain independent: a catalogue outage must not hide
  // which providers are configured, and catalogue entries never imply a key.
  const catalogue = useResource(`${API}/models`, parseCatalogue)
  const config = useResource(`${API}/config`, parseProviders)
  const refresh = useCallback(() => { catalogue.refresh(); config.refresh() }, [catalogue.refresh, config.refresh])
  // Retain automatic defaults across retries, but never retain stale inventory.
  const [defaults, setDefaults] = useState({ defaultModel: DEFAULT_AGENT_MODEL, defaultProvider: '' })
  useEffect(() => {
    if (catalogue.data) setDefaults({ defaultModel: catalogue.data.defaultModel, defaultProvider: catalogue.data.defaultProvider })
  }, [catalogue.data])
  return {
    ...defaults,
    models: catalogue.data?.models ?? [],
    providerErrors: catalogue.data?.providerErrors ?? {},
    modelsLoading: catalogue.loading,
    modelsError: catalogue.error,
    providers: config.data ?? {},
    providersLoading: config.loading,
    providersError: config.error,
    refresh,
  }
}

export function useModelEfforts(modelId: string, provider = '', enabled = false) {
  const url = enabled && modelId
    ? `${API}/models/${encodeURIComponent(modelId)}/efforts?provider=${encodeURIComponent(provider)}` : null
  const resource = useResource(url, parseEfforts)
  return { efforts: resource.data ?? [], loading: resource.loading, error: resource.error,
    ready: resource.data !== undefined && Boolean(url), refresh: resource.refresh }
}

const muted = 'text-ink-muted dark:text-ink-inverse-muted'
const focus = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-surface-900'
const button = cn('rounded-lg px-3 py-2 text-xs font-medium hover:bg-indigo-50 dark:hover:bg-surface-800 disabled:cursor-not-allowed disabled:opacity-50', focus)
const row = cn('flex w-full items-center gap-3 rounded-lg border border-transparent px-3 py-2.5 text-left text-xs transition-colors hover:bg-indigo-50 dark:hover:bg-indigo-950/40 disabled:cursor-not-allowed disabled:hover:bg-transparent', focus)

interface ModelSelectorProps {
  value: string
  provider?: string
  effort?: string
  includeEffort?: boolean
  models: AgentModelOption[]
  providers?: Record<string, boolean>
  providersLoading?: boolean
  providersError?: string
  modelsLoading?: boolean
  modelsError?: string
  providerErrors?: Record<string, string>
  disabled?: boolean
  className?: string
  onChange: (modelId: string, provider: string, effort: string) => void
  onOpen?: () => void
}

export function ModelSelector({ value, provider = '', effort = '', includeEffort = false, models,
  providers = {}, providersLoading = false, providersError = '', modelsLoading = false,
  modelsError = '', providerErrors = {}, disabled, className, onChange, onOpen }: ModelSelectorProps) {
  const [open, setOpen] = useState(false)
  const [step, setStep] = useState<'provider' | 'model' | 'effort'>('provider')
  const [draft, setDraft] = useState<AgentModelSelection>({ model: '', provider: '', effort: '' })
  const [search, setSearch] = useState('')
  const titleId = useId()
  const effortGroup = useId()
  const heading = useRef<HTMLHeadingElement>(null)
  const capabilities = useModelEfforts(draft.model, draft.provider, open && !disabled && step === 'effort' && includeEffort)
  const currentInCatalogue = models.some((model) => model.id === value && model.provider === provider)
  const summary = [providerLabel(provider), value ? provider === 'perplexity' || !currentInCatalogue ? value : readableModelName(value) : 'Backend default', includeEffort ? effort || 'Provider default' : ''].filter(Boolean).join(' / ')
  const modelError = modelsError || providerErrors[draft.provider] || ''
  const validModel = !disabled && !providersLoading && !providersError && providers[draft.provider] === true &&
    !modelsLoading && !modelError && models.some((model) => model.id === draft.model && model.provider === draft.provider)
  const canApply = validModel && (includeEffort
    ? step === 'effort' && capabilities.ready && (!draft.effort || capabilities.efforts.includes(draft.effort))
    : step === 'model')
  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase()
    return models.filter((model) => model.provider === draft.provider &&
      (!query || `${model.id} ${readableModelName(model.id)}`.toLowerCase().includes(query)))
  }, [models, draft.provider, search])

  useEffect(() => {
    if (disabled) setOpen(false)
  }, [disabled])
  useEffect(() => {
    if (!open) return
    const frame = requestAnimationFrame(() => heading.current?.focus())
    return () => cancelAnimationFrame(frame)
  }, [open, step])

  const back = () => {
    setDraft((current) => ({ ...current, model: '', effort: '' }))
    setStep(step === 'effort' ? 'model' : 'provider')
  }
  return <Popover modal open={open && !disabled} onOpenChange={(next) => {
    if (next && disabled) return
    if (next) {
      setStep('provider'); setDraft({ model: '', provider: '', effort: '' }); setSearch(''); onOpen?.()
    }
    setOpen(next)
  }}>
    <PopoverTrigger asChild>
      <button type="button" disabled={disabled} title={`${summary}${value ? `\n${value}` : ''}${disabled ? '\nConfiguration locked for this conversation' : ''}`}
        aria-label={`Model configuration: ${summary}${disabled ? '. Locked for this conversation' : ''}`}
        className={cn('inline-flex h-9 min-w-0 items-center gap-2 rounded-xl border border-surface-200/80 bg-white/70 px-2.5 text-xs font-semibold text-ink shadow-sm transition-colors hover:border-indigo-300 dark:border-surface-700 dark:bg-surface-850/80 dark:text-ink-inverse disabled:cursor-not-allowed disabled:opacity-60', focus, className)}>
        <span className="min-w-0 flex-1 truncate text-left">{summary}</span>
        <ChevronDownIcon aria-hidden="true" className="h-4 w-4 shrink-0" />
      </button>
    </PopoverTrigger>
    <PopoverContent align="start" sideOffset={8} collisionPadding={12} aria-labelledby={titleId}
      onOpenAutoFocus={(event) => { event.preventDefault(); heading.current?.focus() }}
      className="z-[100] flex w-[360px] max-w-[calc(100vw-24px)] flex-col overflow-hidden rounded-xl border-surface-200 bg-white p-0 text-ink shadow-xl dark:border-surface-700 dark:bg-surface-900 dark:text-ink-inverse motion-reduce:animate-none"
      style={{ maxHeight: 'min(520px, var(--radix-popover-content-available-height))' }}>
      <div className="shrink-0 border-b border-surface-200 px-4 py-3 dark:border-surface-700">
        <div className="mb-2 flex items-center justify-between gap-2">
          <span className={cn('text-[10px] font-semibold uppercase tracking-wider', muted)}>Model configuration · {step === 'provider' ? 1 : step === 'model' ? 2 : 3}/{includeEffort ? 3 : 2}</span>
          {step !== 'provider' && <button type="button" onClick={back} className={cn(button, '-my-1 flex items-center gap-1 px-2')}><ArrowLeftIcon aria-hidden="true" className="h-3 w-3" />Back</button>}
        </div>
        <h3 ref={heading} id={titleId} tabIndex={-1} className="text-sm font-semibold outline-none">{step === 'provider' ? 'Choose a provider' : step === 'model' ? `${providerLabel(draft.provider)} models` : 'Choose reasoning effort'}</h3>
        <p className={cn('mt-1 break-words text-[11px]', muted)}>{step === 'provider' ? `Current: ${summary}` : step === 'model' ? 'Choose a model from this provider’s live catalogue.' : `${providerLabel(draft.provider)} / ${draft.model}`}</p>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-2">
        {step === 'provider' && <>
          {providersLoading && <p role="status" className={cn('px-3 py-2 text-xs', muted)}>Checking API key configuration…</p>}
          {providersError && <RequestError message={`Could not check API keys. ${providersError}`} onRetry={onOpen} />}
          {modelsError && <RequestError message={`Model catalogue unavailable. ${modelsError}`} onRetry={onOpen} />}
          {PROVIDERS.map((item) => {
            const configured = providers[item.id] === true && !providersLoading && !providersError
            return <button type="button" key={item.id} disabled={!configured} className={row} onClick={() => {
              setDraft({ provider: item.id, model: '', effort: '' }); setSearch(''); setStep('model')
            }}>
              <span className={cn('h-2 w-2 shrink-0 rounded-full', configured ? 'bg-indigo-500' : 'bg-surface-300 dark:bg-surface-600')} aria-hidden="true" />
              <span className="min-w-0 flex-1"><span className="block font-semibold">{item.label}</span>
                <span className={cn('mt-0.5 block text-[11px]', muted)}>{providersLoading ? 'Checking configuration…' : providersError ? 'Configuration unavailable' : configured ? providerErrors[item.id] ? 'Configured · catalogue unavailable' : 'Configured' : 'API key not configured'}</span></span>
              {item.id === provider && <span className="text-[10px] text-indigo-600 dark:text-indigo-300">Current</span>}
              {configured && <ChevronRightIcon aria-hidden="true" className={cn('h-4 w-4 shrink-0', muted)} />}
            </button>
          })}
        </>}

        {step === 'model' && <>
          <div className="px-2 pb-2 pt-1"><input type="search" value={search} onChange={(event) => setSearch(event.target.value)} aria-label="Search models by name or ID" placeholder="Search model name or ID…"
            className={cn('w-full rounded-lg border border-surface-200 bg-surface-50 px-3 py-2 text-xs dark:border-surface-700 dark:bg-surface-850', focus)} /></div>
          {modelsLoading ? <p role="status" className={cn('p-3 text-xs', muted)}>Loading models…</p> : modelError ? <RequestError message={modelError} onRetry={onOpen} /> : <>
            {!filtered.length && <p role="status" className={cn('p-3 text-xs', muted)}>{search ? 'No models match your search.' : 'No models are available for this provider.'}</p>}
            {!filtered.length && !search && <button type="button" onClick={onOpen} className={button}>Refresh catalogue</button>}
            {filtered.map((model) => <button type="button" key={modelOptionValue(model)} disabled={providers[draft.provider] !== true || providersLoading || Boolean(providersError)}
              aria-pressed={draft.model === model.id} className={cn(row, draft.model === model.id && 'border-indigo-200 bg-indigo-50 dark:border-indigo-800 dark:bg-indigo-950/40')}
              onClick={() => {
                setDraft((current) => ({ ...current, model: model.id, effort: '' }))
                if (includeEffort) { capabilities.refresh(); setStep('effort') }
              }}>
              <span className="min-w-0 flex-1"><span className="block font-semibold">{readableModelName(model.id)}</span><span className={cn('mt-0.5 block break-all text-[11px]', muted)}>{model.id}</span></span>
              {model.id === value && model.provider === provider && <span className="text-[10px] text-indigo-600 dark:text-indigo-300">Current</span>}
              {includeEffort ? <ChevronRightIcon aria-hidden="true" className="h-4 w-4 shrink-0" /> : draft.model === model.id && <CheckIcon aria-hidden="true" className="h-4 w-4 shrink-0 text-indigo-500" />}
            </button>)}
          </>}
        </>}

        {step === 'effort' && <>
          {capabilities.loading && <p role="status" className={cn('p-3 text-xs', muted)}>Checking supported reasoning efforts…</p>}
          {capabilities.error && <RequestError message={`Could not check reasoning support. ${capabilities.error}`} onRetry={capabilities.refresh} />}
          {capabilities.ready && (capabilities.efforts.length ? <fieldset className="space-y-1"><legend className="sr-only">Reasoning effort</legend>
            {['', ...capabilities.efforts].map((option) => <label key={option} className={cn(row, draft.effort === option && 'border-indigo-200 bg-indigo-50 dark:border-indigo-800 dark:bg-indigo-950/40')}>
              <input type="radio" name={effortGroup} value={option} checked={draft.effort === option} onChange={() => setDraft((current) => ({ ...current, effort: option }))} className={cn('h-3.5 w-3.5 accent-indigo-600', focus)} />
              <span><span className="block font-semibold">{option ? option.charAt(0).toUpperCase() + option.slice(1) : 'Provider default'}</span>{!option && <span className={cn('mt-0.5 block text-[11px]', muted)}>Let the provider choose.</span>}</span>
            </label>)}
          </fieldset> : <p role="status" className="p-3 text-xs leading-relaxed"><span className="block font-semibold">Provider default only</span><span className={cn('mt-1 block', muted)}>This model does not support adjustable reasoning effort. Apply to use its default.</span></p>)}
          {!validModel && !modelsLoading && <RequestError message={modelError || 'This model or provider is no longer available. Go back to choose another.'} onRetry={onOpen} />}
        </>}
      </div>

      <div className="flex shrink-0 items-center justify-between gap-2 border-t border-surface-200 px-3 py-2 dark:border-surface-700">
        <button type="button" className={button} onClick={() => setOpen(false)}>Cancel</button>
        <button type="button" disabled={!canApply} className={cn(button, 'bg-indigo-600 text-white hover:bg-indigo-700 dark:hover:bg-indigo-500')} onClick={() => {
          if (!canApply) return
          onChange(draft.model, draft.provider, includeEffort && capabilities.efforts.length ? draft.effort : '')
          setOpen(false)
        }}>Apply configuration</button>
      </div>
    </PopoverContent>
  </Popover>
}

function RequestError({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return <div className="m-1 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
    <p role="alert" className="break-words">{message}</p>
    {onRetry && <button type="button" onClick={onRetry} className={cn('mt-2 rounded font-semibold underline underline-offset-2', focus)}>Retry</button>}
  </div>
}
