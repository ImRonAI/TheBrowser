import type { Extensions } from '@tiptap/core'
import 'katex/dist/katex.min.css'
import './blocks.css'
import { EmbedBlock } from './EmbedBlock'
import { PdfBlock } from './PdfBlock'
import { MediaBlock } from './MediaBlock'
import { RonColor, RonHighlight, RonImage, RonTextStyle, RonYoutube } from './NativeBlocks'
import { DetailsContent, DetailsSummary, ToggleDetails, ToggleHeadingLevel } from './ToggleBlocks'
import { Callout, Card, CardTitle, Column, Columns } from './LayoutBlocks'
import { TableOfContentsBlock } from './TocBlock'
import { MathEditing, RonBlockMath, RonInlineMath } from './MathBlocks'
import { DateChip } from './DateChip'
import { PageLink } from './PageLink'
import { IssueEmbed } from './IssueEmbed'
import { ChatReference } from './ChatReference'
import { RonButton } from './RonButton'

/**
 * Every block the "/" menu can insert, in every NotionEditor (pages, issue descriptions, read-only previews),
 * so a block written in one place renders everywhere it is shown.
 */
export const BLOCK_EXTENSIONS: Extensions = [
  EmbedBlock, PdfBlock, MediaBlock, RonImage, RonYoutube,
  ToggleDetails, DetailsSummary, DetailsContent, ToggleHeadingLevel,
  Callout, CardTitle, Card, Column, Columns, TableOfContentsBlock,
  RonBlockMath, RonInlineMath, MathEditing,
  RonTextStyle, RonColor, RonHighlight,
  DateChip, PageLink, IssueEmbed, ChatReference, RonButton,
]
