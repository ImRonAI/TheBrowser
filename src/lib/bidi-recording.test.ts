import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { MAX_VIDEO_BUFFER, MAX_VIDEO_CHUNK, recordingCanSend, recordingMimeType } from './bidi-recording.ts'

test('selects a supported continuous video codec, never an image MIME', () => {
  assert.equal(recordingMimeType(type => type.includes('vp9')), 'video/webm;codecs=vp9')
  assert.throws(() => recordingMimeType(() => false), /cannot record/)
})

test('bounded transport stops instead of dropping container chunks', () => {
  assert.equal(recordingCanSend(0, MAX_VIDEO_CHUNK), true)
  assert.equal(recordingCanSend(0, 0), false)
  assert.equal(recordingCanSend(0, MAX_VIDEO_CHUNK + 1), false)
  assert.equal(recordingCanSend(MAX_VIDEO_BUFFER, 1), false)
})