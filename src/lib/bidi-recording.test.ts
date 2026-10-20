import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { MAX_VIDEO_BUFFER, MAX_VIDEO_CHUNK, VIDEO_FRAME_INTERVAL_MS, recordingCanSend, videoFrameMessage } from './bidi-recording.ts'

test('camera and screen images use native realtime JSON, with bounded frame size and 1 fps', () => {
  const video = { readyState: 2, videoWidth: 3840, videoHeight: 2160 } as HTMLVideoElement
  const canvas = {
    width: 0, height: 0,
    getContext: () => ({ drawImage: (...args: unknown[]) => assert.deepEqual(args, [video, 0, 0, 1600, 900]) }),
    toDataURL: (mime: string, quality: number) => {
      assert.equal(mime, 'image/jpeg')
      assert.equal(quality, 0.75)
      return 'data:image/jpeg;base64,/9j/2Q=='
    },
  } as unknown as HTMLCanvasElement
  const message = videoFrameMessage(video, canvas)
  assert.equal(typeof message, 'string', 'WebSocket must send text, never a binary Blob')
  assert.deepEqual(JSON.parse(message!), { realtime_input: { video: { format: 'jpeg', source: { bytes: '/9j/2Q==' } } } })
  assert.equal(canvas.width, 1600)
  assert.equal(canvas.height, 900)
  assert.equal(VIDEO_FRAME_INTERVAL_MS, 1000)
})

test('unready video is skipped and failed JPEG encoding is reported', () => {
  const video = { readyState: 1, videoWidth: 0, videoHeight: 0 } as HTMLVideoElement
  const canvas = { getContext: () => null } as unknown as HTMLCanvasElement
  assert.equal(videoFrameMessage(video, canvas), null)
  Object.assign(video, { readyState: 2, videoWidth: 1280, videoHeight: 720 })
  assert.throws(() => videoFrameMessage(video, canvas), /could not create an image/)
  Object.assign(canvas, { getContext: () => ({ drawImage() {} }), toDataURL: () => 'data:,' })
  assert.throws(() => videoFrameMessage(video, canvas), /Could not encode a JPEG/)
})

test('bounded transport rejects empty, oversized, and backlogged JSON frames', () => {
  assert.equal(recordingCanSend(0, MAX_VIDEO_CHUNK), true)
  assert.equal(recordingCanSend(0, 0), false)
  assert.equal(recordingCanSend(0, MAX_VIDEO_CHUNK + 1), false)
  assert.equal(recordingCanSend(MAX_VIDEO_BUFFER, 1), false)
})
