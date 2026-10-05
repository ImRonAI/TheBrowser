import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import {
  browserToolFrame, collectSnapshotElements, cursorTargets, elementCenter, type SnapshotElement,
} from './agent-cursor.ts'

const button: SnapshotElement = { ref: 'e1', x: 10, y: 20, width: 40, height: 16 }
const field: SnapshotElement = { ref: 'e2', x: 8, y: 40, width: 100, height: 24 }

test('mouse move and drag coordinates are used as given', () => {
  assert.deepEqual(cursorTargets({ x: 12, y: 30 }, {}), [{ x: 12, y: 30 }])
  assert.deepEqual(cursorTargets({ x: 4, y: 5, targetCoordinates: { x: 80, y: 90 } }, {}), [
    { x: 4, y: 5 }, { x: 80, y: 90 },
  ])
  assert.deepEqual(cursorTargets({ sourceRef: 'e1', targetCoordinates: { x: 3, y: 4 } }, { e1: button }), [
    { x: 3, y: 4 },
  ])
})

test('a ref click uses the snapshot element center', () => {
  assert.deepEqual(elementCenter(button), { x: 30, y: 28 })
  assert.deepEqual(cursorTargets({ ref: 'e1' }, { e1: button }), [{ x: 30, y: 28 }])
  assert.deepEqual(cursorTargets({ sourceRef: 'e1', targetRef: 'e2' }, { e1: button, e2: field }), [
    elementCenter(button), elementCenter(field),
  ])
  assert.deepEqual(cursorTargets({ ref: 'missing' }, { e1: button }), [])
  assert.deepEqual(cursorTargets({ x: '12', y: 4 }, {}), [])
})

test('snapshot boxes are read from nested tool results', () => {
  const elements = collectSnapshotElements({
    content: [{ text: JSON.stringify({ snapshot: { elements: [button] } }) }],
  })
  assert.deepEqual(elements.e1, button)
})

test('the frame follows playwright and screenshot tool names', () => {
  assert.equal(browserToolFrame('user_browser_playwright_click'), true)
  assert.equal(browserToolFrame('playwright_browser_take_screenshot'), true)
  assert.equal(browserToolFrame('shell'), false)
})
