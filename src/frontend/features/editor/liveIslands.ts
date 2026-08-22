/**
 * Live-preview HTML/SVG islands — CodeMirror widget bridge.
 *
 * In Live preview mode a fenced ```html / ```svg block (or a substantial raw
 * HTML block) collapses into a rendered, shadow-DOM-isolated island whenever
 * the cursor/selection is OUTSIDE the block — exactly like reading mode.
 * Clicking the island moves the caret inside the block, which re-reveals the
 * raw markup for editing; clicking outside re-renders the island. This keeps
 * one editable source of truth instead of separate .html/.svg notes.
 *
 * Raw `<svg>` blocks are the exception: they render INLINE in the light DOM
 * (InlineSvgWidget below) with no shadow island — matching reading mode's
 * inline SVG, since the SVG sanitizer already hardens them (local refs only,
 * `feimage`/`image` blocklist). Single-line SVGs are handled too, since
 * @lezer/markdown parses them as inline HTMLTag nodes inside a Paragraph.
 *
 * The island host mirrors Lumiverse chat's structure so host tokens still
 * apply: `<div class="lx-html-island" data-lumiverse-html-island="true">` with
 * a shadow root containing `<style data-lx-island-base>` (reset + theme
 * forwards incl. scrollbars) and an empty `<style data-lx-island-user>` hook
 * the user can target for their own island styling experiments.
 */
import { Decoration, WidgetType, EditorView } from '@codemirror/view'
import type { EditorState } from '@codemirror/state'
import { mountHtmlIsland, type MountedIsland } from '../../render/render'
import { sanitizeHtmlIsland, sanitizeRichHtml } from '../../render/sanitize'
import { el } from '../../dom'
import { icon } from '../../icons'

export type IslandLang = 'html' | 'svg'

/** Fence/info strings that collapse into a rendered island. */
const FENCE_ISLAND_LANGS: Record<string, IslandLang> = {
  html: 'html',
  xhtml: 'html',
  svg: 'svg',
}

export function islandLangForFence(info: string): IslandLang | null {
  const first = info.trim().toLowerCase().split(/\s+/)[0] ?? ''
  return FENCE_ISLAND_LANGS[first] ?? null
}

/**
 * Raw (unfenced) HTML blocks become islands only when they carry enough
 * structure to be meaningful: a <style> tag, inline styling, an <svg> root
 * or more than one tag. Keeps stray `<br>`-style inline html editable.
 */
const RAW_ISLAND_HINT_RE = /<\s*(style|svg)\b|\bstyle\s*=/i
const RAW_ISLAND_MIN_TAGS = 2

export function rawHtmlIsIsland(source: string): boolean {
  if (source.trim().length === 0) return false
  if (RAW_ISLAND_HINT_RE.test(source)) return true
  const tags = source.match(/<\s*[a-z][\w:-]*(\s|>|\/)/gi)
  return !!tags && tags.length >= RAW_ISLAND_MIN_TAGS
}

/** A block that is exactly one HTML comment (e.g. chat's island markers). */
const LONE_COMMENT_RE = /^\s*<!--[\s\S]*?-->\s*$/

export function isLoneCommentBlock(text: string): boolean {
  return LONE_COMMENT_RE.test(text)
}

/**
 * A single-line raw `<svg>…</svg>` — the whole line is exactly one SVG root.
 * @lezer/markdown parses a one-line SVG as inline `HTMLTag` nodes inside a
 * `Paragraph` (only a multi-line block becomes an `HTMLBlock`), so live
 * preview needs its own detector to render it inline like reading mode.
 */
export function isSingleLineSvg(text: string): boolean {
  if (text.includes('\n')) return false
  const trimmed = text.trim()
  return /^<svg\b/i.test(trimmed) && /<\/svg>\s*$/i.test(trimmed)
}

/**
 * Find the range of a complete single-line `<svg>…</svg>` inside `[from, to]`.
 * Unlike `isSingleLineSvg` (which tests one exact string), this scans each
 * full line of the given range, so an SVG sitting between adjacent text lines
 * — no blank lines, where the whole run is a single `Paragraph` — is still
 * detected and rendered instead of reverting to raw source.
 */
export function singleLineSvgRange(
  state: EditorState,
  from: number,
  to: number,
): { from: number; to: number } | null {
  const startLine = state.doc.lineAt(from).number
  const endLine = state.doc.lineAt(to).number
  for (let n = startLine; n <= endLine; n++) {
    const line = state.doc.line(n)
    // Only a line that sits entirely inside the range can be a complete
    // single-line SVG (a partial first/last line cannot).
    if (line.from < from || line.to > to) continue
    if (isSingleLineSvg(line.text)) return { from: line.from, to: line.to }
  }
  return null
}

// ── Tag-balance run absorption (chat-parity island extents) ─────────────
// CM's markdown parser ends raw HTML blocks at blank lines, but chat
// islands treat a tag-balanced run as ONE unit regardless of interior
// blank lines — the stylesheet, inputs, and body fragments must land in a
// single shadow root or their :checked/sibling selectors break.
// absorbHtmlRun reproduces the chat scan for the live editor.

const VOID_TAGS = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input',
  'link', 'meta', 'param', 'source', 'track', 'wbr',
])
const RAW_TEXT_TAGS = new Set(['style', 'script', 'textarea', 'title'])
/** Never scan more than this past a block start (runaway-document guard). */
const ABSORB_CAP = 512_000

function findTagEnd(text: string, openIndex: number): number {
  let quote: string | null = null
  for (let i = openIndex; i < text.length; i += 1) {
    const ch = text[i]
    if (quote !== null) {
      if (ch === quote) quote = null
      continue
    }
    if (ch === '"' || ch === "'") quote = ch
    else if (ch === '>') return i
  }
  return -1
}

/**
 * Starting at a raw HTML block's `from`, scan forward tracking open tags
 * until the run balances (or the doc ends / the scan cap hits). The result
 * spans every blank-line-split fragment. An immediately following lone
 * comment line (the UI_END-style marker) is absorbed as well.
 */
export function absorbHtmlRun(
  state: EditorState,
  from: number,
  initialTo: number,
): { from: number; to: number } {
  const text = state.sliceDoc(from, Math.min(state.doc.length, from + ABSORB_CAP))
  const minEnd = initialTo - from
  const stack: string[] = []
  let end = minEnd
  let pos = 0

  while (pos < text.length) {
    const lt = text.indexOf('<', pos)
    if (lt === -1) break

    if (text.startsWith('<!--', lt)) {
      const close = text.indexOf('-->', lt + 4)
      if (close === -1) { end = text.length; break }
      pos = close + 3
      continue
    }
    if (text.startsWith('<!', lt) || text.startsWith('<?', lt)) {
      const gt = findTagEnd(text, lt + 2)
      if (gt === -1) { end = text.length; break }
      pos = gt + 1
      continue
    }

    const head = /^<(\/?)([a-zA-Z][\w:-]*)/.exec(text.slice(lt, lt + 80))
    if (!head) { pos = lt + 1; continue }
    const closing = head[1] === '/'
    const name = head[2].toLowerCase()
    const gt = findTagEnd(text, lt + head[0].length)
    if (gt === -1) { end = text.length; break }
    const rawTag = text.slice(lt, gt + 1)

    if (closing) {
      const idx = stack.lastIndexOf(name)
      if (idx !== -1) stack.length = idx // pop the match and anything above it
      pos = gt + 1
    } else if (!rawTag.endsWith('/>') && !VOID_TAGS.has(name)) {
      stack.push(name)
      pos = gt + 1
      if (RAW_TEXT_TAGS.has(name)) {
        // Raw-text element: nothing until the matching close counts as tags.
        const rest = text.slice(pos)
        const closeRe = new RegExp(`</${name}\\s*>`, 'i')
        const closeMatch = closeRe.exec(rest)
        stack.pop()
        if (!closeMatch) { end = text.length; break }
        pos += closeMatch.index + closeMatch[0].length
      }
    } else {
      pos = gt + 1
    }

    if (stack.length === 0) {
      end = Math.max(minEnd, pos)
      // Absorb one immediately-following lone comment line (UI_END markers).
      if (text[end] === '\n') {
        const after = text.slice(end + 1)
        const cmt = /^[^\S\n]*<!--[\s\S]*?-->[^\S\n]*(?=\n|$)/.exec(after)
        if (cmt) end += 1 + cmt[0].length
      }
      break
    }
    end = Math.max(end, pos)
  }

  if (stack.length > 0) end = text.length // unbalanced: rest of stream (chat parity)
  return { from, to: from + end }
}

/** SVG sources get a default center-fit flex frame like the .svg note preview.
 *  A viewBox-only <svg> (no width attr) has no intrinsic size and would
 *  collapse to 0px — force a bounded width so it always renders. */
const SVG_FRAME = `<style>
  :host { display: flex; align-items: center; justify-content: center; }
  svg { max-width: 100%; max-height: 420px; }
  svg:not([width]) { width: min(420px, 100%); }
</style>`

class HtmlIslandWidget extends WidgetType {
  constructor(
    readonly rawSource: string,
    readonly lang: IslandLang,
    /** Where the caret should land when the island is clicked into edit mode. */
    readonly caretFrom: number,
  ) {
    super()
  }

  override eq(other: HtmlIslandWidget): boolean {
    return other.rawSource === this.rawSource && other.lang === this.lang
  }

  toDOM(view: EditorView): HTMLElement {
    const trimmed = this.rawSource.trim()
    const host = document.createElement('div')
    host.className = `lx-live-island lx-live-island-${this.lang}`
    host.setAttribute('role', 'group')
    host.setAttribute('data-lx-island-badge', trimmed ? this.lang : `${this.lang} · empty`)

    const enterEdit = (event: Event): void => {
      event.preventDefault()
      event.stopPropagation()
      const pos = Math.min(this.caretFrom, view.state.doc.length)
      view.dispatch({ selection: { anchor: pos }, scrollIntoView: true })
      view.focus()
    }

    // Header strip — the ONLY editing affordance. The rendered body stays
    // fully interactive (labels, radios, links, details…), like reading mode.
    const editBtn = el('button', {
      class: 'lx-icon-btn lx-live-island-edit',
      title: 'Edit island source',
      attrs: { type: 'button', 'aria-label': 'Edit island source' },
    }, icon('pencil', 11.5))
    const header = el('div', {
      class: 'lx-live-island-header',
      title: 'Edit island source',
      attrs: { role: 'button', tabindex: '0', 'aria-label': `Edit ${this.lang} island source` },
    },
      icon(this.lang === 'svg' ? 'fileImage' : 'fileCode', 12),
      el('span', { class: 'lx-live-island-title', text: `${this.lang.toUpperCase()} island` }),
      editBtn,
    )
    header.addEventListener('mousedown', enterEdit)
    header.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') enterEdit(event)
    })

    const sanitized = !trimmed
      ? ''
      : this.lang === 'svg'
        ? SVG_FRAME + sanitizeRichHtml(this.rawSource)
        : sanitizeHtmlIsland(this.rawSource)

    const island: MountedIsland = mountHtmlIsland(sanitized, { lang: this.lang })
    // Mirrors upstream chat's `<style data-lumi-island-base>` + user `<style>`
    // pair: a stable, documented slot for personal island styling experiments.
    // (An island's own <style> tags land AFTER this one, so mine win ties.)
    const userStyle = document.createElement('style')
    userStyle.setAttribute('data-lx-island-user', '')
    const shadow = island.el.shadowRoot
    if (shadow) shadow.insertBefore(userStyle, shadow.firstChild?.nextSibling ?? null)
    if (!trimmed) {
      const hint = document.createElement('span')
      hint.className = 'lx-live-island-empty'
      hint.textContent = 'Empty island — edit the source to write markup'
      island.el.appendChild(hint)
    }

    host.append(header, island.el)
    return host
  }

  override ignoreEvent(): boolean {
    // The widget owns its events (mousedown → edit) — CodeMirror must not map
    // clicks onto the concealed block range.
    return true
  }

  override get estimatedHeight(): number {
    // A rough pre-measure hint proportional to source size — tight enough
    // that CodeMirror's post-mount measurement correction barely shifts the
    // layout (large corrections behind pointer clicks steal hit targets).
    const lines = this.rawSource.split('\n').length
    return Math.min(480, Math.max(40, lines * 14))
  }
}

/**
 * Push one replace-decoration that conceals `from..to` with a rendered island.
 * Caller guarantees the selection is outside the range.
 */
export function islandDecorationFor(
  state: EditorState,
  from: number,
  to: number,
  rawSource: string,
  lang: IslandLang,
  caretFrom: number,
): { from: number; to: number; value: Decoration } {
  return {
    from,
    to,
    value: Decoration.replace({
      widget: new HtmlIslandWidget(rawSource, lang, caretFrom),
      block: true,
    }),
  }
}

/**
 * Inline SVG widget — renders a raw `<svg>` block directly in the LIGHT DOM
 * (no shadow root, no island header strip), matching reading mode's inline
 * SVG rendition. `sanitizeRichHtml` already allows inline SVG with the full
 * upstream hardening (local `#ref`/`url()` checks, `feimage`/`image` blocklist,
 * etc.), so no island isolation is needed — the SVG is just sanitized markup.
 * Clicking still drops the caret back into the source for editing.
 */
class InlineSvgWidget extends WidgetType {
  constructor(
    readonly rawSource: string,
    /** Where the caret should land when the widget is clicked into edit mode. */
    readonly caretFrom: number,
  ) {
    super()
  }

  override eq(other: InlineSvgWidget): boolean {
    return other.rawSource === this.rawSource
  }

  toDOM(view: EditorView): HTMLElement {
    const host = document.createElement('div')
    host.className = 'lx-live-svg'
    host.setAttribute('role', 'group')
    host.setAttribute('title', 'Edit SVG source')

    const enterEdit = (event: Event): void => {
      event.preventDefault()
      event.stopPropagation()
      const pos = Math.min(this.caretFrom, view.state.doc.length)
      view.dispatch({ selection: { anchor: pos }, scrollIntoView: true })
      view.focus()
    }
    host.addEventListener('mousedown', enterEdit)

    const frame = document.createElement('div')
    frame.className = 'lx-live-svg-frame'
    frame.innerHTML = sanitizeRichHtml(this.rawSource)
    host.appendChild(frame)

    return host
  }

  override ignoreEvent(): boolean {
    return true
  }

  override get estimatedHeight(): number {
    const lines = this.rawSource.split('\n').length
    return Math.min(480, Math.max(40, lines * 14))
  }
}

/** Replace-decoration for a raw `<svg>` block rendered inline (no island). */
export function inlineSvgDecorationFor(
  state: EditorState,
  from: number,
  to: number,
  rawSource: string,
  caretFrom: number,
): { from: number; to: number; value: Decoration } {
  return {
    from,
    to,
    value: Decoration.replace({
      widget: new InlineSvgWidget(rawSource, caretFrom),
      block: true,
    }),
  }
}
