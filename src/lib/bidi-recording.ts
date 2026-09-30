export const RECORDING_MIME_TYPES = ['video/webm;codecs=vp8', 'video/webm;codecs=vp9', 'video/webm'] as const
export const MAX_VIDEO_BUFFER = 4 * 1024 * 1024
export const MAX_VIDEO_CHUNK = 2 * 1024 * 1024

/** Dropping WebM chunks corrupts the stream. Stop instead of silently dropping. */
export function recordingCanSend(buffered: number, chunkSize: number): boolean {
  return chunkSize > 0 && chunkSize <= MAX_VIDEO_CHUNK && buffered + chunkSize <= MAX_VIDEO_BUFFER
}

export function recordingMimeType(supported: (type: string) => boolean): string {
  const type = RECORDING_MIME_TYPES.find(supported)
  if (!type) throw new Error('This browser cannot record VP8/VP9 WebM video.')
  return type
}