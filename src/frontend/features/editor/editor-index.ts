/**
 * Editor feature — split-pane workspace with tabbed panes.
 *
 * Panes form a recursive binary layout; each leaf is an Obsidian-style tab
 * group. Every tab owns its own editor instance (independent undo history,
 * view mode, scroll), the header carries the tab strip, a single
 * view-mode cycle button (Source → Live → Reading), and a more-options
 * menu (split right/below, close tab/others/pane). Coordination with the
 * tree happens only through the store (`openNoteRequest`, `activeEntryId`,
 * save/status fields) and rpc reads.
 */
import type { SpindleFrontendContext } from 'lumiverse-spindle-types'
import {
  extOf,
  type ViewMode,
  type VaultEntry,
  type WorkspaceNodeSnapshot,
  type WorkspaceSnapshot,
  type WorkspaceTabSnapshot,
} from '../../../shared/model'
import { el, createDisposer } from '../../dom'
import { icon, type IconName } from '../../icons'
import type { RpcClient } from '../../rpc'
import type { Store, NoteOpenMode } from '../../state'
import { createLeafEditor, type LeafEditorHandle } from './cmeditor'

// ── Pane model ──────────────────────────────────────────────────────────

interface TabNode {
  id: string
  /** null = empty "New tab" placeholder (shows the pane empty state). */
  entryId: string | null
}

interface LeafNode {
  kind: 'leaf'
  id: string
  tabs: TabNode[]
  activeTabId: string | null
}

interface SplitNode {
  kind: 'split'
  id: string
  dir: 'row' | 'col'
  children: PaneNode[]
  /** Percent (0-100) per child; same length as children. */
  sizes: number[]
}

type PaneNode = LeafNode | SplitNode

let paneSeq = 0
const nextPaneId = () => `pane-${++paneSeq}`

function createLeaf(): LeafNode {
  return { kind: 'leaf', id: nextPaneId(), tabs: [], activeTabId: null }
}

interface TabRuntime {
  editor: LeafEditorHandle
  hostEl: HTMLElement
  /** The tab button in the strip — swapped on every strip rebuild. */
  tabEl: HTMLElement | null
}

export interface EditorFeature {
  /** Flush every dirty tab (used on teardown and vault switch). */
  saveAll(): Promise<void>
  /** Collapse every split pane into one calm leaf (Settings → Overlay). */
  resetLayout(): void
  destroy(): void
}

const MAX_LEAVES = 6

const MODES: Array<{ mode: ViewMode; label: string; icon: IconName }> = [
  { mode: 'source', label: 'Source', icon: 'code' },
  { mode: 'live', label: 'Live preview', icon: 'penLine' },
  { mode: 'reading', label: 'Reading', icon: 'eye' },
]

export function createEditorFeature(
  ctx: SpindleFrontendContext,
  store: Store,
  rpc: RpcClient,
  root: HTMLElement,
  hooks: {
    /** Debounced per-vault workspace write (owned by the setup root). */
    pushWorkspace?: (snapshot: WorkspaceSnapshot) => void
    /**
     * The workspace sidebar toggle (created by the shell). Pinned beside
     * the firstmost tab of the left-most split after every re-render —
     * the strip's leading slot has room and survives layout churn because
     * we re-pin the same node each time (listeners ride along).
     */
    sideToggle?: HTMLElement | null
  } = {},
): EditorFeature {
  const disposer = createDisposer()
  const ac = new AbortController()
  disposer.push(() => ac.abort())
  const signal = ac.signal
  let rootNode: PaneNode = createLeaf()
  let activeLeafId: string = rootNode.id
  const tabRuntimes = new Map<string, TabRuntime>()

  // ── Smushed-tab marker ──
  // When a pane's strip squeezes a tab under the readable threshold we pin
  // an inline `max-width: 40px` marker on its .lx-tab-header-inner; the
  // stylesheet keys off that attribute to hide the title (leaving just the
  // close glyph), exactly like Obsidian's narrowest tabs.
  const SMUSHED_TAB_PX = 56
  const smushObserver = new ResizeObserver((observations) => {
    for (const observation of observations) syncSmushedTabs(observation.target as HTMLElement)
  })
  disposer.push(() => smushObserver.disconnect())

  function syncSmushedTabs(strip: HTMLElement): void {
    for (const tab of Array.from(strip.querySelectorAll<HTMLElement>('.lx-tab-header'))) {
      const inner = tab.querySelector<HTMLElement>('.lx-tab-header-inner')
      if (!inner) continue
      if (tab.offsetWidth > 0 && tab.offsetWidth <= SMUSHED_TAB_PX) {
        inner.style.maxWidth = '40px'
      } else {
        inner.style.removeProperty('max-width')
      }
    }
  }

  function toast(message: string): void {
    const note = el('div', { class: 'lx-toast', text: message })
    root.appendChild(note)
    setTimeout(() => note.classList.add('lx-toast-out'), 2600)
    setTimeout(() => note.remove(), 3100)
  }

  // ── Model helpers ──

  function* walkLeaves(node: PaneNode): Generator<LeafNode> {
    if (node.kind === 'leaf') yield node
    else for (const child of node.children) yield* walkLeaves(child)
  }

  function allLeaves(): LeafNode[] {
    return [...walkLeaves(rootNode)]
  }

  function findParent(targetId: string, node: PaneNode = rootNode): SplitNode | null {
    if (node.kind !== 'split') return null
    if (node.children.some((c) => c.id === targetId)) return node
    for (const child of node.children) {
      const found = findParent(targetId, child)
      if (found) return found
    }
    return null
  }

  function findLeaf(leafId: string, node: PaneNode = rootNode): LeafNode | null {
    if (node.kind === 'leaf') return node.id === leafId ? node : null
    for (const child of node.children) {
      const found = findLeaf(leafId, child)
      if (found) return found
    }
    return null
  }

  function leafOfTab(tabId: string): LeafNode | null {
    for (const leaf of allLeaves()) {
      if (leaf.tabs.some((t) => t.id === tabId)) return leaf
    }
    return null
  }

  /** Tabs with the same note in OTHER panes are allowed (2.2.1); dedupe is leaf-scoped. */
  function findTabInLeaf(leaf: LeafNode, entryId: string): TabNode | null {
    return leaf.tabs.find((t) => t.entryId === entryId) ?? null
  }

  function activeEmptyTab(leaf: LeafNode): TabNode | null {
    const active = leaf.tabs.find((t) => t.id === leaf.activeTabId)
    return active && active.entryId === null ? active : null
  }

  function activeTabOf(leaf: LeafNode): TabNode | null {
    return leaf.tabs.find((t) => t.id === leaf.activeTabId) ?? null
  }

  /** Only the active tab of the active pane reports to the store/statusbar. */
  function tabIsForeground(tabId: string): boolean {
    const leaf = leafOfTab(tabId)
    return !!leaf && leaf.id === activeLeafId && leaf.activeTabId === tabId
  }

  function replaceNode(targetId: string, next: PaneNode): boolean {
    if (rootNode.id === targetId) {
      rootNode = next
      return true
    }
    const parent = findParent(targetId)
    if (!parent) return false
    const index = parent.children.findIndex((c) => c.id === targetId)
    parent.children[index] = next
    return true
  }

  function splitLeaf(leafId: string, dir: 'row' | 'col'): LeafNode | null {
    const leaves = allLeaves()
    if (leaves.length >= MAX_LEAVES) {
      toast(`Pane limit reached (${MAX_LEAVES})`)
      return null
    }
    const leaf = findLeaf(leafId)
    if (!leaf) return null
    const fresh = createLeaf()
    const split: SplitNode = { kind: 'split', id: nextPaneId(), dir, children: [leaf, fresh], sizes: [50, 50] }
    replaceNode(leafId, split)
    return fresh
  }

  // ── Tabs ──

  function ensureTabRuntime(tab: TabNode): TabRuntime {
    let runtime = tabRuntimes.get(tab.id)
    if (runtime) return runtime

    const hostEl = el('div', { class: 'lx-leaf-editor-host' })
    const editor = createLeafEditor(hostEl, {
      rpc,
      vaultId: () => store.get().activeVaultId,
      events: {
        onDirtyStateChange(state) {
          if (tabIsForeground(tab.id)) store.set({ saveState: state })
        },
        onStats(stats) {
          if (tabIsForeground(tab.id)) store.set({ activeStats: stats })
        },
        onSaved(modifiedAt) {
          // Multi-pane copies of the same note: fold the save into every
          // other clean copy so all views of the entry stay in step (2.2.1).
          for (const otherLeaf of allLeaves()) {
            for (const otherTab of otherLeaf.tabs) {
              if (otherTab.id === tab.id || otherTab.entryId !== tab.entryId || tab.entryId === null) continue
              const content = tabRuntimes.get(tab.id)?.editor.currentContent()
              if (content !== undefined) {
                tabRuntimes.get(otherTab.id)?.editor.applyExternalContent(content, modifiedAt)
              }
            }
          }
          if (tabIsForeground(tab.id)) {
            store.set({ saveState: 'saved', activeModifiedAt: modifiedAt })
          }
        },
        onToast: toast,
      },
    })

    runtime = { editor, hostEl, tabEl: null }
    runtime.hostEl.style.setProperty('--lx-editor-font-size', `${store.get().settings.editor.fontSize}px`)
    tabRuntimes.set(tab.id, runtime)
    return runtime
  }

  function destroyTabRuntime(tab: TabNode): void {
    const runtime = tabRuntimes.get(tab.id)
    runtime?.editor.destroy()
    runtime?.hostEl.remove()
    tabRuntimes.delete(tab.id)
  }

  function closeTab(leaf: LeafNode, tabId: string, opts: { flush?: boolean } = {}): void {
    const index = leaf.tabs.findIndex((t) => t.id === tabId)
    if (index === -1) return
    const tab = leaf.tabs[index]
    const runtime = tabRuntimes.get(tab.id)
    if (opts.flush && runtime) void runtime.editor.saveNow()
    destroyTabRuntime(tab)
    leaf.tabs.splice(index, 1)
    if (leaf.activeTabId === tabId) {
      const neighbor = leaf.tabs[index] ?? leaf.tabs[index - 1] ?? null
      leaf.activeTabId = neighbor?.id ?? null
    }
    // Obsidian: a pane whose last tab closed goes away (unless it's the only
    // pane left — that one drops to the empty state instead).
    if (leaf.tabs.length === 0 && allLeaves().length > 1) closePane(leaf)
  }

  function closePane(leaf: LeafNode): void {
    if (allLeaves().length === 1) {
      // Last pane standing — close its tabs instead of the pane itself.
      for (const tab of [...leaf.tabs]) closeTab(leaf, tab.id, { flush: true })
      renderPanes()
      syncActiveToStore()
      return
    }
    for (const tab of [...leaf.tabs]) {
      destroyTabRuntime(tab)
    }

    const parent = findParent(leaf.id)
    if (!parent) return
    const index = parent.children.findIndex((c) => c.id === leaf.id)
    parent.children.splice(index, 1)
    parent.sizes.splice(index, 1)

    if (parent.children.length === 1) {
      // Collapse the split: its surviving child takes its place.
      replaceNode(parent.id, parent.children[0])
    } else {
      const total = parent.sizes.reduce((a, b) => a + b, 0)
      parent.sizes = parent.sizes.map((s) => (s / total) * 100)
    }

    if (activeLeafId === leaf.id) {
      activeLeafId = allLeaves()[0]?.id ?? rootNode.id
    }
    renderPanes()
    syncActiveToStore()
  }

  function activateTab(leaf: LeafNode, tabId: string): void {
    if (leaf.activeTabId === tabId && leaf.id === activeLeafId) return
    leaf.activeTabId = tabId
    activeLeafId = leaf.id
    renderPanes()
    syncActiveToStore()
  }

  // ── Rendering ──

  function renderPanes(): void {
    root.replaceChildren()
    const first = renderNode(rootNode)
    first.classList.add('lx-pane-root')
    root.appendChild(first)
    pinSideToggle()
    store.set({ paneEpoch: store.get().paneEpoch + 1 })
  }

  /**
   * Dock the sidebar toggle at the head of the left-most split's tab
   * strip — "next to the firstmost tab". Re-parenting the same node keeps
   * its shell-owned listeners; the strip rebuilds on every render, so this
   * must re-run after each one.
   */
  function pinSideToggle(): void {
    const toggle = hooks.sideToggle
    if (!toggle) return
    const firstLeaf = allLeaves()[0]
    if (!firstLeaf) return
    const strip = root.querySelector(
      `.lx-tab-header-container[data-leaf-id="${firstLeaf.id}"] .lx-tab-strip-inner`,
    )
    if (!strip) return
    if (strip.firstElementChild !== toggle) strip.prepend(toggle)
    toggle.classList.add('lx-side-toggle-pinned')
  }

  function renderNode(node: PaneNode): HTMLElement {
    if (node.kind === 'leaf') return renderLeaf(node)

    const container = el('div', { class: `lx-split lx-split-${node.dir}`, dataset: { splitId: node.id } })
    node.children.forEach((child, index) => {
      if (index > 0) {
        container.appendChild(renderDivider(node, index - 1))
      }
      const childEl = renderNode(child)
      childEl.style.flex = `0 0 ${node.sizes[index]}%`
      container.appendChild(childEl)
    })
    return container
  }

  function renderDivider(split: SplitNode, sizeIndex: number): HTMLElement {
    const divider = el('div', {
      class: `lx-pane-divider lx-divider-${split.dir}`,
      attrs: { role: 'separator', 'aria-orientation': split.dir === 'row' ? 'vertical' : 'horizontal' },
    })
    divider.addEventListener('pointerdown', (event) => {
      event.preventDefault()
      try {
        divider.setPointerCapture(event.pointerId)
      } catch { /* noop */ }
      const parentRect = divider.parentElement?.getBoundingClientRect()
      if (!parentRect) return
      const startSizes = [...split.sizes]
      const startPos = split.dir === 'row' ? event.clientX : event.clientY
      const extent = split.dir === 'row' ? parentRect.width : parentRect.height

      const move = (ev: PointerEvent) => {
        const delta = ((split.dir === 'row' ? ev.clientX : ev.clientY) - startPos) / extent * 100
        let a = startSizes[sizeIndex] + delta
        let b = startSizes[sizeIndex + 1] - delta
        const min = 12
        if (a < min) { b -= min - a; a = min }
        if (b < min) { a -= min - b; b = min }
        split.sizes[sizeIndex] = a
        split.sizes[sizeIndex + 1] = b
        applySizes(split)
      }
      const up = () => {
        window.removeEventListener('pointermove', move)
        window.removeEventListener('pointerup', up)
        window.removeEventListener('pointercancel', up)
      }
      window.addEventListener('pointermove', move)
      window.addEventListener('pointerup', up)
      window.addEventListener('pointercancel', up)
    })
    return divider
  }

  function applySizes(split: SplitNode): void {
    const container = root.querySelector<HTMLElement>(`.lx-split[data-split-id="${split.id}"]`)
    if (!container) return
    let childIndex = 0
    for (const element of Array.from(container.children)) {
      if (element.classList.contains('lx-pane-divider')) continue
      const size = split.sizes[childIndex]
      if (size === undefined) break
      ;(element as HTMLElement).style.flex = `0 0 ${size}%`
      childIndex++
    }
  }

  function tabLabel(tab: TabNode): string {
    if (tab.entryId === null) return 'New tab'
    return store.get().entries.find((e) => e.id === tab.entryId)?.name ?? 'Note'
  }



  // ── Obsidian-parity tab DOM ──
  // .lx-tab-header[ draggable ] > .lx-tab-header-inner
  //   > .lx-tab-header-inner-title + .lx-tab-header-inner-close-button
  // (text-only, like Obsidian's tabs — no file icon, no dirty dot).
  // State modifiers: .lx-tab-active, .lx-tab-highlighted (drop target while
  // tab-dragging).

  function buildTabHeader(leaf: LeafNode, tab: TabNode): HTMLElement {
    const name = tabLabel(tab)
    const isActive = leaf.activeTabId === tab.id
    const runtime = tab.entryId !== null ? ensureTabRuntime(tab) : null

    const titleEl = el('span', { class: 'lx-tab-header-inner-title lx-tab-name', text: name })
    const closeBtn = el('span', {
      class: 'lx-tab-header-inner-close-button lx-tab-close',
      title: `Close ${name}`,
      attrs: { role: 'button', 'aria-label': 'Close', tabindex: '-1' },
    }, icon('x', 11))
    closeBtn.addEventListener('click', (event) => {
      event.stopPropagation()
      closeTab(leaf, tab.id, { flush: true })
      renderPanes()
      syncActiveToStore()
    })

    const inner = el('div', { class: 'lx-tab-header-inner' }, titleEl, closeBtn)

    const tabEl = el('div', {
      class: `lx-tab-header lx-tab${isActive ? ' lx-tab-active' : ''}`,
      title: name,
      dataset: { tabId: tab.id, ...(tab.entryId ? { entryId: tab.entryId } : {}) },
      attrs: { 'aria-label': name, role: 'tab', 'aria-selected': String(isActive), draggable: 'true' },
    }, inner)

    tabEl.addEventListener('click', (event) => {
      event.stopPropagation()
      activateTab(leaf, tab.id)
    })
    tabEl.addEventListener('auxclick', (event) => {
      if (event.button === 1) {
        event.stopPropagation()
        closeTab(leaf, tab.id, { flush: true })
        renderPanes()
        syncActiveToStore()
      }
    })
    tabEl.addEventListener('contextmenu', (event) => {
      event.preventDefault()
      event.stopPropagation()
      activateTab(leaf, tab.id)
      void showPaneMenu(leaf, { x: event.clientX, y: event.clientY + 4 })
    }, { signal })

    // Drag to reorder / move between panes (Obsidian-style).
    tabEl.addEventListener('dragstart', (event) => {
      event.dataTransfer?.setData('application/x-luminote-tab', JSON.stringify({ tabId: tab.id, fromLeafId: leaf.id }))
      event.dataTransfer?.setData('text/plain', name)
      if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move'
    }, { signal })
    tabEl.addEventListener('dragend', () => {
      root.querySelectorAll('.lx-tab-highlighted, .lx-tabstrip-dropping').forEach((node) => {
        node.classList.remove('lx-tab-highlighted', 'lx-tabstrip-dropping')
      })
    }, { signal })

    if (runtime) runtime.tabEl = tabEl
    return tabEl
  }

  function syncModeButton(leaf: LeafNode, btn: HTMLButtonElement): void {
    const tab = activeTabOf(leaf)
    if (!tab || tab.entryId === null) {
      btn.hidden = true
      return
    }
    btn.hidden = false
    const runtime = ensureTabRuntime(tab)
    const modes = MODES
    const current = runtime.editor.getMode()
    const index = Math.max(0, modes.findIndex((m) => m.mode === current))
    const cur = modes[index]
    const next = modes[(index + 1) % modes.length]
    btn.replaceChildren(icon(cur.icon, 13))
    btn.title = `${cur.label} — click for ${next.label}`
    btn.setAttribute('aria-label', `View mode: ${cur.label}`)
    btn.onclick = (event) => {
      event.stopPropagation()
      runtime.editor.setMode(next.mode)
      syncModeButton(leaf, btn)
      syncActiveToStore()
      pushWorkspace() // view mode is part of the per-vault workspace snapshot
    }
  }

  async function showPaneMenu(leaf: LeafNode, anchorRect: { x: number; y: number }): Promise<void> {
    const hasTabs = leaf.tabs.length > 0
    const { selectedKey } = await ctx.ui.showContextMenu({
      position: anchorRect,
      items: [
        { key: 'new-tab', label: 'New tab' },
        { key: 'split-right', label: 'Split right' },
        { key: 'split-down', label: 'Split below' },
        { key: 'div-1', label: '', type: 'divider' as const },
        { key: 'close-tab', label: 'Close tab', disabled: !leaf.activeTabId },
        { key: 'close-others', label: 'Close other tabs', disabled: leaf.tabs.length < 2 },
        { key: 'close-pane', label: 'Close pane', disabled: allLeaves().length === 1 && !hasTabs },
      ],
    })
    if (!selectedKey) return
    if (selectedKey === 'new-tab') {
      addEmptyTab(leaf)
      renderPanes()
      syncActiveToStore()
      return
    }
    if (selectedKey === 'split-right' || selectedKey === 'split-down') {
      const fresh = splitLeaf(leaf.id, selectedKey === 'split-right' ? 'row' : 'col')
      if (fresh) {
        activeLeafId = fresh.id
        renderPanes()
        syncActiveToStore()
      }
      return
    }
    if (selectedKey === 'close-tab' && leaf.activeTabId) {
      closeTab(leaf, leaf.activeTabId, { flush: true })
      renderPanes()
      syncActiveToStore()
      return
    }
    if (selectedKey === 'close-others') {
      const activeId = leaf.activeTabId
      for (const tab of [...leaf.tabs]) {
        if (tab.id !== activeId) closeTab(leaf, tab.id, { flush: true })
      }
      renderPanes()
      syncActiveToStore()
      return
    }
    if (selectedKey === 'close-pane') closePane(leaf)
  }

  /** Obsidian "New tab": an empty placeholder tab showing the open-note hint. */
  function addEmptyTab(leaf: LeafNode): void {
    const tab: TabNode = { id: nextPaneId(), entryId: null }
    leaf.tabs.push(tab)
    leaf.activeTabId = tab.id
    activeLeafId = leaf.id
  }

  /** Move/reorder a tab dragged within or across leaf tab strips. */
  function handleTabDrop(targetLeaf: LeafNode, beforeTabId: string | null, raw: string): void {
    let payload: { tabId: string; fromLeafId: string } | null = null
    try {
      payload = JSON.parse(raw) as { tabId: string; fromLeafId: string }
    } catch {
      return
    }
    if (!payload) return
    const sourceLeaf = findLeaf(payload.fromLeafId)
    if (!sourceLeaf) return
    const fromIndex = sourceLeaf.tabs.findIndex((t) => t.id === payload!.tabId)
    if (fromIndex === -1) return
    const [moving] = sourceLeaf.tabs.splice(fromIndex, 1)

    let toIndex = beforeTabId
      ? targetLeaf.tabs.findIndex((t) => t.id === beforeTabId)
      : targetLeaf.tabs.length
    if (toIndex === -1) toIndex = targetLeaf.tabs.length
    targetLeaf.tabs.splice(toIndex, 0, moving)

    if (sourceLeaf.activeTabId === moving.id) {
      const neighbor = sourceLeaf.tabs[Math.min(fromIndex, sourceLeaf.tabs.length - 1)] ?? null
      sourceLeaf.activeTabId = neighbor?.id ?? null
    }
    targetLeaf.activeTabId = moving.id
    activeLeafId = targetLeaf.id
    // Dragging a pane's only tab out closes the emptied pane, like closing
    // its last tab would.
    if (sourceLeaf.tabs.length === 0 && allLeaves().length > 1) closePane(sourceLeaf)
    renderPanes()
    syncActiveToStore()
  }

  /** Obsidian view-header breadcrumb: "Folder / Sub / Note.md". */
  function entryPathParts(entryId: string): { parents: string; name: string } | null {
    const entries = store.get().entries
    const entry = entries.find((e) => e.id === entryId)
    if (!entry) return null
    const chain: string[] = []
    let cursor = entry.parentId
    let guard = 0
    while (cursor && guard < 32) {
      const parent = entries.find((e) => e.id === cursor)
      if (!parent) break
      chain.unshift(parent.name)
      cursor = parent.parentId
      guard += 1
    }
    return { parents: chain.join(' / '), name: entry.name }
  }

  /** Title spans for a leaf's view header ("Ideas / logo.svg", or "New tab"). */
  function buildViewHeaderTitle(leaf: LeafNode): HTMLElement[] {
    const active = activeTabOf(leaf)
    if (active && active.entryId !== null) {
      const parts = entryPathParts(active.entryId)
      if (parts) {
        const spans: HTMLElement[] = []
        if (parts.parents) {
          spans.push(el('span', { class: 'lx-view-header-title-parent', text: `${parts.parents} / ` }))
        }
        // Respect the "Show file extension" tree setting (same rule as rows).
        const entry = store.get().entries.find((e) => e.id === active.entryId)
        let name = parts.name
        if (entry && entry.kind === 'file' && !store.get().settings.tree.showExtension) {
          const ext = extOf(name)
          if (ext) name = name.slice(0, -(ext.length + 1))
        }
        spans.push(el('span', { class: 'lx-view-header-title', text: name }))
        return spans
      }
    }
    return [el('span', { class: 'lx-view-header-title lx-view-header-title-empty', text: 'New tab' })]
  }

  /** Patch an already-rendered view-header title after renames/moves. */
  function syncViewHeaderTitle(leaf: LeafNode): void {
    const container = root.querySelector(
      `.lx-pane[data-leaf-id="${leaf.id}"] .lx-view-header-title-container`,
    )
    if (!container) return
    const next = buildViewHeaderTitle(leaf)
    if (container.textContent === next.map((n) => n.textContent).join('')) return
    container.replaceChildren(...next)
  }

  function renderLeaf(leaf: LeafNode): HTMLElement {
    const isActiveLeaf = leaf.id === activeLeafId
    // Row 1 — the tab strip lives on its OWN row (Obsidian's tab-header
    // container); it only ever holds tabs, the + button, and the spacer.
    const tabStrip = el('div', {
      class: 'lx-tab-header-container',
      dataset: { leafId: leaf.id },
    })
    tabStrip.addEventListener('pointerdown', () => setActiveLeaf(leaf.id))

    // Obsidian tree: container > inner > tab … tab > new-tab > spacer
    const inner = el('div', {
      class: 'lx-tab-strip-inner lx-tab-header-container-inner',
      attrs: { role: 'tablist', 'aria-label': 'Open notes' },
    })
    for (const tab of leaf.tabs) inner.appendChild(buildTabHeader(leaf, tab))

    // "+ New tab" — creates an empty tab; picking a note then fills it.
    const newTabBtn = el('div', { class: 'lx-tab-header-new-tab' },
      el('span', {
        class: 'lx-icon-btn lx-clickable-icon lx-new-tab-btn',
        title: 'New tab',
        attrs: { role: 'button', 'aria-label': 'New tab', tabindex: '0' },
      }, icon('plus', 14)))
    newTabBtn.addEventListener('click', (event) => {
      event.stopPropagation()
      addEmptyTab(leaf)
      renderPanes()
      syncActiveToStore()
    })
    newTabBtn.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault()
        addEmptyTab(leaf)
        renderPanes()
        syncActiveToStore()
      }
    })
    const spacer = el('div', { class: 'lx-tab-header-spacer', attrs: { 'aria-hidden': 'true' } })
    inner.append(newTabBtn, spacer)
    // Narrow-pane smush marker: tabs under the threshold hide their title.
    smushObserver.observe(inner)
    requestAnimationFrame(() => syncSmushedTabs(inner))

    // Tab drop targets: strip-level (append) + per-tab (insert before).
    inner.addEventListener('dragover', (event) => {
      if (!event.dataTransfer?.types.includes('application/x-luminote-tab')) return
      event.preventDefault()
      event.dataTransfer.dropEffect = 'move'
      inner.classList.add('lx-tabstrip-dropping')
      inner.querySelectorAll('.lx-tab-highlighted').forEach((node) => node.classList.remove('lx-tab-highlighted'))
      const over = (event.target as HTMLElement).closest?.('.lx-tab-header') as HTMLElement | null
      if (over) over.classList.add('lx-tab-highlighted')
    }, { signal })
    inner.addEventListener('dragleave', (event) => {
      if (!inner.contains(event.relatedTarget as Node | null)) {
        inner.classList.remove('lx-tabstrip-dropping')
        inner.querySelectorAll('.lx-tab-highlighted').forEach((node) => node.classList.remove('lx-tab-highlighted'))
      }
    }, { signal })
    inner.addEventListener('drop', (event) => {
      const raw = event.dataTransfer?.getData('application/x-luminote-tab')
      if (!raw) return
      event.preventDefault()
      event.stopPropagation()
      inner.classList.remove('lx-tabstrip-dropping')
      inner.querySelectorAll('.lx-tab-highlighted').forEach((node) => node.classList.remove('lx-tab-highlighted'))
      const over = (event.target as HTMLElement).closest?.('.lx-tab-header') as HTMLElement | null
      handleTabDrop(leaf, over?.dataset.tabId ?? null, raw)
    }, { signal })

    const modeBtn = el('button', {
      class: 'lx-icon-btn lx-pane-btn lx-mode-cycle',
      attrs: { 'aria-label': 'View mode' },
    }) as HTMLButtonElement
    syncModeButton(leaf, modeBtn)

    const moreBtn = el('button', {
      class: 'lx-icon-btn lx-pane-btn lx-pane-more',
      title: 'More pane options…',
      attrs: { 'aria-label': 'More pane options' },
    }, icon('ellipsisVertical', 14))
    moreBtn.addEventListener('click', (event) => {
      event.stopPropagation()
      const rect = moreBtn.getBoundingClientRect()
      void showPaneMenu(leaf, { x: rect.left, y: rect.bottom + 2 })
    })

    tabStrip.appendChild(inner)

    // Row 2 — the view header (Obsidian's .view-header): breadcrumb title
    // ("Folder / Note.md") + the view actions on the right.
    const viewHeader = el('div', {
      class: 'lx-view-header',
      dataset: { leafId: leaf.id },
    },
      el('div', { class: 'lx-view-header-title-container' }, ...buildViewHeaderTitle(leaf)),
      el('div', { class: 'lx-view-actions' }, modeBtn, moreBtn),
    )
    viewHeader.addEventListener('pointerdown', () => setActiveLeaf(leaf.id))

    const body = el('div', { class: 'lx-pane-body', dataset: { leafId: leaf.id } })
    body.addEventListener('pointerdown', () => setActiveLeaf(leaf.id))
    const active = activeTabOf(leaf)
    if (active && active.entryId !== null) {
      body.appendChild(ensureTabRuntime(active).hostEl)
    } else {
      body.appendChild(renderEmptyState(leaf))
    }

    return el('section', {
      class: `lx-pane${isActiveLeaf ? ' lx-pane-active' : ''}`,
      dataset: { leafId: leaf.id },
    }, tabStrip, viewHeader, body)
  }

  function renderEmptyState(leaf: LeafNode): HTMLElement {
    const newNote = el('button', { class: 'lx-action-btn' }, icon('filePlus', 14), el('span', { text: 'New note' }))
    newNote.addEventListener('click', async (event) => {
      event.stopPropagation()
      const vaultId = store.get().activeVaultId
      if (!vaultId) {
        toast('Create a vault first (vault bar, bottom-left)')
        return
      }
      try {
        const entry = await rpc.call<VaultEntry>('entry.create', { vaultId, parentId: null, kind: 'file', ext: 'md' })
        // Route straight into THIS pane: an openNoteRequest round-trip would
        // race the tree's entries refresh (the new id isn't in the store yet)
        // and could land the tab in a different pane.
        activeLeafId = leaf.id
        await openNote(entry.id, 'reuse', entry)
      } catch (err) {
        toast(err instanceof Error ? err.message : 'Create failed')
      }
    })
    const holder = el('div', { class: 'lx-pane-empty' },
      icon('notebookText', 28),
      el('p', { class: 'lx-pane-empty-title', text: 'No note open' }),
      el('p', { class: 'lx-pane-empty-hint', text: 'Pick a note in the file tree, or start a new one.' }),
      newNote,
    )
    holder.addEventListener('click', () => setActiveLeaf(leaf.id))
    return holder
  }

  function setActiveLeaf(leafId: string): void {
    if (activeLeafId === leafId) return
    activeLeafId = leafId
    for (const pane of root.querySelectorAll('.lx-pane[data-leaf-id]')) {
      pane.classList.toggle('lx-pane-active', (pane as HTMLElement).dataset.leafId === leafId)
    }
    syncActiveToStore()
  }

  function syncActiveToStore(): void {
    const leaf = findLeaf(activeLeafId)
    const tab = leaf ? activeTabOf(leaf) : null
    const runtime = tab ? tabRuntimes.get(tab.id) : undefined
    store.set({
      activeEntryId: tab?.entryId ?? null,
      saveState: runtime?.editor.saveState ?? 'saved',
      activeModifiedAt: runtime?.editor.lastModified ?? null,
      activeStats: runtime?.editor.currentStats() ?? null,
    })
  }

  // ── Opening notes ──

  /**
   * Modes (Obsidian-flavored):
   *  - reuse       open in the focused pane: focus its tab if already open
   *                there, fill the empty "New tab" tab when present, else
   *                REPLACE the active tab (plain tree clicks browse; only
   *                explicit actions stack tabs). The same note MAY be open
   *                in other panes.
   *  - new-tab     always append a new tab to the focused pane
   *                (ctrl/cmd-click, middle-click, context menu).
   *  - split-right always land the note in a pane to the right: reuse an
   *                existing right neighbor if there is one, else split.
   *  - split-down  same story downwards (kept for the pane menu).
   */
  async function openNote(entryId: string, mode: NoteOpenMode, entryOverride?: VaultEntry): Promise<void> {
    const entry = entryOverride ?? store.get().entries.find((e) => e.id === entryId)
    if (!entry || entry.kind !== 'file') return

    const activeLeaf = findLeaf(activeLeafId) ?? allLeaves()[0] ?? (rootNode as LeafNode)

    let target: LeafNode
    if (mode === 'split-right' || mode === 'split-down') {
      target = resolveSplitTarget(activeLeaf, mode === 'split-right' ? 'row' : 'col') ?? activeLeaf
    } else {
      target = activeLeaf
    }

    if (mode === 'reuse') {
      const inLeaf = findTabInLeaf(target, entryId)
      if (inLeaf) {
        activateTab(target, inLeaf.id)
        return
      }
      const empty = activeEmptyTab(target)
      if (empty) {
        empty.entryId = entryId
        target.activeTabId = empty.id
        activeLeafId = target.id
        renderPanes()
        await hydrateTab(target, empty, entry)
        return
      }
      // Obsidian browse semantics: a plain click navigates the ACTIVE tab
      // instead of stacking a new one (that's what ctrl/middle-click is for).
      const active = activeTabOf(target)
      if (active) {
        active.entryId = entryId
        activeLeafId = target.id
        target.activeTabId = active.id
        renderPanes()
        await hydrateTab(target, active, entry)
        return
      }
    }

    const tab: TabNode = { id: nextPaneId(), entryId }
    target.tabs.push(tab)
    target.activeTabId = tab.id
    activeLeafId = target.id
    renderPanes()
    await hydrateTab(target, tab, entry)
  }

  /** Right/below neighbor leaf of `leaf`, splitting when none exists. */
  function resolveSplitTarget(leaf: LeafNode, dir: 'row' | 'col'): LeafNode | null {
    const parent = findParent(leaf.id)
    if (parent && parent.dir === dir) {
      const index = parent.children.findIndex((c) => c.id === leaf.id)
      const next = parent.children[index + 1]
      if (next) {
        // Descend into the sibling's first leaf so the note lands adjacent.
        return next.kind === 'leaf' ? next : allLeaves().find((l) => isDescendant(next, l.id)) ?? null
      }
    }
    return splitLeaf(leaf.id, dir)
  }

  function isDescendant(node: PaneNode, leafId: string): boolean {
    if (node.kind === 'leaf') return node.id === leafId
    return node.children.some((c) => isDescendant(c, leafId))
  }

  async function hydrateTab(
    target: LeafNode,
    tab: TabNode,
    entry: VaultEntry,
    opts: { snapshot?: WorkspaceTabSnapshot; silent?: boolean } = {},
  ): Promise<void> {
    const runtime = tabRuntimes.get(tab.id)
    if (!runtime) return
    try {
      await runtime.editor.open(entry)
    } catch (err) {
      if (!opts.silent) toast(err instanceof Error ? err.message : 'Failed to open note')
      closeTab(target, tab.id)
      renderPanes()
      syncActiveToStore()
      return
    }
    runtime.editor.applySettings(store.get().settings)
    // Workspace restore: bring back the tab's exact view state.
    if (opts.snapshot?.mode) runtime.editor.setMode(opts.snapshot.mode)
    if (opts.snapshot?.caret != null) runtime.editor.setCaret(opts.snapshot.caret)
    if (opts.snapshot?.scroll != null) runtime.editor.setScroll(opts.snapshot.scroll)
    syncActiveToStore()
  }

  disposer.push(store.subscribeKey('openNoteRequest', () => {
    const req = store.get().openNoteRequest
    if (!req) return
    void openNote(req.entryId, req.mode)
  }))

  // Reconcile open tabs against tree mutations (renames, moves, deletes);
  // an entry id that vanishes means its note was deleted. Entries refresh
  // on every autosave, so structural re-renders only happen on removals —
  // renames patch the tab labels in place.
  disposer.push(store.subscribeKey('entries', () => {
    const { entries } = store.get()
    let mutated = false
    for (const leaf of allLeaves()) {
      for (const tab of [...leaf.tabs]) {
        if (tab.entryId === null) continue // empty "New tab" placeholders
        if (!entries.some((e) => e.id === tab.entryId)) {
          closeTab(leaf, tab.id)
          mutated = true
          continue
        }
        const runtime = tabRuntimes.get(tab.id)
        const nameEl = runtime?.tabEl?.querySelector('.lx-tab-name')
        const name = entries.find((e) => e.id === tab.entryId)?.name ?? 'Note'
        if (nameEl && nameEl.textContent !== name) {
          nameEl.textContent = name
          runtime?.tabEl?.setAttribute('title', name)
        }
      }
      // Breadcrumb titles follow renames (and moves that change the folder
      // chain) without a full pane re-render.
      syncViewHeaderTitle(leaf)
    }
    if (mutated) renderPanes()
    syncActiveToStore()
  }))

  disposer.push(store.subscribeKey('settings', () => {
    const settings = store.get().settings
    for (const runtime of tabRuntimes.values()) {
      runtime.editor.applySettings(settings)
      runtime.hostEl.style.setProperty('--lx-editor-font-size', `${settings.editor.fontSize}px`)
    }
    // "Show file extension" affects view-header titles — resync live.
    for (const leaf of allLeaves()) syncViewHeaderTitle(leaf)
  }))

  async function saveAll(): Promise<void> {
    await Promise.all([...tabRuntimes.values()].map((runtime) => runtime.editor.saveNow()))
  }

  disposer.push(store.subscribeKey('overlayVisible', () => {
    if (!store.get().overlayVisible) void saveAll()
  }))

  // ── Workspace persistence (panes/tabs/view state, per vault) ──────────
  // Snapshots are pushed through the setup root's debounced writer; restores
  // read the vault's workspace.json via rpc. Restore happens at boot and on
  // every vault switch (the tree flushes the old vault's snapshot first).

  function captureWorkspace(): WorkspaceSnapshot {
    const serialize = (node: PaneNode): WorkspaceNodeSnapshot => {
      if (node.kind === 'leaf') {
        const activeIndex = node.tabs.findIndex((t) => t.id === node.activeTabId)
        return {
          kind: 'leaf',
          id: node.id,
          activeTabIndex: Math.max(0, activeIndex),
          tabs: node.tabs
            .filter((t) => t.entryId !== null)
            .map((t): WorkspaceTabSnapshot => {
              const runtime = tabRuntimes.get(t.id)
              return {
                entryId: t.entryId as string,
                mode: runtime?.editor.getMode() ?? null,
                caret: runtime?.editor.currentCaret() ?? null,
                scroll: runtime?.editor.currentScroll() ?? null,
              }
            }),
        }
      }
      return {
        kind: 'split',
        id: node.id,
        dir: node.dir,
        sizes: [...node.sizes],
        children: node.children.map(serialize),
      }
    }
    return {
      version: 1,
      root: serialize(rootNode),
      activeLeafId,
      collapsed: Object.keys(store.get().collapsed),
    }
  }

  /** Rebuild the pane tree from a snapshot, pruning notes that vanished. */
  function deserializeNode(
    node: WorkspaceNodeSnapshot,
    entriesById: Map<string, VaultEntry>,
  ): { node: PaneNode; maxSeq: number } {
    const seqOf = (id: string): number => {
      const match = /^pane-(\d+)$/.exec(id)
      return match ? Number(match[1]) : 0
    }
    if (node.kind === 'leaf') {
      const tabs: TabNode[] = node.tabs
        .filter((t) => entriesById.has(t.entryId))
        .map((t) => ({ id: nextPaneId(), entryId: t.entryId }))
      const activeIndex = Math.min(node.activeTabIndex, Math.max(0, tabs.length - 1))
      return {
        node: {
          kind: 'leaf',
          id: node.id,
          tabs,
          activeTabId: tabs[activeIndex]?.id ?? null,
        },
        maxSeq: seqOf(node.id),
      }
    }
    let maxSeq = seqOf(node.id)
    const children: PaneNode[] = []
    const sizes: number[] = []
    node.children.forEach((child, index) => {
      const built = deserializeNode(child, entriesById)
      maxSeq = Math.max(maxSeq, built.maxSeq)
      children.push(built.node)
      sizes.push(node.sizes[index] ?? 100 / node.children.length)
    })
    const total = sizes.reduce((a, b) => a + b, 0)
    return {
      node: {
        kind: 'split',
        id: node.id,
        dir: node.dir,
        sizes: total > 0 ? sizes.map((s) => (s / total) * 100) : sizes,
        children,
      },
      maxSeq,
    }
  }

  let restoring = false

  async function restoreWorkspace(vaultId: string | null): Promise<void> {
    if (restoring) return
    restoring = true
    try {
      for (const leaf of allLeaves()) {
        for (const tab of [...leaf.tabs]) destroyTabRuntime(tab)
      }
      rootNode = createLeaf()
      activeLeafId = rootNode.id

      let snapshot: WorkspaceSnapshot | null = null
      let entries: VaultEntry[] = []
      if (vaultId) {
        try {
          ;[snapshot, entries] = await Promise.all([
            rpc.call<WorkspaceSnapshot>('workspace.get', { vaultId }),
            rpc.call<VaultEntry[]>('entries.list', { vaultId }),
          ])
        } catch { /* fresh workspace on any failure */ }
      }

      if (snapshot?.root) {
        const entriesById = new Map(entries.map((e) => [e.id, e]))
        const built = deserializeNode(snapshot.root, entriesById)
        rootNode = built.node
        paneSeq = Math.max(paneSeq, built.maxSeq)
        if (snapshot.activeLeafId && findLeaf(snapshot.activeLeafId)) {
          activeLeafId = snapshot.activeLeafId
        } else {
          activeLeafId = allLeaves()[0]?.id ?? rootNode.id
        }
      }
      renderPanes()

      // Hydrate every restored tab (mode/caret/scroll ride along); deleted
      // notes were already pruned by deserializeNode, failures drop silently.
      if (snapshot?.root) {
        const snapshotTabs = new Map<string, WorkspaceTabSnapshot>()
        const collect = (node: WorkspaceNodeSnapshot): void => {
          if (node.kind === 'leaf') for (const t of node.tabs) snapshotTabs.set(t.entryId, t)
          else node.children.forEach(collect)
        }
        collect(snapshot.root)
        const entriesById = new Map(entries.map((e) => [e.id, e]))
        await Promise.all(allLeaves().flatMap((leaf) =>
          leaf.tabs.map(async (tab) => {
            if (tab.entryId === null) return
            const entry = entriesById.get(tab.entryId)
            if (!entry) return
            await hydrateTab(leaf, tab, entry, { snapshot: snapshotTabs.get(tab.entryId), silent: true })
          }),
        ))
      }
      syncActiveToStore()
    } finally {
      restoring = false
    }
  }

  function pushWorkspace(): void {
    if (restoring || !hooks.pushWorkspace) return
    if (!store.get().activeVaultId) return
    hooks.pushWorkspace(captureWorkspace())
  }

  // Structure changes (renderPanes) schedule a debounced write; caret/scroll
  // are captured lazily at flush time (vault switch / overlay close / exit).
  let layoutPushTimer: ReturnType<typeof setTimeout> | null = null
  disposer.push(store.subscribeKey('paneEpoch', () => {
    if (layoutPushTimer) clearTimeout(layoutPushTimer)
    layoutPushTimer = setTimeout(pushWorkspace, 600)
  }))
  disposer.push(() => {
    if (layoutPushTimer) clearTimeout(layoutPushTimer)
  })

  // Vault switch: the tree flushed the old snapshot; swap in the new vault's.
  disposer.push(store.subscribeKey('activeVaultId', () => {
    void restoreWorkspace(store.get().activeVaultId)
  }))

  /**
   * Collapse every split back into a single pane, keeping each open note as
   * a tab (duplicates of the same note merge). The tab runtimes of merged
   * duplicates are destroyed; the rest carry over untouched.
   */
  function resetLayout(): void {
    const merged = createLeaf()
    const seen = new Set<string | null>()
    const activeLeaf = findLeaf(activeLeafId)
    for (const leaf of allLeaves()) {
      for (const tab of leaf.tabs) {
        const key = tab.entryId ?? null
        if (seen.has(key)) {
          destroyTabRuntime(tab)
          continue
        }
        seen.add(key)
        merged.tabs.push(tab)
      }
    }
    merged.activeTabId =
      activeLeaf?.activeTabId && merged.tabs.some((t) => t.id === activeLeaf.activeTabId)
        ? activeLeaf.activeTabId
        : (merged.tabs[0]?.id ?? null)
    rootNode = merged
    activeLeafId = merged.id
    renderPanes()
    syncActiveToStore()
  }

  renderPanes()
  // Boot restore: the vault pointer was already set by the boot handshake.
  void restoreWorkspace(store.get().activeVaultId)

  return {
    saveAll,
    resetLayout,
    destroy() {
      disposer.dispose()
      for (const runtime of tabRuntimes.values()) runtime.editor.destroy()
      tabRuntimes.clear()
      root.replaceChildren()
    },
  }
}
