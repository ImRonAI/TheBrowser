/**
 * File Utilities
 * 
 * Helper functions for file handling in prompt attachments.
 */

/**
 * Convert a File to a data URL string
 */
export function fileToDataUrl(file: File, signal?: AbortSignal): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    const abort = () => reader.abort()
    signal?.addEventListener('abort', abort, { once: true })
    reader.onload = () => {
      signal?.removeEventListener('abort', abort)
      if (typeof reader.result === 'string') resolve(reader.result)
      else reject(new TypeError('Expected FileReader result to be a data URL string'))
    }
    reader.onerror = () => reject(reader.error ?? new Error('Failed to read file'))
    reader.onabort = () => reject(new DOMException('File read aborted', 'AbortError'))
    reader.readAsDataURL(file)
  })
}

/**
 * Convert a data URL back to text content
 */
export function dataUrlToText(dataUrl: string): string | null {
  if (!dataUrl.startsWith('data:')) return null
  const commaIdx = dataUrl.indexOf(',')
  if (commaIdx === -1) return null

  const header = dataUrl.slice(5, commaIdx)
  const data = dataUrl.slice(commaIdx + 1)

  try {
    if (header.includes(';base64')) {
      const binary = atob(data)
      const bytes = new Uint8Array(binary.length)
      for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i)
      }
      return new TextDecoder('utf-8').decode(bytes)
    }

    // Non-base64 data URLs are typically percent-encoded payloads
    return decodeURIComponent(data)
  } catch {
    return null
  }
}

/**
 * Generate a timestamped filename for pasted text
 */
export function makePastedTextFilename(): string {
  const stamp = new Date()
    .toISOString()
    .split(':').join('')
    .split('-').join('')
    .split('.').join('')
  return `pasted-${stamp}.txt`
}

/**
 * Format file size for display
 */
export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}
