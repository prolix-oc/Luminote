/**
 * Zod-validated IPC router. Every frontend-bound message is shaped
 * `{ $luminote: 1, kind: 'req', id, op, payload }`; the router validates
 * `payload` against the op's schema, runs the handler and replies on the
 * same id. Mutations also broadcast a `changed` event so every open tab of
 * the same user converges.
 */
import {
  isIpcEnvelope,
  normalizeSettings,
  requestSchemas,
  type BootPayload,
  type IpcEvent,
  type IpcResponse,
  type OpName,
  type WorkspaceSnapshot,
} from '../shared/model'
import * as store from './store'
import { listVaults, getMeta } from './store'

declare const spindle: import('lumiverse-spindle-types').SpindleAPI

// Every handler receives the userId of the frontend that sent the message
// (host-verified, attached by worker-host). Host content APIs (images,
// staged uploads) require it on operator-scoped installs and safely ignore
// it on user-scoped ones — always thread it through.
type Handler = (payload: unknown, userId?: string) => Promise<unknown>

const handlers: Record<OpName, Handler> = {
  'boot': async (): Promise<BootPayload> => {
    const [settings, vaults, meta] = await Promise.all([
      store.getSettings(),
      listVaults(),
      getMeta(),
    ])
    return {
      settings,
      vaults,
      activeVaultId: meta.activeVaultId && vaults.some((v) => v.id === meta.activeVaultId)
        ? meta.activeVaultId
        : (vaults[0]?.id ?? null),
      permissions: {
        app_manipulation: spindle.permissions.has('app_manipulation'),
        ui_panels: spindle.permissions.has('ui_panels'),
        images: spindle.permissions.has('images'),
        ephemeral_storage: spindle.permissions.has('ephemeral_storage'),
        media: spindle.permissions.has('media'),
      },
    }
  },

  'vault.list': () => listVaults(),

  'vault.create': async (p) => {
    const { name } = p as { name: string }
    return store.createVault(name)
  },

  'vault.rename': async (p) => {
    const { vaultId, name } = p as { vaultId: string; name: string }
    return store.renameVault(vaultId, name)
  },

  'vault.delete': async (p, userId) => {
    const { vaultId } = p as { vaultId: string }
    await store.deleteVault(vaultId, userId)
    return { ok: true }
  },

  'vault.activate': async (p) => {
    const { vaultId } = p as { vaultId: string }
    await store.setActiveVault(vaultId)
    return { ok: true }
  },

  'vault.stats': async (p) => {
    const { vaultId } = p as { vaultId: string }
    return store.vaultStats(vaultId)
  },

  'entries.list': async (p) => {
    const { vaultId } = p as { vaultId: string }
    return store.listEntries(vaultId)
  },

  'entry.create': async (p) => {
    const { vaultId, parentId, kind, ext } = p as {
      vaultId: string
      parentId: string | null
      kind: 'file' | 'folder'
      ext?: 'md'
    }
    return store.createEntry(vaultId, parentId, kind, ext)
  },

  'entry.rename': async (p) => {
    const { vaultId, entryId, name } = p as { vaultId: string; entryId: string; name: string }
    return store.renameEntry(vaultId, entryId, name)
  },

  'entry.move': async (p) => {
    const { vaultId, entryId, parentId, order } = p as {
      vaultId: string
      entryId: string
      parentId: string | null
      order?: number
    }
    return store.moveEntry(vaultId, entryId, parentId, order)
  },

  'entry.delete': async (p) => {
    const { vaultId, entryId } = p as { vaultId: string; entryId: string }
    return store.deleteEntry(vaultId, entryId)
  },

  'note.read': async (p) => {
    const { vaultId, entryId } = p as { vaultId: string; entryId: string }
    return store.readNote(vaultId, entryId)
  },

  'note.write': async (p) => {
    const { vaultId, entryId, content } = p as { vaultId: string; entryId: string; content: string }
    return store.writeNote(vaultId, entryId, content)
  },

  'settings.get': () => store.getSettings(),

  'settings.set': async (p) => {
    const { settings } = p as { settings: unknown }
    return store.setSettings(normalizeSettings(settings))
  },

  'workspace.get': async (p) => {
    const { vaultId } = p as { vaultId: string }
    return store.getWorkspace(vaultId)
  },

  'workspace.set': async (p) => {
    const { vaultId, workspace } = p as { vaultId: string; workspace: WorkspaceSnapshot }
    return store.setWorkspace(vaultId, workspace)
  },

  'image.recents': async (p) => {
    const { slot } = p as { slot: string }
    return store.imageRecents(slot)
  },

  'image.set': async (p, userId) => {
    const { slot, vaultId, uploadId, fileName, mimeType } = p as {
      slot: string; vaultId?: string; uploadId: string; fileName?: string; mimeType?: string
    }
    return store.imageSet(slot, vaultId, uploadId, fileName, mimeType, userId)
  },

  'image.select': async (p) => {
    const { slot, vaultId, url, mime } = p as { slot: string; vaultId?: string; url: string; mime?: string }
    return store.imageSelect(slot, vaultId, url, mime)
  },

  'image.clear': async (p) => {
    const { slot, vaultId } = p as { slot: string; vaultId?: string }
    await store.imageClear(slot, vaultId)
    return { ok: true }
  },
}

/** Ops whose success changes data other tabs may be displaying. */
const MUTATING_OPS: Partial<Record<OpName, (payload: unknown) => { topic: string; vaultId?: string }>> = {
  'vault.create': () => ({ topic: 'vaults' }),
  'vault.rename': () => ({ topic: 'vaults' }),
  'vault.delete': () => ({ topic: 'vaults' }),
  'entry.create': (p) => ({ topic: 'entries', vaultId: (p as { vaultId: string }).vaultId }),
  'entry.rename': (p) => ({ topic: 'entries', vaultId: (p as { vaultId: string }).vaultId }),
  'entry.move': (p) => ({ topic: 'entries', vaultId: (p as { vaultId: string }).vaultId }),
  'entry.delete': (p) => ({ topic: 'entries', vaultId: (p as { vaultId: string }).vaultId }),
  'note.write': (p) => ({ topic: 'entries', vaultId: (p as { vaultId: string }).vaultId }),
  'settings.set': () => ({ topic: 'settings' }),
  // Image ops fan out by slot: vault slots repaint the vault bar; widget/
  // banner slots live in settings (banner never notifies recents — they
  // are only fetched inside the picker popup).
  'image.set': (p) => ({ topic: String((p as { slot: string }).slot).startsWith('vault-') ? 'vaults' : 'settings' }),
  'image.select': (p) => ({ topic: String((p as { slot: string }).slot).startsWith('vault-') ? 'vaults' : 'settings' }),
  'image.clear': (p) => ({ topic: String((p as { slot: string }).slot).startsWith('vault-') ? 'vaults' : 'settings' }),
}

async function dispatch(op: OpName, payload: unknown, userId?: string): Promise<unknown> {
  const schema = requestSchemas[op]
  const parsed = schema.safeParse(payload)
  if (!parsed.success) {
    throw new Error(`Invalid payload for ${op}: ${parsed.error.issues[0]?.message ?? 'schema mismatch'}`)
  }
  const handler = handlers[op]
  if (!handler) throw new Error(`Unknown op: ${op}`)
  return handler(parsed.data, userId)
}

export function registerIpc(): void {
  spindle.onFrontendMessage(async (payload: unknown, userId: string) => {
    if (!isIpcEnvelope(payload) || payload.kind !== 'req') return

    const req = payload as { id?: unknown; op?: unknown; payload?: unknown }
    if (typeof req.id !== 'string' || typeof req.op !== 'string' || !(req.op in requestSchemas)) return
    const op = req.op as OpName

    try {
      const result = await dispatch(op, req.payload, userId)
      const res: IpcResponse = { $luminote: 1, kind: 'res', id: req.id, op, payload: result }
      spindle.sendToFrontend(res, userId)

      const mutation = MUTATING_OPS[op]
      if (mutation) {
        const event: IpcEvent = { $luminote: 1, kind: 'event', event: 'changed', payload: mutation(req.payload) }
        spindle.sendToFrontend(event, userId)
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      spindle.log.warn(`[luminote] ${op} failed: ${message}`)
      const res: IpcResponse = { $luminote: 1, kind: 'res', id: req.id, op, error: message }
      spindle.sendToFrontend(res, userId)
    }
  })
}
