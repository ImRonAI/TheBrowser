/**
 * The spreadsheet engine: Univer's open source sheets (Apache-2.0) with its touch interface, loaded only when a grid
 * opens (this module is a lazy chunk). The plugins are the ones the open source packages ship for phones
 * (https://docs.univer.ai/guides/sheets/getting-started/installation.md, "Mobile support"): formulas, number
 * formats, filter, sort, conditional formatting, data validation, find and replace, tables and links. Charts, pivot
 * tables and Excel import and export are in Univer's paid packages (https://docs.univer.ai/server/license.md), so
 * they are not here: a grid's Excel file is written by Ren's backend.
 */
import { LocaleType, mergeLocales, Univer, UniverInstanceType, type IWorkbookData } from '@univerjs/core'
import { FUniver } from '@univerjs/core/facade'
import { UniverDataValidationPlugin } from '@univerjs/data-validation'
import DataValidationEnUS from '@univerjs/data-validation/locale/en-US'
import DesignEnUS from '@univerjs/design/locale/en-US'
import { UniverDocsPlugin } from '@univerjs/docs'
import { UniverDocsMobileUIPlugin } from '@univerjs/docs-ui'
import DocsUIEnUS from '@univerjs/docs-ui/locale/en-US'
import { UniverFormulaEnginePlugin } from '@univerjs/engine-formula'
import { UniverRenderEnginePlugin } from '@univerjs/engine-render'
import { UniverFindReplaceMobileUIPlugin } from '@univerjs/find-replace'
import FindReplaceEnUS from '@univerjs/find-replace/locale/en-US'
import { UniverSheetsPlugin } from '@univerjs/sheets'
import { UniverSheetsConditionalFormattingPlugin } from '@univerjs/sheets-conditional-formatting'
import { UniverSheetsConditionalFormattingMobileUIPlugin } from '@univerjs/sheets-conditional-formatting-ui'
import SheetsConditionalFormattingUIEnUS from '@univerjs/sheets-conditional-formatting-ui/locale/en-US'
import { UniverSheetsDataValidationPlugin } from '@univerjs/sheets-data-validation'
import { UniverSheetsDataValidationMobileUIPlugin } from '@univerjs/sheets-data-validation-ui'
import SheetsDataValidationUIEnUS from '@univerjs/sheets-data-validation-ui/locale/en-US'
import { UniverSheetsFilterPlugin } from '@univerjs/sheets-filter'
import { UniverSheetsFilterMobileUIPlugin } from '@univerjs/sheets-filter-ui'
import SheetsFilterUIEnUS from '@univerjs/sheets-filter-ui/locale/en-US'
import { UniverSheetsFindReplaceMobileUIPlugin } from '@univerjs/sheets-find-replace'
import { UniverSheetsFormulaPlugin } from '@univerjs/sheets-formula'
import { UniverSheetsFormulaMobileUIPlugin } from '@univerjs/sheets-formula-ui'
import SheetsFormulaUIEnUS from '@univerjs/sheets-formula-ui/locale/en-US'
import { UniverSheetsHyperLinkPlugin } from '@univerjs/sheets-hyper-link'
import { UniverSheetsHyperLinkMobileUIPlugin } from '@univerjs/sheets-hyper-link-ui'
import SheetsHyperLinkUIEnUS from '@univerjs/sheets-hyper-link-ui/locale/en-US'
import { UniverSheetsNumfmtPlugin } from '@univerjs/sheets-numfmt'
import { UniverSheetsNumfmtMobileUIPlugin } from '@univerjs/sheets-numfmt-ui'
import SheetsNumfmtUIEnUS from '@univerjs/sheets-numfmt-ui/locale/en-US'
import { UniverSheetsSortPlugin } from '@univerjs/sheets-sort'
import { UniverSheetsSortMobileUIPlugin } from '@univerjs/sheets-sort-ui'
import SheetsSortUIEnUS from '@univerjs/sheets-sort-ui/locale/en-US'
import { UniverSheetsTablePlugin } from '@univerjs/sheets-table'
import { UniverSheetsTableMobileUIPlugin } from '@univerjs/sheets-table-ui'
import SheetsTableUIEnUS from '@univerjs/sheets-table-ui/locale/en-US'
import { UniverSheetsMobileUIPlugin } from '@univerjs/sheets-ui'
import SheetsUIEnUS from '@univerjs/sheets-ui/locale/en-US'
import SheetsEnUS from '@univerjs/sheets/locale/en-US'
import { defaultTheme } from '@univerjs/themes'
import { UniverMobileUIPlugin } from '@univerjs/ui'
import UIEnUS from '@univerjs/ui/locale/en-US'

import '@univerjs/engine-formula/facade'
import '@univerjs/ui/facade'
import '@univerjs/docs-ui/facade'
import '@univerjs/sheets/facade'
import '@univerjs/sheets-ui/facade'
import '@univerjs/sheets-formula/facade'
import '@univerjs/sheets-numfmt/facade'
import '@univerjs/sheets-filter/facade'
import '@univerjs/sheets-sort/facade'

import '@univerjs/design/lib/index.css'
import '@univerjs/ui/lib/index.css'
import '@univerjs/docs-ui/lib/index.css'
import '@univerjs/sheets-ui/lib/index.css'
import '@univerjs/sheets-formula-ui/lib/index.css'
import '@univerjs/sheets-numfmt-ui/lib/index.css'
import '@univerjs/sheets-filter-ui/lib/index.css'
import '@univerjs/sheets-sort-ui/lib/index.css'
import '@univerjs/sheets-conditional-formatting-ui/lib/index.css'
import '@univerjs/sheets-data-validation-ui/lib/index.css'
import '@univerjs/find-replace/lib/index.css'
import '@univerjs/sheets-table-ui/lib/index.css'
import '@univerjs/sheets-hyper-link-ui/lib/index.css'

import type { SheetReading } from '@/lib/grid'

/** Univer's palette with ren's volt (`blurple` in tailwind.config.ts) as its brand scale. */
const THEME = {
  ...defaultTheme,
  primary: {
    ...defaultTheme.primary,
    50: '#F5F6FE', 100: '#E9ECFE', 200: '#D3DAFE', 300: '#B3BDFF', 400: '#8D98FE',
    500: '#676AFE', 600: '#5543FF', 700: '#4533D8', 800: '#3429A7', 900: '#251F78',
  },
}

const LOCALES = mergeLocales(
  DesignEnUS, UIEnUS, DocsUIEnUS, SheetsEnUS, SheetsUIEnUS, SheetsFormulaUIEnUS, SheetsNumfmtUIEnUS,
  SheetsFilterUIEnUS, SheetsSortUIEnUS, SheetsConditionalFormattingUIEnUS, DataValidationEnUS,
  SheetsDataValidationUIEnUS, FindReplaceEnUS, SheetsTableUIEnUS, SheetsHyperLinkUIEnUS,
)

/** What an open spreadsheet holds, once its formulas have calculated: its workbook, each sheet read back, and the sheet in view. */
export interface GridReading { workbook: IWorkbookData; sheets: SheetReading[]; active: number }

export interface GridEngine {
  read: () => Promise<GridReading>
  dispose: () => void
}

/** Open `workbook` as a spreadsheet in `container`, in the page's theme; `editable` false opens it to look at, not to change. */
export function openGrid(container: HTMLElement, workbook: Partial<IWorkbookData>, editable: boolean): GridEngine {
  const univer = new Univer({
    theme: THEME,
    darkMode: document.documentElement.classList.contains('dark'),
    locale: LocaleType.EN_US,
    locales: { [LocaleType.EN_US]: LOCALES },
  })
  univer.registerPlugin(UniverRenderEnginePlugin)
  univer.registerPlugin(UniverFormulaEnginePlugin)
  univer.registerPlugin(UniverMobileUIPlugin, { container })
  univer.registerPlugin(UniverDocsPlugin)
  univer.registerPlugin(UniverDocsMobileUIPlugin)
  univer.registerPlugin(UniverSheetsPlugin)
  univer.registerPlugin(UniverSheetsMobileUIPlugin)
  univer.registerPlugin(UniverSheetsFormulaPlugin)
  univer.registerPlugin(UniverSheetsFormulaMobileUIPlugin)
  univer.registerPlugin(UniverSheetsNumfmtPlugin)
  univer.registerPlugin(UniverSheetsNumfmtMobileUIPlugin)
  univer.registerPlugin(UniverSheetsFilterPlugin)
  univer.registerPlugin(UniverSheetsFilterMobileUIPlugin)
  univer.registerPlugin(UniverSheetsSortPlugin)
  univer.registerPlugin(UniverSheetsSortMobileUIPlugin)
  univer.registerPlugin(UniverSheetsConditionalFormattingPlugin)
  univer.registerPlugin(UniverSheetsConditionalFormattingMobileUIPlugin)
  univer.registerPlugin(UniverDataValidationPlugin)
  univer.registerPlugin(UniverSheetsDataValidationPlugin)
  univer.registerPlugin(UniverSheetsDataValidationMobileUIPlugin)
  univer.registerPlugin(UniverFindReplaceMobileUIPlugin)
  univer.registerPlugin(UniverSheetsFindReplaceMobileUIPlugin)
  univer.registerPlugin(UniverSheetsTablePlugin)
  univer.registerPlugin(UniverSheetsTableMobileUIPlugin)
  univer.registerPlugin(UniverSheetsHyperLinkPlugin)
  univer.registerPlugin(UniverSheetsHyperLinkMobileUIPlugin)
  univer.createUnit(UniverInstanceType.UNIVER_SHEET, workbook)
  const api = FUniver.newAPI(univer)
  const opened = api.getActiveWorkbook()
  if (!opened) {
    univer.dispose()
    throw new Error('The spreadsheet did not open.')
  }
  if (!editable) void opened.getWorkbookPermission().setPoint(api.Enum.WorkbookPermissionPoint.Edit, false)

  // Formulas calculate once the sheet has rendered; a read before that would find them empty.
  const rendered = new Promise<void>((resolve) => {
    api.addEvent(api.Event.LifeCycleChanged, ({ stage }) => { if (stage >= api.Enum.LifecycleStages.Rendered) resolve() })
  })

  return {
    read: async () => {
      await rendered
      // What is being typed into a cell counts, as it does when the cell is left.
      await opened.endEditingAsync(true)
      const formula = api.getFormula()
      const applied = formula.onCalculationResultApplied()
      formula.executeCalculation()
      await applied
      const sheets = opened.getSheets()
      return {
        workbook: opened.save(),
        // A sheet's last row and column with content are -1 while it is empty.
        sheets: sheets.map((sheet) => {
          const range = sheet.getRange(0, 0, Math.max(1, sheet.getLastRow() + 1), Math.max(1, sheet.getLastColumn() + 1))
          return { name: sheet.getSheetName(), formulas: range.getFormulas(), values: range.getRawValues(), formats: range.getNumberFormats(), display: range.getDisplayValues() }
        }),
        active: Math.max(0, sheets.findIndex((sheet) => sheet.getSheetId() === opened.getActiveSheet().getSheetId())),
      }
    },
    dispose: () => univer.dispose(),
  }
}
