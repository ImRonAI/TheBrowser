import assert from 'node:assert/strict'
import { test } from 'node:test'
import { edgeFadeMask, focusAfterClose, horizontalWheelDelta, isCloseTabKey, overflowEdges, revealDelta, tabFocusTarget } from './tab-strip.ts'

test('arrow keys follow the orientation and wrap; Home and End go to the ends', () => {
  assert.equal(tabFocusTarget('ArrowRight', 0, 3, 'horizontal'), 1)
  assert.equal(tabFocusTarget('ArrowRight', 2, 3, 'horizontal'), 0)
  assert.equal(tabFocusTarget('ArrowLeft', 0, 3, 'horizontal'), 2)
  assert.equal(tabFocusTarget('ArrowDown', 1, 3, 'vertical'), 2)
  assert.equal(tabFocusTarget('ArrowUp', 0, 3, 'vertical'), 2)
  assert.equal(tabFocusTarget('Home', 2, 3, 'horizontal'), 0)
  assert.equal(tabFocusTarget('End', 0, 3, 'vertical'), 2)
})

test('cross-axis arrows, other keys and an empty list do not move focus', () => {
  assert.equal(tabFocusTarget('ArrowDown', 0, 3, 'horizontal'), null)
  assert.equal(tabFocusTarget('ArrowRight', 0, 3, 'vertical'), null)
  assert.equal(tabFocusTarget('Enter', 0, 3, 'horizontal'), null)
  assert.equal(tabFocusTarget('ArrowRight', 0, 0, 'horizontal'), null)
})

test('Delete and Backspace close; focus then goes to the next tab, or the previous one after the last', () => {
  assert.equal(isCloseTabKey('Delete'), true)
  assert.equal(isCloseTabKey('Backspace'), true)
  assert.equal(isCloseTabKey('x'), false)
  assert.equal(focusAfterClose(0, 3), 1)
  assert.equal(focusAfterClose(1, 3), 2)
  assert.equal(focusAfterClose(2, 3), 1)
  assert.equal(focusAfterClose(0, 1), -1, 'closing the only tab leaves nothing to focus')
})

test('revealDelta scrolls just enough to show the item clear of the fade margin', () => {
  // View 0..300 with a 24px margin: the comfortable band is 24..276.
  assert.equal(revealDelta(100, 120, 0, 300, 24), 0, 'already visible')
  assert.equal(revealDelta(400, 120, 0, 300, 24), 244, 'past the end: its end lands at 276')
  assert.equal(revealDelta(10, 120, 100, 300, 24), -114, 'before the start: its start lands at 124')
  assert.equal(revealDelta(500, 400, 0, 300, 24), 476, 'wider than the view: its start is shown')
  assert.equal(revealDelta(0, 32, 0, 200), 0, 'no margin')
})

test('overflowEdges and edgeFadeMask fade only the edges that hide tabs', () => {
  assert.deepEqual(overflowEdges(0, 300, 300), { start: false, end: false })
  assert.deepEqual(overflowEdges(0, 300, 900), { start: false, end: true })
  assert.deepEqual(overflowEdges(600, 300, 900), { start: true, end: false })
  assert.deepEqual(overflowEdges(200, 300, 900), { start: true, end: true })
  assert.equal(edgeFadeMask({ start: false, end: false }, 24), undefined)
  assert.equal(edgeFadeMask({ start: false, end: true }, 24), 'linear-gradient(to right, #000 0, #000 24px, #000 calc(100% - 24px), transparent 100%)')
  assert.equal(edgeFadeMask({ start: true, end: false }, 24), 'linear-gradient(to right, transparent 0, #000 24px, #000 calc(100% - 24px), #000 100%)')
})

test('a vertical wheel turn scrolls the strip sideways; a horizontal one is left to the browser', () => {
  assert.equal(horizontalWheelDelta(0, 100), 100)
  assert.equal(horizontalWheelDelta(2, -40), -40)
  assert.equal(horizontalWheelDelta(60, 10), 0)
  assert.equal(horizontalWheelDelta(0, 3, 1), 48, 'line mode counts lines')
})
