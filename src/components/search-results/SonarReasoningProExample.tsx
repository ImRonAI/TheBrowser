/**
 * Example Integration of Sonar Reasoning Pro Display
 *
 * Shows how to integrate the SonarReasoningProDisplay component
 * with the rest of the search results page.
 */

import React, { useState } from 'react'
import { motion } from 'framer-motion'
import { cn } from '@/utils/cn'
import { SonarReasoningProDisplay } from './SonarReasoningProDisplay'
import { useSonarReasoningPro } from '@/api/sonar-reasoning-pro'

// Example usage in a search page
export function SonarReasoningProExample() {
  const [query, setQuery] = useState('')
  const [searchQuery, setSearchQuery] = useState('')
  const [showResults, setShowResults] = useState(false)

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault()
    if (query.trim()) {
      setSearchQuery(query)
      setShowResults(true)
    }
  }

  return (
    <div className="min-h-screen bg-ron-white dark:bg-ron-black">
      {/* Header */}
      <header className="sticky top-0 z-50 glass-ultra backdrop-blur-2xl border-b border-surface-200 dark:border-surface-700">
        <div className="container mx-auto px-4 py-4">
          <form onSubmit={handleSearch} className="max-w-3xl mx-auto">
            <div className="relative group">
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Ask anything..."
                className={cn(
                  'w-full px-6 py-4 pr-12',
                  'bg-white dark:bg-ron-smoke',
                  'border-2 border-surface-200 dark:border-surface-700',
                  'rounded-2xl',
                  'text-ink dark:text-ink-inverse',
                  'placeholder:text-ink-muted dark:placeholder:text-ink-inverse-muted',
                  'focus:outline-none focus:ring-4 focus:ring-accent/20 dark:focus:ring-accent-light/20',
                  'focus:border-accent dark:focus:border-accent-light',
                  'transition-all duration-200',
                  'group-hover:border-accent/50 dark:group-hover:border-accent-light/50'
                )}
              />
              <button
                type="submit"
                className={cn(
                  'absolute right-2 top-1/2 -translate-y-1/2',
                  'p-2 rounded-lg',
                  'bg-accent dark:bg-accent-light',
                  'text-white',
                  'hover:bg-accent/90 dark:hover:bg-accent-light/90',
                  'transition-colors duration-200'
                )}
              >
                <SearchIcon className="w-5 h-5" />
              </button>
            </div>
          </form>
        </div>
      </header>

      {/* Main Content */}
      <main className="container mx-auto px-4 py-8">
        {showResults ? (
          <div className="max-w-4xl mx-auto">
            {/* Page Title */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="mb-8"
            >
              <h1 className="text-3xl font-bold text-ink dark:text-ink-inverse mb-2">
                Search Results
              </h1>
              <p className="text-ink-secondary dark:text-ink-inverse-secondary">
                Powered by Sonar Reasoning Pro
              </p>
            </motion.div>

            {/* Sonar Reasoning Pro Display */}
            <SonarReasoningProDisplay
              query={searchQuery}
              isStreaming={true}
              className="mb-8"
            />

            {/* Additional Search Results */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.5 }}
              className="space-y-4"
            >
              <h2 className="text-xl font-semibold text-ink dark:text-ink-inverse mb-4">
                Related Results
              </h2>

              {/* Placeholder for additional results */}
              <div className="grid gap-4">
                {[1, 2, 3].map((i) => (
                  <motion.div
                    key={i}
                    initial={{ opacity: 0, x: -20 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: 0.6 + i * 0.1 }}
                    className={cn(
                      'p-4 rounded-xl',
                      'bg-surface-50 dark:bg-surface-800',
                      'border border-surface-200 dark:border-surface-700',
                      'hover:border-accent/50 dark:hover:border-accent-light/50',
                      'transition-all duration-200'
                    )}
                  >
                    <div className="h-4 bg-surface-200 dark:bg-surface-700 rounded w-3/4 mb-2" />
                    <div className="h-3 bg-surface-100 dark:bg-surface-600 rounded w-full mb-2" />
                    <div className="h-3 bg-surface-100 dark:bg-surface-600 rounded w-5/6" />
                  </motion.div>
                ))}
              </div>
            </motion.div>
          </div>
        ) : (
          <div className="max-w-2xl mx-auto text-center py-20">
            <motion.div
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.3 }}
            >
              <BrainIcon className="w-20 h-20 mx-auto mb-6 text-accent dark:text-accent-light opacity-50" />
              <h2 className="text-2xl font-bold text-ink dark:text-ink-inverse mb-2">
                Ready to explore?
              </h2>
              <p className="text-ink-secondary dark:text-ink-inverse-secondary">
                Enter your question above to see Sonar Reasoning Pro in action
              </p>
            </motion.div>
          </div>
        )}
      </main>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Icons
// ─────────────────────────────────────────────────────────────────────────────

function SearchIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="11" cy="11" r="8" />
      <path d="m21 21-4.35-4.35" />
    </svg>
  )
}

function BrainIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9.5 2A2.5 2.5 0 0 1 12 4.5v15a2.5 2.5 0 0 1-4.96.44 2.5 2.5 0 0 1-2.96-3.08 3 3 0 0 1-.34-5.58 2.5 2.5 0 0 1 1.32-4.24 2.5 2.5 0 0 1 1.98-3A2.5 2.5 0 0 1 9.5 2Z" />
      <path d="M14.5 2A2.5 2.5 0 0 0 12 4.5v15a2.5 2.5 0 0 0 4.96.44 2.5 2.5 0 0 0 2.96-3.08 3 3 0 0 0 .34-5.58 2.5 2.5 0 0 0-1.32-4.24 2.5 2.5 0 0 0-1.98-3A2.5 2.5 0 0 0 14.5 2Z" />
    </svg>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Hook Example - Alternative Implementation
// ─────────────────────────────────────────────────────────────────────────────

export function SonarReasoningProHookExample() {
  const {
    stream,
    isStreaming,
    content,
    reasoning,
    citations,
    images,
    searchResults,
    error
  } = useSonarReasoningPro()

  const [query, setQuery] = useState('')

  const handleSearch = () => {
    if (query.trim()) {
      stream(query)
    }
  }

  return (
    <div className="p-8 max-w-4xl mx-auto">
      {/* Search Input */}
      <div className="flex gap-2 mb-8">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
          placeholder="Enter your search query..."
          className="flex-1 px-4 py-2 rounded-lg border border-surface-200 dark:border-surface-700"
        />
        <button
          onClick={handleSearch}
          disabled={isStreaming}
          className="px-6 py-2 bg-accent text-white rounded-lg hover:bg-accent/90 disabled:opacity-50"
        >
          {isStreaming ? 'Searching...' : 'Search'}
        </button>
      </div>

      {/* Error Display */}
      {error && (
        <div className="p-4 mb-4 rounded-lg bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400">
          {error}
        </div>
      )}

      {/* Reasoning Display */}
      {reasoning && (
        <div className="mb-6 p-4 rounded-lg bg-accent/5 dark:bg-accent-light/5">
          <h3 className="font-semibold mb-2 text-accent dark:text-accent-light">
            Reasoning Process
          </h3>
          <p className="text-sm text-ink-secondary dark:text-ink-inverse-secondary">
            {reasoning}
          </p>
        </div>
      )}

      {/* Search Results */}
      {searchResults.length > 0 && (
        <div className="mb-6">
          <h3 className="font-semibold mb-2">Search Results</h3>
          <div className="space-y-2">
            {searchResults.map((result) => (
              <div key={result.id} className="p-3 rounded-lg bg-surface-50 dark:bg-surface-800">
                <p className="text-sm font-medium">{result.query}</p>
                <p className="text-xs text-ink-secondary dark:text-ink-inverse-secondary">
                  {result.snippet}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Main Content */}
      {content && (
        <div className="mb-6 whitespace-pre-wrap text-sm text-ink dark:text-ink-inverse">
          {content}
        </div>
      )}

      {/* Images */}
      {images.length > 0 && (
        <div className="mb-6">
          <h3 className="font-semibold mb-2">Related Images</h3>
          <div className="grid grid-cols-3 gap-4">
            {images.map((image) => (
              <div key={image.id} className="rounded-lg overflow-hidden">
                <img
                  src={image.url}
                  alt={image.caption || 'Search result'}
                  className="w-full h-auto"
                />
                {image.caption && (
                  <p className="text-xs text-center mt-1 text-ink-secondary dark:text-ink-inverse-secondary">
                    {image.caption}
                  </p>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Citations */}
      {citations.length > 0 && (
        <div>
          <h3 className="font-semibold mb-2">Sources</h3>
          <div className="space-y-2">
            {citations.map((citation, index) => (
              <a
                key={citation.id}
                href={citation.url}
                target="_blank"
                rel="noopener noreferrer"
                className="block p-3 rounded-lg bg-surface-50 dark:bg-surface-800 hover:bg-surface-100 dark:hover:bg-surface-700 transition-colors"
              >
                <div className="flex items-start gap-2">
                  <span className="text-xs font-bold text-accent dark:text-accent-light">
                    [{index + 1}]
                  </span>
                  <div className="flex-1">
                    <p className="text-sm font-medium">{citation.title}</p>
                    {citation.snippet && (
                      <p className="text-xs text-ink-secondary dark:text-ink-inverse-secondary mt-1">
                        {citation.snippet}
                      </p>
                    )}
                    <p className="text-xs text-accent dark:text-accent-light mt-1">
                      {citation.domain}
                    </p>
                  </div>
                </div>
              </a>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

export default SonarReasoningProExample