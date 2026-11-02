import { frameSize, FRAME_JPEG_QUALITY } from './teaching-media.ts'

export const VIDEO_FRAME_INTERVAL_MS = 1000
export const MAX_VIDEO_BUFFER = 4 * 1024 * 1024
export const MAX_VIDEO_CHUNK = 2 * 1024 * 1024

/** Bound the queued JSON payload, including its base64 overhead. */
export function recordingCanSend(buffered: number, chunkSize: number): boolean {
  return chunkSize > 0 && chunkSize <= MAX_VIDEO_CHUNK && buffered + chunkSize <= MAX_VIDEO_BUFFER
}

/** Gemini Live consumes individual images, not MediaRecorder container chunks. */
export function videoFrameMessage(video: HTMLVideoElement, canvas: HTMLCanvasElement): string | null {
  if (video.readyState < 2 || !video.videoWidth || !video.videoHeight) return null
  const context = canvas.getContext('2d')
  if (!context) throw new Error('Screen/camera capture could not create an image.')
  const size = frameSize({ width: video.videoWidth, height: video.videoHeight })
  canvas.width = size.width
  canvas.height = size.height
  context.drawImage(video, 0, 0, size.width, size.height)
  const dataUrl = canvas.toDataURL('image/jpeg', FRAME_JPEG_QUALITY)
  const prefix = 'data:image/jpeg;base64,'
  if (!dataUrl.startsWith(prefix) || dataUrl.length === prefix.length) throw new Error('Could not encode a JPEG frame.')
  return JSON.stringify({ realtime_input: { video: { format: 'jpeg', source: { bytes: dataUrl.slice(prefix.length) } } } })
}
