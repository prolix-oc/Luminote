/**
 * Ported from Lumiverse `MessageContent.tsx` (renderer configuration) plus
 * `frontend/src/lib/markedEmphasisRenderer.ts` and
 * `frontend/src/lib/markedTokenizer.ts`. Configures a dedicated `Marked`
 * instance that mirrors the chat render pipeline: GFM + breaks, emphasis
 * prose classes, strict `~~` tokenizer, hljs code blocks with a copy
 * button, and the same link/image/table overrides.
 * Keep in step with upstream.
 */
import { Marked, Renderer, Tokenizer } from 'marked'
import type { RendererThis, Tokens } from 'marked'
import { highlightCode } from './highlight'

// ── markedEmphasisRenderer.ts ───────────────────────────────────────────

interface EmphasisRendererOptions {
  emClass?: string
  strongClass?: string
  inlineEmphasisClass?: string
}

function wrapInlineTag(tag: 'em' | 'strong', className: string | undefined, inner: string): string {
  const classAttr = className ? ` class="${className}"` : ''
  return `<${tag}${classAttr}>${inner}</${tag}>`
}

export function createEmphasisAwareRenderer(options: EmphasisRendererOptions = {}) {
  const renderer = new Renderer()
  let emphasisDepth = 0

  renderer.em = function (this: RendererThis, token: Tokens.Em) {
    emphasisDepth += 1

    try {
      const inner = token.tokens ? this.parser.parseInline(token.tokens) : token.text

      if (emphasisDepth > 1) {
        return wrapInlineTag('strong', options.inlineEmphasisClass ?? options.strongClass, inner)
      }

      return wrapInlineTag('em', options.emClass, inner)
    } finally {
      emphasisDepth -= 1
    }
  }

  renderer.strong = function (this: RendererThis, token: Tokens.Strong) {
    const inner = token.tokens ? this.parser.parseInline(token.tokens) : token.text
    return wrapInlineTag('strong', options.strongClass, inner)
  }

  return renderer
}

// ── markedTokenizer.ts ──────────────────────────────────────────────────

const STRICT_DOUBLE_TILDE_DEL_RE = /^~~(?=[^\s~])((?:\\.|[^\\])*?(?:\\.|[^\s~\\]))~~(?=[^~]|$)/

export function createStrictTildeTokenizer() {
  const tokenizer = new Tokenizer()

  tokenizer.code = function (): Tokens.Code | undefined {
    return undefined
  }

  tokenizer.del = function (src: string): Tokens.Del | undefined {
    const cap = STRICT_DOUBLE_TILDE_DEL_RE.exec(src)
    if (!cap) return

    const text = cap[1]

    return {
      type: 'del',
      raw: cap[0],
      text,
      tokens: this.lexer.inlineTokens(text),
    }
  }

  return tokenizer
}

// ── MessageContent.tsx renderer configuration ───────────────────────────

export function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

const COPY_ICON_SVG = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>'

const renderer = createEmphasisAwareRenderer({
  emClass: 'lx-prose-italic',
  strongClass: 'lx-prose-bold',
  inlineEmphasisClass: 'lx-prose-inline-emphasis',
})

renderer.code = ({ text, lang }) => {
  const copyBtn = `<button type="button" class="lx-code-copy" data-code-copy title="Copy code">${COPY_ICON_SVG}<span>Copy</span></button>`
  if (lang) {
    const highlighted = highlightCode(text, lang)
    return `<div class="lx-code-block"><div class="lx-code-header"><span class="lx-code-lang">${escapeHtml(lang)}</span>${copyBtn}</div><pre><code class="hljs">${highlighted}</code></pre></div>`
  }
  if (text.includes('\n')) {
    const highlighted = highlightCode(text)
    return `<div class="lx-code-block"><div class="lx-code-header"><span class="lx-code-lang">text</span>${copyBtn}</div><pre><code class="hljs">${highlighted}</code></pre></div>`
  }
  return `<code>${escapeHtml(text)}</code>`
}

renderer.link = function ({ href, title, tokens }) {
  const inner = this.parser.parseInline(tokens)
  const titleAttr = title ? ` title="${escapeHtml(title)}"` : ''
  return `<a href="${escapeHtml(href || '')}"${titleAttr} target="_blank" rel="noopener noreferrer" class="lx-prose-link">${inner}</a>`
}

renderer.image = ({ href, title, text }) =>
  `<span class="lx-prose-image-wrap"><img src="${escapeHtml(href || '')}" alt="${escapeHtml(text || '')}"${title ? ` title="${escapeHtml(title)}"` : ''} class="lx-prose-image" data-lightbox /></span>`

renderer.table = function (token) {
  const headerCells = token.header.map((cell) => this.tablecell(cell)).join('')
  const headerRow = this.tablerow({ text: headerCells })
  const bodyRows = token.rows.map((row) => {
    const cells = row.map((cell) => this.tablecell(cell)).join('')
    return this.tablerow({ text: cells })
  }).join('')
  return `<table class="lx-prose-table"><thead>${headerRow}</thead><tbody>${bodyRows}</tbody></table>`
}

renderer.tablerow = ({ text }) => `<tr class="lx-prose-table-row">${text}</tr>`

renderer.tablecell = function (token) {
  const tag = token.header ? 'th' : 'td'
  const cls = token.header ? 'lx-prose-table-head' : 'lx-prose-table-cell'
  const alignAttr = token.align ? ` style="text-align:${token.align}"` : ''
  const inner = this.parser.parseInline(token.tokens)
  return `<${tag} class="${cls}"${alignAttr}>${inner}</${tag}>`
}

renderer.html = ({ text }) => text

export const chatMarked = new Marked({
  breaks: true,
  gfm: true,
  silent: true,
  renderer,
  tokenizer: createStrictTildeTokenizer(),
})
