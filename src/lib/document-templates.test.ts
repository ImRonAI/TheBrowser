import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  DOCUMENT_TEMPLATES, TEMPLATE_CATEGORIES, findTemplate, instantiateTemplate, isSkillDocument, searchTemplates,
} from './document-templates.ts'
import { normalizeWorkflow } from './workflow.ts'

const NOW = new Date(2026, 10, 7, 9, 30) // Saturday 7 Nov 2026, local time
let counter = 0
const ids = () => `id-${(counter += 1)}`

test('every template has a unique id, a known category and the brief’s set is present', () => {
  const idsSeen = DOCUMENT_TEMPLATES.map((template) => template.id)
  assert.equal(new Set(idsSeen).size, idsSeen.length)
  for (const template of DOCUMENT_TEMPLATES) assert.ok(TEMPLATE_CATEGORIES.includes(template.category), template.id)
  assert.deepEqual(idsSeen, ['blank', 'meeting-notes', 'weekly-status', 'retrospective', 'project-brief', 'okrs', 'prd',
    'design-doc', 'adr', 'bug-report', 'research-notes', 'daily-plan', 'reading-notes', 'agent-skill'])
})

test('templates are real structure built only from blocks the page editor loads', () => {
  // StarterKit (h1–h3, p, lists, blockquote, hr, marks), task lists, tables, code blocks and the workflow block.
  const allowed = new Set(['h2', 'h3', 'p', 'em', 'strong', 'ul', 'ol', 'li', 'blockquote', 'hr', 'pre', 'code',
    'table', 'tbody', 'tr', 'th', 'td', 'workflow-block'])
  for (const template of DOCUMENT_TEMPLATES.filter((item) => item.id !== 'blank')) {
    const { content } = instantiateTemplate(template, NOW, ids)
    const tags = [...content.matchAll(/<([a-z][a-z0-9-]*)\b/g)].map((match) => match[1])
    assert.ok(tags.length > 10, `${template.id} has structure`)
    for (const tag of tags) assert.ok(allowed.has(tag), `${template.id} uses <${tag}>`)
    assert.ok((content.match(/<h2>/g) ?? []).length >= 3, `${template.id} has sections`)
    // Balanced markup: every opened element is closed (hr is void).
    for (const tag of new Set(tags.filter((name) => name !== 'hr'))) {
      assert.equal((content.match(new RegExp(`<${tag}[\\s>]`, 'g')) ?? []).length, (content.match(new RegExp(`</${tag}>`, 'g')) ?? []).length, `${template.id} <${tag}>`)
    }
  }
})

test('titles carry the date where the page is about a day, week or quarter', () => {
  const title = (id: string) => instantiateTemplate(findTemplate(id)!, NOW, ids).title
  assert.equal(title('meeting-notes'), 'Meeting notes · Nov 7, 2026')
  assert.equal(title('weekly-status'), 'Status update · week of Nov 2, 2026')
  assert.equal(title('daily-plan'), 'Daily plan · Saturday, Nov 7, 2026')
  assert.equal(title('okrs'), 'OKRs · Q4 2026')
  assert.equal(title('blank'), '')
  assert.equal(title('agent-skill'), '')
  assert.equal(instantiateTemplate(findTemplate('blank')!, NOW, ids).content, '')
})

test('the design doc’s workflow block carries a valid graph and a fresh id', () => {
  const { content } = instantiateTemplate(findTemplate('design-doc')!, NOW, () => 'wf-1')
  const match = content.match(/<workflow-block data-id="wf-1" data-title="System context" data-graph="([^"]+)">/)
  assert.ok(match)
  const graph = normalizeWorkflow(JSON.parse(match[1].replace(/&quot;/g, '"').replace(/&amp;/g, '&')))
  assert.deepEqual(graph.steps.map((step) => step.label), ['Client', 'New service', 'Data store', 'Response'])
  assert.equal(graph.connections.length, 3)
})

test('the Agent Skill template has the sections the skill publisher reads, with notes as italic paragraphs', () => {
  const { content } = instantiateTemplate(findTemplate('agent-skill')!, NOW, ids)
  assert.ok(isSkillDocument(content))
  for (const section of ['Description', 'When to use', 'Inputs', 'Steps', 'Completion criteria']) assert.ok(content.includes(`<h2>${section}</h2>`), section)
  assert.equal((content.match(/<h3><\/h3><p><\/p><p>Done when:&nbsp;<\/p>/g) ?? []).length, 2)
  assert.ok(content.startsWith('<p><em>Name this page'))
  assert.ok(content.includes('<ul data-type="taskList"><li data-type="taskItem" data-checked="false"><p></p></li></ul>'))
  assert.equal(isSkillDocument(instantiateTemplate(findTemplate('prd')!, NOW, ids).content), false)
  assert.equal(isSkillDocument('<h1>Summary:</h1><p>x</p><h2><strong>Steps</strong></h2>'), true)
})

test('search matches name, description, category and keywords by word prefix', () => {
  assert.deepEqual(searchTemplates('').length, DOCUMENT_TEMPLATES.length)
  assert.deepEqual(searchTemplates('adr').map((item) => item.id), ['adr'])
  assert.deepEqual(searchTemplates('retro').map((item) => item.id), ['retrospective'])
  assert.deepEqual(searchTemplates('skill').map((item) => item.id), ['agent-skill'])
  assert.ok(searchTemplates('meeting').some((item) => item.id === 'meeting-notes'))
  assert.deepEqual(searchTemplates('steps repro').map((item) => item.id), ['bug-report'])
  assert.deepEqual(searchTemplates('zzz'), [])
})
