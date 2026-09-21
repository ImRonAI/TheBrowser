/**
 * UniversalResultCard Component - Premium Redesign
 * 
 * A polymorphic component that renders distinct layouts for different search result types
 * with premium dark theme styling, purple accent highlights, and selection system.
 * 
 * Supports 10 result types: video, audio, podcast, web, article, social, travel, academic, image, code
 */

import type {
  UniversalResult,
  VideoResult,
  AudioResult,
  PodcastResult,
  WebResult,
  ArticleResult,
  SocialMediaResult,
  TravelResult,
  AcademicResult,
  ImageResult,
  CodeResult,
  ResultType,
} from '@/pages/types/search'
import {
  isVideoResult,
  isAudioResult,
  isPodcastResult,
  isWebResult,
  isArticleResult,
  isSocialMediaResult,
  isTravelResult,
  isAcademicResult,
  isImageResult,
  isCodeResult,
} from '@/pages/types/search'
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from '@/components/ui/collapsible'
import { OpenToChatButton } from '@/components/search-results/OpenToChatButton'
import {
  Play,
  Download,
  ExternalLink,
  Bookmark,
  Share,
  ThumbsUp,
  MessageCircle,
  Copy,
  FileText,
  Image as ImageIcon,
  Star,
  GitFork,
  Calendar,
  Clock,
  Video,
  Radio,
  Plane,
  Code,
  ChevronDown,
  ChevronRight,
  Check,
  Globe,
} from 'lucide-react'
import { useState, memo } from 'react'
import { ResultTypeLabels } from '@/pages/types/search'
import { motion } from 'framer-motion'
import { cn } from '@/utils/cn'

/**
 * Props for the PremiumResultCard component
 */
export interface PremiumResultCardProps {
  result: UniversalResult
  searchQuery?: string
  className?: string
  isSelected?: boolean
  onClick?: () => void
  onSelect?: () => void
  onChatClick?: (result: UniversalResult) => void
}

/**
 * Premium Result Card - Luxurious dark theme with purple accents
 */
export const PremiumResultCard = memo(function PremiumResultCard({
  result,
  className = '',
  isSelected = false,
  onClick,
  onSelect,
  onChatClick,
}: PremiumResultCardProps) {
  const [isExpanded, setIsExpanded] = useState(false)
  const [, setIsHovered] = useState(false)

  // Get display title
  const displayTitle = isSocialMediaResult(result) 
    ? `${result.author || 'User'} - ${result.platform}` 
    : result.title

  // Get favicon or domain
  const domain = result.url ? getDomainFromUrl(result.url) : ''
  const { favicon } = result as { favicon?: string }

  return (
    <motion.div
      whileHover={{ y: -2 }}
      transition={{ duration: 0.2 }}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      className={cn(
        'group relative rounded-2xl overflow-hidden transition-all duration-300',
        'bg-surface-900/60 backdrop-blur-sm border',
        isSelected 
          ? 'border-accent-light/50 shadow-lg shadow-accent-indigo/10' 
          : 'border-surface-700/40 hover:border-surface-600/60',
        className
      )}
    >
      {/* Selection indicator glow */}
      {isSelected && (
        <div className="absolute inset-0 bg-gradient-to-br from-accent-indigo/5 to-accent-light/5 pointer-events-none" />
      )}
      
      {/* Selection checkbox */}
      <button
        onClick={(e) => {
          e.stopPropagation()
          onSelect?.()
        }}
        title={isSelected ? "Deselect result" : "Select result"}
        aria-label={isSelected ? "Deselect result" : "Select result"}
        className={cn(
          'absolute top-3 right-3 z-10 w-6 h-6 rounded-lg flex items-center justify-center transition-all duration-200',
          isSelected
            ? 'bg-gradient-to-br from-accent-indigo to-accent-light text-white'
            : 'bg-surface-800/80 border border-surface-600/50 text-transparent hover:border-accent-light/50',
          'opacity-0 group-hover:opacity-100',
          isSelected && 'opacity-100'
        )}
      >
        <Check className="w-3.5 h-3.5" />
      </button>

      <div onClick={onClick} className="cursor-pointer">
        {/* Card Header */}
        <div className="p-4 pb-2">
          <div className="flex items-start gap-3">
            {/* Favicon/Icon */}
            <div className="flex-shrink-0 w-8 h-8 rounded-lg bg-surface-800/80 border border-surface-700/50 flex items-center justify-center">
              {favicon ? (
                <img src={favicon} alt="" className="w-4 h-4 rounded" />
              ) : (
                <Globe className="w-4 h-4 text-ink-inverse-muted" />
              )}
            </div>
            
            <div className="flex-1 min-w-0 pr-8">
              <h3 className="text-sm font-light text-ink-inverse line-clamp-2 group-hover:text-accent-light transition-colors">
                {displayTitle}
              </h3>
              <p className="text-xs text-ink-inverse-muted mt-1 truncate">
                {domain}
              </p>
            </div>
          </div>
        </div>

        {/* Content */}
        <div className="px-4 pb-3">
          {/* Snippet */}
          {(result as any).snippet && (
            <p className={cn(
              'text-xs text-ink-inverse-secondary font-light leading-relaxed',
              isExpanded ? '' : 'line-clamp-3'
            )}>
              {(result as any).snippet}
            </p>
          )}

          {/* Type badge and metadata */}
          <div className="flex items-center gap-2 mt-3">
            <Badge 
              variant="secondary"
              className="bg-surface-800/80 border-surface-700/50 text-ink-inverse-muted text-[10px] px-2 py-0.5"
            >
              {ResultTypeLabels[result.type]}
            </Badge>
            
            {/* Result-specific metadata */}
            {isVideoResult(result) && result.duration && (
              <Badge variant="outline" className="border-surface-700/50 text-ink-inverse-muted text-[10px]">
                <Video className="w-3 h-3 mr-1" />
                {formatDuration(result.duration)}
              </Badge>
            )}
            {isArticleResult(result) && result.readTime && (
              <Badge variant="outline" className="border-surface-700/50 text-ink-inverse-muted text-[10px]">
                <Clock className="w-3 h-3 mr-1" />
                {result.readTime} min
              </Badge>
            )}
          </div>
        </div>

        {/* Expand/Collapse for more content */}
        {(result as any).snippet && (result as any).snippet.length > 150 && (
          <button
            onClick={(e) => {
              e.stopPropagation()
              setIsExpanded(!isExpanded)
            }}
            className="w-full px-4 py-2 text-xs text-accent-light hover:text-accent-muted transition-colors flex items-center justify-center gap-1 border-t border-surface-700/30"
          >
            {isExpanded ? (
              <>
                <ChevronDown className="w-3 h-3" />
                <span>See less</span>
              </>
            ) : (
              <>
                <ChevronRight className="w-3 h-3" />
                <span>See more</span>
              </>
            )}
          </button>
        )}
      </div>

      {/* Footer Actions */}
      <div className="px-4 py-3 border-t border-surface-700/30 flex items-center justify-between opacity-0 group-hover:opacity-100 transition-opacity duration-200">
        <div className="flex items-center gap-2">
          <motion.button
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            onClick={(e) => {
              e.stopPropagation()
              onChatClick?.(result)
            }}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-gradient-to-r from-accent-indigo to-accent-light text-white text-xs font-light"
          >
            <MessageCircle className="w-3 h-3" />
            <span>Chat</span>
          </motion.button>
          
          <motion.a
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            href={result.url}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-surface-800/80 border border-surface-700/50 text-ink-inverse-muted hover:text-ink-inverse text-xs font-light transition-colors"
          >
            <ExternalLink className="w-3 h-3" />
            <span>Open</span>
          </motion.a>
        </div>
      </div>
    </motion.div>
  )
})

function getDomainFromUrl(url: string): string {
  try {
    return new URL(url).hostname
  } catch {
    return url
  }
}

/**
 * Props for the UniversalResultCard component
 */
export interface UniversalResultCardProps {
  /** The search result to display */
  result: UniversalResult
  /** Optional original search query for context */
  searchQuery?: string
  /** Optional custom className for styling */
  className?: string
  /** Optional click handler for the card */
  onClick?: () => void
  /** Optional handler for "Open to Chat" button */
  onChatClick?: (result: UniversalResult) => void
}

/**
 * Polymorphic card component that renders appropriate layout based on result type
 * 
 * @example
 * ```tsx
 * <UniversalResultCard 
 *   result={searchResult} 
 *   searchQuery="query string"
 * />
 * ```
 */
export function UniversalResultCard({
  result,
  searchQuery,
  className = '',
  onClick,
  onChatClick,
}: UniversalResultCardProps) {
  const [isExpanded] = useState(false)

  // Render the appropriate result type sub-component
  const renderContent = () => {
    if (isVideoResult(result)) {
      return <VideoResultContent result={result} isExpanded={isExpanded} />
    }
    if (isAudioResult(result)) {
      return <AudioResultContent result={result} />
    }
    if (isPodcastResult(result)) {
      return <PodcastResultContent result={result} />
    }
    if (isWebResult(result)) {
      return <WebResultContent result={result} isExpanded={isExpanded} />
    }
    if (isArticleResult(result)) {
      return <ArticleResultContent result={result} isExpanded={isExpanded} />
    }
    if (isSocialMediaResult(result)) {
      return <SocialMediaResultContent result={result} />
    }
    if (isTravelResult(result)) {
      return <TravelResultContent result={result} />
    }
    if (isAcademicResult(result)) {
      return <AcademicResultContent result={result} />
    }
    if (isImageResult(result)) {
      return <ImageResultContent result={result} />
    }
    if (isCodeResult(result)) {
      return <CodeResultContent result={result} />
    }
    return null
  }

  const renderActions = () => {
    if (isVideoResult(result)) {
      return <VideoActions result={result} searchQuery={searchQuery} onChatClick={onChatClick} />
    }
    if (isAudioResult(result)) {
      return <AudioActions result={result} searchQuery={searchQuery} onChatClick={onChatClick} />
    }
    if (isPodcastResult(result)) {
      return <PodcastActions result={result} searchQuery={searchQuery} onChatClick={onChatClick} />
    }
    if (isWebResult(result)) {
      return <WebActions result={result} searchQuery={searchQuery} onChatClick={onChatClick} />
    }
    if (isArticleResult(result)) {
      return <ArticleActions result={result} searchQuery={searchQuery} onChatClick={onChatClick} />
    }
    if (isSocialMediaResult(result)) {
      return <SocialMediaActions result={result} searchQuery={searchQuery} onChatClick={onChatClick} />
    }
    if (isTravelResult(result)) {
      return <TravelActions result={result} searchQuery={searchQuery} onChatClick={onChatClick} />
    }
    if (isAcademicResult(result)) {
      return <AcademicActions result={result} searchQuery={searchQuery} onChatClick={onChatClick} />
    }
    if (isImageResult(result)) {
      return <ImageActions result={result} searchQuery={searchQuery} onChatClick={onChatClick} />
    }
    if (isCodeResult(result)) {
      return <CodeActions result={result} searchQuery={searchQuery} onChatClick={onChatClick} />
    }
    return <OpenToChatButton result={result} searchQuery={searchQuery} variant="full" onClick={(e) => { e.preventDefault(); onChatClick?.(result) }} />
  }

  // SocialMediaResult doesn't have title property, use content for display
  const displayTitle = isSocialMediaResult(result) 
    ? `${result.author || 'User'} - ${result.platform}` 
    : result.title

  return (
    <Card className={className} onClick={onClick}>
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1">
            <CardTitle className="line-clamp-2">{displayTitle}</CardTitle>
            <CardDescription>
              {result.url}
            </CardDescription>
          </div>
          <Badge variant={getBadgeVariant(result.type)}>
            {ResultTypeLabels[result.type]}
          </Badge>
        </div>
      </CardHeader>
      <CardContent>
        {renderContent()}
      </CardContent>
      <CardFooter className="flex items-center justify-between">
        {renderActions()}
      </CardFooter>
    </Card>
  )
}

// ============================================
// Result Type-Specific Content Components
// ============================================

/**
 * Video result content with thumbnail and embed preview
 */
function VideoResultContent({ result, isExpanded }: { result: VideoResult; isExpanded: boolean }) {
  return (
    <div className="space-y-3">
      <div className="relative">
        {result.thumbnail && (
          <img
            src={result.thumbnail}
            alt={result.title}
            className="w-full h-48 object-cover rounded-md"
          />
        )}
        <div className="absolute bottom-2 right-2">
          <Badge variant="secondary">
            <Video className="h-3 w-3 mr-1" />
            {formatDuration(result.duration)}
          </Badge>
        </div>
        {result.platform && (
          <div className="absolute top-2 left-2">
            <Badge variant="outline">{result.platform}</Badge>
          </div>
        )}
      </div>
      {result.uploader && (
        <div className="text-sm text-muted-foreground">
          {result.uploader}
        </div>
      )}
      {result.viewCount !== undefined && (
        <div className="text-sm text-muted-foreground">
          {formatNumber(result.viewCount)} views
        </div>
      )}
      {result.publishedAt && (
        <div className="text-sm text-muted-foreground">
          {formatDate(result.publishedAt)}
        </div>
      )}
      {result.embedUrl && (
        <Collapsible open={isExpanded}>
          <CollapsibleTrigger asChild>
            <Button variant="ghost" size="sm">
              {isExpanded ? (
                <>
                  <ChevronDown className="h-4 w-4 mr-1" /> Hide Preview
                </>
              ) : (
                <>
                  <ChevronRight className="h-4 w-4 mr-1" /> Show Preview
                </>
              )}
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent className="mt-3">
            <iframe
              src={result.embedUrl}
              title={result.title}
              className="w-full aspect-video rounded-md"
              allowFullScreen
            />
          </CollapsibleContent>
        </Collapsible>
      )}
    </div>
  )
}

/**
 * Audio result content with artwork and player
 */
function AudioResultContent({ result }: { result: AudioResult }) {
  return (
    <div className="space-y-3">
      <div className="flex gap-4">
        {result.artwork && (
          <img
            src={result.artwork}
            alt={result.title}
            className="w-24 h-24 object-cover rounded-md"
          />
        )}
        <div className="flex-1">
          <div className="font-semibold">{result.title}</div>
          {result.artist && (
            <div className="text-sm text-muted-foreground">{result.artist}</div>
          )}
          {result.album && (
            <div className="text-sm text-muted-foreground">{result.album}</div>
          )}
          <div className="flex gap-2 mt-2">
            <Badge variant="outline">
              <Clock className="h-3 w-3 mr-1" />
              {formatDuration(result.duration)}
            </Badge>
            {result.genre && (
              <Badge variant="secondary">{result.genre}</Badge>
            )}
          </div>
        </div>
      </div>
      {result.audioUrl && (
        <audio controls className="w-full">
          <source src={result.audioUrl} type="audio/mpeg" />
          Your browser does not support the audio element.
        </audio>
      )}
    </div>
  )
}

/**
 * Podcast result content with episode info and player
 */
function PodcastResultContent({ result }: { result: PodcastResult }) {
  return (
    <div className="space-y-3">
      <div className="flex gap-4">
        {result.artwork && (
          <img
            src={result.artwork}
            alt={result.title}
            className="w-24 h-24 object-cover rounded-md"
          />
        )}
        <div className="flex-1">
          <div className="font-semibold">{result.title}</div>
          {result.showTitle && (
            <div className="text-sm text-muted-foreground">{result.showTitle}</div>
          )}
          {result.host && (
            <div className="text-sm text-muted-foreground">Host: {result.host}</div>
          )}
          <div className="flex gap-2 mt-2">
            <Badge variant="outline">
              <Radio className="h-3 w-3 mr-1" />
              {formatDuration(result.duration)}
            </Badge>
            {result.episodeNumber && (
              <Badge variant="secondary">Ep. {result.episodeNumber}</Badge>
            )}
          </div>
        </div>
      </div>
      {result.publishedAt && (
        <div className="text-sm text-muted-foreground">
          <Calendar className="h-3 w-3 inline mr-1" />
          {formatDate(result.publishedAt)}
        </div>
      )}
      {result.audioUrl && (
        <audio controls className="w-full">
          <source src={result.audioUrl} type="audio/mpeg" />
          Your browser does not support the audio element.
        </audio>
      )}
      {result.transcriptUrl && (
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm">
            <FileText className="h-4 w-4 mr-1" />
            View Transcript
          </Button>
        </div>
      )}
    </div>
  )
}

/**
 * Web result content with snippet and embed preview
 */
function WebResultContent({ result, isExpanded }: { result: WebResult; isExpanded: boolean }) {
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        {result.favicon && (
          <img src={result.favicon} alt="" className="w-4 h-4" />
        )}
        {result.domain && (
          <Badge variant="secondary">{result.domain}</Badge>
        )}
      </div>
      <p className="text-sm text-muted-foreground line-clamp-3">
        {result.snippet}
      </p>
      {result.author && (
        <div className="text-sm text-muted-foreground">By: {result.author}</div>
      )}
      {result.publishDate && (
        <div className="text-sm text-muted-foreground">
          <Calendar className="h-3 w-3 inline mr-1" />
          {formatDate(result.publishDate)}
        </div>
      )}
      {result.iframeCompatible && (
        <Collapsible open={isExpanded}>
          <CollapsibleTrigger asChild>
            <Button variant="ghost" size="sm">
              {isExpanded ? (
                <>
                  <ChevronDown className="h-4 w-4 mr-1" /> Hide Preview
                </>
              ) : (
                <>
                  <ChevronRight className="h-4 w-4 mr-1" /> Show Preview
                </>
              )}
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent className="mt-3">
            <iframe
              src={result.url}
              title={result.title}
              className="w-full h-96 rounded-md"
            />
          </CollapsibleContent>
        </Collapsible>
      )}
    </div>
  )
}

/**
 * Article result content with publication info and preview
 */
function ArticleResultContent({ result, isExpanded }: { result: ArticleResult; isExpanded: boolean }) {
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        {result.favicon && (
          <img src={result.favicon} alt="" className="w-4 h-4" />
        )}
        {result.publication && (
          <Badge variant="secondary">{result.publication}</Badge>
        )}
      </div>
      <p className="text-sm text-muted-foreground line-clamp-3">
        {result.snippet}
      </p>
      {result.author && (
        <div className="text-sm text-muted-foreground">By: {result.author}</div>
      )}
      <div className="flex gap-2">
        {result.publishDate && (
          <div className="text-sm text-muted-foreground">
            <Calendar className="h-3 w-3 inline mr-1" />
            {formatDate(result.publishDate)}
          </div>
        )}
        {result.readingTime && (
          <Badge variant="outline">
            <Clock className="h-3 w-3 mr-1" />
            {result.readingTime} min read
          </Badge>
        )}
      </div>
      {result.thumbnail && (
        <img
          src={result.thumbnail}
          alt={result.title}
          className="w-full h-48 object-cover rounded-md"
        />
      )}
      {result.iframeCompatible && (
        <Collapsible open={isExpanded}>
          <CollapsibleTrigger asChild>
            <Button variant="ghost" size="sm">
              {isExpanded ? (
                <>
                  <ChevronDown className="h-4 w-4 mr-1" /> Hide Preview
                </>
              ) : (
                <>
                  <ChevronRight className="h-4 w-4 mr-1" /> Show Preview
                </>
              )}
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent className="mt-3">
            <iframe
              src={result.url}
              title={result.title}
              className="w-full h-96 rounded-md"
            />
          </CollapsibleContent>
        </Collapsible>
      )}
    </div>
  )
}

/**
 * Social media result content with engagement metrics
 */
function SocialMediaResultContent({ result }: { result: SocialMediaResult }) {
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        {result.avatar && (
          <img
            src={result.avatar}
            alt={result.author || 'User'}
            className="w-10 h-10 rounded-full"
          />
        )}
        <div>
          <div className="font-semibold">{result.author}</div>
          {result.handle && (
            <div className="text-sm text-muted-foreground">@{result.handle}</div>
          )}
        </div>
        <Badge variant="outline">{result.platform}</Badge>
      </div>
      <p className="text-sm">
        {result.content}
      </p>
      {result.mediaUrl && (
        <div>
          {result.mediaType === 'image' && (
            <img
              src={result.mediaUrl}
              alt="Post media"
              className="w-full rounded-md"
            />
          )}
          {result.mediaType === 'video' && (
            <video controls className="w-full rounded-md">
              <source src={result.mediaUrl} type="video/mp4" />
            </video>
          )}
        </div>
      )}
      <div className="flex gap-4 text-sm text-muted-foreground">
        {result.likes !== undefined && (
          <span>
            <ThumbsUp className="h-4 w-4 inline mr-1" />
            {formatNumber(result.likes)}
          </span>
        )}
        {result.comments !== undefined && (
          <span>
            <MessageCircle className="h-4 w-4 inline mr-1" />
            {formatNumber(result.comments)}
          </span>
        )}
        {result.shares !== undefined && (
          <span>
            <Share className="h-4 w-4 inline mr-1" />
            {formatNumber(result.shares)}
          </span>
        )}
      </div>
      {result.publishedAt && (
        <div className="text-sm text-muted-foreground">
          <Calendar className="h-3 w-3 inline mr-1" />
          {formatDate(result.publishedAt)}
        </div>
      )}
    </div>
  )
}

/**
 * Travel result content with booking details
 */
function TravelResultContent({ result }: { result: TravelResult }) {
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Badge variant="default">
          <Plane className="h-3 w-3 mr-1" />
          {result.destination}
        </Badge>
        {result.rating && (
          <Badge variant="outline">
            <Star className="h-3 w-3 mr-1" />
            {result.rating}
          </Badge>
        )}
      </div>
      <div className="flex gap-2 items-baseline">
        <div className="text-2xl font-bold">
          {result.currency || '$'}{result.price}
        </div>
        {result.originalPrice && (
          <div className="text-sm text-muted-foreground line-through">
            {result.currency || '$'}{result.originalPrice}
          </div>
        )}
      </div>
      <div className="text-sm text-muted-foreground">
        <Calendar className="h-3 w-3 inline mr-1" />
        {formatDate(result.dates.departure)}
        {result.dates.return && ` - ${formatDate(result.dates.return)}`}
      </div>
      {result.airline && (
        <div className="text-sm">
          <Plane className="h-3 w-3 inline mr-1" />
          {result.airline}
        </div>
      )}
      {result.propertyType && (
        <Badge variant="secondary">{result.propertyType}</Badge>
      )}
      {result.images && result.images.length > 0 && (
        <div className="grid grid-cols-2 gap-2">
          {result.images.slice(0, 4).map((image, index) => (
            <img
              key={index}
              src={image}
              alt={`${result.title} ${index + 1}`}
              className="w-full h-24 object-cover rounded-md"
            />
          ))}
        </div>
      )}
      {result.bedrooms && (
        <div className="text-sm text-muted-foreground">
          {result.bedrooms} bedrooms
        </div>
      )}
      {result.reviews && (
        <div className="text-sm text-muted-foreground">
          {result.reviews} reviews
        </div>
      )}
    </div>
  )
}

/**
 * Academic result content with citation info
 */
function AcademicResultContent({ result }: { result: AcademicResult }) {
  return (
    <div className="space-y-3">
      <div className="text-sm">
        {result.authors.join(', ')}
      </div>
      <p className="text-sm text-muted-foreground line-clamp-3">
        {result.abstract || result.snippet}
      </p>
      <div className="flex flex-wrap gap-2">
        {result.journal && (
          <Badge variant="secondary">{result.journal}</Badge>
        )}
        {result.doi && (
          <Badge variant="outline">DOI: {result.doi}</Badge>
        )}
        {result.year && (
          <Badge variant="outline">{result.year}</Badge>
        )}
      </div>
      <div className="flex gap-4 text-sm text-muted-foreground">
        {result.citationCount !== undefined && (
          <span>
            <Star className="h-4 w-4 inline mr-1" />
            {result.citationCount} citations
          </span>
        )}
        {result.publishDate && (
          <span>
            <Calendar className="h-4 w-4 inline mr-1" />
            {formatDate(result.publishDate)}
          </span>
        )}
      </div>
      {result.hasOpenAccess && (
        <Badge variant="default">Open Access</Badge>
      )}
    </div>
  )
}

/**
 * Image result content with preview and metadata
 */
function ImageResultContent({ result }: { result: ImageResult }) {
  return (
    <div className="space-y-3">
      <img
        src={result.thumbnail || result.url}
        alt={result.title || 'Image'}
        className="w-full h-64 object-contain bg-muted rounded-md"
      />
      <div className="flex gap-2">
        <Badge variant="outline">
          <ImageIcon className="h-3 w-3 mr-1" />
          {result.width} × {result.height}
        </Badge>
        {result.format && (
          <Badge variant="secondary">{result.format}</Badge>
        )}
      </div>
      {result.title && (
        <div className="font-semibold">{result.title}</div>
      )}
      {result.author && (
        <div className="text-sm text-muted-foreground">By: {result.author}</div>
      )}
      {result.source && (
        <div className="text-sm text-muted-foreground">Source: {result.source}</div>
      )}
      {result.tags && result.tags.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {result.tags.map((tag, index) => (
            <Badge key={index} variant="secondary" className="text-xs">
              {tag}
            </Badge>
          ))}
        </div>
      )}
    </div>
  )
}

/**
 * Code result content with repository info and preview
 */
function CodeResultContent({ result }: { result: CodeResult }) {
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Badge variant="default">
          <Code className="h-3 w-3 mr-1" />
          {result.language}
        </Badge>
      </div>
      <div className="text-sm text-muted-foreground line-clamp-3">
        {result.snippet}
      </div>
      <div className="flex gap-4 text-sm text-muted-foreground">
        {result.stars !== undefined && (
          <span>
            <Star className="h-4 w-4 inline mr-1" />
            {formatNumber(result.stars)}
          </span>
        )}
        {result.forks !== undefined && (
          <span>
            <GitFork className="h-4 w-4 inline mr-1" />
            {formatNumber(result.forks)}
          </span>
        )}
      </div>
      {result.author && (
        <div className="text-sm text-muted-foreground">By: {result.author}</div>
      )}
      {result.repository && (
        <div className="text-sm text-muted-foreground">{result.repository}</div>
      )}
      {result.lastUpdated && (
        <div className="text-sm text-muted-foreground">
          <Calendar className="h-3 w-3 inline mr-1" />
          Last updated: {formatDate(result.lastUpdated)}
        </div>
      )}
      {result.codePreview && (
        <pre className="text-xs bg-muted p-3 rounded-md overflow-auto max-h-32">
          <code>{result.codePreview}</code>
        </pre>
      )}
    </div>
  )
}

// ============================================
// Action Button Components
// ============================================

function VideoActions({ result, searchQuery, onChatClick }: { result: VideoResult; searchQuery?: string; onChatClick?: (result: UniversalResult) => void }) {
  return (
    <div className="flex items-center gap-2">
      <Button variant="outline" size="sm">
        <Play className="h-4 w-4 mr-1" />
        Play
      </Button>
      {result.transcriptUrl && (
        <Button variant="outline" size="sm">
          <FileText className="h-4 w-4 mr-1" />
          Transcript
        </Button>
      )}
      <OpenToChatButton result={result} searchQuery={searchQuery} variant="icon" onClick={(e) => { e.preventDefault(); onChatClick?.(result) }} />
    </div>
  )
}

function AudioActions({ result, searchQuery, onChatClick }: { result: AudioResult; searchQuery?: string; onChatClick?: (result: UniversalResult) => void }) {
  return (
    <div className="flex items-center gap-2">
      <Button variant="outline" size="sm">
        <Play className="h-4 w-4 mr-1" />
        Play
      </Button>
      <Button variant="outline" size="sm">
        <Bookmark className="h-4 w-4 mr-1" />
        Subscribe
      </Button>
      <OpenToChatButton result={result} searchQuery={searchQuery} variant="icon" onClick={(e) => { e.preventDefault(); onChatClick?.(result) }} />
    </div>
  )
}

function PodcastActions({ result, searchQuery, onChatClick }: { result: PodcastResult; searchQuery?: string; onChatClick?: (result: UniversalResult) => void }) {
  return (
    <div className="flex items-center gap-2">
      <Button variant="outline" size="sm">
        <Play className="h-4 w-4 mr-1" />
        Play
      </Button>
      <Button variant="outline" size="sm">
        <Bookmark className="h-4 w-4 mr-1" />
        Subscribe
      </Button>
      {result.transcriptUrl && (
        <Button variant="outline" size="sm">
          <FileText className="h-4 w-4 mr-1" />
          Transcript
        </Button>
      )}
      <OpenToChatButton result={result} searchQuery={searchQuery} variant="icon" onClick={(e) => { e.preventDefault(); onChatClick?.(result) }} />
    </div>
  )
}

function WebActions({ result, searchQuery, onChatClick }: { result: WebResult; searchQuery?: string; onChatClick?: (result: UniversalResult) => void }) {
  return (
    <div className="flex items-center gap-2">
      <Button variant="outline" size="sm" asChild>
        <a href={result.url} target="_blank" rel="noopener noreferrer">
          <ExternalLink className="h-4 w-4 mr-1" />
          Open
        </a>
      </Button>
      <OpenToChatButton result={result} searchQuery={searchQuery} variant="icon" onClick={(e) => { e.preventDefault(); onChatClick?.(result) }} />
    </div>
  )
}

function ArticleActions({ result, searchQuery, onChatClick }: { result: ArticleResult; searchQuery?: string; onChatClick?: (result: UniversalResult) => void }) {
  return (
    <div className="flex items-center gap-2">
      <Button variant="outline" size="sm" asChild>
        <a href={result.url} target="_blank" rel="noopener noreferrer">
          <ExternalLink className="h-4 w-4 mr-1" />
          Open
        </a>
      </Button>
      <OpenToChatButton result={result} searchQuery={searchQuery} variant="icon" onClick={(e) => { e.preventDefault(); onChatClick?.(result) }} />
    </div>
  )
}

function SocialMediaActions({ result, searchQuery, onChatClick }: { result: SocialMediaResult; searchQuery?: string; onChatClick?: (result: UniversalResult) => void }) {
  return (
    <div className="flex items-center gap-2">
      <Button variant="outline" size="sm">
        <ThumbsUp className="h-4 w-4 mr-1" />
        React
      </Button>
      <Button variant="outline" size="sm">
        <MessageCircle className="h-4 w-4 mr-1" />
        Comment
      </Button>
      <Button variant="outline" size="sm">
        <Share className="h-4 w-4 mr-1" />
        Share
      </Button>
      <OpenToChatButton result={result} searchQuery={searchQuery} variant="icon" onClick={(e) => { e.preventDefault(); onChatClick?.(result) }} />
    </div>
  )
}

function TravelActions({ result, searchQuery, onChatClick }: { result: TravelResult; searchQuery?: string; onChatClick?: (result: UniversalResult) => void }) {
  return (
    <div className="flex items-center gap-2">
      <Button variant="default" size="sm" asChild>
        <a href={result.bookingUrl} target="_blank" rel="noopener noreferrer">
          <Calendar className="h-4 w-4 mr-1" />
          Book
        </a>
      </Button>
      <Button variant="outline" size="sm">
        <Bookmark className="h-4 w-4 mr-1" />
        Save
      </Button>
      <OpenToChatButton result={result} searchQuery={searchQuery} variant="icon" onClick={(e) => { e.preventDefault(); onChatClick?.(result) }} />
    </div>
  )
}

function AcademicActions({ result, searchQuery, onChatClick }: { result: AcademicResult; searchQuery?: string; onChatClick?: (result: UniversalResult) => void }) {
  return (
    <div className="flex items-center gap-2">
      {result.pdfUrl && (
        <Button variant="outline" size="sm" asChild>
          <a href={result.pdfUrl} target="_blank" rel="noopener noreferrer">
            <Download className="h-4 w-4 mr-1" />
            PDF
          </a>
        </Button>
      )}
      <Button variant="outline" size="sm">
        <Copy className="h-4 w-4 mr-1" />
        Cite
      </Button>
      <OpenToChatButton result={result} searchQuery={searchQuery} variant="icon" onClick={(e) => { e.preventDefault(); onChatClick?.(result) }} />
    </div>
  )
}

function ImageActions({ result, searchQuery, onChatClick }: { result: ImageResult; searchQuery?: string; onChatClick?: (result: UniversalResult) => void }) {
  return (
    <div className="flex items-center gap-2">
      <Button variant="outline" size="sm" asChild>
        <a href={result.url} target="_blank" rel="noopener noreferrer" download>
          <Download className="h-4 w-4 mr-1" />
          Download
        </a>
      </Button>
      <Button variant="outline" size="sm">
        <ImageIcon className="h-4 w-4 mr-1" />
        Similar
      </Button>
      <OpenToChatButton result={result} searchQuery={searchQuery} variant="icon" onClick={(e) => { e.preventDefault(); onChatClick?.(result) }} />
    </div>
  )
}

function CodeActions({ result, searchQuery, onChatClick }: { result: CodeResult; searchQuery?: string; onChatClick?: (result: UniversalResult) => void }) {
  return (
    <div className="flex items-center gap-2">
      {result.repositoryUrl && (
        <Button variant="outline" size="sm" asChild>
          <a href={result.repositoryUrl} target="_blank" rel="noopener noreferrer">
            <Code className="h-4 w-4 mr-1" />
            View Repo
          </a>
        </Button>
      )}
      <Button variant="outline" size="sm">
        <Copy className="h-4 w-4 mr-1" />
        Copy Code
      </Button>
      <OpenToChatButton result={result} searchQuery={searchQuery} variant="icon" onClick={(e) => { e.preventDefault(); onChatClick?.(result) }} />
    </div>
  )
}

// ============================================
// Helper Functions
// ============================================

/**
 * Returns appropriate badge variant for a result type
 */
function getBadgeVariant(resultType: ResultType): 'default' | 'secondary' | 'outline' {
  switch (resultType) {
    case 'video':
      return 'secondary'
    case 'audio':
      return 'secondary'
    case 'podcast':
      return 'secondary'
    case 'web':
      return 'outline'
    case 'article':
      return 'outline'
    case 'social':
      return 'default'
    case 'travel':
      return 'default'
    case 'academic':
      return 'secondary'
    case 'image':
      return 'outline'
    case 'code':
      return 'secondary'
    default:
      return 'outline'
  }
}

/**
 * Formats duration in seconds to MM:SS format
 */
function formatDuration(seconds: number): string {
  const minutes = Math.floor(seconds / 60)
  const remainingSeconds = Math.floor(seconds % 60)
  return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`
}

/**
 * Formats a date string for display
 */
function formatDate(dateString: string): string {
  const date = new Date(dateString)
  const now = new Date()
  const diffInMs = now.getTime() - date.getTime()
  const diffInDays = Math.floor(diffInMs / (1000 * 60 * 60 * 24))
  
  if (diffInDays === 0) {
    return 'Today'
  }
  if (diffInDays === 1) {
    return 'Yesterday'
  }
  if (diffInDays < 7) {
    return `${diffInDays} days ago`
  }
  if (diffInDays < 30) {
    const weeks = Math.floor(diffInDays / 7)
    return `${weeks} week${weeks > 1 ? 's' : ''} ago`
  }
  if (diffInDays < 365) {
    const months = Math.floor(diffInDays / 30)
    return `${months} month${months > 1 ? 's' : ''} ago`
  }
  
  const years = Math.floor(diffInDays / 365)
  return `${years} year${years > 1 ? 's' : ''} ago`
}

/**
 * Formats a number with K/M/B suffixes
 */
function formatNumber(num: number): string {
  if (num >= 1000000000) {
    return `${(num / 1000000000).toFixed(1)}B`
  }
  if (num >= 1000000) {
    return `${(num / 1000000).toFixed(1)}M`
  }
  if (num >= 1000) {
    return `${(num / 1000).toFixed(1)}K`
  }
  return num.toString()
}
