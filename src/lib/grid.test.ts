import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  columnLetter, gridDisplay, gridFromJson, gridMarkdown, gridValue, gridWorkbook, normalizeGrid, readGrid, sheetCsv, starterGrid,
  type Grid,
} from './grid.ts'

const GRID: Grid = {
  title: 'Fleet costs',
  sheets: [
    {
      name: 'Fleet',
      formats: { C: '$#,##0.00', D: '$#,##0.00' },
      rows: [
        ['Vehicle', 'Units', 'Unit cost', 'Total', 'Electric'],
        ['Van', 3, 1500, '=B2*C2', true],
        ['Truck', 1.5, 2041.67, '=B3*C3', false],
        [null, '=SUM(B2:B3)', null, '=SUM(D2:D3)'],
      ],
    },
    { name: 'Sources', rows: [['Number', 'Title', 'URL'], [1, 'Fleet report', 'https://example.com/fleet']] },
  ],
}

test('column letters', () => {
  assert.deepEqual([0, 25, 26, 27, 701, 702].map(columnLetter), ['A', 'Z', 'AA', 'AB', 'ZZ', 'AAA'])
})

test('a grid is normalized to named sheets of plain cells, as the server does', () => {
  const grid = normalizeGrid({
    title: '  Costs  ',
    sheets: [
      { name: 'Costs', rows: [['a', 1, 2.5, true, null], 'not a row', [Number.NaN, { x: 1 }, [1]]], formats: { B: '#,##0', b: '0', C: '', D: 3 } },
      'not a sheet',
      { name: 'costs', rows: [] },
      { name: ' Q1: plan / [draft]  and a name that is far too long for Excel ' },
      { rows: [[1]] },
    ],
  })
  assert.equal(grid?.title, 'Costs')
  assert.deepEqual(grid?.sheets.map((sheet) => sheet.name), ['Costs', 'Sheet2', 'Q1 plan draft and a name that i', 'Sheet4'])
  assert.deepEqual(grid?.sheets[0], { name: 'Costs', rows: [['a', 1, 2.5, true, null], [null, null, null]], formats: { B: '#,##0' } })
  assert.deepEqual(normalizeGrid(grid), grid)
  assert.deepEqual(normalizeGrid({ sheets: [{ name: 'sheet2' }, {}] })?.sheets.map((sheet) => sheet.name), ['sheet2', 'Sheet3'])
  assert.equal(normalizeGrid({ title: 'x', sheets: [] }), null)
  assert.equal(normalizeGrid([1]), null)
  assert.deepEqual(normalizeGrid({ sheets: [{ rows: [] }] }), { title: 'Spreadsheet', sheets: [{ name: 'Sheet1', rows: [] }] })
  assert.deepEqual(normalizeGrid(starterGrid()), starterGrid())
})

test('a grid reads as a fence with a row a line and parses back', () => {
  const fence = gridMarkdown(GRID)
  assert.ok(fence.startsWith('```grid\n{"title": "Fleet costs", "sheets": [\n    {"name": "Fleet", "formats": {'))
  assert.ok(fence.includes('\n      ["Van",3,1500,"=B2*C2",true],\n'))
  assert.deepEqual(gridFromJson(fence.slice('```grid\n'.length, -'\n```'.length)), GRID)
  assert.equal(gridFromJson('{not json'), null)
  assert.equal(gridFromJson('3'), null)
})

test('before a spreadsheet calculates it, a grid shows each cell as written', () => {
  assert.deepEqual(gridDisplay(GRID)[0]?.rows, [
    ['Vehicle', 'Units', 'Unit cost', 'Total', 'Electric'],
    ['Van', '3', '1500', '=B2*C2', 'TRUE'],
    ['Truck', '1.5', '2041.67', '=B3*C3', 'FALSE'],
    ['', '=SUM(B2:B3)', '', '=SUM(D2:D3)', ''],
  ])
})

test('a grid opens as a workbook: formulas, a bold frozen header, column formats on the data cells', () => {
  const workbook = gridWorkbook(GRID)
  assert.deepEqual(workbook.sheetOrder, ['sheet-1', 'sheet-2'])
  const fleet = workbook.sheets?.['sheet-1']
  assert.equal(fleet?.name, 'Fleet')
  assert.deepEqual(fleet?.freeze, { xSplit: 0, ySplit: 1, startRow: 1, startColumn: -1 })
  assert.deepEqual(fleet?.cellData?.[0]?.[2], { v: 'Unit cost', s: 'header' })
  assert.deepEqual(fleet?.cellData?.[1]?.[2], { v: 1500, s: 'format-$#,##0.00' })
  assert.deepEqual(fleet?.cellData?.[1]?.[3], { f: '=B2*C2', s: 'format-$#,##0.00' })
  assert.deepEqual(fleet?.cellData?.[1]?.[4], { v: true })
  assert.equal(fleet?.cellData?.[3]?.[0], undefined)
  assert.deepEqual(workbook.styles, { header: { bl: 1 }, 'format-$#,##0.00': { n: { pattern: '$#,##0.00' } } })
  assert.equal(fleet?.rowCount, 54)
  assert.equal(fleet?.columnCount, 11)
  // A column is as wide as its longest text: a formula's text before a spreadsheet has calculated it, its result after.
  assert.equal(fleet?.columnData?.[3]?.w, 112)
  const shown = gridDisplay(GRID).map((sheet) => ({ ...sheet, rows: sheet.rows.map((row) => row.map((cell) => (cell.startsWith('=') ? '$7,562.51' : cell))) }))
  assert.equal(gridWorkbook(GRID, shown).sheets?.['sheet-1']?.columnData?.[3]?.w, 96)
})

test('what the spreadsheet reads back becomes the grid, its formulas\' results and what it shows', () => {
  const money = '$#,##0.00'
  const read = readGrid('Fleet costs', [{
    name: 'Fleet',
    formulas: [['', '', '', '', ''], ['', '', '', '=B2*C2', ''], ['', '', '', '=B3*C3', ''], ['', '=SUM(B2:B3)', '', '=SUM(D2:D3)', ''], ['', '', '', '', '']],
    values: [['Vehicle', 'Units', 'Unit cost', 'Total', ''], ['Van', 3, 1500, 4500, undefined], ['Truck', 1.5, 2041.67, 3062.505, null], ['', 4.5, null, 7562.505, null], [null, null, null, null, null]],
    formats: [['', '', '', '', ''], ['', '', money, money, ''], ['', '', money, money, ''], ['', '', '', money, ''], ['', '', '', '', '']],
    display: [['Vehicle', 'Units', 'Unit cost', 'Total', ''], ['Van', '3', '$1,500.00', '$4,500.00', ''], ['Truck', '1.5', '$2,041.67', '$3,062.51', ''], ['', '4.5', '', '$7,562.51', ''], ['', '', '', '', '']],
  }])
  assert.deepEqual(read.grid, {
    title: 'Fleet costs',
    sheets: [{
      name: 'Fleet',
      rows: [['Vehicle', 'Units', 'Unit cost', 'Total'], ['Van', 3, 1500, '=B2*C2'], ['Truck', 1.5, 2041.67, '=B3*C3'], [null, '=SUM(B2:B3)', null, '=SUM(D2:D3)']],
      formats: { C: money, D: money },
    }],
  })
  assert.deepEqual(read.values, [[['Vehicle', 'Units', 'Unit cost', 'Total'], ['Van', 3, 1500, 4500], ['Truck', 1.5, 2041.67, 3062.505], ['', 4.5, null, 7562.505]]])
  assert.deepEqual(read.display[0]?.rows[3], ['', '4.5', '', '$7,562.51'])
  assert.deepEqual(normalizeGrid(read.grid), read.grid)
  const empty = readGrid('  ', [{ name: 'Sheet1', formulas: [['']], values: [[null]], formats: [['']], display: [['']] }])
  assert.deepEqual(empty.grid, { title: 'Spreadsheet', sheets: [{ name: 'Sheet1', rows: [] }] })
})

test('a block holds a grid, and what it shows and its workbook only as a spreadsheet wrote them', () => {
  const display = gridDisplay(GRID)
  const workbook = { id: 'grid', sheetOrder: ['sheet-1'], sheets: { 'sheet-1': {} } }
  assert.deepEqual(gridValue(GRID, display, workbook), { grid: GRID, display, workbook })
  assert.deepEqual(gridValue(GRID, null, null), { grid: GRID, display: null, workbook: null })
  // What it shows is for other sheets, or isn't sheets of text; the workbook isn't one.
  assert.deepEqual(gridValue(GRID, display.slice(1), { sheets: [] }), { grid: GRID, display: null, workbook: null })
  assert.deepEqual(gridValue(GRID, [{ name: 'Fleet', rows: [[1]] }, { name: 'Sources', rows: [] }], 'workbook'), { grid: GRID, display: null, workbook: null })
  assert.equal(gridValue({ sheets: [] }, display, workbook), null)
  assert.equal(gridValue(null, null, null), null)
})

test('a sheet as CSV quotes what needs it', () => {
  assert.equal(sheetCsv([['Name', 'Note'], ['Van, long', 'said "ok"'], ['Truck', 'line\nbreak']]), 'Name,Note\r\n"Van, long","said ""ok"""\r\nTruck,"line\nbreak"')
})
