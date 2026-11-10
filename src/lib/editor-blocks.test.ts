import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  MAX_INLINE_FILE_BYTES, addDays, calloutVariant, clampHeight, daysFrom, decodeBase64DataUrl, driveEmbed, emojiScore, figmaEmbed,
  flattenSections, formatBytes, formatLongDate, imageSource, isPdfBytes, issueMarkdown, loomEmbed, mapsEmbed, matchScore,
  matchesAll, nameFromUrl, normalizeEmbed, pageHref, parseHttpsUrl, parseIsoDate, pdfSource, relativeDayLabel, safeEmbedSrc,
  searchEmoji, slashSections, toIsoDate, tocRows, tooLargeMessage, vimeoEmbed, type SearchableItem,
} from './editor-blocks.ts'

const ok = <T>(result: { ok: true; value: T } | { ok: false; error: string }): T => {
  assert.equal(result.ok, true, result.ok ? '' : result.error)
  return (result as { ok: true; value: T }).value
}

test('parseHttpsUrl accepts only absolute https links without credentials', () => {
  assert.equal(parseHttpsUrl(' https://example.com/a?b=1 ')?.href, 'https://example.com/a?b=1')
  for (const bad of ['http://example.com', 'javascript:alert(1)', 'data:text/html,<p>x</p>', 'https://user:pw@example.com', 'example.com', 'https://a b.com', '']) {
    assert.equal(parseHttpsUrl(bad), null, bad)
  }
})

test('generic embeds keep https pages and refuse script/data links', () => {
  const page = ok(normalizeEmbed('https://www.example.org/report'))
  assert.deepEqual(page, { src: 'https://www.example.org/report', url: 'https://www.example.org/report', provider: 'web', title: 'example.org' })
  const javascript = normalizeEmbed('javascript:alert(1)')
  assert.equal(javascript.ok, false)
  assert.match((javascript as { error: string }).error, /cannot be embedded/)
  assert.equal(normalizeEmbed('data:text/html;base64,PHA+').ok, false)
  assert.equal(normalizeEmbed('http://example.com').ok, false)
  // A known provider pasted into the generic Embed uses its player.
  assert.equal(ok(normalizeEmbed('https://www.loom.com/share/0123456789abcdef0123456789abcdef')).src, 'https://www.loom.com/embed/0123456789abcdef0123456789abcdef')
  assert.equal(safeEmbedSrc('javascript:alert(1)'), '')
  assert.equal(safeEmbedSrc('https://ok.example/x'), 'https://ok.example/x')
})

test('Google Maps links, coordinates and plain addresses become keyless embed URLs', () => {
  const place = ok(mapsEmbed('https://www.google.com/maps/place/Eiffel+Tower/@48.8583701,2.2944813,17z/data=!3m1'))
  assert.equal(place.src, 'https://www.google.com/maps?q=Eiffel+Tower&z=17&output=embed')
  assert.equal(place.title, 'Eiffel Tower')
  assert.equal(ok(mapsEmbed('https://www.google.com/maps/@40.7128,-74.006,12z')).src, 'https://www.google.com/maps?q=40.7128%2C-74.006&z=12&output=embed')
  assert.equal(ok(mapsEmbed('https://maps.google.com/?q=Golden+Gate+Bridge')).src, 'https://www.google.com/maps?q=Golden+Gate+Bridge&output=embed')
  assert.equal(ok(mapsEmbed('1600 Amphitheatre Parkway, Mountain View')).src, 'https://www.google.com/maps?q=1600+Amphitheatre+Parkway%2C+Mountain+View&output=embed')
  const embed = 'https://www.google.com/maps/embed?pb=!1m18!1m12'
  assert.equal(ok(mapsEmbed(embed)).src, embed)
  assert.equal(mapsEmbed('https://maps.app.goo.gl/abc123').ok, false)
  assert.equal(mapsEmbed('https://example.com/maps').ok, false)
})

test('Figma, Loom, Vimeo and Google Drive links map to their documented embed players', () => {
  const figma = ok(figmaEmbed('https://www.figma.com/design/AbC123xyz/Checkout-flow?node-id=1-2'))
  assert.equal(figma.src, `https://www.figma.com/embed?embed_host=share&url=${encodeURIComponent('https://www.figma.com/design/AbC123xyz/Checkout-flow?node-id=1-2')}`)
  assert.equal(figma.title, 'Checkout flow')
  assert.equal(figmaEmbed('https://www.figma.com/community').ok, false)
  assert.equal(ok(loomEmbed('https://www.loom.com/share/0123456789abcdef0123456789abcdef?sid=1')).src, 'https://www.loom.com/embed/0123456789abcdef0123456789abcdef')
  assert.equal(loomEmbed('https://www.loom.com/pricing').ok, false)
  assert.equal(ok(vimeoEmbed('https://vimeo.com/76979871')).src, 'https://player.vimeo.com/video/76979871')
  assert.equal(ok(vimeoEmbed('https://vimeo.com/76979871/abcdef1234')).src, 'https://player.vimeo.com/video/76979871?h=abcdef1234')
  assert.equal(vimeoEmbed('https://vimeo.com/about').ok, false)
  assert.equal(ok(driveEmbed('https://docs.google.com/document/d/1AbC_dEf-123/edit?usp=sharing')).src, 'https://docs.google.com/document/d/1AbC_dEf-123/preview')
  assert.equal(ok(driveEmbed('https://docs.google.com/spreadsheets/d/1Xyz/edit#gid=0')).title, 'Google Sheet')
  assert.equal(ok(driveEmbed('https://docs.google.com/forms/d/e/1FAIpQ/viewform')).src, 'https://docs.google.com/forms/d/e/1FAIpQ/viewform?embedded=true')
  assert.equal(ok(driveEmbed('https://drive.google.com/file/d/1FileId/view?usp=sharing')).src, 'https://drive.google.com/file/d/1FileId/preview')
  assert.equal(driveEmbed('https://drive.google.com/drive/folders/1').ok, false)
})

test('PDF and image sources: https links or the file uploaded into the page', () => {
  assert.deepEqual(pdfSource('https://example.com/a.pdf'), { kind: 'url', src: 'https://example.com/a.pdf' })
  assert.deepEqual(pdfSource('data:application/pdf;base64,JVBERi0xLjQ='), { kind: 'upload', src: 'data:application/pdf;base64,JVBERi0xLjQ=' })
  assert.equal(pdfSource('data:text/html;base64,PHA+'), null)
  assert.equal(pdfSource('javascript:alert(1)'), null)
  assert.equal(imageSource('https://example.com/a.png'), 'https://example.com/a.png')
  assert.equal(imageSource('data:image/png;base64,iVBORw0KGgo='), 'data:image/png;base64,iVBORw0KGgo=')
  assert.equal(imageSource('data:text/html;base64,PHA+'), null)
})

test('data URLs decode to bytes; PDFs are recognised by their header', () => {
  const decoded = decodeBase64DataUrl('data:application/pdf;base64,JVBERi0xLjQK')
  assert.equal(decoded?.mime, 'application/pdf')
  assert.equal(isPdfBytes(decoded!.bytes), true)
  assert.equal(isPdfBytes(new TextEncoder().encode('<html>')), false)
  assert.equal(decodeBase64DataUrl('https://example.com'), null)
})

test('file sizes, names and the inline upload limit', () => {
  assert.equal(formatBytes(512), '512 B')
  assert.equal(formatBytes(2048), '2.0 KB')
  assert.equal(formatBytes(3 * 1024 * 1024), '3.0 MB')
  assert.equal(nameFromUrl('https://example.com/files/Q3%20report.pdf'), 'Q3 report.pdf')
  assert.equal(nameFromUrl('https://example.com/'), 'example.com')
  assert.match(tooLargeMessage('big.pdf', MAX_INLINE_FILE_BYTES * 3), /big\.pdf is 3\.0 MB.*up to 1\.0 MB/)
  assert.equal(clampHeight('900', 400), 900)
  assert.equal(clampHeight(10, 400), 120)
  assert.equal(clampHeight('x', 400), 400)
})

test('dates are calendar days relative to today', () => {
  const now = new Date(2026, 10, 7, 15, 30)
  assert.equal(toIsoDate(now), '2026-11-07')
  assert.equal(parseIsoDate('2026-02-30'), null)
  assert.equal(toIsoDate(addDays(now, 7)), '2026-11-14')
  assert.equal(daysFrom('2026-11-10', now), 3)
  assert.equal(relativeDayLabel('2026-11-07', now), 'Today')
  assert.equal(relativeDayLabel('2026-11-08', now), 'Tomorrow')
  assert.equal(relativeDayLabel('2026-11-06', now), 'Yesterday')
  assert.equal(relativeDayLabel('2026-11-01', now), '6 days ago')
  assert.equal(relativeDayLabel('2026-12-07', now), 'in 30 days')
  assert.equal(formatLongDate('2026-11-07'), 'Sat, Nov 7, 2026')
})

const item = (id: string, label: string, group: SearchableItem['group'], keywords: string[] = []): SearchableItem => ({ id, label, group, keywords })
const ITEMS = [
  item('text', 'Text', 'basic', ['paragraph', 'plain']),
  item('h1', 'Heading 1', 'basic', ['h1', 'title']),
  item('todo', 'To-Do List', 'lists', ['checkbox', 'task']),
  item('toggle', 'Toggle List', 'lists', ['accordion', 'details', 'collapse']),
  item('youtube', 'YouTube', 'media', ['video']),
  item('video', 'Video', 'media', ['mp4', 'movie']),
  item('cols2', '2 Columns', 'layout', ['columns', 'layout', 'side by side']),
  item('issue', 'Embed issue', 'workspace', ['issue', 'ticket', 'task']),
]

test('slash search ranks label prefixes, then words, then keywords, and ignores spaces and dashes', () => {
  assert.equal(matchScore(ITEMS[2], 'todo'), 0)
  assert.equal(matchScore(ITEMS[2], 'to do'), 0)
  assert.equal(matchScore(ITEMS[1], '1'), 1)
  assert.equal(matchScore(ITEMS[3], 'accordion'), 2)
  assert.equal(matchScore(ITEMS[0], 'xyz'), null)
  assert.deepEqual(flattenSections(slashSections(ITEMS, 'video')).map((entry) => entry.id), ['video', 'youtube'])
  // "task" is a keyword of both To-Do and Embed issue: the Lists group shows first (menu order on equal scores).
  assert.deepEqual(flattenSections(slashSections(ITEMS, 'task')).map((entry) => entry.id), ['todo', 'issue'])
  assert.deepEqual(slashSections(ITEMS, 'nothing-matches'), [])
})

test('with no query the menu shows every group in order with its header', () => {
  const sections = slashSections(ITEMS, '')
  assert.deepEqual(sections.map((section) => section.label), ['Basic blocks', 'Lists', 'Media', 'Layout', 'Ren / Workspace'])
  assert.deepEqual(flattenSections(sections).map((entry) => entry.id), ITEMS.map((entry) => entry.id))
})

test('picker matching needs every query word somewhere in the texts', () => {
  assert.equal(matchesAll(['RON-12', 'Fix the login page'], 'login ron'), true)
  assert.equal(matchesAll(['RON-12', 'Fix the login page'], 'logout'), false)
  assert.equal(matchesAll(['anything'], '  '), true)
})

test('emoji search puts an exact name before emoji that only share a tag', () => {
  // Shapes and order as in @tiptap/extension-emoji's dataset (astronaut comes first there).
  const astronaut = { name: 'astronaut', shortcodes: ['astronaut'], tags: ['rocket', 'space'], group: 'people & body' }
  const rocket = { name: 'rocket', shortcodes: ['rocket'], tags: ['launch', 'space'], group: 'travel & places' }
  const smile = { name: 'smile', shortcodes: ['smile', 'grinning_face_with_smiling_eyes'], tags: ['happy'], group: 'smileys & emotion' }
  assert.deepEqual(searchEmoji([astronaut, rocket, smile], 'rocket').map((emoji) => emoji.name), ['rocket', 'astronaut'])
  assert.equal(emojiScore(smile, 'grinning face'), 1)
  assert.equal(emojiScore(smile, 'face'), 2)
  assert.equal(emojiScore(rocket, 'space'), 3)
  assert.equal(emojiScore(rocket, 'banana'), null)
  assert.equal(searchEmoji([astronaut, rocket, smile], '').length, 3)
  assert.equal(searchEmoji([astronaut, rocket, smile], '', 2).length, 2)
})

test('table of contents depth is relative to the shallowest heading and skips empty headings', () => {
  assert.deepEqual(tocRows([
    { level: 2, text: 'Intro', pos: 1 }, { level: 3, text: ' Detail ', pos: 9 }, { level: 2, text: '   ', pos: 20 },
  ]), [{ level: 2, text: 'Intro', pos: 1, depth: 0 }, { level: 3, text: 'Detail', pos: 9, depth: 1 }])
  assert.deepEqual(tocRows([]), [])
})

test('callout variants, deep links and the issue line Ren reads', () => {
  assert.equal(calloutVariant('warning'), 'warning')
  assert.equal(calloutVariant('<script>'), 'info')
  assert.equal(pageHref('p1', 'd1'), 'ron://project/p1/docs/d1')
  assert.equal(issueMarkdown({ key: 'RON-4', title: 'Ship it', status: 'In Progress', dueDate: '2026-11-12', projectId: 'p1' }),
    'Issue [RON-4: Ship it](ron://project/p1) (status: In Progress, due 2026-11-12)')
  assert.equal(issueMarkdown({ key: 'RON-4', title: 'Ship it' }), 'Issue RON-4: Ship it')
})
