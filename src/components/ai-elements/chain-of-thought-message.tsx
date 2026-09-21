'use client'

import { Fragment, memo, useMemo } from 'react'
import { getToolName, isDataUIPart, isToolUIPart, type UIMessage } from 'ai'
import { cn } from '@/utils/cn'
import {
  ChainOfThought,
  ChainOfThoughtContent,
  ChainOfThoughtHeader,
  ChainOfThoughtImage,
  ChainOfThoughtSearchResult,
  ChainOfThoughtSearchResults,
  ChainOfThoughtStep,
} from '@/components/ai-elements/chain-of-thought'
import { Reasoning, ReasoningContent, ReasoningTrigger } from '@/components/ai-elements/reasoning'
import { IDE, type IDEFile } from '@/components/ai-elements/ide'
import {
  detectPreviewUrl,
  fileFromToolCall,
  filesFromListDir,
  getToolView,
  toolOutputText,
} from '@/components/ai-elements/ide-tool-mapping'
import {
  Sandbox,
  SandboxContent,
  SandboxHeader,
} from '@/components/ai-elements/sandbox'
import { Tool, ToolContent, ToolHeader, ToolInput, ToolOutput } from '@/components/ai-elements/tool'
import { Terminal, TerminalContent } from '@/components/ai-elements/terminal'
import { ResponseWithCitations, type Citation } from '@/components/ai-elements/response-with-citations'
import { ThinkingIndicator } from '@/components/ai-elements/loader'
import { JSXPreview, JSXPreviewContent, JSXPreviewError } from '@/components/ai-elements/jsx-preview'

type MessagePart = UIMessage['parts'][number]

type ChainOfThoughtMessageProps = {
  parts: MessagePart[]
  citations?: Citation[]
  isStreaming?: boolean
  messageId?: string
  className?: string
}

type ToolState =
  | 'input-streaming'
  | 'input-available'
  | 'output-available'
  | 'output-error'
  | 'output-denied'
  | 'approval-requested'
  | 'approval-responded'

/**
 * Mirror of the `SearchResult` Pydantic model in agent/api/endpoints/chat.py.
 * The agent validates its output against that schema, so these fields are
 * guaranteed to be present and correctly typed on arrival.
 */
type SearchResult = {
  id: string
  title: string
  url: string
  snippet?: string
  favicon?: string
  thumbnail?: string
  date?: string
  author?: string
}

/**
 * Mirror of the `ViewedImage` Pydantic model in agent/api/endpoints/chat.py.
 * `caption` is the agent's own interpretation of the image, produced by xAI's
 * `enable_image_understanding`.
 */
type ViewedImage = {
  id: string
  url: string
  caption: string
  alt?: string
}

function toToolState(value: unknown): ToolState {
  if (typeof value === 'string') {
    if (
      value === 'input-streaming' ||
      value === 'input-available' ||
      value === 'output-available' ||
      value === 'output-error' ||
      value === 'output-denied' ||
      value === 'approval-requested' ||
      value === 'approval-responded'
    ) {
      return value
    }

    if (value === 'running') return 'input-available'
    if (value === 'pending') return 'input-streaming'
    if (value === 'success') return 'output-available'
    if (value === 'error') return 'output-error'
  }

  return 'input-streaming'
}

function safeJson(value: unknown) {
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

function asText(value: unknown) {
  return typeof value === 'string' ? value : ''
}

function getPartText(part: MessagePart) {
  if (part.type === 'text') {
    return asText((part as { text?: string }).text)
  }

  return ''
}

function getMergedReasoningText(reasoningParts: Array<MessagePart & { text?: string }>) {
  return reasoningParts.map((part) => asText(part.text)).filter(Boolean).join('')
}

function escapeForRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function sanitizeVisibleResponseText(textContent: string, reasoningText: string) {
  if (!textContent || !reasoningText) return textContent

  // Defensive guard for streams that accidentally replay reasoning as text prefix.
  if (textContent.startsWith(reasoningText)) {
    return textContent.slice(reasoningText.length).replace(/^\s+/, '')
  }

  // Tolerate whitespace differences between reasoning and visible text prefixes.
  const normalizedReasoning = reasoningText.trim()
  if (!normalizedReasoning) return textContent
  const reasoningPrefixPattern = new RegExp(
    `^\\s*${escapeForRegex(normalizedReasoning).replace(/\s+/g, '\\s+')}\\s*`
  )

  if (reasoningPrefixPattern.test(textContent)) {
    return textContent.replace(reasoningPrefixPattern, '')
  }

  return textContent
}

/**
 * Read the search results off a tool payload.
 *
 * The agent returns `AgentPanelResponse` (agent/api/endpoints/chat.py), whose
 * shape Pydantic validates server-side, so `results` is guaranteed to be an
 * array of `{id, title, url, ...}`. No key guessing, no shape normalisation.
 */
function getResults(value: unknown): SearchResult[] {
  if (!value || typeof value !== 'object') return []
  const { results } = value as { results?: SearchResult[] }
  return Array.isArray(results) ? results : []
}

/**
 * Collect the workspace state built up by this message's file and shell tools.
 *
 * File tools are aggregated into a single IDE rather than rendering one IDE per
 * call, so a turn that writes five files shows one workspace with five files.
 * Later writes to the same path win, matching edit order.
 */
function collectWorkspace(toolParts: Array<{ toolName?: unknown; type?: unknown; input?: unknown; output?: unknown }>) {
  const byPath = new Map<string, IDEFile>()
  let output = ''
  let previewUrl: string | undefined

  for (const part of toolParts) {
    const toolName =
      (typeof part.toolName === 'string' && part.toolName) ||
      (typeof part.type === 'string' ? part.type.replace(/^tool-/, '') : '')
    const view = getToolView(toolName)

    if (view === 'terminal') {
      const text = toolOutputText(part.output)
      const command = (part.input as { command?: string } | undefined)?.command
      if (command) output += `$ ${command}\n`
      if (text) output += text
      previewUrl = previewUrl ?? detectPreviewUrl(text)
      continue
    }

    if (view !== 'ide') continue

    if (toolName.endsWith('list_dir')) {
      for (const file of filesFromListDir(part.input, part.output)) {
        if (!byPath.has(file.path)) byPath.set(file.path, file)
      }
      continue
    }

    const file = fileFromToolCall(toolName, part.input, part.output)
    if (file) byPath.set(file.path, file)
  }

  return { files: Array.from(byPath.values()), output, previewUrl }
}

/**
 * Mirror of the `ThoughtStep` Pydantic model -- the props of a
 * <ChainOfThoughtStep> plus the results and images found during that step.
 */
type ThoughtStep = {
  label: string
  description?: string
  status?: 'complete' | 'active' | 'pending'
  results: SearchResult[]
  images: ViewedImage[]
}

/** Read the ordered steps off a terminal AgentPanelResponse data part. */
function getSteps(value: unknown): ThoughtStep[] {
  if (!value || typeof value !== 'object') return []
  const { steps } = value as { steps?: ThoughtStep[] }
  if (!Array.isArray(steps)) return []
  return steps.map((step) => ({
    ...step,
    results: Array.isArray(step.results) ? step.results : [],
    images: Array.isArray(step.images) ? step.images : [],
  }))
}

/** Read the viewed images off a tool payload. Same guarantee as getResults. */
function getImages(value: unknown): ViewedImage[] {
  if (!value || typeof value !== 'object') return []
  const { images } = value as { images?: ViewedImage[] }
  return Array.isArray(images) ? images : []
}

/**
 * Merge the agent's explicitly-viewed images with any thumbnails carried by
 * search results. Explicit images win on URL collision, since they carry the
 * agent's own caption rather than a borrowed result title.
 */
function mergeImages(images: ViewedImage[], results: SearchResult[]): ViewedImage[] {
  const byUrl = new Map<string, ViewedImage>()
  for (const image of images) byUrl.set(image.url, image)
  for (const result of results) {
    if (!result.thumbnail || byUrl.has(result.thumbnail)) continue
    byUrl.set(result.thumbnail, {
      id: result.id,
      url: result.thumbnail,
      caption: result.title,
      alt: result.title,
    })
  }
  return Array.from(byUrl.values())
}

/** Render viewed images through the native <ChainOfThoughtImage>. */
function ViewedImageGrid({ images }: { images: ViewedImage[] }) {
  if (images.length === 0) return null

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      {images.map((image) => (
        <ChainOfThoughtImage key={image.id} caption={image.caption}>
          <img
            src={image.url}
            alt={image.alt ?? image.caption}
            loading="lazy"
            className="max-h-full max-w-full object-contain"
          />
        </ChainOfThoughtImage>
      ))}
    </div>
  )
}

function openSource(url?: string) {
  if (!url || typeof window === 'undefined') return
  window.open(url, '_blank', 'noopener,noreferrer')
}

function getReasoningParts(parts: MessagePart[]) {
  return parts.filter((part) => part.type === 'reasoning') as Array<
    MessagePart & { text?: string }
  >
}

function getToolParts(parts: MessagePart[]) {
  return parts.filter((part) => isToolUIPart(part)) as Array<
    MessagePart & {
      type: string
      state?: string
      input?: unknown
      output?: unknown
      errorText?: string
      toolName?: string
    }
  >
}

function getDataParts(parts: MessagePart[]) {
  return parts.filter((part) => isDataUIPart(part)) as Array<
    MessagePart & { type: string; data?: unknown }
  >
}

export const ChainOfThoughtMessage = memo(function ChainOfThoughtMessage({
  parts,
  citations = [],
  isStreaming = false,
  messageId,
  className,
}: ChainOfThoughtMessageProps) {
  const reasoningParts = useMemo(() => getReasoningParts(parts), [parts])

  const textContent = useMemo(
    () => {
      const visibleText = parts.map((part) => getPartText(part)).filter(Boolean).join('')
      const mergedReasoning = getMergedReasoningText(reasoningParts)
      return sanitizeVisibleResponseText(visibleText, mergedReasoning)
    },
    [parts, reasoningParts],
  )

  const toolParts = useMemo(() => getToolParts(parts), [parts])
  const dataParts = useMemo(() => getDataParts(parts), [parts])

  // Shell and file tools render as one aggregated IDE/Terminal below the chain,
  // so they are excluded from the per-tool step list to avoid rendering twice.
  const workspace = useMemo(() => collectWorkspace(toolParts), [toolParts])
  const chainToolParts = useMemo(
    () =>
      toolParts.filter((part) => {
        const toolName =
          (typeof part.toolName === 'string' && part.toolName) ||
          (typeof part.type === 'string' ? part.type.replace(/^tool-/, '') : '')
        // Everything with a dedicated component renders below the chain instead.
        return getToolView(toolName) === 'default'
      }),
    [toolParts],
  )
  const hasWorkspace = workspace.files.length > 0 || workspace.output.length > 0

  const codeExecutionParts = useMemo(
    () =>
      toolParts.filter((part) => {
        const toolName =
          (typeof part.toolName === 'string' && part.toolName) ||
          (typeof part.type === 'string' ? part.type.replace(/^tool-/, '') : '')
        return getToolView(toolName) === 'sandbox'
      }),
    [toolParts],
  )

  const hasProcessParts =
    reasoningParts.length > 0 || chainToolParts.length > 0 || dataParts.length > 0

  return (
    <div className={cn('space-y-3', className)} data-message-id={messageId}>
      {hasProcessParts && (
        <ChainOfThought defaultOpen={isStreaming}>
          <ChainOfThoughtHeader>
            {isStreaming ? 'Working…' : 'Reasoning and tool calls'}
          </ChainOfThoughtHeader>
          <ChainOfThoughtContent>
            {reasoningParts.map((part, index) => {
              const reasoningText = asText(part.text)
              if (!reasoningText.trim()) return null

              return (
                <ChainOfThoughtStep
                  key={`reasoning-${index}`}
                  label={`Reasoning ${index + 1}`}
                  status={isStreaming ? 'active' : 'complete'}
                >
                  <Reasoning defaultOpen={isStreaming} isStreaming={isStreaming}>
                    <ReasoningTrigger />
                    <ReasoningContent>{reasoningText}</ReasoningContent>
                  </Reasoning>
                </ChainOfThoughtStep>
              )
            })}

            {chainToolParts.map((part, index) => {
              const state = toToolState(part.state)
              const toolType = typeof part.type === 'string' ? part.type : 'dynamic-tool'
              const toolName =
                (typeof part.toolName === 'string' && part.toolName) ||
                getToolName(part as any) ||
                `tool-${index + 1}`
              const toolResults = getResults(part.output ?? part.input)
              const toolImages = getImages(part.output ?? part.input)

              if (toolName === 'emit_jsx') {
                const jsx = (part.input as any)?.jsx || ''
                return (
                  <ChainOfThoughtStep
                    key={`tool-${index}-${toolName}`}
                    label="Interactive JSX Component"
                    status={state.startsWith('output-') ? 'complete' : 'active'}
                  >
                    <div className="my-1.5 p-3 rounded-xl border border-indigo-100/30 dark:border-indigo-900/30 bg-white/40 dark:bg-surface-900/40 backdrop-blur-md shadow-sm">
                      <JSXPreview jsx={jsx} isStreaming={state === 'input-streaming'}>
                        <JSXPreviewContent />
                        <JSXPreviewError />
                      </JSXPreview>
                    </div>
                  </ChainOfThoughtStep>
                )
              }

              return (
                <ChainOfThoughtStep
                  key={`tool-${index}-${toolName}`}
                  label={`Tool: ${toolName}`}
                  status={state.startsWith('output-') ? 'complete' : 'active'}
                >
                  <Tool>
                    {toolType === 'dynamic-tool' ? (
                      <ToolHeader type={toolType as 'dynamic-tool'} toolName={toolName} state={state} />
                    ) : (
                      <ToolHeader type={toolType as any} state={state} />
                    )}
                    <ToolContent>
                      {part.input !== undefined && <ToolInput input={part.input as any} />}
                      {(part.output !== undefined || part.errorText) && (
                        <ToolOutput
                          output={(part.output as any) ?? null}
                          errorText={part.errorText as any}
                        />
                      )}
                    </ToolContent>
                  </Tool>

                  {toolResults.length > 0 && (
                    <ChainOfThoughtSearchResults>
                      {toolResults.map((result) => (
                        <ChainOfThoughtSearchResult
                          key={result.id}
                          className="cursor-pointer"
                          onClick={() => openSource(result.url)}
                          title={result.url}
                        >
                          {result.title}
                        </ChainOfThoughtSearchResult>
                      ))}
                    </ChainOfThoughtSearchResults>
                  )}

                  <ViewedImageGrid images={mergeImages(toolImages, toolResults)} />
                </ChainOfThoughtStep>
              )
            })}

            {dataParts.map((part, index) => {
              if (
                part.type === 'data-panel-mode' ||
                part.type === 'data-agent-stop' ||
                part.type === 'data-agent-rollover' ||
                part.type === 'data-bidi-interruption' ||
                part.type === 'data-bidi-connection-restart' ||
                part.type === 'data-bidi-usage' ||
                part.type === 'data-bidi-audio' ||
                part.type === 'data-bidi-fallback' ||
                part.type === 'data-orchestration' ||
                part.type === 'data-usage'
              ) {
                return null
              }

              if (part.type === 'data-jsx' || part.type === 'data-gen-ui') {
                const dataObj = part.data as any
                const jsx = typeof dataObj === 'string' ? dataObj : dataObj?.jsx || ''
                if (jsx) {
                  return (
                    <ChainOfThoughtStep
                      key={`data-${index}-${part.type}`}
                      label="Interactive Component"
                      status={isStreaming ? 'active' : 'complete'}
                    >
                      <div className="my-1.5 p-3 rounded-xl border border-indigo-100/30 dark:border-indigo-900/30 bg-white/40 dark:bg-surface-900/40 backdrop-blur-md shadow-sm">
                        <JSXPreview jsx={jsx} isStreaming={isStreaming}>
                          <JSXPreviewContent />
                          <JSXPreviewError />
                        </JSXPreview>
                      </div>
                    </ChainOfThoughtStep>
                  )
                }
              }

              // Terminal AgentPanelResponse: render its steps through the native
              // components. Each ThoughtStep maps 1:1 onto ChainOfThoughtStep.
              if (part.type === 'data-agent-panel') {
                const steps = getSteps(part.data)
                if (steps.length === 0) return null

                return (
                  <Fragment key={`data-${index}-panel`}>
                    {steps.map((step, stepIndex) => (
                      <ChainOfThoughtStep
                        key={`panel-step-${stepIndex}`}
                        label={step.label}
                        description={step.description}
                        status={step.status ?? 'complete'}
                      >
                        {step.results.length > 0 && (
                          <ChainOfThoughtSearchResults>
                            {step.results.map((result) => (
                              <ChainOfThoughtSearchResult
                                key={result.id}
                                className="cursor-pointer"
                                onClick={() => openSource(result.url)}
                                title={result.url}
                              >
                                {result.title}
                              </ChainOfThoughtSearchResult>
                            ))}
                          </ChainOfThoughtSearchResults>
                        )}

                        <ViewedImageGrid images={mergeImages(step.images, step.results)} />
                      </ChainOfThoughtStep>
                    ))}
                  </Fragment>
                )
              }

              const dataResults = getResults(part.data)
              const dataImages = getImages(part.data)

              return (
                <ChainOfThoughtStep
                  key={`data-${index}-${part.type}`}
                  label={part.type.replace(/^data-/, '').replace(/-/g, ' ') || 'Data event'}
                  status={isStreaming ? 'active' : 'complete'}
                >
                  {dataResults.length > 0 && (
                    <ChainOfThoughtSearchResults>
                      {dataResults.map((result) => (
                        <ChainOfThoughtSearchResult
                          key={result.id}
                          className="cursor-pointer"
                          onClick={() => openSource(result.url)}
                          title={result.url}
                        >
                          {result.title}
                        </ChainOfThoughtSearchResult>
                      ))}
                    </ChainOfThoughtSearchResults>
                  )}

                  <ViewedImageGrid images={mergeImages(dataImages, dataResults)} />

                  <pre className="overflow-x-auto rounded-md border bg-muted/40 p-3 text-xs">
                    {safeJson(part.data)}
                  </pre>
                </ChainOfThoughtStep>
              )
            })}
          </ChainOfThoughtContent>
        </ChainOfThought>
      )}

      {/*
        Shell and file activity, aggregated into one IDE for the whole message.
        The IDE owns the Terminal pane and the sliding WebPreview, so a dev-server
        URL detected in shell output becomes a live preview of the running app.
      */}
      {hasWorkspace && (
        <IDE
          description={workspace.previewUrl ? `Serving ${workspace.previewUrl}` : undefined}
          files={workspace.files}
          isStreaming={isStreaming}
          output={workspace.output}
          previewUrl={workspace.previewUrl}
          title="Workspace"
        />
      )}

      {/* xAI server-side code_execution renders through Sandbox. */}
      {codeExecutionParts.map((part, index) => (
        <Sandbox key={`sandbox-${index}`}>
          <SandboxHeader state={toToolState(part.state)} title="Code execution" />
          <SandboxContent>
            <div className="border-t p-3">
              <Terminal output={toolOutputText(part.output)}>
                <TerminalContent />
              </Terminal>
            </div>
          </SandboxContent>
        </Sandbox>
      ))}

      {textContent.trim() ? (
        <ResponseWithCitations
          className="prose prose-sm max-w-none dark:prose-invert"
          citations={citations}
          content={textContent}
          isStreaming={isStreaming}
        />
      ) : (
        isStreaming && <ThinkingIndicator text="Thinking…" />
      )}

      {parts.map((part, index) => {
        if (part.type === 'data-jsx' || part.type === 'data-gen-ui') {
          const dataObj = (part as any).data
          const jsx = typeof dataObj === 'string' ? dataObj : dataObj?.jsx || ''
          if (jsx) {
            return (
              <JSXPreview key={`msg-jsx-${index}`} jsx={jsx} isStreaming={isStreaming}>
                <JSXPreviewContent />
                <JSXPreviewError />
              </JSXPreview>
            )
          }
        }

        if (isToolUIPart(part)) {
          const toolName = (part as any).toolName || getToolName(part as any)
          if (toolName === 'emit_jsx') {
            const jsx = (part as any).input?.jsx || ''
            if (jsx) {
              const state = toToolState((part as any).state)
              return (
                <JSXPreview key={`msg-jsx-${index}`} jsx={jsx} isStreaming={state === 'input-streaming'}>
                  <JSXPreviewContent />
                  <JSXPreviewError />
                </JSXPreview>
              )
            }
          }
        }

        return null
      })}
    </div>
  )
})
