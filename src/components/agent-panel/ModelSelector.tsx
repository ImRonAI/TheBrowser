import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { CheckIcon, ChevronDownIcon } from '@heroicons/react/24/outline'
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
  { id: 'nim', label: 'NVIDIA NIM' },
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
  // The backend lists only the providers it offers for chat (RON_CHAT_PROVIDERS); true/false is key presence.
  return Object.fromEntries(PROVIDERS.filter(({ id }) => id in providers).map(({ id }) => [id, providers[id] === true]))
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
const focus = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-1 dark:focus-visible:ring-offset-surface-900'
const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1)

interface ModelSelectorProps {
  value: string
  provider?: string
  effort?: string
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

/**
 * The model picker: one searchable list of the configured providers' models, and the chosen model's reasoning
 * levels along the bottom. Picking a model applies it at once with the provider's default reasoning ("Auto");
 * picking a level applies it and closes. The levels are whatever `GET /models/{id}/efforts` reports for the chosen model,
 * and the row is absent for a model with none.
 */
export function ModelSelector({ value, provider = '', effort = '', models, providers = {}, providersLoading = false,
  providersError = '', modelsLoading = false, modelsError = '', providerErrors = {}, disabled, className, onChange, onOpen }: ModelSelectorProps) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const searchBox = useRef<HTMLInputElement>(null)
  const capabilities = useModelEfforts(value, provider, open && !disabled && Boolean(value && provider))
  const modelName = value ? provider === 'perplexity' ? value : readableModelName(value) : 'Default model'
  const level = effort && (!capabilities.ready || capabilities.efforts.includes(effort)) ? effort : ''
  const summary = [modelName, level && capitalize(level)].filter(Boolean).join(' · ')
  const loading = providersLoading || modelsLoading
  const failure = providersError || modelsError
  const sections = useMemo(() => {
    const query = search.trim().toLowerCase()
    return PROVIDERS.filter((item) => providers[item.id] === true).map((item) => ({
      ...item,
      error: providerErrors[item.id] ?? '',
      models: models.filter((model) => model.provider === item.id &&
        (!query || `${model.id} ${readableModelName(model.id)}`.toLowerCase().includes(query))),
    })).filter((section) => section.models.length || (section.error && !query))
  }, [models, providers, providerErrors, search])

  useEffect(() => {
    if (disabled) setOpen(false)
  }, [disabled])

  return <Popover modal open={open && !disabled} onOpenChange={(next) => {
    if (next && disabled) return
    if (next) { setSearch(''); onOpen?.() }
    setOpen(next)
  }}>
    <PopoverTrigger asChild>
      <button type="button" disabled={disabled}
        title={`${providerLabel(provider)}${value ? ` · ${value}` : ''}${disabled ? '\nLocked for this conversation' : ''}`}
        aria-label={`Model: ${summary}${disabled ? '. Locked for this conversation' : ''}`}
        className={cn('inline-flex h-9 min-w-0 items-center gap-1.5 rounded-xl border border-surface-200/80 bg-white/70 px-2.5 text-xs font-semibold text-ink shadow-sm transition-colors hover:border-indigo-300 dark:border-surface-700 dark:bg-surface-850/80 dark:text-ink-inverse disabled:cursor-not-allowed disabled:opacity-60', focus, className)}>
        <span className="min-w-0 flex-1 truncate text-left">{summary}</span>
        <ChevronDownIcon aria-hidden="true" className="h-3.5 w-3.5 shrink-0 opacity-60" />
      </button>
    </PopoverTrigger>
    <PopoverContent align="start" sideOffset={8} collisionPadding={12} aria-label="Choose a model"
      onOpenAutoFocus={(event) => { event.preventDefault(); searchBox.current?.focus() }}
      className="z-[100] flex w-[300px] max-w-[calc(100vw-24px)] flex-col overflow-hidden rounded-xl border-surface-200 bg-white p-0 text-ink shadow-xl dark:border-surface-700 dark:bg-surface-900 dark:text-ink-inverse motion-reduce:animate-none"
      style={{ maxHeight: 'min(440px, var(--radix-popover-content-available-height))' }}>
      <input ref={searchBox} type="search" value={search} onChange={(event) => setSearch(event.target.value)}
        onKeyDown={(event) => {
          const first = sections[0]?.models[0]
          if (event.key === 'Enter' && first?.provider) { event.preventDefault(); onChange(first.id, first.provider, '') }
        }}
        aria-label="Search models" placeholder="Search models…"
        className="ron-field shrink-0 border-b border-surface-200 bg-transparent px-3.5 py-2.5 text-xs outline-none placeholder:text-ink-muted/70 dark:border-surface-700 dark:placeholder:text-ink-inverse-muted/70" />

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-1.5">
        {/* The model in use leads the list, so it is in view however long the catalogue is. */}
        {value && !search && <div title={value} className="flex items-center gap-2 rounded-lg bg-indigo-50 px-2.5 py-1.5 text-xs font-semibold text-indigo-700 dark:bg-indigo-950/40 dark:text-indigo-200">
          <span className="min-w-0 flex-1 truncate">{modelName}</span>
          <span className="shrink-0 text-[10px] font-medium opacity-70">{providerLabel(provider)}</span>
          <CheckIcon aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />
        </div>}
        {loading && !sections.length && <p role="status" className={cn('px-2.5 py-2 text-xs', muted)}>Loading models…</p>}
        {failure && <RequestError message={failure} onRetry={onOpen} />}
        {!loading && !failure && !sections.length && <p role="status" className={cn('px-2.5 py-2 text-xs', muted)}>
          {search ? 'No models match.' : 'No model provider is configured.'}</p>}
        {sections.map((section) => <div key={section.id} role="group" aria-label={section.label}>
          <p className={cn('px-2.5 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wider', muted)}>{section.label}</p>
          {section.error && <RequestError message={section.error} onRetry={onOpen} />}
          {section.models.map((model) => {
            const current = model.id === value && model.provider === provider
            return <button type="button" key={modelOptionValue(model)} title={model.id} aria-pressed={current}
              onClick={() => { if (!current) onChange(model.id, section.id, '') }}
              className={cn('flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs transition-colors hover:bg-surface-100 dark:hover:bg-surface-800', focus,
                current && 'bg-indigo-50 font-semibold text-indigo-700 hover:bg-indigo-50 dark:bg-indigo-950/40 dark:text-indigo-200 dark:hover:bg-indigo-950/40')}>
              <span className="min-w-0 flex-1 truncate">{section.id === 'perplexity' ? model.id : readableModelName(model.id)}</span>
              {current && <CheckIcon aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />}
            </button>
          })}
        </div>)}
      </div>

      {capabilities.error && <RequestError message={`Reasoning levels unavailable. ${capabilities.error}`} onRetry={capabilities.refresh} />}
      {capabilities.efforts.length > 0 && <div role="radiogroup" aria-label={`Reasoning for ${modelName}`}
        className="flex shrink-0 flex-wrap items-center gap-1 border-t border-surface-200 px-2 py-2 dark:border-surface-700">
        <span className={cn('mr-auto px-1.5 text-[10px] font-semibold uppercase tracking-wider', muted)}>Reasoning</span>
        {['', ...capabilities.efforts].map((option) => <button type="button" key={option} role="radio" aria-checked={level === option}
          onClick={() => { onChange(value, provider, option); setOpen(false) }}
          className={cn('rounded-md px-2 py-1 text-[11px] font-medium transition-colors hover:bg-surface-100 dark:hover:bg-surface-800', focus,
            level === option && 'bg-indigo-600 text-white hover:bg-indigo-600 dark:hover:bg-indigo-600')}>
          {option ? capitalize(option) : 'Auto'}
        </button>)}
      </div>}
    </PopoverContent>
  </Popover>
}

function RequestError({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return <div className="m-1 rounded-lg bg-amber-50 px-2.5 py-2 text-[11px] text-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
    <p role="alert" className="break-words">{message}</p>
    {onRetry && <button type="button" onClick={onRetry} className={cn('mt-1 rounded font-semibold underline underline-offset-2', focus)}>Retry</button>}
  </div>
}
