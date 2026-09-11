/**
 * Luminote backend storage layer.
 *
 * All persistence goes through `spindle.storage.*` — the extension's scoped
 * storage directory. Layout:
 *
 *   settings.json                       extension settings
 *   meta.json                           { activeVaultId }
 *   vaults.json                         VaultMeta[]
 *   vaults/<vaultId>/entries.json       VaultEntry[]  (flat list, parent links)
 *   vaults/<vaultId>/workspace.json     per-vault UI layout snapshot (panes,
 *                                       tabs, view state, collapsed folders)
 *   vaults/<vaultId>/blob/<entryId>.txt note content (keyed by stable id, so
 *                                       renames/moves never touch the blob)
 */
import {
  DEFAULT_SETTINGS,
  normalizeSettings,
  sanitizeEntryName,
  SUPPORTED_EXTS,
  extOf,
  type LuminoteSettings,
  type VaultEntry,
  type VaultMeta,
  type VaultStats,
  type SupportedExt,
  type WorkspaceSnapshot,
} from '../shared/model'
import { normalizeArtMime } from '../shared/media-types'
import { uuidv7 } from '../shared/uuid'

declare const spindle: import('lumiverse-spindle-types').SpindleAPI

// ── Per-key promise queue (serializes read-modify-write cycles) ─────────

const queues = new Map<string, Promise<unknown>>()

function withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const prev = queues.get(key) ?? Promise.resolve()
  const next = prev.then(fn, fn)
  queues.set(
    key,
    next.catch(() => undefined),
  )
  return next
}

// ── Small helpers ───────────────────────────────────────────────────────

const encoder = new TextEncoder()

async function readJson<T>(path: string, fallback: T): Promise<T> {
  return spindle.storage.getJson<T>(path, { fallback })
}

async function vaultExists(vaultId: string): Promise<boolean> {
  const vaults = await listVaults()
  return vaults.some((v) => v.id === vaultId)
}

async function requireVault(vaultId: string): Promise<void> {
  if (!(await vaultExists(vaultId))) throw new Error(`Unknown vault: ${vaultId}`)
}

// ── Settings ────────────────────────────────────────────────────────────

export async function getSettings(): Promise<LuminoteSettings> {
  const saved = await readJson<unknown>('settings.json', undefined)
  return normalizeSettings(saved ?? DEFAULT_SETTINGS)
}

export async function setSettings(raw: unknown): Promise<LuminoteSettings> {
  const normalized = normalizeSettings(raw)
  await spindle.storage.setJson('settings.json', normalized, { indent: 2 })
  return normalized
}

// ── Meta (active vault pointer) ─────────────────────────────────────────

interface MetaFile {
  activeVaultId: string | null
}

export async function getMeta(): Promise<MetaFile> {
  return readJson<MetaFile>('meta.json', { activeVaultId: null })
}

async function setMeta(meta: MetaFile): Promise<void> {
  await spindle.storage.setJson('meta.json', meta)
}

export async function setActiveVault(vaultId: string | null): Promise<void> {
  if (vaultId !== null) await requireVault(vaultId)
  await setMeta({ activeVaultId: vaultId })
}

// ── Vaults ──────────────────────────────────────────────────────────────

export async function listVaults(): Promise<VaultMeta[]> {
  const vaults = await readJson<VaultMeta[]>('vaults.json', [])
  return vaults
    .filter((v) => v && typeof v.id === 'string' && typeof v.name === 'string')
    .map((v) => ({
      ...v,
      pfp: typeof v.pfp === 'string' ? v.pfp : null,
      pfpDecor: typeof v.pfpDecor === 'string' ? v.pfpDecor : null,
      nameplate: typeof v.nameplate === 'string' ? v.nameplate : null,
    }))
}

async function writeVaults(vaults: VaultMeta[]): Promise<void> {
  await spindle.storage.setJson('vaults.json', vaults)
}

export async function createVault(name: string): Promise<VaultMeta> {
  return withLock('vaults', async () => {
    const vaults = await listVaults()
    const trimmed = name.trim() || 'Untitled vault'
    const taken = new Set(vaults.map((v) => v.name.toLowerCase()))
    let finalName = trimmed
    for (let i = 2; taken.has(finalName.toLowerCase()); i++) finalName = `${trimmed} ${i}`
    const vault: VaultMeta = { id: uuidv7(), name: finalName, createdAt: Date.now(), pfp: null, pfpDecor: null, nameplate: null }
    vaults.push(vault)
    await writeVaults(vaults)
    await spindle.storage.setJson(entriesPath(vault.id), [])
    await setMeta({ activeVaultId: vault.id })
    return vault
  })
}

export async function renameVault(vaultId: string, name: string): Promise<VaultMeta[]> {
  return withLock('vaults', async () => {
    await requireVault(vaultId)
    const trimmed = name.trim()
    if (!trimmed) throw new Error('Vault name cannot be empty')
    const vaults = await listVaults()
    for (const v of vaults) if (v.id === vaultId) v.name = trimmed
    await writeVaults(vaults)
    return vaults
  })
}

function imagesAvailable(): boolean {
  try {
    return !!spindle.permissions?.has?.('images')
  } catch {
    return false
  }
}

function mediaAvailable(): boolean {
  try {
    return !!spindle.permissions?.has?.('media')
  } catch {
    return false
  }
}

// ── Image slots (avatars / decorations / nameplate / banner) ────────────
// One uploader feeds every image the extension shows: vault avatar,
// avatar decoration, vault nameplate, widget icon/decoration, and the
// settings banner. Every slot except the banner keeps a 6-deep MRU of
// recent uploads so cycling back never re-uploads or duplicates.
//
// Replaced assets are NOT deleted — recents would 404. Orphaned hosted
// assets are owned by the extension and reclaimed by the host image GC.

const IMAGE_RECENTS_PATH = 'images.json'
/** Per-URL MIME index for the recents buckets (tiny, bounded by recents). */
const IMAGE_MIMES_PATH = 'images-mimes.json'
const IMAGE_RECENTS_MAX = 6

type VaultSlotFields = {
  url: 'pfp' | 'pfpDecor' | 'nameplate'
  id: 'pfpImageId' | 'pfpDecorImageId' | 'nameplateImageId'
  mime: 'pfpMime' | 'pfpDecorMime' | 'nameplateMime'
}
type SettingsSlotFields = {
  url: 'bannerUrl' | 'widgetIconUrl' | 'widgetDecorUrl'
  id: 'bannerImageId' | 'widgetIconImageId' | 'widgetDecorImageId'
  mime: 'bannerMime' | 'widgetIconMime' | 'widgetDecorMime'
}

const VAULT_SLOT_FIELDS: Record<string, VaultSlotFields> = {
  'vault-pfp': { url: 'pfp', id: 'pfpImageId', mime: 'pfpMime' },
  'vault-decor': { url: 'pfpDecor', id: 'pfpDecorImageId', mime: 'pfpDecorMime' },
  'vault-nameplate': { url: 'nameplate', id: 'nameplateImageId', mime: 'nameplateMime' },
}
const SETTINGS_SLOT_FIELDS: Record<string, SettingsSlotFields> = {
  'widget-icon': { url: 'widgetIconUrl', id: 'widgetIconImageId', mime: 'widgetIconMime' },
  'widget-decor': { url: 'widgetDecorUrl', id: 'widgetDecorImageId', mime: 'widgetDecorMime' },
  'banner': { url: 'bannerUrl', id: 'bannerImageId', mime: 'bannerMime' },
}

async function readImageRecents(): Promise<Record<string, string[]>> {
  const raw = await readJson<Record<string, unknown>>(IMAGE_RECENTS_PATH, {})
  const out: Record<string, string[]> = {}
  for (const [slot, list] of Object.entries(raw)) {
    if (!Array.isArray(list)) continue
    const clean = list.filter((v): v is string =>
      typeof v === 'string' && v.length > 0 && v.length <= 2048)
    if (clean.length) out[slot] = clean.slice(0, IMAGE_RECENTS_MAX)
  }
  return out
}

/** The MIME index answers "is this recent a video?" without touching bytes. */
async function readImageMimes(): Promise<Record<string, string>> {
  const raw = await readJson<Record<string, unknown>>(IMAGE_MIMES_PATH, {})
  const out: Record<string, string> = {}
  for (const [url, mime] of Object.entries(raw)) {
    if (typeof url === 'string' && typeof mime === 'string' && /^[a-z]+\/[a-z0-9.+-]+$/i.test(mime)) out[url] = mime
  }
  return out
}

async function rememberImageMime(url: string, mime: string | null | undefined): Promise<void> {
  await withLock('image-mimes', async () => {
    const all = await readImageMimes()
    if (mime && /^[a-z]+\/[a-z0-9.+-]+$/i.test(mime)) all[url] = mime
    else delete all[url]
    await spindle.storage.setJson(IMAGE_MIMES_PATH, all, { indent: 2 })
  })
}

/** The index serves the picker's recents only; anything else is dead weight. */
async function pruneImageMimesToRecents(): Promise<void> {
  await withLock('image-mimes', async () => {
    const all = await readImageMimes()
    const recents = await readImageRecents()
    const keep = new Set(Object.values(recents).flat())
    const next: Record<string, string> = {}
    for (const [url, mime] of Object.entries(all)) if (keep.has(url)) next[url] = mime
    if (Object.keys(next).length !== Object.keys(all).length) {
      await spindle.storage.setJson(IMAGE_MIMES_PATH, next, { indent: 2 })
    }
  })
}

/** Mimes for a recents list, sparse (unknowns omitted). */
async function mimesFor(urls: string[]): Promise<Record<string, string>> {
  const all = await readImageMimes()
  const out: Record<string, string> = {}
  for (const url of urls) if (all[url]) out[url] = all[url]
  return out
}

/** Push a URL to the front of the slot's MRU (dedupe first) and persist. */
async function bumpImageRecents(slot: string, url: string): Promise<string[]> {
  return withLock('image-recents', async () => {
    const all = await readImageRecents()
    const next = [url, ...(all[slot] ?? []).filter((u) => u !== url)].slice(0, IMAGE_RECENTS_MAX)
    all[slot] = next
    await spindle.storage.setJson(IMAGE_RECENTS_PATH, all, { indent: 2 })
    return next
  })
}

export async function imageRecents(slot: string): Promise<{ recents: string[]; mimes: Record<string, string> }> {
  const all = await readImageRecents()
  if (!VAULT_SLOT_FIELDS[slot] && !SETTINGS_SLOT_FIELDS[slot]) throw new Error(`Unknown image slot: ${slot}`)
  const recents = all[slot] ?? []
  return { recents, mimes: await mimesFor(recents) }
}

/** Apply a URL (or null on clear) to the slot's home — the vault record or settings. */
async function applyImageToSlot(
  slot: string,
  vaultId: string | undefined,
  url: string | null,
  imageId: string | null,
  mime: string | null,
): Promise<void> {
  const vaultFields = VAULT_SLOT_FIELDS[slot]
  if (vaultFields) {
    // Vault-index writes share the 'vaults' lock with every other entry/
    // vault mutation so two ops can never tear vaults.json.
    return withLock('vaults', async () => {
      if (!vaultId) throw new Error('vaultId required for vault image slots')
      await requireVault(vaultId)
      const vaults = await listVaults()
      const vault = vaults.find((v) => v.id === vaultId)
      if (!vault) throw new Error('Vault not found')
      vault[vaultFields.url] = url
      vault[vaultFields.id] = imageId
      vault[vaultFields.mime] = mime
      await writeVaults(vaults)
    })
  }
  const settingsFields = SETTINGS_SLOT_FIELDS[slot]
  if (!settingsFields) throw new Error(`Unknown image slot: ${slot}`)
  const settings = await getSettings()
  ;(settings.ui as Record<string, unknown>)[settingsFields.url] = url
  ;(settings.ui as Record<string, unknown>)[settingsFields.id] = imageId
  ;(settings.ui as Record<string, unknown>)[settingsFields.mime] = mime
  await setSettings(settings)
}

export async function imageSet(
  slot: string,
  vaultId: string | undefined,
  uploadId: string,
  fileName?: string,
  mimeType?: string,
  userId?: string,
): Promise<{ url: string; mime: string; recents?: string[]; mimes?: Record<string, string> }> {
  return withLock('image-slots', async () => {
    if (!imagesAvailable()) {
      throw new Error('The Images permission is required to upload — grant it in Settings → Permissions.')
    }
    // The frontend staged the file with the host's tus endpoint; pull the
    // assembled bytes locally instead of dragging megabytes across IPC.
    // userId is threaded from the frontend message: required on
    // operator-scoped installs, harmlessly overridden on user-scoped ones.
    const staged = await spindle.uploads.get(uploadId, userId)
    if (!staged?.data?.length) {
      throw new Error('That upload expired — pick the image again.')
    }
    try {
      const mime = stagedMime(staged, mimeType, fileName)
      if (!mime) {
        throw new Error('Use a WEBM, WEBP, MP4, GIF, PNG, JPG, or JPEG file.')
      }
      const uploadName = fileName ?? staged.fileName ?? `luminote-${slot}${vaultId ? `-${vaultId}` : ''}.png`

      // Videos are normalized to silent H.264 MP4 through the host media
      // pipeline (matching Lumiverse's wallpaper uploads) so looping art
      // plays reliably. Falls back to the raw bytes when the media
      // permission is missing or the transcode fails.
      const normalized = await transcodeVideoForStorage(uploadId, userId, staged, mime, uploadName)

      // The host image store persists stills, GIFs and videos alike
      // (developer-docs/backend-api/images.md: mime_type accepts video/*)
      // and generates poster thumbnails for video on demand.
      const uploaded = await spindle.images.upload({
        data: normalized ? normalized.data : staged.data,
        filename: normalized ? normalized.filename : uploadName,
        mime_type: normalized ? normalized.mime : mime,
      }, userId)
      const url = uploaded.url
      const imageId = uploaded.id
      const storedMime = normalized ? normalized.mime : mime
      await rememberImageMime(url, storedMime)
      await applyImageToSlot(slot, vaultId, url, imageId, storedMime)
      const recents = slot === 'banner' ? undefined : await bumpImageRecents(slot, url)
      await pruneImageMimesToRecents()
      return { url, mime: storedMime, recents, mimes: recents ? await mimesFor(recents) : undefined }
    } finally {
      // Consumed — free the staged file rather than letting it sit until TTL.
      await spindle.uploads.delete(uploadId, userId).catch(() => undefined)
    }
  })
}

/** Resolve and strictly gate staged art using the same list as the picker. */
function stagedMime(staged: { fileName?: string }, hint: string | undefined, fileName: string | undefined): string | null {
  return normalizeArtMime(hint, fileName ?? staged.fileName)
}

/**
 * Normalize a staged video through the host media pipeline before storing it,
 * mirroring Lumiverse's own wallpaper upload path: transcode to H.264 MP4
 * with the audio stripped, so the asset loops and plays reliably across
 * browsers (WebM timestamp quirks and software HEVC are the two big sources
 * of frozen/looping art). The host reads the staged file straight from disk
 * (`kind: "upload"`), so the bytes never round-trip through the worker.
 *
 * Returns null (caller stores the original) when the source isn't a video,
 * is a WebM (whose alpha transparency must survive), the `media` permission
 * is missing, or the transcode fails — GIFs and stills always pass through
 * untranscoded.
 */
async function transcodeVideoForStorage(
  uploadId: string,
  userId: string | undefined,
  staged: { fileName?: string },
  mime: string,
  uploadName: string,
): Promise<{ data: Uint8Array; mime: string; filename: string } | null> {
  if (!mime.startsWith('video/')) return null
  // WebM (VP8/VP9) is the only format that can carry alpha transparency, and
  // transcoding it to H.264 MP4 (which has no alpha channel — the host forces
  // yuv420p) would bake the transparent pixels to black. Store WebM as-is so
  // its transparency survives; only MP4/other sources get the H.264 pass.
  if (mime === 'video/webm') return null
  if (!mediaAvailable()) return null
  try {
    const outName = uploadName.replace(/\.[^.]+$/, '') + '.mp4'
    const result = await spindle.media.transcodeVideo({
      source: { kind: 'upload', upload_id: uploadId, filename: staged.fileName, mime_type: mime },
      output_format: 'mp4',
      video_codec: 'h264',
      audio_codec: 'none',
      faststart: true,
      filename: outName,
      userId,
    })
    if (!result?.data?.length) return null
    return {
      data: result.data,
      mime: result.mime_type || 'video/mp4',
      filename: result.filename || outName,
    }
  } catch (err) {
    // ffmpeg unavailable or the transcode failed — store the original.
    console.warn('[luminote] Video transcode failed, storing original:', err)
    return null
  }
}


/** Apply an existing recent — never uploads, never duplicates the bucket. */
export async function imageSelect(
  slot: string,
  vaultId: string | undefined,
  url: string,
  mime?: string,
): Promise<{ recents: string[]; mimes: Record<string, string> }> {
  return withLock('image-slots', async () => {
    // Hosted assets may come back as root-relative paths (the host serves
    // them), so allow `/…` alongside absolute http(s) and inline data URLs.
    if (!/^(https?:\/\/|\/|data:(image|video)\/)/.test(url)) {
      throw new Error('Image URL must be http(s), root-relative, or a data: image/video URL')
    }
    if (slot === 'banner') throw new Error('The banner has no recents')
    const knownMime = mime && /^[a-z]+\/[a-z0-9.+-]+$/i.test(mime)
      ? mime
      : (/^data:([^;,]+)/.exec(url)?.[1] ?? null)
    if (knownMime) await rememberImageMime(url, knownMime)
    await applyImageToSlot(slot, vaultId, url, null, knownMime)
    // The hosting id is only tracked for the freshest upload; re-applied
    // recents keep working while their asset is alive in the host store.
    const recents = await bumpImageRecents(slot, url)
    return { recents, mimes: await mimesFor(recents) }
  })
}

export async function imageClear(slot: string, vaultId: string | undefined): Promise<void> {
  return withLock('image-slots', async () => {
    await applyImageToSlot(slot, vaultId, null, null, null)
  })
}

/** Drop one URL from a slot's recents MRU. Never touches the applied asset. */
export async function imageForgetRecent(
  slot: string,
  url: string,
): Promise<{ recents: string[]; mimes: Record<string, string> }> {
  return withLock('image-recents', async () => {
    const all = await readImageRecents()
    const next = (all[slot] ?? []).filter((u) => u !== url)
    all[slot] = next
    await spindle.storage.setJson(IMAGE_RECENTS_PATH, all, { indent: 2 })
    await pruneImageMimesToRecents()
    return { recents: next, mimes: await mimesFor(next) }
  })
}

export async function deleteVault(vaultId: string, userId?: string): Promise<void> {
  return withLock('vaults', async () => {
    await requireVault(vaultId)
    const vaults = await listVaults()
    // Hosted vault icon (if any) goes back to the shared image store GC.
    const doomedVault = vaults.find((v) => v.id === vaultId)
    if (doomedVault?.pfpImageId && imagesAvailable()) {
      void spindle.images.delete(doomedVault.pfpImageId, userId).catch(() => undefined)
    }
    await writeVaults(vaults.filter((v) => v.id !== vaultId))
    // Remove entries index + every blob under the vault prefix.
    await spindle.storage.delete(entriesPath(vaultId)).catch(() => undefined)
    const blobs = await spindle.storage.list(`vaults/${vaultId}/`)
    await Promise.all(blobs.map((p) => spindle.storage.delete(p).catch(() => undefined)))
    // …plus any ephemeral backup copies (7-day TTL handles stragglers anyway).
    if (ephemeralAvailable()) {
      void spindle.ephemeral.list(`backups/${vaultId}/`)
        .then((paths) => Promise.all(paths.map((p) => spindle.ephemeral.delete(p).catch(() => undefined))))
        .catch(() => undefined)
    }
    const meta = await getMeta()
    if (meta.activeVaultId === vaultId) {
      const remaining = await listVaults()
      await setMeta({ activeVaultId: remaining[0]?.id ?? null })
    }
  })
}

// ── Entries ─────────────────────────────────────────────────────────────

function entriesPath(vaultId: string): string {
  return `vaults/${vaultId}/entries.json`
}

function workspacePath(vaultId: string): string {
  return `vaults/${vaultId}/workspace.json`
}

// ── Workspace (per-vault UI layout) ─────────────────────────────────────
// The frontend owns the snapshot shape (zod-validated on the way in); the
// backend just keeps it next to the vault's entries so vault delete purges
// it along with everything else.

const EMPTY_WORKSPACE: WorkspaceSnapshot = { version: 1, root: null, activeLeafId: null, collapsed: [] }

export async function getWorkspace(vaultId: string): Promise<WorkspaceSnapshot> {
  await requireVault(vaultId)
  const saved = await readJson<unknown>(workspacePath(vaultId), undefined)
  if (!saved || typeof saved !== 'object' || (saved as { version?: unknown }).version !== 1) {
    return structuredClone(EMPTY_WORKSPACE)
  }
  return saved as WorkspaceSnapshot
}

export async function setWorkspace(vaultId: string, workspace: WorkspaceSnapshot): Promise<{ ok: true }> {
  return withLock(`workspace:${vaultId}`, async () => {
    await requireVault(vaultId)
    if (JSON.stringify(workspace).length > 512_000) throw new Error('Workspace snapshot too large')
    await spindle.storage.setJson(workspacePath(vaultId), workspace)
    return { ok: true }
  })
}

function blobPath(vaultId: string, entryId: string): string {
  return `vaults/${vaultId}/blob/${entryId}.txt`
}

export async function listEntries(vaultId: string): Promise<VaultEntry[]> {
  await requireVault(vaultId)
  const entries = await readJson<VaultEntry[]>(entriesPath(vaultId), [])
  return entries.filter((e) => e && typeof e.id === 'string')
}

async function writeEntries(vaultId: string, entries: VaultEntry[]): Promise<void> {
  await spindle.storage.setJson(entriesPath(vaultId), entries)
}

function siblingNames(entries: VaultEntry[], parentId: string | null, excludeId?: string): Set<string> {
  const names = new Set<string>()
  for (const e of entries) {
    if (e.parentId === parentId && e.id !== excludeId) names.add(e.name.toLowerCase())
  }
  return names
}

function isDescendantOf(entries: VaultEntry[], nodeId: string, maybeAncestorId: string): boolean {
  let cursor: string | null = maybeAncestorId
  let hops = 0
  while (cursor) {
    if (cursor === nodeId) return true
    if (hops++ > 10_000) return true // corrupt tree: treat as cycle
    cursor = entries.find((e) => e.id === cursor)?.parentId ?? null
  }
  return false
}

export async function createEntry(
  vaultId: string,
  parentId: string | null,
  kind: 'file' | 'folder',
  ext?: SupportedExt,
): Promise<VaultEntry> {
  return withLock(`entries:${vaultId}`, async () => {
    await requireVault(vaultId)
    const entries = await listEntries(vaultId)
    if (parentId) {
      const parent = entries.find((e) => e.id === parentId)
      if (!parent || parent.kind !== 'folder') throw new Error('Parent folder not found')
    }

    const fileExt: SupportedExt = ext && SUPPORTED_EXTS.includes(ext) ? ext : 'md'
    const base = kind === 'folder' ? 'New folder' : 'Untitled'
    const suffix = kind === 'folder' ? '' : `.${fileExt}`
    const siblings = siblingNames(entries, parentId)
    // Obsidian-style sequence: Untitled.md, Untitled 1.md, Untitled 2.md…
    let name = `${base}${suffix}`
    for (let i = 1; siblings.has(name.toLowerCase()); i++) name = `${base} ${i}${suffix}`

    const maxOrder = entries
      .filter((e) => e.parentId === parentId)
      .reduce((acc, e) => Math.max(acc, e.order), 0)

    const entry: VaultEntry = {
      id: uuidv7(),
      name,
      kind,
      parentId,
      createdAt: Date.now(),
      modifiedAt: Date.now(),
      order: maxOrder + 1024,
    }
    entries.push(entry)
    await writeEntries(vaultId, entries)
    if (kind === 'file') await spindle.storage.write(blobPath(vaultId, entry.id), '')
    return entry
  })
}

/**
 * Resolve a desired name against its sibling set. Collisions never fail —
 * they sequence Obsidian/OS-style: `todo.md` → `todo 1.md` → `todo 2.md`
 * (folders sequence the same way, `New folder` → `New folder 1`).
 */
function uniqueSequentialName(
  entries: VaultEntry[],
  parentId: string | null,
  desired: string,
  excludeId?: string,
): string {
  const siblings = siblingNames(entries, parentId, excludeId)
  if (!siblings.has(desired.toLowerCase())) return desired
  const ext = extOf(desired)
  const stem = ext ? desired.slice(0, -(ext.length + 1)) : desired
  const suffix = ext ? `.${ext}` : ''
  for (let i = 1; ; i += 1) {
    const candidate = `${stem} ${i}${suffix}`
    if (!siblings.has(candidate.toLowerCase())) return candidate
  }
}

export async function renameEntry(vaultId: string, entryId: string, rawName: string): Promise<VaultEntry> {
  return withLock(`entries:${vaultId}`, async () => {
    await requireVault(vaultId)
    const entries = await listEntries(vaultId)
    const entry = entries.find((e) => e.id === entryId)
    if (!entry) throw new Error('Entry not found')

    let name = sanitizeEntryName(rawName)
    if (!name) throw new Error('Name cannot be empty')

    if (entry.kind === 'file') {
      const currentExt = extOf(entry.name) ?? 'md'
      if (!extOf(name)) name = `${name}.${currentExt}`
    }

    // Name taken in this folder? Take the next free sequential name instead
    // of rejecting — same-name intents are allowed, they just get numbered.
    entry.name = uniqueSequentialName(entries, entry.parentId, name, entry.id)
    entry.modifiedAt = Date.now()
    await writeEntries(vaultId, entries)
    return entry
  })
}

export async function moveEntry(
  vaultId: string,
  entryId: string,
  parentId: string | null,
  order?: number,
): Promise<VaultEntry[]> {
  return withLock(`entries:${vaultId}`, async () => {
    await requireVault(vaultId)
    const entries = await listEntries(vaultId)
    const entry = entries.find((e) => e.id === entryId)
    if (!entry) throw new Error('Entry not found')

    if (parentId) {
      const parent = entries.find((e) => e.id === parentId)
      if (!parent || parent.kind !== 'folder') throw new Error('Target folder not found')
      if (entry.kind === 'folder' && (parentId === entry.id || isDescendantOf(entries, entry.id, parentId))) {
        throw new Error('Cannot move a folder into itself')
      }
    }

    // Dropping onto a folder that already has an entry with this name used to
    // fail the move; now it lands sequenced (`logo.md` → `logo 1.md`).
    if (entry.parentId !== parentId) {
      entry.name = uniqueSequentialName(entries, parentId, entry.name, entry.id)
    }

    entry.parentId = parentId
    if (typeof order === 'number' && Number.isFinite(order)) {
      entry.order = order
    } else if (entry.parentId !== parentId || order === undefined) {
      const maxOrder = entries
        .filter((e) => e.parentId === parentId && e.id !== entry.id)
        .reduce((acc, e) => Math.max(acc, e.order), 0)
      entry.order = maxOrder + 1024
    }
    entry.modifiedAt = Date.now()
    await writeEntries(vaultId, entries)
    return entries
  })
}

export async function deleteEntry(vaultId: string, entryId: string): Promise<VaultEntry[]> {
  return withLock(`entries:${vaultId}`, async () => {
    await requireVault(vaultId)
    const entries = await listEntries(vaultId)
    const target = entries.find((e) => e.id === entryId)
    if (!target) throw new Error('Entry not found')

    const doomed = new Set<string>([entryId])
    if (target.kind === 'folder') {
      let grew = true
      while (grew) {
        grew = false
        for (const e of entries) {
          if (e.parentId && doomed.has(e.parentId) && !doomed.has(e.id)) {
            doomed.add(e.id)
            grew = true
          }
        }
      }
    }

    const remaining = entries.filter((e) => !doomed.has(e.id))
    await writeEntries(vaultId, remaining)
    if (ephemeralAvailable()) {
      void Promise.all(
        [...doomed].map((doomedId) =>
          spindle.ephemeral.delete(`backups/${vaultId}/${doomedId}.txt`).catch(() => undefined)),
      )
    }
    await Promise.all(
      [...doomed]
        .filter((doomedId) => entries.find((e) => e.id === doomedId)?.kind === 'file')
        .map((doomedId) => spindle.storage.delete(blobPath(vaultId, doomedId)).catch(() => undefined)),
    )
    return remaining
  })
}

// ── Notes ───────────────────────────────────────────────────────────────

export async function readNote(vaultId: string, entryId: string): Promise<{ content: string; modifiedAt: number }> {
  await requireVault(vaultId)
  const entries = await listEntries(vaultId)
  const entry = entries.find((e) => e.id === entryId)
  if (!entry || entry.kind !== 'file') throw new Error('Note not found')
  let content = ''
  if (await spindle.storage.exists(blobPath(vaultId, entryId))) {
    content = await spindle.storage.read(blobPath(vaultId, entryId))
  }
  return { content, modifiedAt: entry.modifiedAt }
}

// ── Large-note hardening ────────────────────────────────────────────────
// Two failure modes hit big notes in the past:
//   1. the schema cap (fixed — 64 MB now), and
//   2. a failed schema/storage write losing the whole autosave.
// Writes now go to a temp path and are moved into place (atomic replace),
// and when `ephemeral_storage` is granted the previous blob is stashed in
// the ephemeral pool before the overwrite, so a corrupted/interrupted save
// can never destroy the only copy.

const EPHEMERAL_BACKUP_TTL = 7 * 24 * 60 * 60 * 1000 // one week

function ephemeralAvailable(): boolean {
  try {
    return !!spindle.permissions?.has?.('ephemeral_storage')
  } catch {
    return false
  }
}

export async function writeNote(
  vaultId: string,
  entryId: string,
  content: string,
): Promise<{ modifiedAt: number }> {
  return withLock(`note:${vaultId}:${entryId}`, async () => {
    await requireVault(vaultId)
    const entries = await listEntries(vaultId)
    const entry = entries.find((e) => e.id === entryId)
    if (!entry || entry.kind !== 'file') throw new Error('Note not found')

    const target = blobPath(vaultId, entryId)

    // Stash the pre-overwrite copy (7-day TTL) so a failed move never loses
    // the note. Ephemeral quota is best-effort — failures don't block saves.
    if (ephemeralAvailable() && (await spindle.storage.exists(target))) {
      try {
        const previous = await spindle.storage.read(target)
        await spindle.ephemeral.write(`backups/${vaultId}/${entryId}.txt`, previous, {
          ttlMs: EPHEMERAL_BACKUP_TTL,
        })
      } catch (err) {
        spindle.log.warn(`[luminote] ephemeral backup skipped: ${String(err)}`)
      }
    }

    // Atomic replace: write to a sibling temp file, then move over the blob.
    const tmp = `${target}.tmp`
    await spindle.storage.write(tmp, content)
    await spindle.storage.move(tmp, target)

    entry.modifiedAt = Date.now()
    await writeEntries(vaultId, entries)
    return { modifiedAt: entry.modifiedAt }
  })
}

// ── Stats ───────────────────────────────────────────────────────────────

export async function vaultStats(vaultId: string): Promise<VaultStats> {
  await requireVault(vaultId)
  const entries = await listEntries(vaultId)
  const files = entries.filter((e) => e.kind === 'file')

  let words = 0
  let characters = 0
  let lines = 0
  let bytes = 0

  for (const file of files) {
    const path = blobPath(vaultId, file.id)
    if (!(await spindle.storage.exists(path))) continue
    const content = await spindle.storage.read(path)
    bytes += encoder.encode(content).byteLength
    characters += content.length
    lines += content.length === 0 ? 0 : content.split('\n').length
    words += content.split(/\s+/).filter((w) => w.length > 0).length
  }

  return {
    files: files.length,
    folders: entries.length - files.length,
    words,
    characters,
    lines,
    tokens: Math.ceil(characters / 4),
    bytes,
  }
}
