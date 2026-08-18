/**
 * Chat-parity markdown renderer.
 *
 * `formatContent` mirrors Lumiverse's `MessageContent.tsx` pipeline
 * (heal → quotes → list escape → marked → quote/font/dialogue passes)
 * and `formatContentPieces` splits the result into sanitized markup pieces
 * and Shadow-DOM HTML islands, exactly like chat messages.
 *
 * Intentional deviation from upstream: trusted YouTube embed extraction is
 * not ported (iframes stay forbidden by the shared sanitize policy).
 */
import { chatMarked, escapeHtml } from './markedSetup'
import { healFormattingArtifacts } from './healing'
import { normalizeLegacyFontTags } from './legacyFontTags'
import {
  HTML_ISLAND_TOKEN,
  extractHtmlIslands,
  normalizeQuotesInHTML,
  processMarkdownInIsland,
} from './islands'
import { sanitizeHtmlIsland, sanitizeRichHtml } from './sanitize'
import { ISLAND_BASE_CSS } from '../styles'

// ── Prose passes (ported from MessageContent.tsx) ───────────────────────

function normalizeQuotes(text: string): string {
  return text
    .replace(/[“”„‟«»]/g, '"')
    .replace(/[‘’‚‛]/g, "'")
}

const BLOCK_CLOSE_RE = /^<\/(p|div|li|blockquote|h[1-6]|pre|table|tr|td|th)\b/i
const SKIP_OPEN_RE = /^<(pre|code)\b/i
const SKIP_CLOSE_RE = /^<\/(pre|code)\b/i

function isFeetInchesQuote(text: string, quoteIndex: number): boolean {
  const beforeQuote = text.slice(0, quoteIndex)
    .replace(/&#(?:0*39|x0*27);|&apos;/gi, "'")

  return /\d'\d+$/.test(beforeQuote)
}

function colorizeDialogue(html: string): string {
  const parts = html.split(/(<[^>]*>)/)
  let result = ''
  let inQuote = false
  let skipDepth = 0

  for (let i = 0; i < parts.length; i++) {
    const part = parts[i]

    if (i % 2 === 1) {
      if (SKIP_OPEN_RE.test(part)) skipDepth++
      else if (SKIP_CLOSE_RE.test(part)) skipDepth = Math.max(0, skipDepth - 1)

      if (inQuote && BLOCK_CLOSE_RE.test(part)) {
        result += '</span>'
        inQuote = false
      }
      result += part
      continue
    }

    if (skipDepth > 0 || !part) {
      result += part
      continue
    }

    let output = ''
    for (let j = 0; j < part.length; j++) {
      const isLiteral = part[j] === '"'
      const isEntity = !isLiteral
        && part[j] === '&'
        && part[j + 1] === 'q'
        && part[j + 2] === 'u'
        && part[j + 3] === 'o'
        && part[j + 4] === 't'
        && part[j + 5] === ';'

      if (isLiteral || isEntity) {
        if (isFeetInchesQuote(part, j)) {
          output += '&quot;'
          if (isEntity) j += 5
          continue
        }

        if (!inQuote) {
          output += '<span class="lx-prose-dialogue">&quot;'
          inQuote = true
        } else {
          output += '&quot;</span>'
          inQuote = false
        }
        if (isEntity) j += 5
      } else {
        output += part[j]
      }
    }
    result += output
  }

  if (inQuote) result += '</span>'

  return result
}

function addLazyLoadingToImages(html: string): string {
  return html.replace(/<img\b(?![^>]*\bloading=)/gi, '<img loading="lazy"')
}

interface MarkdownFence {
  marker: '`' | '~'
  length: number
}

function getMarkdownFence(line: string): MarkdownFence | null {
  const match = line.match(/^\s*(`{3,}|~{3,})/)
  if (!match) return null
  return { marker: match[1][0] as MarkdownFence['marker'], length: match[1].length }
}

/**
 * Escape ordered-list patterns that don't form intentional multi-item lists.
 * Prevents lines like "25. She felt old" from rendering as <ol start="25">.
 * Only preserves list formatting when 2+ consecutive numbered lines exist
 * (bridging blank lines between them).
 */
function escapeIsolatedOrderedListItems(text: string): string {
  const lines = text.split('\n')
  const n = lines.length
  const LIST_RE = /^\s*\d+\.\s/

  let fenced = false
  const inFence: boolean[] = []
  for (let i = 0; i < n; i++) {
    if (/^\s*(`{3,}|~{3,})/.test(lines[i])) fenced = !fenced
    inFence[i] = fenced
  }

  const isCand = lines.map((l, i) => !inFence[i] && LIST_RE.test(l))

  const isReal = new Array<boolean>(n).fill(false)
  let i = 0
  while (i < n) {
    if (!isCand[i]) { i++; continue }

    const members = [i]
    let j = i + 1
    while (j < n) {
      if (isCand[j]) {
        members.push(j)
        j++
      } else if (lines[j].trim() === '') {
        let k = j
        while (k < n && lines[k].trim() === '') k++
        if (k < n && isCand[k]) {
          j = k
        } else {
          break
        }
      } else {
        break
      }
    }

    if (members.length >= 2) {
      for (const m of members) isReal[m] = true
    }

    i = j
  }

  return lines.map((line, idx) => {
    if (isCand[idx] && !isReal[idx]) {
      return line.replace(/^(\s*\d+)\.\s/, '$1\\. ')
    }
    return line
  }).join('\n')
}

// ── formatContent (ported) ──────────────────────────────────────────────

export function formatContent(raw: string): string {
  if (!raw) return ''
  const healed = healFormattingArtifacts(raw)
  const normalized = normalizeQuotes(healed)
  const listSafe = escapeIsolatedOrderedListItems(normalized)
  let html = chatMarked.parse(listSafe, { async: false }) as string
  html = normalizeQuotesInHTML(html)
  html = normalizeLegacyFontTags(html)
  html = colorizeDialogue(html)
  html = addLazyLoadingToImages(html)
  return html
}

// ── formatContentPieces (ported, minus YouTube embeds) ──────────────────

export type ContentPiece =
  | { type: 'markup'; content: string }
  | { type: 'island'; content: string }

const SPECIAL_PIECE_RE = new RegExp(`<!--(${HTML_ISLAND_TOKEN})_(\\d+)-->`, 'g')

export function formatContentPieces(raw: string, isStreaming = false): ContentPiece[] {
  if (!raw) return []

  const { content, islands } = extractHtmlIslands(raw, isStreaming)

  if (islands.length === 0) {
    return [{ type: 'markup', content: sanitizeRichHtml(formatContent(raw)) }]
  }

  const html = formatContent(content)
  const pieces: ContentPiece[] = []
  let lastIdx = 0

  for (const m of html.matchAll(SPECIAL_PIECE_RE)) {
    const before = html.slice(lastIdx, m.index!)
    if (before.trim()) pieces.push({ type: 'markup', content: sanitizeRichHtml(before) })

    const idx = parseInt(m[2], 10)
    if (m[1] === HTML_ISLAND_TOKEN && islands[idx] != null) {
      pieces.push({ type: 'island', content: sanitizeHtmlIsland(processMarkdownInIsland(islands[idx])) })
    }

    lastIdx = m.index! + m[0].length
  }

  const after = html.slice(lastIdx)
  if (after.trim()) pieces.push({ type: 'markup', content: sanitizeRichHtml(after) })

  return pieces
}

// ── Shadow-DOM island mounting ──────────────────────────────────────────

function attachCodeCopyHandler(root: HTMLElement | ShadowRoot): () => void {
  const handleClick = (e: Event) => {
    const target = e.target
    if (!(target instanceof Element)) return

    const btn = target.closest('[data-code-copy]') as HTMLButtonElement | null
    if (!btn) return

    const codeBlock = btn.closest('.lx-code-block')
    const codeEl = codeBlock?.querySelector('code')
    if (!codeEl) return

    const text = codeEl.textContent || ''
    navigator.clipboard.writeText(text).then(() => {
      const label = btn.querySelector('span')
      if (label) {
        label.textContent = 'Copied'
        btn.classList.add('lx-code-copied')
        setTimeout(() => {
          label.textContent = 'Copy'
          btn.classList.remove('lx-code-copied')
        }, 2000)
      }
    }).catch((err) => {
      console.error('[luminote] Copy failed:', err)
    })
  }

  root.addEventListener('click', handleClick)
  return () => root.removeEventListener('click', handleClick)
}

// ── Public mounting API ─────────────────────────────────────────────────

export interface MountedRender {
  /** Re-render new markdown into the same container. */
  update(raw: string): void
  destroy(): void
}

export interface MountedIsland {
  el: HTMLElement
  /** Swap the island's inner markup (sanitized by the caller). */
  update(html: string): void
  destroy(): void
}

/**
 * Mount a single HTML island into an open shadow root with the island base
 * CSS — the same isolation Lumiverse chat uses (`data-lumiverse-html-island`
 * host + `data-lumi-island-base` style), so user `<style>` blocks stay scoped.
 * Shared by the reading-mode renderer and the live-preview island widget.
 * `html` must already be sanitized (sanitizeHtmlIsland / sanitizeRichHtml).
 */
export function mountHtmlIsland(html: string, options?: { lang?: string }): MountedIsland {
  const islandHost = document.createElement('div')
  islandHost.className = 'lx-html-island'
  islandHost.setAttribute('data-lumiverse-html-island', 'true')
  if (options?.lang) islandHost.dataset.islandLang = options.lang
  const shadow = islandHost.attachShadow({ mode: 'open' })

  const baseStyle = document.createElement('style')
  baseStyle.setAttribute('data-lumi-island-base', '')
  baseStyle.textContent = ISLAND_BASE_CSS
  shadow.appendChild(baseStyle)

  const chunk = document.createElement('div')
  chunk.innerHTML = html
  for (const img of chunk.querySelectorAll('img')) {
    if (!img.hasAttribute('loading')) img.setAttribute('loading', 'lazy')
  }
  shadow.appendChild(chunk)

  const removeCopyHandler = attachCodeCopyHandler(shadow)
  return {
    el: islandHost,
    update(next: string) {
      chunk.innerHTML = next
      for (const img of chunk.querySelectorAll('img')) {
        if (!img.hasAttribute('loading')) img.setAttribute('loading', 'lazy')
      }
    },
    destroy() {
      removeCopyHandler()
      shadow.replaceChildren()
    },
  }
}

/**
 * Mount the chat-parity render of `raw` into `container`. Markup pieces go
 * straight into the container; HTML islands are mounted into open shadow
 * roots with the island base CSS so their `<style>` blocks stay scoped —
 * identical to how Lumiverse chat renders styled HTML.
 */
export function mountRenderedMarkdown(container: HTMLElement, raw: string): MountedRender {
  const removeCopyHandler = attachCodeCopyHandler(container)
  let islands: MountedIsland[] = []

  const render = (markdown: string) => {
    const pieces = formatContentPieces(markdown)
    for (const island of islands) island.destroy()
    islands = []
    container.replaceChildren()

    for (const piece of pieces) {
      if (piece.type === 'markup') {
        const chunk = document.createElement('div')
        chunk.className = 'lx-markup-piece'
        chunk.innerHTML = piece.content
        container.appendChild(chunk)
        continue
      }

      const island = mountHtmlIsland(piece.content)
      islands.push(island)
      container.appendChild(island.el)
    }
  }

  render(raw)

  return {
    update(next: string) {
      render(next)
    },
    destroy() {
      removeCopyHandler()
      for (const island of islands) island.destroy()
      islands = []
      container.replaceChildren()
    },
  }
}

/** Sanitized inline HTML preview (used by the HTML/SVG note viewer). */
export function sanitizeForFrame(html: string): string {
  return sanitizeRichHtml(html)
}

export { escapeHtml }
