/**
 * Central observable store. Feature modules never import each other — all
 * cross-module coordination flows through this store (plus the rpc client).
 *
 * High-frequency editor content intentionally lives outside the store (each
 * pane owns its CodeMirror document); only metadata, status flags and
 * explicit "bus" requests move through here.
 */
import type { LuminoteSettings, VaultEntry, VaultMeta } from '../shared/model'

export interface PaneStats {
  words: number
  characters: number
  lines: number
  tokens: number
}

export type SaveState = 'saved' | 'saving' | 'dirty' | 'error'

export type NoteOpenMode = 'reuse' | 'new-tab' | 'split-right' | 'split-down'

export interface OpenNoteRequest {
  entryId: string
  mode: NoteOpenMode
  /** Monotonic tick so repeated opens of the same note still notify. */
  tick: number
}

export interface LuminoteState {
  ready: boolean
  booted: boolean
  permissions: { app_manipulation: boolean; ui_panels: boolean; images: boolean; ephemeral_storage: boolean; media: boolean }

  settings: LuminoteSettings
  overlayVisible: boolean

  vaults: VaultMeta[]
  activeVaultId: string | null
  entries: VaultEntry[]
  /** Collapsed folder ids for the active vault (session scoped). */
  collapsed: Record<string, true>
  search: string

  openNoteRequest: OpenNoteRequest | null
  /** Entry of the active editor pane (drives tree highlight + status bar). */
  activeEntryId: string | null
  /** Counter that bumps whenever pane structure changes. */
  paneEpoch: number

  saveState: SaveState
  activeStats: PaneStats | null
  activeModifiedAt: number | null
}

type Listener = () => void

export class Store {
  private state: LuminoteState
  private listeners = new Set<Listener>()
  private keyListeners = new Map<keyof LuminoteState, Set<Listener>>()

  constructor(initial: LuminoteState) {
    this.state = initial
  }

  get(): LuminoteState {
    return this.state
  }

  set(patch: Partial<LuminoteState>): void {
    const changed: Array<keyof LuminoteState> = []
    for (const key of Object.keys(patch) as Array<keyof LuminoteState>) {
      if (!Object.is(this.state[key], patch[key])) changed.push(key)
    }
    if (changed.length === 0) return
    this.state = { ...this.state, ...patch }
    for (const listener of this.listeners) listener()
    for (const key of changed) {
      const subs = this.keyListeners.get(key)
      if (subs) for (const listener of subs) listener()
    }
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  subscribeKey(key: keyof LuminoteState, listener: Listener): () => void {
    let subs = this.keyListeners.get(key)
    if (!subs) {
      subs = new Set()
      this.keyListeners.set(key, subs)
    }
    subs.add(listener)
    return () => subs.delete(listener)
  }
}

export function createInitialState(settings: LuminoteSettings): LuminoteState {
  return {
    ready: false,
    booted: false,
    permissions: { app_manipulation: false, ui_panels: false, images: false, ephemeral_storage: false, media: false },
    settings,
    overlayVisible: false,
    vaults: [],
    activeVaultId: null,
    entries: [],
    collapsed: {},
    search: '',
    openNoteRequest: null,
    activeEntryId: null,
    paneEpoch: 0,
    saveState: 'saved',
    activeStats: null,
    activeModifiedAt: null,
  }
}
