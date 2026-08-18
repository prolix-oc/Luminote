/**
 * Luminote frontend entry — wiring root.
 *
 * The Spindle loader calls `setup(ctx)`; the returned function is the full
 * teardown chain the host invokes when the extension is disabled. Feature
 * modules never import each other: this root creates the store and rpc
 * client first, then constructs features in dependency order and connects
 * them through the store (state), the rpc client (backend) and explicit
 * late-bound handles (persistSettings, onGeometryCommitted, toast roots).
 */
import type { SpindleFrontendContext } from 'lumiverse-spindle-types'
import {
  DEFAULT_SETTINGS,
  type BootPayload,
  type LuminoteSettings,
  type OverlayGeometry,
  type WorkspacePlacement,
  type WorkspaceSnapshot,
} from './shared/model'
import { Store, createInitialState } from './frontend/state'
import { createRpc } from './frontend/rpc'
import { OVERLAY_CSS } from './frontend/styles'
import { createOverlayFeature } from './frontend/features/overlay/overlay-index'
import { createDockShellFeature } from './frontend/features/dockshell/dockshell-index'

/** The two workspace shells (floating overlay / docked panel) expose the
 * same regions to the feature modules. */
interface ShellHandle {
  sidebarRoot: HTMLElement
  editorRoot: HTMLElement
  statusbarRoot: HTMLElement
  /** Sidebar collapse toggle — the editor pins it into the left-most split's tab strip. */
  sideToggleEl: HTMLElement
  /** Overlay only: restore default centered window bounds. */
  resetWindowSize?(): void
  /** Dock only: restore default dock panel width. */
  resetDockWidth?(): void
  destroy(): void
}
import { createTreeFeature, type TreeFeature } from './frontend/features/tree/tree-index'
import { createEditorFeature, type EditorFeature } from './frontend/features/editor/editor-index'
import { createStatusbarFeature, type StatusbarFeature } from './frontend/features/statusbar/statusbar-index'
import { createWidgetFeature, type WidgetFeature } from './frontend/features/widget/widget-index'
import { createSettingsDrawerFeature, type SettingsDrawerFeature } from './frontend/features/settingsdrawer/settingsdrawer-index'

function sameSettings(a: LuminoteSettings, b: LuminoteSettings): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

export function setup(ctx: SpindleFrontendContext) {
  ctx.deferReady()

  const cleanups: Array<() => void | Promise<void>> = []
  let tornDown = false

  // Late-bound feature handles (created in dependency order during boot).
  let editorFeature: EditorFeature | null = null
  let treeFeature: TreeFeature | null = null
  let shellFeature: ShellHandle | null = null
  let statusbarFeature: StatusbarFeature | null = null
  let widgetFeature: WidgetFeature | null = null
  let settingsDrawerFeature: SettingsDrawerFeature | null = null

  const cleanupAll = async (): Promise<void> => {
    if (tornDown) return
    tornDown = true

    // Flush pending note writes before tearing anything down.
    try {
      await editorFeature?.saveAll()
    } catch { /* teardown is best effort */ }

    for (const fn of [...cleanups].reverse()) {
      try {
        await fn()
      } catch {
        // Cleanup functions are idempotent and swallow errors by contract.
      }
    }
  }

  // ── Core handles: rpc first (backend), then the store (state) ──
  const rpc = createRpc(ctx)
  cleanups.push(() => rpc.destroy())

  const store = new Store(createInitialState(DEFAULT_SETTINGS))

  // ── Styles ──
  const removeStyle = ctx.dom.addStyle(OVERLAY_CSS)
  cleanups.push(() => removeStyle())

  // ── Debounced settings persistence (single channel for all features) ──
  let settingsSaveTimer: ReturnType<typeof setTimeout> | null = null
  let pendingSettings: LuminoteSettings | null = null
  // Snapshot of the last settings payload sent to the backend. The
  // backend rebroadcasts a `changed` event for write; applying that
  // echo would resurrect stale values over anything committed locally in
  // the meantime (e.g. a sidebar drag landing mid-round-trip).
  let lastSentSettings: LuminoteSettings | null = null

  function persistSettings(next: LuminoteSettings): Promise<void> {
    pendingSettings = next
    if (settingsSaveTimer) clearTimeout(settingsSaveTimer)
    return new Promise((resolve) => {
      settingsSaveTimer = setTimeout(() => {
        const settings = pendingSettings
        pendingSettings = null
        lastSentSettings = settings
        rpc.call('settings.set', { settings })
          .catch((err: unknown) => console.warn('[luminote] settings persist failed:', err))
          .finally(() => resolve())
      }, 350)
    })
  }

  cleanups.push(() => {
    if (settingsSaveTimer) {
      clearTimeout(settingsSaveTimer)
      settingsSaveTimer = null
    }
  })

  // Pull authoritative settings when another tab mutates them. Echoes of
  // extensions writes are dropped: the local store is already at least as new
  // as any snapshot sent, so applying it could only resurrect staleness.
  cleanups.push(rpc.onChanged((topic) => {
    if (topic !== 'settings') return
    void rpc.call<LuminoteSettings>('settings.get').then((remote) => {
      if (sameSettings(remote, store.get().settings)) return
      if (lastSentSettings && sameSettings(remote, lastSentSettings)) return
      store.set({ settings: remote })
    }).catch(() => undefined)
  }))

  // ── Workspace persistence (debounced writer, per vault) ──
  // The editor pushes full snapshots (layout + view state + tree collapse
  // list); the write is tagged with the vault that was active at push time
  // and flushed on vault switch (via the tree's beforeVaultSwitch hook),
  // overlay close and teardown.
  let workspaceTimer: ReturnType<typeof setTimeout> | null = null
  let pendingWorkspace: { vaultId: string; snapshot: WorkspaceSnapshot } | null = null

  async function flushWorkspace(): Promise<void> {
    if (workspaceTimer) {
      clearTimeout(workspaceTimer)
      workspaceTimer = null
    }
    const pending = pendingWorkspace
    pendingWorkspace = null
    if (!pending || tornDown) return
    await rpc.call('workspace.set', { vaultId: pending.vaultId, workspace: pending.snapshot })
      .catch((err: unknown) => console.warn('[luminote] workspace persist failed:', err))
  }

  function pushWorkspace(snapshot: WorkspaceSnapshot): void {
    const vaultId = store.get().activeVaultId
    if (!vaultId) return
    pendingWorkspace = { vaultId, snapshot }
    if (workspaceTimer) clearTimeout(workspaceTimer)
    workspaceTimer = setTimeout(() => void flushWorkspace(), 500)
  }

  // ── Keyboard shortcut: Ctrl+Shift+L toggles the overlay ──
  const onKeydown = (event: KeyboardEvent) => {
    if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key.toLowerCase() === 'l') {
      event.preventDefault()
      store.set({ overlayVisible: !store.get().overlayVisible })
    }
  }
  window.addEventListener('keydown', onKeydown)
  cleanups.push(() => window.removeEventListener('keydown', onKeydown))

  // Persist overlay visibility so the workspace reopens exactly as it was
  // left (falls back to the "open on load" setting until first toggled).
  let bootOverlayApplied = false
  cleanups.push(store.subscribeKey('overlayVisible', () => {
    if (!bootOverlayApplied) return
    const settings = store.get().settings
    if (settings.ui.overlayOpen === store.get().overlayVisible) return
    const next: LuminoteSettings = {
      ...settings,
      ui: { ...settings.ui, overlayOpen: store.get().overlayVisible },
    }
    store.set({ settings: next })
    void persistSettings(next)
  }))

  // ── Overlay geometry persistence ──
  function onGeometryCommitted(geo: OverlayGeometry): void {
    const settings = store.get().settings
    const next: LuminoteSettings = { ...settings, ui: { ...settings.ui, overlay: geo } }
    store.set({ settings: next })
    void persistSettings(next)
  }

  // ── Sidebar width persistence ──
  function onSidebarWidthCommitted(width: number): void {
    const settings = store.get().settings
    const next: LuminoteSettings = { ...settings, ui: { ...settings.ui, sidebarWidth: width } }
    store.set({ settings: next })
    void persistSettings(next)
  }

  // ── Sidebar collapse persistence (titlebar toggle button) ──
  function onSidebarCollapsedCommitted(collapsed: boolean): void {
    const settings = store.get().settings
    const next: LuminoteSettings = { ...settings, ui: { ...settings.ui, sidebarCollapsed: collapsed } }
    store.set({ settings: next })
    void persistSettings(next)
  }

  // ── Dock width persistence (host resize → settings, dock placement only) ──
  function onDockWidthCommitted(width: number): void {
    const settings = store.get().settings
    if (settings.ui.dockWidth === width) return
    const next: LuminoteSettings = { ...settings, ui: { ...settings.ui, dockWidth: width } }
    store.set({ settings: next })
    void persistSettings(next)
  }

  // ── Permission-gated placements, built once the backend grants them ──
  let placementsBuilt = false
  let fallbackBanner: Element | null = null
  let currentPlacement: WorkspacePlacement | null = null

  function buildPlacements(): void {
    if (placementsBuilt || tornDown) return
    const placement = store.get().settings.ui.placement
    const neededPermission = placement === 'dock' ? 'ui_panels' : 'app_manipulation'
    if (!store.get().permissions[neededPermission]) {
      showPermissionFallback(placement)
      return
    }

    try {
      shellFeature = placement === 'dock'
        ? createDockShellFeature(ctx, store, onSidebarWidthCommitted, onDockWidthCommitted, onSidebarCollapsedCommitted)
        : createOverlayFeature(ctx, store, onGeometryCommitted, onSidebarWidthCommitted, onSidebarCollapsedCommitted)
    } catch (err) {
      console.warn(`[luminote] Failed to mount ${placement} shell:`, err)
      showPermissionFallback(placement)
      return
    }
    removePermissionFallback()
    placementsBuilt = true
    currentPlacement = placement

    cleanups.push(() => shellFeature?.destroy())

    editorFeature = createEditorFeature(ctx, store, rpc, shellFeature.editorRoot, {
      pushWorkspace,
      sideToggle: shellFeature.sideToggleEl,
    })
    cleanups.push(() => flushWorkspace())
    cleanups.push(() => editorFeature?.destroy())

    treeFeature = createTreeFeature(ctx, store, rpc, shellFeature.sidebarRoot, persistSettings, {
      beforeVaultSwitch: async () => {
        await editorFeature?.saveAll()
        await flushWorkspace()
      },
    })
    cleanups.push(() => treeFeature?.destroy())

    statusbarFeature = createStatusbarFeature(store, shellFeature.statusbarRoot)
    cleanups.push(() => statusbarFeature?.destroy())

    void treeFeature.refreshEntries().catch(() => undefined)
  }

  /** Placement switch at runtime: tear down the current shell and rebirth
   * every region-bound feature into the new one. The editor restores the
   * vault workspace snapshot on construction, so panes/tabs ride across. */
  let rebuildingShell = false
  async function rebuildShell(): Promise<void> {
    if (rebuildingShell || tornDown || !placementsBuilt) return
    rebuildingShell = true
    try {
      try { await editorFeature?.saveAll() } catch { /* best effort */ }
      try { await flushWorkspace() } catch { /* best effort */ }
      editorFeature?.destroy()
      treeFeature?.destroy()
      statusbarFeature?.destroy()
      shellFeature?.destroy()
      editorFeature = null
      treeFeature = null
      statusbarFeature = null
      shellFeature = null
      placementsBuilt = false
      buildPlacements()
    } finally {
      rebuildingShell = false
    }
  }

  cleanups.push(store.subscribeKey('settings', () => {
    if (rebuildingShell || tornDown) return
    const placement = store.get().settings.ui.placement
    if (currentPlacement && placement !== currentPlacement) void rebuildShell()
  }))
  cleanups.push(store.subscribeKey('permissions', () => {
    if (!placementsBuilt) buildPlacements()
    else if (!rebuildingShell) {
      // Permission just granted for the OTHER placement mode? Rebuild if the
      // current shell can't run without it (its own grant revoked is handled
      // by the mount failing on next interaction).
    }
  }))

  function showPermissionFallback(placement: WorkspacePlacement = 'overlay'): void {
    if (fallbackBanner) return
    const perm = placement === 'dock' ? 'UI panels' : 'App manipulation'
    fallbackBanner = ctx.dom.inject('body', `
      <div class="lx-perm-banner">
        <strong>Luminote</strong> needs the <em>${perm}</em> permission to show its workspace.
        Enable it in Settings → Extensions → Luminote, then reload the extension.
      </div>
    `, 'beforeend')
  }

  function removePermissionFallback(): void {
    if (!fallbackBanner) return
    try {
      ctx.dom.uninject(fallbackBanner)
    } catch { /* noop */ }
    fallbackBanner = null
  }

  cleanups.push(removePermissionFallback)
  cleanups.push(store.subscribeKey('permissions', () => {
    if (!placementsBuilt) buildPlacements()
  }))

  // ── Boot: hydrate from backend, then build features ──
  void (async () => {
    try {
      const boot = await rpc.call<BootPayload>('boot')

      // Tree collapse state for the boot vault rides its workspace snapshot —
      // hydrate it before features mount so the first render already matches
      // the previous session.
      const bootCollapsed: Record<string, true> = {}
      if (boot.activeVaultId) {
        try {
          const ws = await rpc.call<{ collapsed?: string[] }>('workspace.get', { vaultId: boot.activeVaultId })
          for (const id of ws.collapsed ?? []) bootCollapsed[id] = true
        } catch { /* fresh profile */ }
      }

      store.set({
        settings: boot.settings,
        vaults: boot.vaults,
        activeVaultId: boot.activeVaultId,
        permissions: boot.permissions,
        collapsed: bootCollapsed,
        booted: true,
      })

      buildPlacements()

      widgetFeature = createWidgetFeature(ctx, store, persistSettings)
      cleanups.push(() => widgetFeature?.destroy())

      try {
        settingsDrawerFeature = createSettingsDrawerFeature(ctx, store, rpc, persistSettings, {
          // Live lookups: the shell/editor swap identities on placement
          // switches, so these must resolve at call time.
          resetWidgetSpot: () => widgetFeature?.resetSpot(),
          resetWindowSize: () => shellFeature?.resetWindowSize?.(),
          resetDockWidth: () => {
            if (shellFeature?.resetDockWidth) {
              shellFeature.resetDockWidth()
            } else {
              const next: LuminoteSettings = {
                ...store.get().settings,
                ui: { ...store.get().settings.ui, dockWidth: DEFAULT_SETTINGS.ui.dockWidth },
              }
              store.set({ settings: next })
              void persistSettings(next)
            }
          },
          resetPanesAndSplits: () => editorFeature?.resetLayout(),
        })
        cleanups.push(() => settingsDrawerFeature?.destroy())
      } catch (err) {
        console.warn('[luminote] Settings surface unavailable:', err)
      }

      // Last-known visibility wins; the "open on load" setting is only the
      // default until the overlay has been toggled once. The permission gate
      // mirrors the active shell placement: dock panels need ui_panels, the
      // floating overlay needs app_manipulation.
      const openOnLoad = boot.settings.ui.overlayOpen ?? boot.settings.ui.overlayOpenOnLoad
      const bootPermission = boot.settings.ui.placement === 'dock'
        ? store.get().permissions.ui_panels
        : store.get().permissions.app_manipulation
      store.set({ overlayVisible: openOnLoad && bootPermission })
      bootOverlayApplied = true
    } catch (err) {
      console.error('[luminote] Boot failed:', err)
    } finally {
      ctx.ready()
    }
  })()

  return cleanupAll
}
