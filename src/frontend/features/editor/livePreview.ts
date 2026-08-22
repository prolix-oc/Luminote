/**
 * Live-preview (WYSIWYG-ish) layer for the markdown source editor.
 *
 * A CodeMirror ViewPlugin that walks the markdown syntax tree and, for
 * lines the cursor/selection is NOT on, conceals formatting delimiters
 * (`#`, `**`, `*`, `~~`, backticks, quote/list marks, link machinery)
 * while tagging the content with styled classes — headings scale up,
 * bold/italic color like chat prose, inline code gets a chip. On the
 * cursor line everything falls back to raw markdown so the text stays
 * editable, mirroring Obsidian's live preview.
 *
 * HTML/SVG islands: a fenced ```html / ```svg block — or a substantial raw
 * HTML block — whose range has no cursor inside collapses into a rendered
 * shadow-DOM island (see liveIslands.ts). Raw `<svg>` blocks render inline
 * in the light DOM instead (matching reading mode), including single-line
 * SVGs. Clicking the island drops the caret back into the source for editing.
 *
 * This is an editor-only concern: the reading-mode view renders the same
 * markdown through the full chat-parity pipeline instead.
 *
 * Implementation note: CodeMirror forbids BLOCK decorations (like the
 * island replace widgets) in plugin-provided decoration sets, so islands
 * live in a StateField surfaced via EditorView.decorations.from(field);
 * the inline conceal/style marks stay in the viewport-scoped ViewPlugin.
 */
import { Decoration, EditorView, ViewPlugin } from '@codemirror/view'
import type { DecorationSet, ViewUpdate } from '@codemirror/view'
import { syntaxTree } from '@codemirror/language'
import { StateField, type Extension, type Range } from '@codemirror/state'
import {
  absorbHtmlRun,
  inlineSvgDecorationFor,
  islandDecorationFor,
  islandLangForFence,
  isLoneCommentBlock,
  rawHtmlIsIsland,
  singleLineSvgRange,
} from './liveIslands'

const HIDE = Decoration.replace({})

const HEADING_LINE_CLASS: Record<string, string> = {
  ATXHeading1: 'lx-lp-h1',
  ATXHeading2: 'lx-lp-h2',
  ATXHeading3: 'lx-lp-h3',
  ATXHeading4: 'lx-lp-h4',
  ATXHeading5: 'lx-lp-h5',
  ATXHeading6: 'lx-lp-h6',
  SetextHeading1: 'lx-lp-h1',
  SetextHeading2: 'lx-lp-h2',
}

const MARK_CLASS: Record<string, string> = {
  Emphasis: 'lx-lp-em',
  StrongEmphasis: 'lx-lp-strong',
  Strikethrough: 'lx-lp-strike',
  InlineCode: 'lx-lp-code',
  FencedCode: 'lx-lp-fenced',
  Blockquote: 'lx-lp-quote',
  URL: 'lx-lp-url',
  Link: 'lx-lp-link',
  HorizontalRule: 'lx-lp-hr',
}

/** Mark node types hidden when their line has no cursor. */
const CONCEALABLE_MARKS = new Set([
  'HeaderMark',
  'EmphasisMark',
  'StrikethroughMark',
  'CodeMark',
  'QuoteMark',
  'LinkMark',
  'ListMark',
  'SetextMark',
])

// ── HTML/SVG islands (block replace decorations — must come from a state
// field, not a plugin) ──

function buildIslandDecorations(state: EditorView['state']): DecorationSet {
  const ranges: Array<Range<Decoration>> = []
  const selectionTouches = (from: number, to: number): boolean =>
    state.selection.ranges.some((r) => r.from <= to && r.to >= from)
  // Syntax nodes fully inside a merged raw-HTML island must not spawn their
  // own (CommonMark splits raw HTML at blank lines; chat treats the whole
  // tag-balanced run as one island).
  let absorbedUntil = -1

  syntaxTree(state).iterate({
    enter(node) {
      const { name } = node
      if (node.from < absorbedUntil) return false
      if (name === 'FencedCode') {
        const infoNode = node.node.getChild('CodeInfo')
        if (infoNode) {
          const lang = islandLangForFence(state.sliceDoc(infoNode.from, infoNode.to))
          if (lang !== null && !selectionTouches(node.from, node.to)) {
            absorbedUntil = node.to
            const fenceOpenEnd = state.doc.lineAt(node.from).to
            const fenceCloseLine = state.doc.lineAt(node.to)
            const codeStart = Math.min(fenceOpenEnd + 1, node.to)
            const codeText = node.node.getChild('CodeText')
            const codeEnd = codeText ? codeText.to : fenceCloseLine.from
            ranges.push(islandDecorationFor(
              state,
              node.from,
              node.to,
              state.sliceDoc(codeStart, Math.max(codeStart, codeEnd - 1)),
              lang,
              codeStart,
            ))
            return false
          }
        }
      }

      // @lezer/markdown parses a lone `<!-- … -->` line as CommentBlock (not
      // HTMLBlock), so chat-style UI_START markers must match here too — the
      // lone-comment lead-in logic below then swallows the marker into the
      // island instead of leaving it visible above the rendered body.
      if ((name === 'HTMLBlock' || name === 'CommentBlock') && !selectionTouches(node.from, node.to)) {
        let start = node.from
        let probeTo = node.to
        if (isLoneCommentBlock(state.sliceDoc(node.from, node.to))) {
          // UI_START-style lead-in: a lone comment block only becomes part
          // of an island when a tag run follows (blank lines allowed).
          let lineNum = state.doc.lineAt(node.to).number + 1
          while (lineNum <= state.doc.lines && state.doc.line(lineNum).text.trim() === '') lineNum += 1
          if (lineNum > state.doc.lines) return undefined
          const next = state.doc.line(lineNum).text
          if (!/^\s*<(?!!--)/.test(next)) return undefined
          probeTo = state.doc.line(lineNum).to
        } else if (name === 'CommentBlock') {
          // Pure comment blocks (no tag run after) stay visible raw source.
          return undefined
        }
        const merged = absorbHtmlRun(state, start, probeTo)
        const raw = state.sliceDoc(merged.from, merged.to)
        if (!rawHtmlIsIsland(raw)) return undefined
        const commentless = raw.replace(/^\s*(<!--[\s\S]*?-->\s*)+/, '')
        const lang = /^\s*<\s*svg\b/i.test(commentless) ? 'svg' : 'html'
        absorbedUntil = merged.to
        // Raw SVGs render inline (light DOM, no shadow island) to match
        // reading mode — only HTML keeps the shadow-DOM island treatment.
        if (lang === 'svg') {
          ranges.push(inlineSvgDecorationFor(state, merged.from, merged.to, commentless, merged.from))
        } else {
        ranges.push(islandDecorationFor(state, merged.from, merged.to, raw, lang, merged.from))
        }
        return false
      }

      // A single-line `<svg>…</svg>` parses as inline HTMLTag nodes inside a
      // Paragraph (multi-line SVG becomes an HTMLBlock above). Render it
      // inline too, so "oneline" SVG notes behave like reading mode instead
      // of leaving raw source visible. When text sits directly above/below
      // (no blank line) the SVG shares that Paragraph with the text, so scan
      // the paragraph's lines rather than testing the whole paragraph text.
      if (name === 'Paragraph') {
        const svg = singleLineSvgRange(state, node.from, node.to)
        if (svg) {
          if (!selectionTouches(svg.from, svg.to)) {
            absorbedUntil = svg.to
            const raw = state.sliceDoc(svg.from, svg.to).trim()
            ranges.push(inlineSvgDecorationFor(state, svg.from, svg.to, raw, svg.from))
            return false
          }
        }
      }
      return undefined
    },
  })

  return Decoration.set(ranges, true)
}

const islandField = StateField.define<DecorationSet>({
  create: (state) => buildIslandDecorations(state),
  update(_deco, tr) {
    const treeChanged = syntaxTree(tr.state) !== syntaxTree(tr.startState)
    if (!tr.docChanged && !tr.selection && !treeChanged) return _deco
    return buildIslandDecorations(tr.state)
  },
})

/** Block island decorations, legally surfaced from a state field. */
const islandDecorations: Extension = [islandField, EditorView.decorations.from(islandField)]

// ── Inline conceal/style marks (viewport-scoped ViewPlugin) ──

function buildDecorations(view: EditorView): DecorationSet {
  const ranges: Array<Range<Decoration>> = []

  const cursorLines = new Set<number>()
  const { state } = view
  for (const range of state.selection.ranges) {
    const fromLine = state.doc.lineAt(range.from).number
    const toLine = state.doc.lineAt(range.to).number
    for (let line = fromLine; line <= toLine; line++) cursorLines.add(line)
  }

  const lineActive = (from: number, to: number): boolean => {
    const fromLine = state.doc.lineAt(from).number
    const toLine = state.doc.lineAt(to).number
    for (let line = fromLine; line <= toLine; line++) {
      if (cursorLines.has(line)) return true
    }
    return false
  }

  for (const { from, to } of view.visibleRanges) {
    syntaxTree(state).iterate({
      from,
      to,
      enter(node) {
        const { name } = node

        // Island blocks (```html/```svg fences + substantial raw HTML) are
        // handled by the state field above — skip their subtrees here so
        // their fence/source marks are never doubly concealed.
        if (name === 'FencedCode') {
          const infoNode = node.node.getChild('CodeInfo')
          if (infoNode && islandLangForFence(state.sliceDoc(infoNode.from, infoNode.to)) !== null) {
            return false
          }
        }
        if (name === 'HTMLBlock' && rawHtmlIsIsland(state.sliceDoc(node.from, node.to))) {
          return false
        }

        const active = lineActive(node.from, node.to)

        const lineClass = HEADING_LINE_CLASS[name]
        if (lineClass) {
          const lineFrom = state.doc.lineAt(node.from).from
          ranges.push({ from: lineFrom, to: lineFrom, value: Decoration.line({ class: lineClass }) })
          return undefined
        }

        if (CONCEALABLE_MARKS.has(name)) {
          if (!active && node.from < node.to) ranges.push({ from: node.from, to: node.to, value: HIDE })
          return undefined
        }

        const markClass = MARK_CLASS[name]
        if (markClass) {
          if (name === 'URL' && active) return undefined
          if (name === 'HorizontalRule' && !active) {
            // A divider painted as a LINE decoration (the `---` marks turn
            // transparent): zero layout geometry change, so the gutter can
            // never drift against the content the way a 0-height block did.
            const lineFrom = state.doc.lineAt(node.from).from
            ranges.push({ from: lineFrom, to: lineFrom, value: Decoration.line({ class: 'lx-lp-hr-line' }) })
            ranges.push({ from: node.from, to: node.to, value: Decoration.mark({ class: 'lx-lp-hr' }) })
            return undefined
          }
          ranges.push({ from: node.from, to: node.to, value: Decoration.mark({ class: markClass }) })
          if (name === 'FencedCode' || name === 'Blockquote') return false
          return undefined
        }

        return undefined
      },
    })
  }

  return Decoration.set(ranges as Range<Decoration>[], true)
}

const inlinePreviewPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet

    constructor(view: EditorView) {
      this.decorations = buildDecorations(view)
    }

    update(update: ViewUpdate): void {
      const treeChanged = syntaxTree(update.state) !== syntaxTree(update.startState)
      if (update.docChanged || update.selectionSet || update.viewportChanged || treeChanged) {
        this.decorations = buildDecorations(update.view)
      }
      if (treeChanged) {
        // Heading/HR line classes only appear once the async parse lands —
        // without a fresh measure the gutter keeps the placeholder line
        // heights and drifts out of step with the taller content lines.
        update.view.requestMeasure()
      }
    }
  },
  { decorations: (plugin) => plugin.decorations },
)

/** Full live-preview extension: inline conceals + block HTML/SVG islands. */
export const livePreviewPlugin: Extension = [islandDecorations, inlinePreviewPlugin]
