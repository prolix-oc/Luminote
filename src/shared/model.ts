/**
 * Shared wire model for Luminote — used by both the backend worker and the
 * frontend bundle. Keep this file free of runtime-environment imports.
 */
import { z } from 'zod'

// ── Notes ───────────────────────────────────────────────────────────────
// Luminote notes are always Markdown: HTML/SVG content lives in live-preview
// islands inside a note, so dedicated .html/.svg note types were removed.
// (Legacy names ending in those extensions open as plain Markdown source.)

// ── Vaults & entries ────────────────────────────────────────────────────

export interface VaultMeta {
  id: string
  name: string
  createdAt: number
  /** Host image URL (images permission) or legacy inline data: URL; null = default icon. */
  pfp: string | null
  /** Host image asset id when the icon lives in the shared image store. */
  pfpImageId?: string | null
  /** Discord-style avatar decoration overlaid on the vault icon. */
  pfpDecor: string | null
  pfpDecorImageId?: string | null
  /** Nameplate image layered behind the workspace vault bar. */
  nameplate: string | null
  nameplateImageId?: string | null
  /** MIME types of the hosted assets (drives <video> vs <img> rendering). */
  pfpMime?: string | null
  pfpDecorMime?: string | null
  nameplateMime?: string | null
}

export interface VaultEntry {
  id: string
  name: string
  kind: 'file' | 'folder'
  parentId: string | null
  createdAt: number
  modifiedAt: number
  /** Custom sort weight within the parent; only meaningful for sortBy=custom. */
  order: number
}

export interface VaultStats {
  files: number
  folders: number
  words: number
  characters: number
  lines: number
  tokens: number
  bytes: number
}

// ── Settings ────────────────────────────────────────────────────────────

export type ViewMode = 'source' | 'live' | 'reading'

export type SortBy = 'custom' | 'name' | 'modified' | 'created'
export type SortDir = 'asc' | 'desc'

export type OverlayWindowState = 'regular' | 'maximized' | 'minimized'

/** Where the workspace shell lives: the floating overlay, or a host dock panel. */
export type WorkspacePlacement = 'overlay' | 'dock'

/** Stable ids for settings-drawer collapsible cards and their persisted state. */
export const SETTINGS_CARD_SLUGS = [
  'editor',
  'widget',
  'half-dock',
  'overlay',
  'settings-panel',
  'sidebar',
  'statusbar',
  'vault',
] as const
export type SettingsCardSlug = (typeof SETTINGS_CARD_SLUGS)[number]

export interface OverlayGeometry {
  x: number
  y: number
  w: number
  h: number
  /** Window state; geometry fields always describe the REGULAR bounds. */
  state?: OverlayWindowState
}

export interface LuminoteSettings {
  ui: {
    widgetEnabled: boolean
    overlayOpenOnLoad: boolean
    /** Last known overlay visibility (null = fall back to overlayOpenOnLoad). */
    overlayOpen: boolean | null
    overlay: OverlayGeometry | null
    widgetPos: { x: number; y: number } | null
    sidebarWidth: number
    /** File tree visible or tucked away (sidebar toggle button). */
    sidebarCollapsed: boolean
    /** Docked-panel width (the host dock's size on a left/right edge). */
    dockWidth: number
    /** Workspace shell placement: floating overlay window or host dock panel. */
    placement: WorkspacePlacement
    /** Last expanded/collapsed state of every settings-drawer card. */
    settingsCardsExpanded: Record<SettingsCardSlug, boolean>
    /** Settings-drawer banner — deliberately a single upload, no recents. */
    bannerUrl: string | null
    bannerImageId: string | null
    /** Floating-widget icon + decoration overrides (null = default glyph). */
    widgetIconUrl: string | null
    widgetIconImageId: string | null
    widgetDecorUrl: string | null
    widgetDecorImageId: string | null
    widgetSize: number
    /** Floating-widget corner radius as a percent (0 = square, 50 = circle). */
    widgetRadius: number
    widgetOpacity: number
    /** Glide to the nearest screen edge after a drag (extension-side). */
    widgetSnap: boolean
    widgetSnapAnim: boolean
    widgetSnapAnimMs: number
    overlayOpacity: number
    /** Vault Statistics block in the settings drawer body (name stays in the header). */
    showVaultRow: boolean
    /** Profile avatar in the settings-drawer header. */
    showSettingsAvatar: boolean
    /** Vault avatar in the workspace vault bar. */
    showVaultAvatar: boolean
    /** Nameplate image layered behind the workspace vault bar. */
    showNameplate: boolean
    /** Settings-drawer header avatar diameter (px). */
    avatarSize: number
    /** Vault avatar corner radius as a percent (0 = square, 50 = circle). */
    avatarRadius: number
    /** Workspace vault-bar input font size (px). Drawer/titlebar identity stays fixed. */
    vaultNameFontSize: number
    /** MIME types of settings-owned assets (drives <video> vs <img>). */
    bannerMime: string | null
    widgetIconMime: string | null
    widgetDecorMime: string | null
  }
  editor: {
    viewMode: ViewMode
    wordWrap: boolean
    lineNumbers: boolean
    spellcheck: boolean
    fontSize: number
    /** Debounce (ms) before an edit is persisted. 0 = manual save only. */
    autosaveMs: number
    /** CodeMirror bracket/quote auto-pairing while typing. */
    autoPair: boolean
  }
  tree: {
    sortBy: SortBy
    sortDir: SortDir
    /** Show the ".md" extension on file rows in the tree. */
    showExtension: boolean
    /** Show the parent-folder breadcrumb in each pane's view header. */
    showViewHeaderParent: boolean
    /** Topbar sort button shows the glyph or the current sort as words. */
    sortButtonStyle: 'icon' | 'text'
    /** Confirm before deleting notes/folders." */
    confirmDelete: boolean
  }
  statusbar: {
    words: boolean
    characters: boolean
    lines: boolean
    tokens: boolean
    /** Left-side save indicator (Saved / Unsaved / Saving…). */
    showSaved: boolean
    /** Right-side "edited … ago" timestamp. */
    showEdited: boolean
  }
}

export const DEFAULT_SETTINGS: LuminoteSettings = {
  ui: {
    widgetEnabled: true,
    overlayOpenOnLoad: true,
    overlayOpen: null,
    overlay: null,
    widgetPos: null,
    sidebarWidth: 252,
    sidebarCollapsed: false,
    dockWidth: 560,
    placement: 'overlay',
    settingsCardsExpanded: {
      editor: true,
      widget: false,
      'half-dock': false,
      overlay: false,
      'settings-panel': true,
      sidebar: false,
      statusbar: false,
      vault: false,
    },
    bannerUrl: null,
    bannerImageId: null,
    widgetIconUrl: null,
    widgetIconImageId: null,
    widgetDecorUrl: null,
    widgetDecorImageId: null,
    widgetSize: 44,
    widgetRadius: 30,
    widgetOpacity: 1,
    widgetSnap: true,
    widgetSnapAnim: true,
    widgetSnapAnimMs: 220,
    overlayOpacity: 1,
    showVaultRow: true,
    showSettingsAvatar: true,
    showVaultAvatar: true,
    showNameplate: true,
    avatarSize: 56,
    avatarRadius: 50,
    vaultNameFontSize: 12.5,
    bannerMime: null,
    widgetIconMime: null,
    widgetDecorMime: null,
  },
  editor: {
    viewMode: 'live',
    wordWrap: true,
    lineNumbers: true,
    spellcheck: false,
    fontSize: 14,
    autosaveMs: 1200,
    autoPair: true,
  },
  tree: {
    sortBy: 'custom',
    sortDir: 'asc',
    showExtension: true,
    showViewHeaderParent: true,
    sortButtonStyle: 'icon',
    confirmDelete: true,
  },
  statusbar: {
    words: true,
    characters: true,
    lines: true,
    tokens: true,
    showSaved: true,
    showEdited: true,
  },
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function mergeWithDefaults<Defaults>(defaults: Defaults, saved: unknown): Defaults {
  if (saved === undefined) return structuredClone(defaults)
  if (isRecord(defaults) && isRecord(saved)) {
    const merged: Record<string, unknown> = {}
    for (const [key, defaultValue] of Object.entries(defaults)) {
      merged[key] = mergeWithDefaults(defaultValue, (saved as Record<string, unknown>)[key])
    }
    for (const [key, savedValue] of Object.entries(saved)) {
      if (!(key in (defaults as Record<string, unknown>))) merged[key] = structuredClone(savedValue)
    }
    return merged as Defaults
  }
  return structuredClone(saved) as Defaults
}

/** Merge stored settings over the defaults, then whitelist-clamp the enums. */
export const DOCK_MIN_DEFAULT = 360
export const DOCK_MAX_DEFAULT = 1600

/**
 * Compute viewport-aware dock width bounds so large / ultrawide displays
 * can allocate generous workspace width without clipping the chat area.
 */
export function getDockBounds(viewportWidth?: number): { min: number; max: number } {
  const vw = viewportWidth ?? (typeof window !== 'undefined' ? (document.documentElement?.clientWidth || window.innerWidth || 1920) : 1920)
  const min = Math.min(380, Math.max(300, Math.round(vw * 0.2)))
  const max = Math.min(2400, Math.max(min + 120, vw > 600 ? Math.round(vw - 300) : vw))
  return { min, max }
}

export function clampDockWidth(width: number, viewportWidth?: number): number {
  const { min, max } = getDockBounds(viewportWidth)
  return Math.min(max, Math.max(min, Math.round(width)))
}

export function normalizeSettings(saved: unknown): LuminoteSettings {
  const merged = mergeWithDefaults(DEFAULT_SETTINGS, saved) as LuminoteSettings
  const viewModes: ViewMode[] = ['source', 'live', 'reading']
  if (!viewModes.includes(merged.editor.viewMode)) merged.editor.viewMode = DEFAULT_SETTINGS.editor.viewMode
  const sortBys: SortBy[] = ['custom', 'name', 'modified', 'created']
  if (!sortBys.includes(merged.tree.sortBy)) merged.tree.sortBy = DEFAULT_SETTINGS.tree.sortBy
  if (merged.tree.sortDir !== 'asc' && merged.tree.sortDir !== 'desc') merged.tree.sortDir = 'asc'
  merged.editor.fontSize = clampNumber(merged.editor.fontSize, 11, 20, DEFAULT_SETTINGS.editor.fontSize)
  merged.editor.autosaveMs = clampNumber(merged.editor.autosaveMs, 0, 10000, DEFAULT_SETTINGS.editor.autosaveMs)
  merged.ui.sidebarWidth = clampNumber(merged.ui.sidebarWidth, 200, 460, DEFAULT_SETTINGS.ui.sidebarWidth)
  merged.ui.dockWidth = clampNumber(merged.ui.dockWidth, 300, 2400, DEFAULT_SETTINGS.ui.dockWidth)
  merged.editor.wordWrap = merged.editor.wordWrap === true
  merged.editor.lineNumbers = merged.editor.lineNumbers === true
  merged.editor.spellcheck = merged.editor.spellcheck === true
  merged.ui.widgetEnabled = merged.ui.widgetEnabled === true
  merged.ui.overlayOpenOnLoad = merged.ui.overlayOpenOnLoad === true
  merged.ui.overlayOpen = typeof merged.ui.overlayOpen === 'boolean' ? merged.ui.overlayOpen : null
  merged.ui.sidebarCollapsed = merged.ui.sidebarCollapsed === true
  if (merged.ui.placement !== 'overlay' && merged.ui.placement !== 'dock') merged.ui.placement = 'overlay'
  const rawCardStates = isRecord(merged.ui.settingsCardsExpanded)
    ? merged.ui.settingsCardsExpanded
    : DEFAULT_SETTINGS.ui.settingsCardsExpanded
  const normalizedCardStates = {} as Record<SettingsCardSlug, boolean>
  for (const slug of SETTINGS_CARD_SLUGS) {
    const value: unknown = rawCardStates[slug]
    normalizedCardStates[slug] = typeof value === 'boolean'
      ? value
      : DEFAULT_SETTINGS.ui.settingsCardsExpanded[slug]
  }
  merged.ui.settingsCardsExpanded = normalizedCardStates
  merged.tree.showExtension = merged.tree.showExtension === true
  merged.tree.showViewHeaderParent = merged.tree.showViewHeaderParent === true
  if (merged.tree.sortButtonStyle !== 'icon' && merged.tree.sortButtonStyle !== 'text') merged.tree.sortButtonStyle = 'icon'
  merged.tree.confirmDelete = merged.tree.confirmDelete === true
  merged.editor.autoPair = merged.editor.autoPair === true

  merged.ui.widgetSize = clampNumber(merged.ui.widgetSize, 24, 256, DEFAULT_SETTINGS.ui.widgetSize)
  merged.ui.widgetOpacity = clampNumber(merged.ui.widgetOpacity, 0.4, 1, DEFAULT_SETTINGS.ui.widgetOpacity)
  merged.ui.widgetSnap = merged.ui.widgetSnap === true
  merged.ui.widgetSnapAnim = merged.ui.widgetSnapAnim === true
  merged.ui.widgetSnapAnimMs = clampNumber(merged.ui.widgetSnapAnimMs, 0, 900, DEFAULT_SETTINGS.ui.widgetSnapAnimMs)
  merged.ui.overlayOpacity = clampNumber(merged.ui.overlayOpacity, 0.35, 1, DEFAULT_SETTINGS.ui.overlayOpacity)
  merged.ui.showVaultRow = merged.ui.showVaultRow === true
  merged.ui.showSettingsAvatar = merged.ui.showSettingsAvatar === true
  merged.ui.showVaultAvatar = merged.ui.showVaultAvatar === true
  merged.ui.showNameplate = merged.ui.showNameplate === true
  merged.ui.widgetRadius = clampNumber(merged.ui.widgetRadius, 0, 50, DEFAULT_SETTINGS.ui.widgetRadius)
  merged.ui.avatarSize = clampNumber(merged.ui.avatarSize, 48, 72, DEFAULT_SETTINGS.ui.avatarSize)
  merged.ui.avatarRadius = clampNumber(merged.ui.avatarRadius, 0, 50, DEFAULT_SETTINGS.ui.avatarRadius)
  merged.ui.vaultNameFontSize = clampNumber(merged.ui.vaultNameFontSize, 11, 24, DEFAULT_SETTINGS.ui.vaultNameFontSize)
  for (const key of ['bannerUrl', 'bannerImageId', 'widgetIconUrl', 'widgetIconImageId', 'widgetDecorUrl', 'widgetDecorImageId'] as const) {
    const value: unknown = merged.ui[key]
    merged.ui[key] = typeof value === 'string' && value.length > 0 && value.length <= 4_500_000 ? value : null
  }
  for (const key of ['bannerMime', 'widgetIconMime', 'widgetDecorMime'] as const) {
    const value: unknown = merged.ui[key]
    merged.ui[key] = typeof value === 'string' && /^[a-z]+\/[a-z0-9.+-]+$/i.test(value) ? value : null
  }
  for (const key of ['words', 'characters', 'lines', 'tokens', 'showSaved', 'showEdited'] as const) {
    merged.statusbar[key] = merged.statusbar[key] === true
  }
  if (merged.ui.overlay) {
    const states: OverlayWindowState[] = ['regular', 'maximized', 'minimized']
    if (merged.ui.overlay.state !== undefined && !states.includes(merged.ui.overlay.state)) {
      delete merged.ui.overlay.state
    }
  }
  return merged
}

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.min(max, Math.max(min, value))
    : fallback
}

// ── Workspace persistence (per-vault layout) ────────────────────────────
// Everything needed to rebuild the workspace after a vault switch or app
// relaunch: the split-pane tree with each tab's note + view state, which
// pane was active, and which tree folders were collapsed.

export interface WorkspaceTabSnapshot {
  entryId: string
  mode: ViewMode | null
  /** CodeMirror anchor offset; null = leave at start. */
  caret: number | null
  /** Scroller scrollTop; null = leave at top. */
  scroll: number | null
}

export interface WorkspaceLeafSnapshot {
  kind: 'leaf'
  id: string
  /** Index into tabs; -1/invalid = first tab. */
  activeTabIndex: number
  tabs: WorkspaceTabSnapshot[]
}

export interface WorkspaceSplitSnapshot {
  kind: 'split'
  id: string
  dir: 'row' | 'col'
  sizes: number[]
  children: WorkspaceNodeSnapshot[]
}

export type WorkspaceNodeSnapshot = WorkspaceLeafSnapshot | WorkspaceSplitSnapshot

export interface WorkspaceSnapshot {
  version: 1
  root: WorkspaceNodeSnapshot | null
  activeLeafId: string | null
  /** Collapsed folder ids in the file tree. */
  collapsed: string[]
}

// ── IPC protocol ────────────────────────────────────────────────────────

export const PROTOCOL_TAG = 'luminote:1'

const id = z.string().min(1).max(128)
const entryName = z.string().min(1).max(160)

// ── Image slots (avatars / decorations / nameplate / banner) ────────────
// Vault slots live on the vault record; widget/banner slots live in
// settings. The picker's recents bucket is keyed by the same slot string.
export const IMAGE_SLOTS = ['vault-pfp', 'vault-decor', 'vault-nameplate', 'widget-icon', 'widget-decor', 'banner'] as const
export type ImageSlot = (typeof IMAGE_SLOTS)[number]
/** Slots that carry a recents bucket (the banner is a deliberate single upload). */
export const RECENT_IMAGE_SLOTS = ['vault-pfp', 'vault-decor', 'vault-nameplate', 'widget-icon', 'widget-decor'] as const
export type RecentImageSlot = (typeof RECENT_IMAGE_SLOTS)[number]

// Workspace snapshots are UI-generated; validate shape defensively with
// hard caps so a corrupt/huge payload can never wedge the store.
const viewModes = z.enum(['source', 'live', 'reading'])
const wsTab = z.object({
  entryId: z.string().min(1).max(128),
  mode: viewModes.nullable(),
  caret: z.number().int().min(0).max(64_000_000).nullable(),
  scroll: z.number().min(0).max(1_000_000).nullable(),
}).strict()
const wsNode: z.ZodType<unknown> = z.lazy(() =>
  z.union([
    z.object({
      kind: z.literal('leaf'),
      id: z.string().min(1).max(64),
      activeTabIndex: z.number().int().min(0).max(64),
      tabs: z.array(wsTab).max(64),
    }).strict(),
    z.object({
      kind: z.literal('split'),
      id: z.string().min(1).max(64),
      dir: z.enum(['row', 'col']),
      sizes: z.array(z.number().min(0).max(100)).max(8),
      children: z.array(wsNode).max(8),
    }).strict(),
  ]),
)
const wsSnapshot = z.object({
  version: z.literal(1),
  root: wsNode.nullable(),
  activeLeafId: z.string().min(1).max(64).nullable(),
  collapsed: z.array(z.string().min(1).max(128)).max(2048),
}).strict()

export const requestSchemas = {
  'boot': z.object({}).strict(),

  'vault.list': z.object({}).strict(),
  'vault.create': z.object({ name: z.string().trim().min(1).max(80) }).strict(),
  'vault.rename': z.object({ vaultId: id, name: z.string().trim().min(1).max(80) }).strict(),
  'vault.delete': z.object({ vaultId: id }).strict(),
  'vault.activate': z.object({ vaultId: id }).strict(),
  'vault.stats': z.object({ vaultId: id }).strict(),

  'entries.list': z.object({ vaultId: id }).strict(),
  'entry.create': z.object({
    vaultId: id,
    parentId: id.nullable(),
    kind: z.enum(['file', 'folder']),
    ext: z.enum(['md']).optional(),
  }).strict(),
  'entry.rename': z.object({ vaultId: id, entryId: id, name: entryName }).strict(),
  'entry.move': z.object({
    vaultId: id,
    entryId: id,
    parentId: id.nullable(),
    order: z.number().finite().optional(),
  }).strict(),
  'entry.delete': z.object({ vaultId: id, entryId: id }).strict(),

  'note.read': z.object({ vaultId: id, entryId: id }).strict(),
  'note.write': z.object({
    vaultId: id,
    entryId: id,
    // Notes are plain text blobs on disk — no artificial small cap (regular
    // spindle storage has no per-file limit; ephemeral backups do).
    content: z.string().max(64_000_000),
  }).strict(),

  'settings.get': z.object({}).strict(),
  'settings.set': z.object({ settings: z.unknown() }).strict(),

  'image.recents': z.object({ slot: z.enum(RECENT_IMAGE_SLOTS) }).strict(),
  // Uploads arrive as a stage id, never bytes: the frontend streams the
  // file to the host's tus endpoint (/api/v1/spindle-uploads, see
  // developer-docs/backend-api/uploads.md) and sends only the returned id,
  // keeping the IPC channel free of multi-MB payloads (and far under the
  // 4 MB SPINDLE_BACKEND_MSG cap that used to stall the worker).
  'image.set': z.object({
    slot: z.enum(IMAGE_SLOTS),
    vaultId: id.optional(),
    uploadId: z.string().min(1).max(128).regex(/^[A-Za-z0-9_-]+$/),
    fileName: z.string().max(256).optional(),
    mimeType: z.string().max(100).optional(),
  }).strict(),
  'image.select': z.object({
    slot: z.enum(RECENT_IMAGE_SLOTS),
    vaultId: id.optional(),
    url: z.string().min(1).max(2048),
    /** Picker-known MIME (recents carry video too); drives <video> renders. */
    mime: z.string().max(100).optional(),
  }).strict(),
  'image.clear': z.object({
    slot: z.enum(IMAGE_SLOTS),
    vaultId: id.optional(),
  }).strict(),
  'image.forget': z.object({
    slot: z.enum(RECENT_IMAGE_SLOTS),
    url: z.string().min(1).max(2048),
  }).strict(),

  'workspace.get': z.object({ vaultId: id }).strict(),
  'workspace.set': z.object({ vaultId: id, workspace: wsSnapshot }).strict(),
} as const

export type OpName = keyof typeof requestSchemas

export interface IpcRequest {
  $luminote: 1
  kind: 'req'
  id: string
  op: OpName
  payload: unknown
}

export interface IpcResponse {
  $luminote: 1
  kind: 'res'
  id: string
  op: OpName
  payload?: unknown
  error?: string
}

export interface IpcEvent {
  $luminote: 1
  kind: 'event'
  event: string
  payload: unknown
}

export function isIpcEnvelope(value: unknown): value is { $luminote: 1; kind: string } {
  return isRecord(value) && value.$luminote === 1 && typeof value.kind === 'string'
}

// ── Boot payload ────────────────────────────────────────────────────────

export interface BootPayload {
  settings: LuminoteSettings
  vaults: VaultMeta[]
  activeVaultId: string | null
  permissions: {
    app_manipulation: boolean
    ui_panels: boolean
    images: boolean
    ephemeral_storage: boolean
    /** FFmpeg media pipeline (declared; video *assets* ride the images store). */
    media: boolean
  }
}

// ── Naming helpers ──────────────────────────────────────────────────────

export const SUPPORTED_EXTS = ['md'] as const
export type SupportedExt = (typeof SUPPORTED_EXTS)[number]

/** Characters that cannot appear in a stored note/folder name. */
const ILLEGAL_NAME_CHARS_RE = /[/\\?%*:|"<>]/g
const CONTROL_CHARS_RE = /[\u0000-\u001f]/g

export function sanitizeEntryName(raw: string): string {
  return raw.replace(ILLEGAL_NAME_CHARS_RE, ' ').replace(CONTROL_CHARS_RE, '').replace(/\s+/g, ' ').trim()
}

export function extOf(name: string): SupportedExt | null {
  const lower = name.toLowerCase()
  for (const ext of SUPPORTED_EXTS) {
    if (lower.endsWith(`.${ext}`)) return ext
  }
  return null
}
