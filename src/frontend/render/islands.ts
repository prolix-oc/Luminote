/**
 * Ported from Lumiverse `MessageContent.tsx` (HTML island isolation section).
 * Detects self-contained HTML blocks that carry `<style>` tags or significant
 * inline styling and extracts them for Shadow-DOM rendering, with a
 * markdown-aware tokenizer that skips fenced code blocks.
 * Keep in step with upstream.
 *
 * Deliberate Luminote deviations from chat parity (upstream leaves these as
 * code blocks; a note taking an explicit fence is declaring intent):
 *   1. ```html / ```xhtml / ```svg FENCED blocks always extract as islands.
 *   2. Svg fences get a center-fit frame style so viewBox-only markup still
 *      renders with a size (inline svg with no width attr collapses to 0).
 */
import { chatMarked, escapeHtml } from './markedSetup'
import { normalizeLegacyFontTags } from './legacyFontTags'
import { processMarkdownInHtmlIsland } from './islandMarkdown'

export const HTML_ISLAND_TOKEN = 'LUMIVERSE_HTML_ISLAND'

const INLINE_STYLE_ATTR_RE = /\bstyle\s*=/gi
const NO_ISLAND_ATTR_RE = /\bdata-no-island(?=[\s=>"'/]|$)/i
const ROOT_HTML_TAG_RE = /^<([a-z][\w:-]*)\b[^>]*>/i
const VOID_HTML_TAGS = new Set([
  'area',
  'base',
  'br',
  'col',
  'embed',
  'hr',
  'img',
  'input',
  'link',
  'meta',
  'param',
  'source',
  'track',
  'wbr',
])

export interface MarkdownFence {
  marker: '`' | '~'
  length: number
}

export function getMarkdownFence(line: string): MarkdownFence | null {
  const match = line.match(/^\s*(`{3,}|~{3,})/)
  if (!match) return null
  return {
    marker: match[1][0] as MarkdownFence['marker'],
    length: match[1].length,
  }
}

export function isMarkdownFenceClose(line: string, fence: MarkdownFence): boolean {
  const trimmed = line.trimStart()
  const run = trimmed.match(/^(`+|~+)/)?.[0]
  if (!run) return false
  if (run[0] !== fence.marker || run.length < fence.length) return false
  return trimmed.slice(run.length).trim().length === 0
}

/** Detect HTML blocks with enough inline styling to warrant island extraction. */
function hasSignificantInlineStyles(html: string): boolean {
  INLINE_STYLE_ATTR_RE.lastIndex = 0
  let count = 0
  while (INLINE_STYLE_ATTR_RE.exec(html)) {
    if (++count >= 3) return true
  }
  return false
}

function escapeRegexLiteral(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

interface HtmlElementMatch {
  openingTag: string
  end: number
}

function findStyleBlockEnd(raw: string, start: number): number | null {
  const open = raw.slice(start).match(/^<style(?=[\s>])[^>]*>/i)
  if (!open) return null

  const closeRe = /<\/style\s*>/gi
  closeRe.lastIndex = start + open[0].length
  const close = closeRe.exec(raw)
  return close ? close.index + close[0].length : null
}

function parseHtmlElementAt(raw: string, start: number): HtmlElementMatch | null {
  const open = raw.slice(start).match(ROOT_HTML_TAG_RE)
  if (!open) return null

  const tag = open[1].toLowerCase()
  const openingTag = open[0]
  const openingEnd = start + openingTag.length

  if (tag === 'style') {
    const end = findStyleBlockEnd(raw, start)
    return end == null ? null : { openingTag, end }
  }

  if (VOID_HTML_TAGS.has(tag) || /\/\s*>$/.test(openingTag)) {
    return { openingTag, end: openingEnd }
  }

  const tagRe = new RegExp(`</?${escapeRegexLiteral(tag)}(?=[\\s>/])[^>]*>`, 'gi')
  tagRe.lastIndex = start

  let depth = 0
  let match: RegExpExecArray | null
  while ((match = tagRe.exec(raw)) !== null) {
    const token = match[0]
    if (/^<\//.test(token)) {
      depth -= 1
    } else if (!/\/\s*>$/.test(token)) {
      depth += 1
    }

    if (depth <= 0) {
      return { openingTag, end: match.index + token.length }
    }
  }

  return null
}

function skipWhitespace(raw: string, start: number): number {
  let i = start
  while (i < raw.length && /\s/.test(raw[i])) i++
  return i
}

function extendThroughAdjacentHtmlSiblings(raw: string, start: number): number {
  let end = start
  let pos = start

  while (pos < raw.length) {
    const next = skipWhitespace(raw, pos)
    const element = parseHtmlElementAt(raw, next)
    if (!element || NO_ISLAND_ATTR_RE.test(element.openingTag)) break

    end = element.end
    pos = element.end
  }

  return end
}

function getMarkdownFenceRanges(raw: string): Array<[number, number]> {
  const ranges: Array<[number, number]> = []
  const lines = raw.match(/.*(?:\n|$)/g) || []
  let offset = 0
  let openFence: MarkdownFence | null = null
  let openStart = 0

  for (const line of lines) {
    if (!line && offset >= raw.length) break

    if (!openFence) {
      const fence = getMarkdownFence(line)
      if (fence) {
        openFence = fence
        openStart = offset
      }
    } else if (isMarkdownFenceClose(line, openFence)) {
      ranges.push([openStart, offset + line.length])
      openFence = null
    }

    offset += line.length
  }

  if (openFence) ranges.push([openStart, raw.length])
  return ranges
}

function getFenceRangeContaining(ranges: Array<[number, number]>, pos: number, startIndex: number): number {
  for (let i = startIndex; i < ranges.length; i++) {
    const [start, end] = ranges[i]
    if (pos < start) return -1
    if (pos >= start && pos < end) return i
  }
  return -1
}

// ── Explicit island fences (Luminote extension beyond chat parity) ──────

/** Info string of the fence opening at `fenceStart` (first word, lowercased). */
function fenceInfoOf(raw: string, fenceStart: number): string {
  const lineEnd = raw.indexOf('\n', fenceStart)
  const openLine = raw.slice(fenceStart, lineEnd === -1 ? raw.length : lineEnd)
  const openMatch = openLine.match(/^\s*(?:`{3,}|~{3,})\s*([^\s`~]*)/)
  return (openMatch?.[1] ?? '').toLowerCase()
}

const ISLAND_FENCE_INFO_RE = /^(?:x?html|svg)$/
/** Cheap pre-scan so the no-styles early-exit doesn't skip eligible fences. */
const ISLAND_FENCE_PRESENT_RE = /^[ \t]*(?:`{3,}|~{3,})\s*(?:x?html|svg)\b/im

/** Svg fence frame: islands sanitize their own style tags through, and inline
   ones override the base sheet on ties — so this rides inside the island. */
const SVG_FENCE_FRAME = `<style>
  svg { max-width: 100%; max-height: 420px; }
  svg:not([width]) { width: min(420px, 100%); display: block; margin: 0 auto; }
</style>`

/** Fence body: the lines between the opener and the (optional) closer. */
function fenceInnerText(raw: string, start: number, end: number): string {
  const firstNewline = raw.indexOf('\n', start)
  if (firstNewline === -1 || firstNewline >= end) return ''
  const inner = raw.slice(firstNewline + 1, end)
  return inner.replace(/(^|\n)[ \t]*`{3,}[ \t]*\n?$/, '$1').replace(/(^|\n)[ \t]*~{3,}[ \t]*\n?$/, '$1')
}

function getIslandEndAt(raw: string, start: number, isStreaming: boolean): number | null {
  const styleEnd = findStyleBlockEnd(raw, start)
  if (styleEnd != null) {
    return extendThroughAdjacentHtmlSiblings(raw, styleEnd)
  }

  if (isStreaming && /^<style(?=[\s>])/i.test(raw.slice(start))) return null

  const element = parseHtmlElementAt(raw, start)
  if (!element || NO_ISLAND_ATTR_RE.test(element.openingTag)) return null

  const fragment = raw.slice(start, element.end)
  if (/<style[\s>]/i.test(fragment) || hasSignificantInlineStyles(fragment)) {
    return element.end
  }

  let peekStart = skipWhitespace(raw, element.end)
  while (raw.startsWith('</', peekStart)) {
    const closeEnd = raw.indexOf('>', peekStart + 2)
    if (closeEnd < 0) break
    peekStart = skipWhitespace(raw, closeEnd + 1)
  }
  const trailingStyleEnd = findStyleBlockEnd(raw, peekStart)
  if (trailingStyleEnd != null) return extendThroughAdjacentHtmlSiblings(raw, trailingStyleEnd)

  return null
}

export function normalizeQuotesInHTML(html: string): string {
  return html
    .replace(/&ldquo;|&rdquo;|&bdquo;/g, '"')
    .replace(/&lsquo;|&rsquo;|&sbquo;/g, "'")
    .replace(/&laquo;|&raquo;/g, '"')
}

function renderIslandMarkdownText(markdown: string): string {
  const leadingWhitespace = markdown.match(/^\s*/)?.[0] ?? ''
  const trailingWhitespace = markdown.match(/\s*$/)?.[0] ?? ''
  const core = markdown.trim()

  if (!core) return markdown

  let html = chatMarked.parse(core, { async: false }) as string
  html = normalizeQuotesInHTML(html)

  const singleParagraphMatch = html.match(/^<p>([\s\S]*)<\/p>\s*$/)
  if (singleParagraphMatch && !/<\/p>\s*<p\b/i.test(html)) {
    html = singleParagraphMatch[1]
  }

  return `${leadingWhitespace}${html}${trailingWhitespace}`
}

function renderIslandInlineMarkdownText(markdown: string): string {
  const leadingWhitespace = markdown.match(/^\s*/)?.[0] ?? ''
  const trailingWhitespace = markdown.match(/\s*$/)?.[0] ?? ''
  const core = markdown.trim()

  if (!core) return markdown

  let html = chatMarked.parseInline(core, { async: false }) as string
  html = normalizeQuotesInHTML(html)

  return `${leadingWhitespace}${html}${trailingWhitespace}`
}

export function extractHtmlIslands(
  raw: string,
  isStreaming: boolean,
): { content: string; islands: string[] } {
  const hasStyleTag = /<style[\s>]/i.test(raw)
  if (!hasStyleTag && !/\bstyle\s*=/i.test(raw) && !ISLAND_FENCE_PRESENT_RE.test(raw)) {
    return { content: raw, islands: [] }
  }

  const trimmedRaw = raw.trim()
  if (
    /^(?:<!doctype\b|<html\b|<head\b)/i.test(trimmedRaw)
    && /<\/(?:html|body|head)>$/i.test(trimmedRaw)
  ) {
    return { content: `<!--${HTML_ISLAND_TOKEN}_0-->`, islands: [raw] }
  }

  const islands: string[] = []
  const fences = getMarkdownFenceRanges(raw)
  let fenceIdx = 0
  let content = ''
  let pos = 0

  while (pos < raw.length) {
    const containingFence = getFenceRangeContaining(fences, pos, fenceIdx)
    if (containingFence >= 0) {
      const [fenceStart, fenceEnd] = fences[containingFence]
      // Luminote deviation: explicit html/xhtml/svg fences always island-ify —
      // chat leaves fences as code blocks, but a note fence declares intent.
      const info = fenceInfoOf(raw, fenceStart)
      if (pos === fenceStart && ISLAND_FENCE_INFO_RE.test(info)) {
        const inner = fenceInnerText(raw, fenceStart, fenceEnd)
        if (inner.trim()) {
          const idx = islands.length
          islands.push(info === 'svg' ? `${SVG_FENCE_FRAME}${inner}` : inner)
          content += `<!--${HTML_ISLAND_TOKEN}_${idx}-->`
          pos = fenceEnd
          fenceIdx = containingFence + 1
          continue
        }
      }
      content += raw.slice(pos, fenceEnd)
      pos = fenceEnd
      fenceIdx = containingFence + 1
      continue
    }

    const nextTag = raw.indexOf('<', pos)
    if (nextTag < 0) {
      content += raw.slice(pos)
      break
    }

    const nextFence = fences[fenceIdx]
    if (nextFence && nextTag >= nextFence[0]) {
      // Stop at the fence boundary: plain fences fall through the containing-
      // fence branch unchanged (chat parity), island fences extract there.
      content += raw.slice(pos, nextFence[0])
      pos = nextFence[0]
      continue
    }

    content += raw.slice(pos, nextTag)

    const islandEnd = getIslandEndAt(raw, nextTag, isStreaming)
    if (islandEnd != null && islandEnd > nextTag) {
      const idx = islands.length
      islands.push(raw.slice(nextTag, islandEnd))
      content += `<!--${HTML_ISLAND_TOKEN}_${idx}-->`
      pos = islandEnd
    } else {
      content += raw[nextTag]
      pos = nextTag + 1
    }
  }

  return { content, islands }
}

export function processMarkdownInIsland(html: string): string {
  return processMarkdownInHtmlIsland(html, {
    renderBlockText: renderIslandMarkdownText,
    renderInlineText: renderIslandInlineMarkdownText,
    normalizeHtml: normalizeLegacyFontTags,
  })
}

export const ISLAND_ID_PREFIX = 'lx-island-'

/** Keep escapeHtml available to sibling render modules. */
export { escapeHtml }
