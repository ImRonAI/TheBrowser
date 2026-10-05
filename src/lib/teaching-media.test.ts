import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  FRAME_MAX_EDGE, MIC_CHUNK_SAMPLES, MIC_MAX_CHUNK_BYTES, PIP_FRACTION, PIP_MARGIN, PIP_MAX_DIAMETER, bytesToBase64, captureSummary, classifyMediaError,
  drainPcmChunks, frameSize, packPcm16, pipRect,
} from './teaching-media.ts'

test('frameSize caps the longest edge at 1600 and never upscales', () => {
  assert.deepEqual(frameSize({ width: 3200, height: 1800 }), { width: FRAME_MAX_EDGE, height: 900 })
  assert.deepEqual(frameSize({ width: 1200, height: 800 }), { width: 1200, height: 800 })
  assert.deepEqual(frameSize({ width: 900, height: 2400 }), { width: 600, height: FRAME_MAX_EDGE })
  assert.deepEqual(frameSize({ width: 0, height: 0 }), { width: 0, height: 0 })
})

test('pipRect places a small circle bottom-right, capped at PIP_MAX_DIAMETER', () => {
  const frame = { width: 1600, height: 900 }
  const rect = pipRect(frame, { width: 1280, height: 720 })!
  assert.equal(rect.width, PIP_MAX_DIAMETER)
  assert.equal(rect.height, rect.width)
  assert.ok(PIP_MAX_DIAMETER <= Math.round(frame.width * PIP_FRACTION))
  assert.equal(rect.x + rect.width + PIP_MARGIN, frame.width)
  assert.equal(rect.y + rect.height + PIP_MARGIN, frame.height)
  assert.equal(pipRect(frame, null), null, 'no camera → screen-only frame')
  assert.equal(pipRect(frame, { width: 0, height: 0 }), null, 'camera not yet decoding → skip overlay')
  const narrow = pipRect({ width: 400, height: 800 }, { width: 1280, height: 720 })!
  assert.equal(narrow.width, Math.round(400 * PIP_FRACTION))
  assert.equal(narrow.height, narrow.width)
  const short = pipRect({ width: 1600, height: 80 }, { width: 720, height: 1280 })!
  assert.equal(short.width, 80 - 2 * PIP_MARGIN)
  assert.equal(short.height, short.width)
  assert.equal(short.y, PIP_MARGIN)
  assert.equal(pipRect({ width: 40, height: 40 }, { width: 100, height: 100 }), null)
})

test('classifyMediaError separates user denial from missing devices', () => {
  assert.equal(classifyMediaError({ name: 'NotAllowedError' }), 'denied')
  assert.equal(classifyMediaError({ name: 'SecurityError' }), 'denied')
  assert.equal(classifyMediaError({ name: 'NotFoundError' }), 'unavailable')
  assert.equal(classifyMediaError({ name: 'OverconstrainedError' }), 'unavailable')
  assert.equal(classifyMediaError(new Error('boom')), 'unavailable')
  assert.equal(classifyMediaError(undefined), 'unavailable')
})

test('captureSummary states exactly what is shared', () => {
  assert.equal(captureSummary({ screen: 'granted', mic: 'granted', camera: 'granted' }), 'Screen shared · microphone on · camera in frame')
  assert.equal(captureSummary({ screen: 'granted', mic: 'denied', camera: 'unavailable' }), 'Screen shared · microphone denied · no camera')
})

test('packPcm16 clamps and encodes little-endian; drainPcmChunks emits whole 100 ms chunks under the backend limit', () => {
  const bytes = packPcm16([1, -1, 0, 2, -2])
  assert.deepEqual(Array.from(bytes), [0xff, 0x7f, 0x01, 0x80, 0, 0, 0xff, 0x7f, 0x01, 0x80])
  const pending = Array.from({ length: MIC_CHUNK_SAMPLES * 2 + 7 }, () => 0.5)
  const { chunks, rest } = drainPcmChunks(pending)
  assert.equal(chunks.length, 2)
  assert.equal(chunks[0].length, MIC_CHUNK_SAMPLES * 2)
  assert.ok(chunks[0].length <= MIC_MAX_CHUNK_BYTES)
  assert.equal(chunks[0].length % 2, 0)
  assert.equal(rest.length, 7)
  const untouched = [0.1, 0.2]
  assert.equal(drainPcmChunks(untouched).rest, untouched, 'no copy when nothing drains')
  assert.equal(bytesToBase64(new Uint8Array([0, 255, 16]), (b) => Buffer.from(b, 'binary').toString('base64')), 'AP8Q')
})
