/**
 * File-tree feature — vault sidebar.
 *
 *   ┌ topbar: search · stats · collapse/expand · sort
 *   ├ tree:  folders & notes, drag-and-drop (loombuilder-style),
 *   │        context menus, inline rename, search filtering
 *   ├ actions: New Note · New Folder
 *   └ vault bar: pfp · vault name · switcher
 *
 * The tree never touches other feature modules: opening a note publishes a
 * `openNoteRequest` on the store; stats/modals go through the rpc client
 * and host modal APIs.
 */
import type { SpindleFrontendContext } from 'lumiverse-spindle-types'
import {
  extOf,
  sanitizeEntryName,
  type LuminoteSettings,
  type SortBy,
  type SortDir,
  type VaultEntry,
  type VaultMeta,
  type VaultStats,
} from '../../../shared/model'
import { el, createDisposer } from '../../dom'
import { mediaThumbEl } from '../../media'
import { icon, type IconName } from '../../icons'
import type { RpcClient } from '../../rpc'
import type { Store } from '../../state'

export interface TreeFeature {
  refreshEntries(): Promise<void>
  refreshVaults(): Promise<void>
  destroy(): void
}

// ── Helpers ─────────────────────────────────────────────────────────────



function sortSiblings(entries: VaultEntry[], sortBy: SortBy, sortDir: SortDir): VaultEntry[] {
  const dirFactor = sortDir === 'asc' ? 1 : -1
  const byName = (a: VaultEntry, b: VaultEntry) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true })
  const foldersFirst = (a: VaultEntry, b: VaultEntry) => (a.kind === b.kind ? 0 : a.kind === 'folder' ? -1 : 1)

  return [...entries].sort((a, b) => {
    if (sortBy === 'custom') {
      if (a.order !== b.order) return a.order - b.order
      return byName(a, b)
    }
    const folderDiff = foldersFirst(a, b)
    if (folderDiff !== 0) return folderDiff
    if (sortBy === 'name') return byName(a, b) * dirFactor
    const keyA = sortBy === 'modified' ? a.modifiedAt : a.createdAt
    const keyB = sortBy === 'modified' ? b.modifiedAt : b.createdAt
    if (keyA !== keyB) return (keyA - keyB) * dirFactor
    return byName(a, b)
  })
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
}

function formatNumber(value: number): string {
  return value.toLocaleString()
}

// ── Feature ─────────────────────────────────────────────────────────────

/** Tree row label: extension hidden on files when the setting says so. */
function displayName(entry: VaultEntry, showExtension: boolean): string {
  if (entry.kind !== 'file' || showExtension) return entry.name
  const ext = extOf(entry.name)
  return ext ? entry.name.slice(0, -(ext.length + 1)) : entry.name
}


export function createTreeFeature(
  ctx: SpindleFrontendContext,
  store: Store,
  rpc: RpcClient,
  root: HTMLElement,
  persistSettings: (settings: LuminoteSettings) => Promise<void>,
  hooks: {
    /** Runs BEFORE activeVaultId changes: flush saves + workspace of the old vault. */
    beforeVaultSwitch?: () => Promise<void>
  } = {},
): TreeFeature {
  const disposer = createDisposer()
  const ac = new AbortController()
  const { signal } = ac
  disposer.push(() => ac.abort())

  /** Transient UI state that does not belong in the shared store. */
  let renamingId: string | null = null
  /** Typing progress of the active rename, preserved across re-renders. */
  let renameDraft: string | null = null
  /** Handle for the live rename input so outside clicks settle it first. */
  let activeRename: { input: HTMLInputElement; finish: (commit: boolean) => void } | null = null
  let dragState: {
    entryId: string
  } | null = null
  let dropIndicator:
    | { kind: 'into'; id: string }
    | { kind: 'before'; id: string; after: boolean }
    | { kind: 'root' }
    | null = null
  let autoExpandTimer: ReturnType<typeof setTimeout> | null = null

  // ── Shell ──
  const searchInput = el('input', {
    class: 'lx-search-input',
    attrs: { type: 'search', placeholder: 'Search notes…', 'aria-label': 'Search notes', spellcheck: 'false' },
  }) as HTMLInputElement
  const searchBtn = iconBtn('search', 'Search notes…')
  searchBtn.classList.add('lx-search-toggle')
  const statsBtn = iconBtn('chartColumn', 'Vault statistics…')
  const collapseBtn = iconBtn('chevronsDownUp', 'Collapse all folders')
  // Sort button: icon glyph, or the current sort order as words (setting).
  const sortBtn = el('button', { class: 'lx-icon-btn lx-sort-btn', title: 'Sort order…', attrs: { 'aria-label': 'Sort order' } }) as HTMLButtonElement

  const topbar = el('div', { class: 'lx-topbar' },
    searchBtn, statsBtn, collapseBtn, sortBtn,
  )

  // The input box itself lives in a collapsible panel under the topbar.
  const searchPanel = el('div', { class: 'lx-search-panel', attrs: { hidden: 'true' } },
    el('div', { class: 'lx-search' }, icon('search', 14), searchInput),
  )

  const treeScroller = el('div', { class: 'lx-tree-scroller' })
  const rootDropHint = el('div', { class: 'lx-root-drop-hint', text: 'Move to vault root' })
  const treeEl = el('div', { class: 'lx-tree', attrs: { role: 'tree', 'aria-label': 'Vault files' } })
  treeScroller.append(treeEl, rootDropHint)

  // `.add-note` scopes the primary action for theming (accent-filled button).
  const newNoteBtn = el('button', { class: 'lx-action-btn add-note' }, icon('filePlus', 14), el('span', { text: 'New note' }))
  const newFolderBtn = el('button', { class: 'lx-action-btn' }, icon('folderPlus', 14), el('span', { text: 'New folder' }))
  const actionsBar = el('div', { class: 'lx-tree-actions' }, newNoteBtn, newFolderBtn)

  const pfpBtn = el('div', { class: 'lx-vault-pfp', title: 'Vault avatar', attrs: { 'aria-hidden': 'true' } })
  const vaultNameInput = el('input', {
    class: 'lx-vault-name-input',
    attrs: { type: 'text', placeholder: 'Vault name', 'aria-label': 'Vault name', spellcheck: 'false', readonly: 'true' },
  }) as HTMLInputElement
  const vaultMenuBtn = el('button', {
    class: 'lx-icon-btn lx-vault-settings-btn',
    title: 'Vault options…',
    attrs: { 'aria-label': 'Vault options' },
  }, icon('settings', 15))
  /** Nameplate media layer — sits behind the bar's controls (see CSS). */
  const nameplateLayerRef = el('div', { class: 'lx-vault-bar-nameplate lx-hidden', attrs: { 'aria-hidden': 'true' } })
  const vaultBar = el('div', { class: 'lx-vault-bar' }, nameplateLayerRef, pfpBtn, vaultNameInput, vaultMenuBtn)

  root.append(topbar, searchPanel, treeScroller, actionsBar, vaultBar)

  // Clicking anywhere outside the rename input settles the rename first
  // (Obsidian-style): the commit runs before the click's own side effects.
  document.addEventListener('pointerdown', (event) => {
    const session = activeRename
    if (!session || event.target === session.input) return
    session.finish(true)
  }, { capture: true, signal })

  function iconBtn(name: IconName, title: string): HTMLButtonElement {
    return el('button', { class: 'lx-icon-btn', title, attrs: { 'aria-label': title } }, icon(name, 15)) as HTMLButtonElement
  }

  function toast(message: string): void {
    const note = el('div', { class: 'lx-toast', text: message })
    root.appendChild(note)
    setTimeout(() => note.classList.add('lx-toast-out'), 2600)
    setTimeout(() => note.remove(), 3100)
  }

  // ── Data access ──
  function activeVault(): VaultMeta | undefined {
    const { vaults, activeVaultId } = store.get()
    return vaults.find((v) => v.id === activeVaultId)
  }

  async function refreshEntries(): Promise<void> {
    const vaultId = store.get().activeVaultId
    if (!vaultId) {
      store.set({ entries: [] })
      return
    }
    try {
      const entries = await rpc.call<VaultEntry[]>('entries.list', { vaultId })
      if (store.get().activeVaultId === vaultId) store.set({ entries })
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Failed to load vault')
    }
  }

  async function refreshVaults(): Promise<void> {
    try {
      const vaults = await rpc.call<VaultMeta[]>('vault.list')
      store.set({ vaults })
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Failed to load vaults')
    }
  }

  disposer.push(rpc.onChanged((topic, vaultId) => {
    if (topic === 'entries' && vaultId === store.get().activeVaultId) void refreshEntries()
    if (topic === 'vaults') void refreshVaults()
  }))

  // ── Rendering ──
  function renderTree(): void {
    const { entries, collapsed, search, activeEntryId, settings } = store.get()
    const { sortBy, sortDir } = settings.tree
    const query = search.trim().toLowerCase()

    treeEl.replaceChildren()

    if (entries.length === 0) {
      treeEl.appendChild(el('div', { class: 'lx-tree-empty', text: activeVault() ? 'Empty vault — create your first note.' : 'Create a vault to begin.' }))
      return
    }

    const matches = new Set<string>()
    if (query) {
      const byParent = new Map<string | null, VaultEntry[]>()
      for (const entry of entries) {
        const list = byParent.get(entry.parentId) ?? []
        list.push(entry)
        byParent.set(entry.parentId, list)
      }
      const markWithDescendants = (entry: VaultEntry): boolean => {
        let childMatch = false
        for (const child of byParent.get(entry.id) ?? []) {
          if (markWithDescendants(child)) childMatch = true
        }
        const self = entry.name.toLowerCase().includes(query)
        if (self || childMatch) matches.add(entry.id)
        return self || childMatch
      }
      for (const rootEntry of byParent.get(null) ?? []) markWithDescendants(rootEntry)
    }

    const rows: Array<{ entry: VaultEntry; depth: number }> = []
    const walk = (parentId: string | null, depth: number) => {
      const siblings = sortSiblings(entries.filter((e) => e.parentId === parentId), sortBy, sortDir)
      for (const entry of siblings) {
        if (query && !matches.has(entry.id)) continue
        rows.push({ entry, depth })
        if (entry.kind === 'folder' && (query || !collapsed[entry.id])) walk(entry.id, depth + 1)
      }
    }
    walk(null, 0)

    if (rows.length === 0 && query) {
      treeEl.appendChild(el('div', { class: 'lx-tree-empty', text: 'No notes match your search.' }))
      return
    }

    const dragLine = el('div', { class: 'lx-drag-line' })

    for (const { entry, depth } of rows) {
      const row = buildRow(entry, depth)
      treeEl.appendChild(row)
    }
    treeEl.appendChild(dragLine)
  }

  function buildRow(entry: VaultEntry, depth: number): HTMLElement {
    const { collapsed, activeEntryId, search } = store.get()
    const isFolder = entry.kind === 'folder'
    const isCollapsed = !!collapsed[entry.id]
    const isActive = activeEntryId === entry.id

    const caret = el('button', {
      class: `lx-row-caret${isFolder ? '' : ' lx-caret-hidden'}`,
      attrs: { 'aria-label': isCollapsed ? 'Expand folder' : 'Collapse folder', tabindex: '-1' },
    }, icon('chevronRight', 13))
    if (isCollapsed && isFolder) caret.classList.add('lx-caret-closed')

    // Expanded folders read as folder-open; files always use the plain
    // file glyph, matching Obsidian's tree.
    const iconHolder = el('span', { class: 'lx-row-icon' }, icon(isFolder ? (isCollapsed ? 'folder' : 'folderOpen') : 'file', 15))

    const label = el('span', { class: 'lx-row-label', text: displayName(entry, store.get().settings.tree.showExtension), title: entry.name })

    const menuBtn = el('button', {
      class: 'lx-icon-btn lx-row-menu-btn',
      title: 'More actions…',
      attrs: { 'aria-label': `Actions for ${entry.name}`, tabindex: '-1' },
    }, icon('ellipsis', 14))

    const row = el('div', {
      class: `lx-row${isFolder ? ' lx-row-folder' : ' lx-row-file'}${isActive ? ' lx-row-active' : ''}${dropIndicator && dropIndicator.kind === 'into' && dropIndicator.id === entry.id ? ' lx-drop-into' : ''}`,
      dataset: { entryId: entry.id },
      attrs: { role: 'treeitem', draggable: renamingId === entry.id ? 'false' : 'true' },
      style: { paddingLeft: `${8 + depth * 16}px` },
    }, caret, iconHolder, label, menuBtn)

    if (search && entry.kind === 'file' && entry.name.toLowerCase().includes(search.trim().toLowerCase())) {
      row.classList.add('lx-row-match')
    }

    caret.addEventListener('click', (event) => {
      event.stopPropagation()
      if (!isFolder) return
      toggleCollapsed(entry.id)
    })

    row.addEventListener('click', (event) => {
      if (renamingId === entry.id) return
      if (isFolder) {
        toggleCollapsed(entry.id)
      } else if (event.ctrlKey || event.metaKey) {
        // Obsidian: ctrl/cmd-click (and middle-click) is the "new tab" gesture.
        openEntry(entry, 'new-tab')
      } else {
        openEntry(entry, 'reuse')
      }
    })

    row.addEventListener('auxclick', (event) => {
      if (event.button !== 1 || isFolder || renamingId === entry.id) return
      event.preventDefault()
      openEntry(entry, 'new-tab')
    })

    row.addEventListener('contextmenu', (event) => {
      event.preventDefault()
      event.stopPropagation()
      void showEntryMenu(entry, event.clientX, event.clientY)
    })

    menuBtn.addEventListener('click', (event) => {
      event.stopPropagation()
      const rect = menuBtn.getBoundingClientRect()
      void showEntryMenu(entry, rect.left, rect.bottom + 4)
    })

    row.addEventListener('dragstart', (event) => {
      if (renamingId === entry.id || !event.dataTransfer) return
      dragState = { entryId: entry.id }
      event.dataTransfer.setData('application/x-luminote-entry', entry.id)
      event.dataTransfer.effectAllowed = 'move'
      requestAnimationFrame(() => row.classList.add('lx-row-dragging'))
    })
    row.addEventListener('dragend', () => {
      dragState = null
      dropIndicator = null
      clearAutoExpand()
      renderTree()
    })
    row.addEventListener('dragover', (event) => onRowDragOver(event, entry, row))
    row.addEventListener('dragleave', (event) => {
      if (!row.contains(event.relatedTarget as Node | null)) clearAutoExpand()
    })
    row.addEventListener('drop', (event) => {
      void onDrop(event, entry)
    })

    if (renamingId === entry.id) mountRenameInput(row, label, entry)

    return row
  }

  function toggleCollapsed(folderId: string): void {
    const collapsed = { ...store.get().collapsed }
    if (collapsed[folderId]) delete collapsed[folderId]
    else collapsed[folderId] = true
    store.set({ collapsed })
  }

  function openEntry(entry: VaultEntry, mode: 'reuse' | 'new-tab' | 'split-right' | 'split-down'): void {
    if (entry.kind !== 'file') return
    const { openNoteRequest } = store.get()
    store.set({
      activeEntryId: entry.id,
      openNoteRequest: { entryId: entry.id, mode, tick: (openNoteRequest?.tick ?? 0) + 1 },
    })
  }

  // ── Inline rename ──
  function mountRenameInput(row: HTMLElement, label: HTMLElement, entry: VaultEntry): void {
    row.classList.add('lx-row-renaming')
    const input = el('input', {
      class: 'lx-rename-input',
      attrs: { type: 'text', spellcheck: 'false', 'aria-label': 'Rename' },
    }) as HTMLInputElement
    input.value = renameDraft ?? entry.name
    input.addEventListener('input', () => {
      renameDraft = input.value
    })
    label.replaceWith(input)
    // Rows are built detached (focus() on a detached element is a no-op),
    // so focus once the row is connected — and only if this input instance
    // survived the render cascade. A backend-refresh re-render swaps in a
    // fresh input carrying renameDraft, so the session continues.
    const ext = entry.kind === 'file' ? extOf(input.value) : null
    const stemEnd = ext ? input.value.length - ext.length - 1 : input.value.length
    queueMicrotask(() => {
      if (!input.isConnected) return
      input.focus()
      input.setSelectionRange(0, Math.max(0, stemEnd))
    })

    let settled = false
    const finish = (commit: boolean) => {
      if (settled) return
      settled = true
      renamingId = null
      renameDraft = null
      if (activeRename?.input === input) activeRename = null
      const nextName = input.value
      if (commit && nextName.trim() && nextName !== entry.name) {
        // Same-name intents are allowed — the backend sequences collisions
        // ("todo.md" → "todo 1.md"); tell the user when that happened.
        void rpc.call<VaultEntry>('entry.rename', { vaultId: entryVaultId(), entryId: entry.id, name: nextName })
          .then((renamed) => {
            const expected = extOf(nextName) === null && entry.kind === 'file'
              ? `${sanitizeEntryName(nextName)}.${extOf(entry.name) ?? 'md'}`
              : sanitizeEntryName(nextName)
            if (renamed.name !== entry.name && renamed.name !== expected) {
              toast(`Name was taken — renamed to "${renamed.name}"`)
            }
          })
          .catch((err: unknown) => toast(err instanceof Error ? err.message : 'Rename failed'))
          .finally(() => void refreshEntries())
      } else {
        renderTree()
      }
    }
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') finish(true)
      else if (event.key === 'Escape') finish(false)
      event.stopPropagation()
    })
    // A re-render replaces the row wholesale, and Chromium fires blur for
    // the removed input — that must NOT settle the rename. Genuine user
    // blur (clicking elsewhere) leaves this input connected, so defer a
    // microtask and only commit when the row is still live.
    input.addEventListener('blur', () => {
      queueMicrotask(() => {
        if (input.isConnected) finish(true)
      })
    })
    input.addEventListener('click', (event) => event.stopPropagation())
    activeRename = { input, finish }
  }

  function entryVaultId(): string {
    const vaultId = store.get().activeVaultId
    if (!vaultId) throw new Error('No active vault')
    return vaultId
  }

  // ── Context menus (host-rendered, theme-aware) ──
  async function showEntryMenu(entry: VaultEntry, x: number, y: number): Promise<void> {
    const items = entry.kind === 'folder'
      ? [
          { key: 'new-note', label: 'New note here' },
          { key: 'new-folder', label: 'New folder here' },
          { key: 'div-1', label: '', type: 'divider' as const },
          { key: 'rename', label: 'Rename…' },
          { key: 'delete', label: 'Delete folder…', danger: true },
        ]
      : [
          { key: 'open', label: 'Open' },
          { key: 'open-new-tab', label: 'Open in new tab' },
          { key: 'open-right', label: 'Open to the right' },
          { key: 'div-1', label: '', type: 'divider' as const },
          { key: 'rename', label: 'Rename…' },
          { key: 'delete', label: 'Delete note…', danger: true },
        ]

    const { selectedKey } = await ctx.ui.showContextMenu({ position: { x, y }, items })
    if (!selectedKey) return

    try {
      switch (selectedKey) {
        case 'new-note':
          await createEntry('file', entry.id)
          break
        case 'new-folder':
          await createEntry('folder', entry.id)
          break
        case 'open':
          openEntry(entry, 'reuse')
          break
        case 'open-new-tab':
          openEntry(entry, 'new-tab')
          break
        case 'open-right':
          openEntry(entry, 'split-right')
          break
        case 'rename':
          renamingId = entry.id
          renderTree()
          break
        case 'delete':
          await confirmDelete(entry)
          break
      }
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Action failed')
    }
  }

  async function confirmDelete(entry: VaultEntry): Promise<void> {
    const descendantCount = entry.kind === 'folder'
      ? countDescendants(entry.id)
      : 0
    const message = entry.kind === 'folder'
      ? `Delete folder "${entry.name}" and its ${descendantCount} item${descendantCount === 1 ? '' : 's'}? This cannot be undone.`
      : `Delete note "${entry.name}"? This cannot be undone.`

    // Settings → Sidebar → "Ask before deleting" gates the confirmation.
    if (store.get().settings.tree.confirmDelete) {
      const { confirmed } = await ctx.ui.showConfirm({
        title: entry.kind === 'folder' ? 'Delete folder' : 'Delete note',
        message,
        variant: 'danger',
        confirmLabel: 'Delete',
      })
      if (!confirmed) return
    }

    try {
      await rpc.call('entry.delete', { vaultId: entryVaultId(), entryId: entry.id })
      if (store.get().activeEntryId === entry.id) store.set({ activeEntryId: null })
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Delete failed')
    }
  }

  function countDescendants(folderId: string): number {
    const { entries } = store.get()
    let count = 0
    const frontier = [folderId]
    while (frontier.length > 0) {
      const parent = frontier.pop()!
      for (const entry of entries) {
        if (entry.parentId === parent) {
          count++
          if (entry.kind === 'folder') frontier.push(entry.id)
        }
      }
    }
    return count
  }

  // ── Creation ──
  async function createEntry(kind: 'file' | 'folder', parentId: string | null): Promise<void> {
    const vaultId = entryVaultId()
    // Notes are always Markdown: HTML/SVG content lives in live-preview
    // islands inside a note, so dedicated .html/.svg types are redundant.
    const entry = await rpc.call<VaultEntry>('entry.create', { vaultId, parentId, kind, ...(kind === 'file' ? { ext: 'md' } : {}) })
    if (parentId) {
      const collapsed = { ...store.get().collapsed }
      delete collapsed[parentId]
      store.set({ collapsed })
    }
    renamingId = entry.id
    await refreshEntries()
    if (kind === 'file') openEntry(entry, 'reuse')
    requestAnimationFrame(() => {
      treeEl.querySelector(`[data-entry-id="${entry.id}"]`)?.scrollIntoView({ block: 'nearest' })
    })
  }

  newNoteBtn.addEventListener('click', () => {
    if (!activeVault()) {
      toast('Create a vault first (vault bar below)')
      return
    }
    void createEntry('file', null).catch((err: unknown) => toast(err instanceof Error ? err.message : 'Create failed'))
  }, { signal })

  newFolderBtn.addEventListener('click', () => {
    if (!activeVault()) {
      toast('Create a vault first (vault bar below)')
      return
    }
    void createEntry('folder', null).catch((err: unknown) => toast(err instanceof Error ? err.message : 'Create failed'))
  }, { signal })

  treeScroller.addEventListener('contextmenu', (event) => {
    if ((event.target as HTMLElement).closest('.lx-row')) return
    event.preventDefault()
    void (async () => {
      const { selectedKey } = await ctx.ui.showContextMenu({
        position: { x: event.clientX, y: event.clientY },
        items: [
          { key: 'new-note', label: 'New note' },
          { key: 'new-folder', label: 'New folder' },
        ],
      })
      if (!selectedKey) return
      try {
        if (selectedKey === 'new-note') await createEntry('file', null)
        else if (selectedKey === 'new-folder') await createEntry('folder', null)
      } catch (err) {
        toast(err instanceof Error ? err.message : 'Create failed')
      }
    })()
  }, { signal })

  // ── Topbar wiring ──
  let searchOpen = false
  function syncSearchToggle(): void {
    searchBtn.classList.toggle('lx-search-active', searchOpen || store.get().search.trim().length > 0)
  }
  function setSearchOpen(open: boolean): void {
    searchOpen = open
    searchPanel.hidden = !open
    if (open) {
      requestAnimationFrame(() => searchInput.focus())
    } else if (store.get().search) {
      searchInput.value = ''
      store.set({ search: '' })
    }
    syncSearchToggle()
  }
  searchBtn.addEventListener('click', () => setSearchOpen(!searchOpen), { signal })

  searchInput.addEventListener('input', () => store.set({ search: searchInput.value }), { signal })
  searchInput.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      searchInput.blur()
      setSearchOpen(false)
    }
    event.stopPropagation()
  }, { signal })

  statsBtn.addEventListener('click', () => void showStatsModal(), { signal })

  collapseBtn.addEventListener('click', () => {
    const { entries, collapsed } = store.get()
    const folders = entries.filter((e) => e.kind === 'folder')
    const anyExpanded = folders.some((f) => !collapsed[f.id])
    if (anyExpanded) {
      const next: Record<string, true> = {}
      for (const f of folders) next[f.id] = true
      store.set({ collapsed: next })
    } else {
      store.set({ collapsed: {} })
    }
  }, { signal })

  /** Current sort order as short words for the sort button's text mode. */
  function sortLabel(): string {
    const { sortBy, sortDir } = store.get().settings.tree
    if (sortBy === 'custom') return 'Custom'
    if (sortBy === 'name') return sortDir === 'asc' ? 'Name A–Z' : 'Name Z–A'
    if (sortBy === 'modified') return sortDir === 'desc' ? 'Modified (New)' : 'Modified (Old)'
    return sortDir === 'desc' ? 'Created (New)' : 'Created (Old)'
  }

  function syncSortButton(): void {
    const style = store.get().settings.tree.sortButtonStyle
    sortBtn.classList.toggle('lx-sort-btn-text', style === 'text')
    if (style === 'text') {
      sortBtn.replaceChildren(el('span', { class: 'lx-sort-label', text: sortLabel() }))
    } else {
      sortBtn.replaceChildren(icon('arrowUpDown', 15))
    }
  }

  sortBtn.addEventListener('click', async () => {
    const rect = sortBtn.getBoundingClientRect()
    const current = store.get().settings.tree
    const option = (key: string, label: string, sortBy: SortBy, sortDir: SortDir) => ({
      key,
      label,
      active: current.sortBy === sortBy && current.sortDir === sortDir,
    })
    const { selectedKey } = await ctx.ui.showContextMenu({
      position: { x: rect.left, y: rect.bottom + 4 },
      items: [
        option('custom', 'Custom', 'custom', 'asc'),
        { key: 'div-0', label: '', type: 'divider' },
        option('name-asc', 'File name (A to Z)', 'name', 'asc'),
        option('name-desc', 'File name (Z to A)', 'name', 'desc'),
        { key: 'div-1', label: '', type: 'divider' },
        option('modified-desc', 'Modified time (newest first)', 'modified', 'desc'),
        option('modified-asc', 'Modified time (oldest first)', 'modified', 'asc'),
        { key: 'div-2', label: '', type: 'divider' },
        option('created-desc', 'Created time (newest first)', 'created', 'desc'),
        option('created-asc', 'Created time (oldest first)', 'created', 'asc'),
      ],
    })
    if (!selectedKey) return
    const [sortBy, sortDir] = selectedKey.split('-') as [SortBy, SortDir?]
    const settings = store.get().settings
    store.set({
      settings: {
        ...settings,
        tree: {
          ...settings.tree,
          sortBy: sortBy as SortBy,
          sortDir: (sortDir ?? 'asc') as SortDir,
        },
      },
    })
    void persistSettings(store.get().settings)
  }, { signal })

  const feature: TreeFeature = {
    refreshEntries,
    refreshVaults,
    destroy() {
      disposer.dispose()
    },
  }

  // ── Stats modal ──
  async function showStatsModal(): Promise<void> {
    const vault = activeVault()
    if (!vault) {
      toast('No active vault')
      return
    }
    let stats: VaultStats
    try {
      stats = await rpc.call<VaultStats>('vault.stats', { vaultId: vault.id })
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Failed to compute stats')
      return
    }

    const modal = ctx.ui.showModal({ title: `Vault statistics — ${vault.name}`, width: 400 })
    const grid = el('div', { class: 'lx-stats-grid' })
    const item = (label: string, value: string) => {
      grid.append(
        el('div', { class: 'lx-stats-value', text: value }),
        el('div', { class: 'lx-stats-label', text: label }),
      )
    }
    item('Notes', formatNumber(stats.files))
    item('Folders', formatNumber(stats.folders))
    item('Total words', formatNumber(stats.words))
    item('Total characters', formatNumber(stats.characters))
    item('Total lines', formatNumber(stats.lines))
    item('Estimated tokens', `~${formatNumber(stats.tokens)}`)
    item('Storage used', formatBytes(stats.bytes))
    item('Token estimate', 'chars ÷ 4')
    modal.root.appendChild(grid)
    modal.root.appendChild(el('p', {
      class: 'lx-stats-note',
      text: 'Counts include every note in this vault. Token estimation matches Lumiverse’s chars/4 heuristic.',
    }))
  }

  // ── Drag & drop ──
  function clearAutoExpand(): void {
    if (autoExpandTimer) {
      clearTimeout(autoExpandTimer)
      autoExpandTimer = null
    }
  }

  function onRowDragOver(event: DragEvent, entry: VaultEntry, row: HTMLElement): void {
    if (!dragState || dragState.entryId === entry.id) return
    const dragged = store.get().entries.find((e) => e.id === dragState?.entryId)
    if (!dragged) return
    if (dragged.kind === 'folder' && wouldCycle(dragged.id, entry.id)) return

    event.preventDefault()
    event.stopPropagation()
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move'

    const { settings } = store.get()
    const rect = row.getBoundingClientRect()
    const ratio = (event.clientY - rect.top) / rect.height

    if (entry.kind === 'folder' && ratio > 0.28 && ratio < 0.72) {
      dropIndicator = { kind: 'into', id: entry.id }
      row.classList.add('lx-drop-into')
      hideDragLine()

      clearAutoExpand()
      if (store.get().collapsed[entry.id]) {
        autoExpandTimer = setTimeout(() => toggleCollapsed(entry.id), 650)
      }
    } else if (settings.tree.sortBy === 'custom') {
      dropIndicator = { kind: 'before', id: entry.id, after: ratio >= 0.72 }
      row.classList.remove('lx-drop-into')
      clearAutoExpand()
      showDragLine(row, ratio >= 0.72)
    } else {
      dropIndicator = { kind: 'into', id: entry.kind === 'folder' ? entry.id : (entry.parentId ?? entry.id) }
      row.classList.remove('lx-drop-into')
      hideDragLine()
      clearAutoExpand()
    }
  }

  function wouldCycle(folderId: string, targetId: string): boolean {
    // Moving folderId into targetId must not target itself or a descendant.
    if (folderId === targetId) return true
    const { entries } = store.get()
    let cursor: string | null = targetId
    let hops = 0
    while (cursor && hops++ < 10_000) {
      if (cursor === folderId) return true
      cursor = entries.find((e) => e.id === cursor)?.parentId ?? null
    }
    return false
  }

  let dragLineEl: HTMLElement | null = null

  function showDragLine(row: HTMLElement, after: boolean): void {
    if (!dragLineEl) {
      dragLineEl = treeEl.querySelector('.lx-drag-line')
    }
    if (!dragLineEl) return
    const treeRect = treeEl.getBoundingClientRect()
    const rowRect = row.getBoundingClientRect()
    dragLineEl.style.display = 'block'
    dragLineEl.style.top = `${(after ? rowRect.bottom : rowRect.top) - treeRect.top - 1}px`
    dragLineEl.style.left = `${rowRect.left - treeRect.left + 8}px`
    dragLineEl.style.width = `${rowRect.width - 16}px`
  }

  function hideDragLine(): void {
    const line = treeEl.querySelector<HTMLElement>('.lx-drag-line')
    if (line) line.style.display = 'none'
  }

  async function onDrop(event: DragEvent, target: VaultEntry): Promise<void> {
    event.preventDefault()
    event.stopPropagation()
    const draggedId = dragState?.entryId ?? event.dataTransfer?.getData('application/x-luminote-entry')
    dragState = null
    clearAutoExpand()
    hideDragLine()
    if (!draggedId || draggedId === target.id) {
      dropIndicator = null
      renderTree()
      return
    }

    const { entries, settings } = store.get()
    const dragged = entries.find((e) => e.id === draggedId)
    if (!dragged) return
    if (dragged.kind === 'folder' && wouldCycle(dragged.id, target.id)) {
      toast('Cannot move a folder into itself')
      dropIndicator = null
      renderTree()
      return
    }

    let parentId: string | null
    let order: number | undefined

    const indicator = dropIndicator
    dropIndicator = null

    if (indicator && indicator.kind === 'into') {
      parentId = target.kind === 'folder' ? target.id : target.parentId
    } else if (indicator && indicator.kind === 'before') {
      parentId = target.parentId
      const siblings = sortSiblings(
        entries.filter((e) => e.parentId === parentId && e.id !== dragged.id),
        settings.tree.sortBy,
        settings.tree.sortDir,
      )
      const targetIndex = siblings.findIndex((e) => e.id === target.id)
      const effectiveIndex = indicator.after ? targetIndex + 1 : targetIndex
      const prev = siblings[effectiveIndex - 1]
      const next = siblings[effectiveIndex]
      order = prev && next ? (prev.order + next.order) / 2 : prev ? prev.order + 1024 : next ? next.order - 1024 : 1024
    } else {
      parentId = target.kind === 'folder' ? target.id : target.parentId
    }

    const samePosition = dragged.parentId === parentId && order === undefined
    renderTree()
    if (samePosition && indicator?.kind !== 'into') return

    try {
      await rpc.call('entry.move', {
        vaultId: entryVaultId(),
        entryId: dragged.id,
        parentId,
        ...(order !== undefined ? { order } : {}),
      })
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Move failed')
      await refreshEntries()
    }
  }

  // Root-level drop: empty space in the tree moves the entry to vault root.
  treeScroller.addEventListener('dragover', (event) => {
    if (!dragState) return
    if ((event.target as HTMLElement).closest('.lx-row')) return
    event.preventDefault()
    treeScroller.classList.add('lx-tree-root-drop')
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move'
    dropIndicator = { kind: 'root' }
  }, { signal })
  treeScroller.addEventListener('dragleave', (event) => {
    if (!treeScroller.contains(event.relatedTarget as Node | null)) {
      treeScroller.classList.remove('lx-tree-root-drop')
      if (dropIndicator?.kind === 'root') dropIndicator = null
    }
  }, { signal })
  treeScroller.addEventListener('drop', (event) => {
    if ((event.target as HTMLElement).closest('.lx-row')) return
    void (async () => {
      event.preventDefault()
      treeScroller.classList.remove('lx-tree-root-drop')
      const draggedId = dragState?.entryId ?? event.dataTransfer?.getData('application/x-luminote-entry')
      dragState = null
      dropIndicator = null
      if (!draggedId) return
      const dragged = store.get().entries.find((e) => e.id === draggedId)
      if (!dragged || dragged.parentId === null) {
        renderTree()
        return
      }
      try {
        await rpc.call('entry.move', { vaultId: entryVaultId(), entryId: dragged.id, parentId: null })
      } catch (err) {
        toast(err instanceof Error ? err.message : 'Move failed')
      }
      await refreshEntries()
    })()
  }, { signal })

  // ── Vault bar ──
  const nameplateLayer = nameplateLayerRef
  let nameplateSig = ''

  function syncVaultBar(): void {
    const vault = activeVault()
    const ui = store.get().settings.ui
    pfpBtn.replaceChildren()
    if (vault?.pfp) {
      pfpBtn.appendChild(mediaThumbEl('lx-vault-pfp-img', vault.pfp, vault.pfpMime ?? null))
    } else {
      pfpBtn.appendChild(icon('vault', 16))
    }
    // Discord-style avatar decoration rides on top of the icon.
    if (vault?.pfpDecor) {
      pfpBtn.appendChild(mediaThumbEl('lx-vault-pfp-decor', vault.pfpDecor, vault.pfpDecorMime ?? null))
      pfpBtn.classList.add('lx-vault-pfp-decorated')
    } else {
      pfpBtn.classList.remove('lx-vault-pfp-decorated')
    }
    // Avatar customization is scoped to the workspace vault button. The
    // settings-drawer profile preview deliberately keeps its own fixed size
    // and radius so these controls never reflow the drawer header.
    const avatarSize = Math.min(72, ui.avatarSize)
    pfpBtn.style.width = `${avatarSize}px`
    pfpBtn.style.height = `${avatarSize}px`
    pfpBtn.style.borderRadius = `${ui.avatarRadius}%`

    // The nameplate image layers behind the WHOLE vault bar (not the name
    // text) — it is the vault banner, Discord-profile style. Video plates
    // play inline; the media node is signature-guarded so syncs never
    // restart playback.
    const plateUrl = ui.showNameplate ? vault?.nameplate ?? null : null
    const plateMime = ui.showNameplate ? vault?.nameplateMime ?? null : null
    const nextSig = `${plateUrl ?? ''}|${plateMime ?? ''}`
    if (nextSig !== nameplateSig) {
      nameplateSig = nextSig
      nameplateLayer.replaceChildren()
      if (plateUrl) {
        nameplateLayer.appendChild(mediaThumbEl('lx-vault-bar-nameplate-media', plateUrl, plateMime))
      }
      nameplateLayer.classList.toggle('lx-hidden', !plateUrl)
      vaultBar.classList.toggle('lx-vault-bar-plated', !!plateUrl)
    }
    if (document.activeElement !== vaultNameInput) vaultNameInput.value = vault?.name ?? ''
    vaultNameInput.disabled = !vault
    vaultNameInput.placeholder = vault ? 'Vault name' : 'No vault'
    vaultNameInput.style.fontSize = `${ui.vaultNameFontSize}px`
  }

  // Vault identity is display-only in the workspace bar. Renaming and art
  // changes are intentionally centralized in the settings drawer.

  vaultMenuBtn.addEventListener('click', async () => {
    const rect = vaultMenuBtn.getBoundingClientRect()
    const { vaults, activeVaultId } = store.get()
    const { selectedKey } = await ctx.ui.showContextMenu({
      position: { x: rect.left, y: rect.top - 8 },
      items: [
        ...vaults.map((v) => ({ key: `vault:${v.id}`, label: v.name, active: v.id === activeVaultId })),
        { key: 'div-1', label: '', type: 'divider' as const },
        { key: 'create', label: 'Create new vault…' },
        { key: 'delete', label: 'Delete current vault…', danger: true, disabled: !activeVaultId },
      ],
    })
    if (!selectedKey) return
    try {
      if (selectedKey.startsWith('vault:')) {
        await activateVault(selectedKey.slice('vault:'.length))
      } else if (selectedKey === 'create') {
        await showCreateVaultModal()
      } else if (selectedKey === 'delete') {
        await confirmDeleteVault()
      }
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Vault action failed')
    }
  }, { signal })

  async function activateVault(vaultId: string): Promise<void> {
    if (store.get().activeVaultId === vaultId) return
    // Old vault first: save dirty notes + persist its workspace snapshot.
    await hooks.beforeVaultSwitch?.()
    // The new vault's collapsed-folder state rides its workspace snapshot so
    // vaults restore their own tree shape on switch and relaunch.
    const collapsedMap: Record<string, true> = {}
    try {
      const ws = await rpc.call<{ collapsed?: string[] }>('workspace.get', { vaultId })
      for (const id of ws.collapsed ?? []) collapsedMap[id] = true
    } catch { /* fresh vault */ }
    store.set({ activeVaultId: vaultId, entries: [], collapsed: collapsedMap, activeEntryId: null })
    await Promise.all([
      refreshEntries(),
      rpc.call('vault.activate', { vaultId }).catch(() => undefined),
    ])
  }

  async function showCreateVaultModal(): Promise<void> {
    const modal = ctx.ui.showModal({ title: 'Create vault', width: 360 })
    const input = el('input', {
      class: 'lx-modal-input',
      attrs: { type: 'text', placeholder: 'Vault name', 'aria-label': 'Vault name', spellcheck: 'false' },
    }) as HTMLInputElement
    const createBtn = el('button', { class: 'lx-modal-btn', text: 'Create vault' })
    modal.root.append(el('p', { class: 'lx-modal-hint', text: 'Vaults keep notes and folders in separate workspaces.' }), input, createBtn)
    input.focus()

    const submit = async () => {
      const name = input.value.trim()
      if (!name) {
        input.classList.add('lx-modal-input-error')
        return
      }
      createBtn.setAttribute('disabled', 'true')
      try {
        const vault = await rpc.call<VaultMeta>('vault.create', { name })
        modal.dismiss()
        await refreshVaults()
        await activateVault(vault.id)
      } catch (err) {
        createBtn.removeAttribute('disabled')
        toast(err instanceof Error ? err.message : 'Create failed')
      }
    }
    createBtn.addEventListener('click', () => void submit())
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') void submit()
    })
  }

  async function confirmDeleteVault(): Promise<void> {
    const vault = activeVault()
    if (!vault) return
    let stats: VaultStats | null = null
    try {
      stats = await rpc.call<VaultStats>('vault.stats', { vaultId: vault.id })
    } catch {
      stats = null
    }
    const detail = stats ? ` (${stats.files} note${stats.files === 1 ? '' : 's'})` : ''
    const { confirmed } = await ctx.ui.showConfirm({
      title: 'Delete vault',
      message: `Permanently delete vault "${vault.name}"${detail} and all of its contents? This cannot be undone.`,
      variant: 'danger',
      confirmLabel: 'Delete vault',
    })
    if (!confirmed) return

    await rpc.call('vault.delete', { vaultId: vault.id })
    const vaults = await rpc.call<VaultMeta[]>('vault.list')
    store.set({ vaults, activeVaultId: vaults[0]?.id ?? null, entries: [], collapsed: {}, activeEntryId: null })
    if (store.get().activeVaultId) await refreshEntries()
  }

  // ── Store subscriptions ──
  const rerenderKeys = ['entries', 'collapsed', 'search', 'activeEntryId', 'settings', 'activeVaultId'] as const
  for (const key of rerenderKeys) {
    disposer.push(store.subscribeKey(key, () => {
      renderTree()
      if (key === 'activeVaultId' || key === 'settings' || key === 'entries') syncVaultBar()
      if (key === 'settings') syncSortButton()
    }))
  }
  disposer.push(store.subscribeKey('vaults', syncVaultBar))
  disposer.push(store.subscribeKey('search', () => {
    if (document.activeElement !== searchInput) searchInput.value = store.get().search
    syncSearchToggle()
  }))

  renderTree()
  syncVaultBar()
  syncSortButton()

  return feature
}
