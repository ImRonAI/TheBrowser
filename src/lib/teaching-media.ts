/**
 * Pure helpers for the Teaching Studio capture pipeline: the one-gesture
 * media acquisition plan, composite frame geometry (browser window + a
 * small circular camera at the bottom right, Loom style) and PCM packing. No DOM,
 * no React, no `@/` imports so `node --test` can run the colocated test.
 */

export const FRAME_MAX_EDGE = 1600
export const FRAME_JPEG_QUALITY = 0.75
/** Circle diameter as a fraction of the frame width, never larger than PIP_MAX_DIAMETER. */
export const PIP_FRACTION = 0.14
export const PIP_MAX_DIAMETER = 128
export const PIP_MARGIN = 16
export const MIC_SAMPLE_RATE = 16000
/** 100 ms of 16 kHz mono per `{type:'audio'}` frame. */
export const MIC_CHUNK_SAMPLES = 1600
/** Backend `validate_pcm` limit per chunk. */
export const MIC_MAX_CHUNK_BYTES = 64 * 1024

export interface Size { width: number; height: number }
export interface Rect extends Size { x: number; y: number }

/** Scale the screen to at most FRAME_MAX_EDGE on its longer edge, never upscaling. */
export function frameSize(screen: Size): Size {
  const longest = Math.max(screen.width, screen.height)
  if (!longest) return { width: 0, height: 0 }
  const ratio = Math.min(1, FRAME_MAX_EDGE / longest)
  return { width: Math.round(screen.width * ratio), height: Math.round(screen.height * ratio) }
}

/**
 * Bottom-right circular camera inside `frame`. The rect is a square (the
 * circle's box). Returns null when the camera size is unknown or the frame
 * cannot fit a circle above the margins, so the frame stays screen-only.
 */
export function pipRect(frame: Size, camera: Size | null): Rect | null {
  if (!camera || !camera.width || !camera.height || !frame.width || !frame.height) return null
  const limit = Math.min(frame.width, frame.height) - 2 * PIP_MARGIN
  if (limit < 24) return null
  const diameter = Math.min(PIP_MAX_DIAMETER, Math.round(frame.width * PIP_FRACTION), limit)
  return { x: frame.width - diameter - PIP_MARGIN, y: frame.height - diameter - PIP_MARGIN, width: diameter, height: diameter }
}

export type MediaOutcome = 'granted' | 'denied' | 'unavailable'

export interface CapturePlan {
  screen: 'granted'
  mic: MediaOutcome
  camera: MediaOutcome
}

const name = (cause: unknown): string => (cause && typeof cause === 'object' && typeof (cause as { name?: unknown }).name === 'string' ? (cause as { name: string }).name : '')

/** Permission denial is a user decision; everything else means no usable device. */
export function classifyMediaError(cause: unknown): Exclude<MediaOutcome, 'granted'> {
  const kind = name(cause)
  if (kind === 'NotAllowedError' || kind === 'SecurityError') return 'denied'
  return 'unavailable'
}

/** Human copy for the brief's capture status line. Screen is always granted when this renders. */
export function captureSummary(plan: CapturePlan): string {
  const mic = plan.mic === 'granted' ? 'microphone on' : plan.mic === 'denied' ? 'microphone denied' : 'no microphone'
  const camera = plan.camera === 'granted' ? 'camera in frame' : plan.camera === 'denied' ? 'camera denied' : 'no camera'
  return `Screen shared · ${mic} · ${camera}`
}

/** Clamp float samples to little-endian PCM16; chunked by MIC_CHUNK_SAMPLES by the caller. */
export function packPcm16(samples: ArrayLike<number>): Uint8Array {
  const bytes = new Uint8Array(samples.length * 2)
  const view = new DataView(bytes.buffer)
  for (let i = 0; i < samples.length; i++) view.setInt16(i * 2, Math.round(Math.max(-1, Math.min(1, samples[i])) * 32767), true)
  return bytes
}

export function bytesToBase64(bytes: Uint8Array, encode: (binary: string) => string = (binary) => btoa(binary)): string {
  let binary = ''
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return encode(binary)
}

/** Drain whole chunks from a pending sample queue; returns the frames to send and the remainder. */
export function drainPcmChunks(pending: number[]): { chunks: Uint8Array[]; rest: number[] } {
  const chunks: Uint8Array[] = []
  let offset = 0
  while (pending.length - offset >= MIC_CHUNK_SAMPLES) {
    chunks.push(packPcm16(pending.slice(offset, offset + MIC_CHUNK_SAMPLES)))
    offset += MIC_CHUNK_SAMPLES
  }
  return { chunks, rest: offset ? pending.slice(offset) : pending }
}
