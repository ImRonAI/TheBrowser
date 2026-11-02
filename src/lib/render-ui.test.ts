import { test } from 'node:test'
import assert from 'node:assert/strict'
import { supersededUiParts, uiActionText, uiViewFromOutput, type PanelPart } from './panel-stream.ts'

test('render_ui result json block becomes a view with clamped height', () => {
  const view = uiViewFromOutput([{ json: { ui: { view_id: 'v1', format: 'html', title: 'Videos', source: '<html></html>', height: 9000 } } }, { text: 'Rendered' }])
  assert.deepEqual(view, { viewId: 'v1', format: 'html', title: 'Videos', source: '<html></html>', height: 2000 })
  assert.equal(uiViewFromOutput([{ text: 'nope' }]), null)
  assert.equal(uiViewFromOutput([{ json: { ui: { format: 'pdf', source: 'x' } } }]), null)
  assert.equal(uiViewFromOutput('string')?.viewId, undefined)
})

test('a later render of the same view_id supersedes the earlier one; distinct ids stay', () => {
  const part = (key: string, id: string): PanelPart => ({ kind: 'tool', key, id: key, name: 'render_ui', path: [], input: {}, progress: [], finished: true,
    output: [{ json: { ui: { view_id: id, format: 'html', source: '<div/>' } } }] })
  const superseded = supersededUiParts([{ parts: [part('a', 'list')] }, { parts: [part('b', 'list'), part('c', 'other')] }])
  assert.deepEqual([...superseded], ['a'])
})

test('ui action user-turn text mirrors the server format and bounds the payload', () => {
  assert.equal(uiActionText('v1', 'thumbs_up', { video: 'abc' }), '[ui_action v1] action=thumbs_up payload={"video":"abc"}')
  assert.equal(uiActionText('v1', 'Bad Label!', null), '[ui_action v1] action=action payload=null')
  assert.ok(uiActionText('v1', 'rank', 'x'.repeat(5000)).length < 4100)
})
