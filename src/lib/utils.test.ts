import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { CUSTOM_FONT_SIZES, cn } from './utils.ts'
import { cn as cnFromUtils } from '../utils/cn.ts'

test('a custom font size survives a colour class next to it', () => {
  assert.equal(cn('text-body-sm', 'text-ink'), 'text-body-sm text-ink')
  assert.equal(cn('text-ink', 'text-body-sm'), 'text-ink text-body-sm')
  assert.equal(cn('text-label text-ink-muted'), 'text-label text-ink-muted')
  assert.equal(cn('text-display-sm', 'dark:text-ink-inverse', 'text-ink'), 'text-display-sm dark:text-ink-inverse text-ink')
  assert.equal(
    cn('block text-body-sm font-medium truncate', true ? 'text-accent dark:text-accent-light' : 'text-ink dark:text-ink-inverse'),
    'block text-body-sm font-medium truncate text-accent dark:text-accent-light',
  )
})

test('custom and built-in font sizes still override each other', () => {
  assert.equal(cn('text-body-sm', 'text-sm'), 'text-sm')
  assert.equal(cn('text-xs', 'text-body-md'), 'text-body-md')
  assert.equal(cn('text-body-xs', 'text-label'), 'text-label')
  assert.equal(cn('text-ink', 'text-accent'), 'text-accent')
})

test('both cn helpers are the same configured function', () => {
  assert.equal(cnFromUtils, cn)
})

test('the registered sizes are exactly the fontSize keys in tailwind.config.ts', () => {
  const config = readFileSync(new URL('../../tailwind.config.ts', import.meta.url), 'utf8')
  const start = config.indexOf('fontSize: {')
  assert.ok(start >= 0, 'tailwind.config.ts has a fontSize block')
  let depth = 0
  let end = -1
  for (let index = config.indexOf('{', start); index < config.length; index += 1) {
    if (config[index] === '{') depth += 1
    if (config[index] === '}') depth -= 1
    if (depth === 0) {
      end = index
      break
    }
  }
  const block = config.slice(config.indexOf('{', start) + 1, end)
  const keys = [...block.matchAll(/^\s*'?([\w-]+)'?\s*:\s*\[/gm)].map((match) => match[1])
  assert.deepEqual([...keys].sort(), [...CUSTOM_FONT_SIZES].sort())
})
