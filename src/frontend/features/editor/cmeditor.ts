/**
 * Per-leaf editor host (internal to the editor feature).
 *
 * One CodeMirror instance per leaf serves Source and Live-preview modes
 * (the live layer is a reconfigurable compartment). Reading mode swaps in
 * the chat-parity renderer for markdown, or a sandboxed frame for HTML and
 * SVG notes, so the same leaf covers all three documented editors.
 */
import { EditorState, Compartment } from '@codemirror/state'
import {
  EditorView,
  keymap,
  highlightActiveLine,
  highlightActiveLineGutter,
  lineNumbers,
  drawSelection,
  dropCursor,
  highlightSpecialChars,
} from '@codemirror/view'
import {
  defaultKeymap,
  history,
  historyKeymap,
  indentWithTab,
} from '@codemirror/commands'
import {
  bracketMatching,
  indentOnInput,
  syntaxHighlighting,
} from '@codemirror/language'
import {
  closeBrackets,
  closeBracketsKeymap,
} from '@codemirror/autocomplete'
import {
  highlightSelectionMatches,
  search,
  searchKeymap,
} from '@codemirror/search'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import {
  type LuminoteSettings,
  type ViewMode,
  type VaultEntry,
} from '../../../shared/model'
import { mountRenderedMarkdown, type MountedRender } from '../../render/render'
import { livePreviewPlugin } from './livePreview'
import type { RpcClient } from '../../rpc'
import type { PaneStats, SaveState } from '../../state'
import { editorTheme, lumiverseHighlight } from '../../styles'

// ── Types ───────────────────────────────────────────────────────────────

export interface LeafEditorEvents {
  onDirtyStateChange(state: SaveState): void
  onStats(stats: PaneStats): void
  onSaved(modifiedAt: number): void
  onToast(message: string): void
}

export interface LeafEditorHandle {
  readonly entryId: string | null
  readonly lastModified: number | null
  readonly saveState: SaveState
  currentStats(): PaneStats | null
  /** Live buffer contents (undefined while nothing is open). */
  currentContent(): string | undefined
  /** Caret anchor offset in the CM surface (null while unmounted/reading). */
  currentCaret(): number | null
  setCaret(anchor: number | null): void
  /** Scroller scrollTop of the current surface (null while unmounted). */
  currentScroll(): number | null
  setScroll(top: number | null): void
  open(entry: VaultEntry): Promise<void>
  setMode(mode: ViewMode): void
  getMode(): ViewMode
  applySettings(settings: LuminoteSettings): void
  saveNow(): Promise<boolean>
  /** Fold a save from another pane viewing the same entry into this copy. */
  applyExternalContent(next: string, modifiedAt: number): void
  clear(): void
  destroy(): void
}

// ── Stats ───────────────────────────────────────────────────────────────

export function computeStats(content: string): PaneStats {
  const trimmedWords = content.split(/\s+/).filter((w) => w.length > 0)
  return {
    words: trimmedWords.length,
    characters: content.length,
    lines: content.length === 0 ? 0 : content.split('\n').length,
    tokens: Math.ceil(content.length / 4),
  }
}

// ── Leaf editor ─────────────────────────────────────────────────────────

export function createLeafEditor(
  hostEl: HTMLElement,
  deps: {
    rpc: RpcClient
    vaultId: () => string | null
    events: LeafEditorEvents
  },
): LeafEditorHandle {
  let entry: VaultEntry | null = null
  let entryId: string | null = null
  let content = ''
  let lastModified: number | null = null
  let saveState: SaveState = 'saved'
  let destroyed = false

  let view: EditorView | null = null
  let renderMount: MountedRender | null = null
  let saveTimer: ReturnType<typeof setTimeout> | null = null
  let statsTimer: ReturnType<typeof setTimeout> | null = null
  let settingsSnapshot: LuminoteSettings | null = null
  let modeOverride: ViewMode | null = null
  /** Set while a programmatic doc replace runs so it isn't read as an edit. */
  let applyingRemoteContent = false

  const wrapCompartment = new Compartment()
  const gutterCompartment = new Compartment()
  const readOnlyCompartment = new Compartment()
  const spellcheckCompartment = new Compartment()
  const liveCompartment = new Compartment()
  const autoPairCompartment = new Compartment()

  function effectiveMode(): ViewMode {
    return modeOverride ?? settingsSnapshot?.editor.viewMode ?? 'live'
  }

  function languageExtension() {
    // No codeLanguages registry: @codemirror/language-data ships every
    // @codemirror/lang-* package (~40 MB of node_modules) just to tint fenced
    // code in Source mode. Reading mode still highlights via highlight.js.
    return markdown({ base: markdownLanguage })
  }

  function buildView(preserveAnchor?: number): EditorView {
    const settings = settingsSnapshot
    const state = EditorState.create({
      doc: content,
      // Mode switches rebuild the view — keep the caret where the user had
      // it (Obsidian parity), clamped into the current doc range.
      selection: preserveAnchor !== undefined
        ? { anchor: Math.max(0, Math.min(preserveAnchor, content.length)) }
        : undefined,
      extensions: [
        gutterCompartment.of(settings?.editor.lineNumbers === false ? [] : lineNumbers()),
        wrapCompartment.of(settings?.editor.wordWrap === false ? [] : EditorView.lineWrapping),
        spellcheckCompartment.of(
          EditorView.contentAttributes.of({ spellcheck: settings?.editor.spellcheck ? 'true' : 'false' }),
        ),
        readOnlyCompartment.of([
          EditorState.readOnly.of(false),
          EditorView.editable.of(true),
        ]),
        liveCompartment.of(effectiveMode() === 'live' ? [livePreviewPlugin] : []),
        highlightSpecialChars(),
        history(),
        drawSelection(),
        dropCursor(),
        EditorState.allowMultipleSelections.of(true),
        indentOnInput(),
        bracketMatching(),
        // Auto-pair brackets: gated by the editor setting, live-togglable.
        autoPairCompartment.of(settings?.editor.autoPair === false ? [] : closeBrackets()),
        highlightActiveLine(),
        highlightActiveLineGutter(),
        highlightSelectionMatches(),
        search({ top: true }),
        languageExtension(),
        syntaxHighlighting(lumiverseHighlight, { fallback: true }),
        editorTheme,
        keymap.of([
          {
            key: 'Mod-s',
            preventDefault: true,
            run: () => {
              void saveNow()
              return true
            },
          },
          ...closeBracketsKeymap,
          ...defaultKeymap,
          ...searchKeymap,
          ...historyKeymap,
          indentWithTab,
        ]),
        EditorView.updateListener.of((update) => {
          if (!update.docChanged || destroyed) return
          content = update.state.doc.toString()
          if (applyingRemoteContent) return
          markDirty()
        }),
      ],
    })

    return new EditorView({ state, parent: hostEl })
  }

  function markDirty(): void {
    if (!entryId) {
      // Buffer content of a cleared leaf; nothing to persist.
      return
    }
    saveState = 'dirty'
    deps.events.onDirtyStateChange('dirty')
    scheduleAutosave()
    scheduleStats()
  }

  function scheduleAutosave(): void {
    const delay = settingsSnapshot?.editor.autosaveMs ?? 1200
    if (saveTimer) clearTimeout(saveTimer)
    if (delay <= 0) return
    saveTimer = setTimeout(() => {
      void saveNow()
    }, delay)
  }

  function scheduleStats(): void {
    if (statsTimer) clearTimeout(statsTimer)
    statsTimer = setTimeout(() => deps.events.onStats(computeStats(content)), 400)
  }

  async function saveNow(): Promise<boolean> {
    if (saveTimer) {
      clearTimeout(saveTimer)
      saveTimer = null
    }
    const vaultId = deps.vaultId()
    if (!entryId || !vaultId || saveState === 'saving') return true
    saveState = 'saving'
    deps.events.onDirtyStateChange('saving')
    try {
      const result = await deps.rpc.call<{ modifiedAt: number }>('note.write', {
        vaultId,
        entryId,
        content,
      })
      if (destroyed) return true
      lastModified = result.modifiedAt
      saveState = 'saved'
      deps.events.onSaved(result.modifiedAt)
      return true
    } catch (err) {
      // 'error' surfaces the failure state in the status bar; the content is
      // still dirty in memory, and the next edit or explicit retry re-saves.
      saveState = 'error'
      deps.events.onDirtyStateChange('error')
      deps.events.onToast(err instanceof Error ? err.message : 'Save failed')
      return false
    }
  }

  /**
   * Push content saved by ANOTHER pane viewing the same entry into this
   * editor without touching dirty buffers. No-op while this copy has
   * unsaved changes (its own autosave is the authoritative write).
   */
  function applyExternalContent(next: string, modifiedAt: number): void {
    if (destroyed || !entryId) return
    if (saveState !== 'saved') return
    if (modifiedAt === lastModified || next === content) {
      lastModified = Math.max(lastModified ?? 0, modifiedAt)
      return
    }
    content = next
    lastModified = modifiedAt
    if (view) {
      const sel = view.state.selection.main
      applyingRemoteContent = true
      try {
        view.dispatch({
          changes: { from: 0, to: view.state.doc.length, insert: next },
          selection: { anchor: Math.min(sel.anchor, next.length) },
        })
      } finally {
        applyingRemoteContent = false
      }
    } else if (renderMount) {
      renderMount.update(next)
    }
    deps.events.onStats(computeStats(content))
  }

  // ── View mode management ──

  function teardownReading(): void {
    if (renderMount) {
      renderMount.destroy()
      renderMount = null
    }
  }

  function teardownEditor(): void {
    if (view) {
      view.destroy()
      view = null
    }
  }

  function mountMode(): void {
    const anchor = view?.state.selection.main.anchor
    teardownReading()
    teardownEditor()
    hostEl.replaceChildren()

    if (!entry) return

    const mode = effectiveMode()
    if (mode === 'reading') {
      renderMount = mountRenderedMarkdown(hostEl, content)
      return
    }

    view = buildView(anchor)
    deps.events.onStats(computeStats(content))
  }

  function setMode(mode: ViewMode): void {
    modeOverride = mode
    if (saveState === 'dirty') void saveNow()
    mountMode()
  }

  function applySettings(settings: LuminoteSettings): void {
    const prevLive = effectiveMode()
    const prevSnapshot = settingsSnapshot
    settingsSnapshot = settings
    if (!view) {
      if (effectiveMode() !== prevLive && entry) mountMode()
      return
    }
    view.dispatch({
      effects: [
        wrapCompartment.reconfigure(settings.editor.wordWrap ? [EditorView.lineWrapping] : []),
        gutterCompartment.reconfigure(settings.editor.lineNumbers ? [lineNumbers()] : []),
        spellcheckCompartment.reconfigure(
          EditorView.contentAttributes.of({ spellcheck: settings.editor.spellcheck ? 'true' : 'false' }),
        ),
        liveCompartment.reconfigure(effectiveMode() === 'live' ? [livePreviewPlugin] : []),
        autoPairCompartment.reconfigure(settings.editor.autoPair ? [closeBrackets()] : []),
      ],
    })
    hostEl.style.setProperty('--lx-editor-font-size', `${settings.editor.fontSize}px`)
    if (!prevSnapshot || prevSnapshot.editor.viewMode !== settings.editor.viewMode) {
      // Default view mode changed — leaves without an override follow it.
      if (modeOverride === null) mountMode()
    }
  }

  async function open(next: VaultEntry): Promise<void> {
    if (saveState === 'dirty') void saveNow()
    entry = next
    entryId = next.id
    saveState = 'saved'
    const vaultId = deps.vaultId()
    if (!vaultId) throw new Error('No active vault')
    const note = await deps.rpc.call<{ content: string; modifiedAt: number }>('note.read', {
      vaultId,
      entryId: next.id,
    })
    if (destroyed) return
    content = note.content
    lastModified = note.modifiedAt
    mountMode()
    deps.events.onSaved(note.modifiedAt)
    deps.events.onStats(computeStats(content))
  }

  function clear(): void {
    entry = null
    entryId = null
    content = ''
    lastModified = null
    saveState = 'saved'
    teardownReading()
    teardownEditor()
    hostEl.replaceChildren()
  }

  function destroy(): void {
    destroyed = true
    if (saveTimer) clearTimeout(saveTimer)
    if (statsTimer) clearTimeout(statsTimer)
    teardownReading()
    teardownEditor()
    clear()
  }

  return {
    get entryId() { return entryId },
    get lastModified() { return lastModified },
    get saveState() { return saveState },
    currentStats() {
      return entry ? computeStats(content) : null
    },
    currentContent() {
      return entry ? content : undefined
    },
    currentCaret() {
      return view ? view.state.selection.main.anchor : null
    },
    setCaret(anchor) {
      if (anchor === null || !view) return
      const pos = Math.max(0, Math.min(anchor, view.state.doc.length))
      view.dispatch({ selection: { anchor: pos } })
    },
    currentScroll() {
      if (view) return view.scrollDOM.scrollTop
      return hostEl.scrollTop
    },
    setScroll(top) {
      if (top === null) return
      const apply = () => {
        if (view) view.scrollDOM.scrollTop = top
        hostEl.scrollTop = top
      }
      // Layout may not have settled yet right after a mode mount — apply now
      // and once more on the next frame so tall documents scroll correctly.
      apply()
      requestAnimationFrame(apply)
    },
    open,
    setMode,
    getMode: effectiveMode,
    applySettings,
    saveNow,
    applyExternalContent,
    clear,
    destroy,
  }
}
