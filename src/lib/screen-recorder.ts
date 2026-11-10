/**
 * Screen recording for the Context widget: `getDisplayMedia` (Electron's `setDisplayMediaRequestHandler`
 * in electron/main.ts asks which screen or window to share) recorded with `MediaRecorder` as WebM.
 * Recording ends when the user presses Stop, stops sharing from the OS, or after `maxMs`.
 */

export interface ScreenRecording {
  startedAt: number
  /** Resolves with the WebM once recording ends, however it ends. */
  done: Promise<Blob>
  stop: () => Promise<Blob>
}

export const MAX_RECORDING_MS = 5 * 60_000
const TYPES = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm']

/** Call straight from a click handler: Electron only grants screen sharing to a user gesture. */
export async function startScreenRecording(maxMs = MAX_RECORDING_MS): Promise<ScreenRecording> {
  const stream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 15 }, audio: false })
  const mimeType = TYPES.find((type) => MediaRecorder.isTypeSupported(type))
  const recorder = new MediaRecorder(stream, mimeType ? { mimeType, videoBitsPerSecond: 2_500_000 } : undefined)
  const chunks: Blob[] = []
  recorder.ondataavailable = (event) => { if (event.data.size) chunks.push(event.data) }
  const done = new Promise<Blob>((resolve, reject) => {
    recorder.onstop = () => {
      stream.getTracks().forEach((track) => track.stop())
      resolve(new Blob(chunks, { type: 'video/webm' }))
    }
    recorder.onerror = () => {
      stream.getTracks().forEach((track) => track.stop())
      reject(new Error('Screen recording failed.'))
    }
  })
  const stop = () => {
    if (recorder.state !== 'inactive') recorder.stop()
    return done
  }
  stream.getVideoTracks()[0]?.addEventListener('ended', () => { void stop() })
  const timer = setTimeout(() => { void stop() }, maxMs)
  void done.finally(() => clearTimeout(timer)).catch(() => undefined)
  recorder.start(1000)
  return { startedAt: Date.now(), done, stop }
}
