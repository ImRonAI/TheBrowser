/**
 * SourcesGrid
 * 
 * Layout component for displaying sources using AI Elements primitives.
 */

import { SourceCard, type SourceData } from './SourceCard'
import { Sources, SourcesContent, SourcesTrigger } from '@/components/ai-elements/sources'

interface SourcesGridProps {
  sources: SourceData[]
  onSendToRon?: (source: SourceData) => void
  onSendToCoding?: (source: SourceData) => void
  onAttachToTask?: (source: SourceData) => void
  onStartTask?: (source: SourceData) => void
  onPreview?: (source: SourceData) => void
  className?: string
}

export function SourcesGrid({
  sources,
  onSendToRon,
  onSendToCoding,
  onAttachToTask,
  onStartTask,
  onPreview,
  className = '',
}: SourcesGridProps) {
  if (sources.length === 0) return null

  return (
    <Sources className={className}>
      <SourcesTrigger count={sources.length} />
      <SourcesContent>
        <div className="grid grid-cols-1 gap-3">
          {sources.map((source, index) => (
            <SourceCard
              key={source.id}
              source={source}
              citationNumber={index + 1}
              onSendToRon={onSendToRon ? () => onSendToRon(source) : undefined}
              onSendToCoding={onSendToCoding ? () => onSendToCoding(source) : undefined}
              onAttachToTask={onAttachToTask ? () => onAttachToTask(source) : undefined}
              onStartTask={onStartTask ? () => onStartTask(source) : undefined}
              onPreview={onPreview ? () => onPreview(source) : undefined}
            />
          ))}
        </div>
      </SourcesContent>
    </Sources>
  )
}

export default SourcesGrid
