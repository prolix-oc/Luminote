/**
 * Settings-drawer feature — Luminote's settings surface lives in a host
 * drawer tab (`ctx.ui.registerDrawerTab`), Discord-profile-style:
 *
 *   .lx-setting-header   removable/video-capable banner · fixed profile
 *                        avatar + nameplate-backed editable vault name (both
 *                        art surfaces expose context menus) · quick controls
 *   .lx-setting-body     labelled vault statistics
 *   .lx-setting-scroll   lx-scoped collapsible cards: Editor, Floating
 *                        Widget (including its art), Overlay, Sidebar,
 *                        Status Bar, Vault (including avatar controls).
 *                        The former Permissions / Data cards now live in
 *                        the panel-header guide (registerDrawerTab `guide`).
 *
 * Scoping contract (the user skins this surface): every block ships
 * lx-prefixed classes — section roots get `lx-setting-section-{slug}` via
 * the host's `className` option, and the host-rendered header/content are
 * tagged post-mount (`lx-setting-section-header` / `-content`) since the
 * host's own classes are CSS-module hashes that can't be targeted.
 *
 * Conventions: the scroll cards use the host's shared
 * `ctx.components.mountCollapsibleSection` chrome (safe on the detached
 * drawer root — mounts survive host detach/reattach), one-shot actions
 * delegate through `ctx.ui.events.bindActionHandlers` (`data-action`),
 * and every change round-trips the backend (`settings.set`
 * / `vault.*` / `image.*` ops) so it persists and syncs across tabs.
 *
 * HOST LIFECYCLE (verified against the host source): the drawer tab root
 * is created detached and only lives in the document while the tab is
 * active. `bindActionHandlers` requires a connected target and the host
 * retires bindings on detach — so the delegation is (re)bound on every
 * detached→connected transition (tab activation + a mutation backstop for
 * drawer close→reopen, which emits no activation event). Binding at
 * setup() would throw `Target not found` and kill the whole frontend —
 * that was the boot regression this design fixes.
 * The Settings → Extensions mount keeps a compact jump card as a fallback.
 */
import type {
  SpindleCollapsibleSectionHandle,
  SpindleDrawerTabHandle,
  SpindleFrontendContext,
} from 'lumiverse-spindle-types'
import {
  DEFAULT_SETTINGS,
  DOCK_MIN_DEFAULT,
  DOCK_MAX_DEFAULT,
  type ImageSlot,
  type LuminoteSettings,
  type VaultStats,
  type ViewMode,
  type WorkspacePlacement,
} from '../../../shared/model'
import { el, createDisposer } from '../../dom'
import { mediaThumbEl } from '../../media'
import { icon } from '../../icons'
import type { RpcClient } from '../../rpc'
import type { Store } from '../../state'
import { openImagePicker } from '../imagepicker/imagepicker-index'

export interface SettingsDrawerFeature {
  destroy(): void
}

/** Actions owned by other features; the drawer only triggers them. */
export interface SettingsDrawerActions {
  resetWidgetSpot(): void
  resetWindowSize(): void
  resetDockWidth?(): void
  resetPanesAndSplits(): void
}

interface SettingPatch {
  (settings: LuminoteSettings): LuminoteSettings
}

/** Notebook-pen glyph, inlined for the drawer tab icon slot. */
const DRAWER_TAB_ICON_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M13.4 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7.4"/><path d="M2 6h4"/><path d="M2 10h4"/><path d="M2 14h4"/><path d="M2 18h4"/><path d="M21.378 5.626a1 1 0 1 0-3.004-3.004l-5.01 5.012a2 2 0 0 0-.506.854l-.837 2.87a.5.5 0 0 0 .62.62l2.87-.837a2 2 0 0 0 .854-.506z"/></svg>'

/**
 * Panel-header guide (Spindle `guide` on `registerDrawerTab`) — the host
 * renders this markdown in its native guide viewer.
 */
const DRAWER_TAB_GUIDE = `# Luminote

Inspired by ObsidianMD, this Spindle extension focuses on being an extremely easy to use note-taking workspace.

## Getting Started

Vaults are how Luminote organizes your workspace through Spindle. To create a vault you navigate to the nameplate in the bottom corner, click "Vault Options…" → "Create New Vault…" This will prompt a dialog box to name your vault.

### Creating Notes

With your vault set up, you can finally start adding notes and typing away. Luminote supports multiple ways of creating notes:
1. Navigate to the bottom of the file-tree and selecting "New Note".
2. At the center of a empty pane and selecting "New Note".
3. Right-clicking the filetree.
4. Right-clicking a folder.

By default newly created notes are named "Untitled". Either accept by pressing \`Enter\` or overwrite with your desired name. Luminote will create the file and immediately open it for you to start typing.

### Creating Folders

Creating folders is almost analogous to creating notes:
1. Navigating to the bottom of the file-tree and selecting "New Folder".
2. Right-clicking the filetree.
3. Right-clicking a folder.

### Permissions

App manipulation: Required → Responsible for the overlay.
Ephemeral storage: Optional → Allows for a 7-day rolling backup.
Images & Media: Optional → For use in the Vault Avatar, Widget Icon, Decorations, Nameplate and Banner.
UI panels: Required → Responsible for the floating widget & half-dock.

### Data & Storage

It's strongly recommended that you regularly back up your notes from time-to-time. Notes themselves are stored as plain text(.txt) and can be accessed at (data/extensions/luminote/storage/vaults/vault-string/blob/text-documents).

Ephemeral storage acts as a 7-day rolling backup at (data/extensions/luminote/storage/.ephemeral/backups/vault-string/text-documents).

Media and Images that you upload for use in this extension are stored at (data/extensions/images).

---

wip
`

export function createSettingsDrawerFeature(
  ctx: SpindleFrontendContext,
  store: Store,
  rpc: RpcClient,
  persistSettings: (settings: LuminoteSettings) => Promise<void>,
  actions: SettingsDrawerActions,
): SettingsDrawerFeature {
  const disposer = createDisposer()

  let drawerTab: SpindleDrawerTabHandle | null = null
  try {
    drawerTab = ctx.ui.registerDrawerTab({
      id: 'luminote',
      title: 'Luminote',
      shortName: 'Note',
      description: 'Vault workspace settings',
      keywords: ['notes', 'vault', 'editor', 'settings'],
      headerTitle: 'Luminote',
      iconSvg: DRAWER_TAB_ICON_SVG,
      guide: { title: 'Luminote Guide', markdown: DRAWER_TAB_GUIDE },
    })
  } catch {
    drawerTab = null // older hosts without drawer tabs — fall back below.
  }

  const settingsMountRoot = ctx.ui.mount('settings_extensions') as HTMLElement

  function patchSettings(patch: SettingPatch): void {
    const next = patch(store.get().settings)
    store.set({ settings: next })
    void persistSettings(next)
  }

  const syncables: Array<() => void> = []

  // ── Row atoms (unchanged lx- scopes; Lumiverse tokens do the theming) ──
  function buildSwitch(label: string, hint: string, get: () => boolean, set: (value: boolean) => void): HTMLElement {
    const input = el('input', { attrs: { type: 'checkbox', role: 'switch' } }) as HTMLInputElement
    const toggle = el('label', { class: 'lx-switch' }, input, el('span', { class: 'lx-switch-track' }, el('span', { class: 'lx-switch-thumb' })))
    input.checked = get()
    input.addEventListener('change', () => set(input.checked))
    const row = el('div', { class: 'lx-setting-row' },
      el('div', { class: 'lx-setting-text' },
        el('div', { class: 'lx-setting-label', text: label }),
        hint ? el('div', { class: 'lx-setting-hint', text: hint }) : null,
      ),
      toggle,
    )
    ;(row as HTMLElement & { _lxSync?: () => void })._lxSync = () => { input.checked = get() }
    syncables.push(() => { input.checked = get() })
    return row
  }

  function buildSegmented<T extends string>(
    label: string,
    hint: string,
    options: Array<{ value: T; label: string }>,
    get: () => T,
    set: (value: T) => void,
  ): HTMLElement {
    const holder = el('div', { class: 'lx-segmented lx-segmented-wide' })
    const sync = () => {
      holder.replaceChildren()
      for (const option of options) {
        const btn = el('button', {
          class: `lx-segmented-btn${get() === option.value ? ' lx-segmented-active' : ''}`,
          text: option.label,
          attrs: { 'aria-pressed': String(get() === option.value) },
        })
        btn.addEventListener('click', () => {
          if (get() !== option.value) set(option.value)
          sync()
        })
        holder.appendChild(btn)
      }
    }
    sync()
    const row = el('div', { class: 'lx-setting-row' },
      el('div', { class: 'lx-setting-text' },
        el('div', { class: 'lx-setting-label', text: label }),
        hint ? el('div', { class: 'lx-setting-hint', text: hint }) : null,
      ),
      holder,
    )
    syncables.push(sync)
    return row
  }

  type RangeScope = 'range' | 'setting-slider'

  /**
   * Native range semantics with fully extension-owned visual parts. The
   * transparent input keeps keyboard/pointer/accessibility behavior, while
   * real track-area/track/fill/thumb elements expose stable lx-scoped hooks
   * instead of browser pseudo-elements that user CSS cannot reliably tune.
   */
  function buildScopedRange(
    scope: RangeScope,
    label: string,
    min: number,
    max: number,
  ): {
    root: HTMLElement
    input: HTMLInputElement
    sync(value: number): void
  } {
    const input = el('input', {
      class: `lx-slider-input lx-${scope}-input`,
      attrs: {
        type: 'range', min: String(min), max: String(max), step: '1',
        'aria-label': label,
      },
    }) as HTMLInputElement
    const fill = el('span', { class: `lx-slider-fill lx-${scope}-fill`, attrs: { 'aria-hidden': 'true' } })
    const thumb = el('span', { class: `lx-slider-thumb lx-${scope}-thumb`, attrs: { 'aria-hidden': 'true' } })
    const track = el('span', { class: `lx-slider-track lx-${scope}-track`, attrs: { 'aria-hidden': 'true' } }, fill, thumb)
    const root = el('span', { class: `lx-slider-trackarea lx-${scope}-trackarea` }, input, track)

    return {
      root,
      input,
      sync(value: number) {
        const clamped = Math.min(max, Math.max(min, value))
        const pct = max === min ? 0 : ((clamped - min) / (max - min)) * 100
        input.value = String(clamped)
        fill.style.width = `${pct}%`
        thumb.style.left = `${pct}%`
      },
    }
  }

  function buildRange(
    label: string,
    hint: string,
    min: number,
    max: number,
    get: () => number,
    set: (value: number) => void,
    format: (value: number) => string,
  ): HTMLElement {
    const slider = buildScopedRange('setting-slider', label, min, max)
    const valueEl = el('span', { class: 'lx-setting-slider-value', text: format(get()) })
    const syncValue = (value: number): void => {
      slider.sync(value)
      valueEl.textContent = format(value)
    }
    syncValue(get())
    slider.input.addEventListener('change', () => {
      set(Number(slider.input.value))
      syncValue(get())
    })
    slider.input.addEventListener('input', () => {
      const value = Number(slider.input.value)
      slider.sync(value)
      valueEl.textContent = format(value)
    })
    const row = el('div', { class: 'lx-setting-control' },
      el('div', { class: 'lx-setting-label', text: label }),
      el('label', { class: 'lx-setting-slider lx-setting-slider-range' }, slider.root, valueEl),
      hint ? el('div', { class: 'lx-setting-hint', text: hint }) : null,
    )
    syncables.push(() => syncValue(get()))
    return row
  }

  function buildTileSlider(
    label: string,
    min: number,
    max: number,
    get: () => number,
    set: (value: number) => void,
    format: (value: number) => string,
  ): HTMLElement {
    const slider = buildScopedRange('setting-slider', label, min, max)
    const valueEl = el('span', { class: 'lx-setting-slider-value', text: format(get()) })
    const syncValue = (value: number): void => {
      slider.sync(value)
      valueEl.textContent = format(value)
    }
    syncValue(get())
    slider.input.addEventListener('change', () => {
      set(Number(slider.input.value))
      syncValue(get())
    })
    slider.input.addEventListener('input', () => {
      const value = Number(slider.input.value)
      slider.sync(value)
      valueEl.textContent = format(value)
    })
    syncables.push(() => syncValue(get()))
    return el('label', { class: `lx-setting-slider lx-setting-slider-${label.toLowerCase()}` },
      el('span', { class: 'lx-setting-slider-label', text: label }),
      slider.root,
      valueEl,
    )
  }

  function buildSelect<T extends string>(
    label: string,
    hint: string,
    options: Array<{ value: T; label: string }>,
    get: () => T,
    set: (value: T) => void,
  ): HTMLElement {
    const select = el('select', { class: 'lx-select' }) as HTMLSelectElement
    const sync = () => {
      select.replaceChildren()
      for (const option of options) {
        const opt = el('option', { text: option.label, attrs: { value: option.value } }) as HTMLOptionElement
        opt.selected = get() === option.value
        select.appendChild(opt)
      }
    }
    sync()
    select.addEventListener('change', () => set(select.value as T))
    const row = el('div', { class: 'lx-setting-row' },
      el('div', { class: 'lx-setting-text' },
        el('div', { class: 'lx-setting-label', text: label }),
        hint ? el('div', { class: 'lx-setting-hint', text: hint }) : null,
      ),
      select,
    )
    syncables.push(sync)
    return row
  }

  function buildActionRow(label: string, hint: string, action: string, buttonLabel: string): HTMLElement {
    return el('div', { class: 'lx-setting-row' },
      el('div', { class: 'lx-setting-text' },
        el('div', { class: 'lx-setting-label', text: label }),
        hint ? el('div', { class: 'lx-setting-hint', text: hint }) : null,
      ),
      el('button', { class: 'lx-action-btn', text: buttonLabel, attrs: { type: 'button', 'data-action': action } }),
    )
  }

  // ── Collapsible cards: the host's shared component, mounted per the ──
  // documented provisional-ownership rule (the card is appended under the
  // drawer root synchronously, before the current task completes).
  //
  // SCOPING: the host's own chrome classes are CSS-module hashes
  // (frontend/src/components/shared/CollapsibleSection.module.css) that no
  // sheet can target, so the section root gets our `lx-setting-section-*`
  // classes through the documented `className` option, and the header
  // button/content wrapper are tagged post-mount. The host renders the
  // React bridge asynchronously, so tagging rides a mutation observer
  // until every chrome piece has landed (collapsed cards render their
  // content wrapper late).
  function buildCard(slug: string, title: string, children: HTMLElement[], defaultExpanded = false): HTMLElement {
    const wrap = el('section', { class: `lx-card lx-card-${slug}`, attrs: { 'data-lx-card': slug } })
    const mountTarget = el('div', { class: 'lx-card-host' })
    wrap.appendChild(mountTarget)
    const section: SpindleCollapsibleSectionHandle = ctx.components.mountCollapsibleSection(mountTarget, {
      title,
      defaultExpanded,
      className: `lx-setting-section lx-setting-section-${slug}`,
    })
    section.body.classList.add('lx-setting-section-body')
    for (const child of children) section.body.appendChild(child)

    // The host mounts the React bridge asynchronously AND its component
    // renders the content wrapper as `{isExpanded && <div>}` — collapse
    // destroys the wrapper, expand creates a FRESH one (imperative classes
    // on the old node do not carry over). So tagging is idempotent, keyed
    // off current nodes, and the observer stays live for the card's whole
    // lifetime instead of disconnecting after the first success.
    const tagChrome = (): void => {
      const sectionRoot = mountTarget.firstElementChild
      if (!sectionRoot) return
      // Redundant with the className option, but free — older hosts whose
      // bridge predates the option still get a targetable root.
      if (!sectionRoot.classList.contains('lx-setting-section')) {
        sectionRoot.classList.add('lx-setting-section', `lx-setting-section-${slug}`)
      }
      const header = sectionRoot.querySelector(':scope > button')
      if (header && !header.classList.contains('lx-setting-section-header')) {
        header.classList.add('lx-setting-section-header')
      }
      const contentWrapper = section.body.parentElement
      if (contentWrapper && contentWrapper !== mountTarget && !contentWrapper.classList.contains('lx-setting-section-content')) {
        contentWrapper.classList.add('lx-setting-section-content')
      }
    }
    const chromeObserver = new MutationObserver(tagChrome)
    chromeObserver.observe(mountTarget, { childList: true, subtree: true })
    tagChrome()
    disposer.push(() => {
      chromeObserver.disconnect()
      try { section.destroy() } catch { /* host already cleaned up */ }
    })
    return wrap
  }

  // ── Header: banner · vault identity · workspace controls ──
  const banner = el('div', { class: 'lx-banner' })
  const bannerEditBtn = el('button', {
    class: 'lx-banner-edit',
    attrs: { type: 'button', 'data-action': 'pick-banner', title: 'Change or remove banner', 'aria-label': 'Change or remove settings banner' },
  }, icon('imagePlus', 14))
  const bannerStage = el('div', { class: 'lx-container' },
    banner,
    el('div', { class: 'lx-banner-overlay', attrs: { 'aria-hidden': 'true' } }),
    bannerEditBtn,
  )
  const bannerContainer = el('div', { class: 'lx-setting-header-banner-container' }, bannerStage)

  const avatarWrapper = el('button', {
    class: 'lx-setting-avatar-wrapper',
    attrs: {
      type: 'button',
      title: 'Vault avatar — right-click to change the avatar or decoration',
      'aria-label': 'Vault avatar. Right-click for avatar and decoration options.',
      'aria-haspopup': 'menu',
    },
  })
  const avatarContainer = el('div', { class: 'lx-setting-avatar-container' }, avatarWrapper)

  // ── Vault name: lives beside the avatar in the settings header ──
  const vaultNameCurrent = el('span', { class: 'lx-vaultname-current' })
  const vaultNameInput = el('input', {
    class: 'lx-vaultname-input',
    attrs: { type: 'text', maxlength: '80', 'aria-label': 'Vault name' },
  }) as HTMLInputElement
  const vaultNameAccessory = el('div', { class: 'lx-vaultname-accessory' },
    el('button', {
      class: 'lx-icon-btn lx-vaultname-edit-btn',
      attrs: { type: 'button', 'data-action': 'edit-vault-name', title: 'Rename vault', 'aria-label': 'Rename vault' },
    }, icon('pencil', 13)),
  )
  const vaultNameRow = el('span', { class: 'lx-vaultnamerow' }, vaultNameCurrent, vaultNameInput)
  const vaultNameEditable = el('div', { class: 'lx-vaultname-editable' },
    el('div', { class: 'lx-vaultname-content' },
      el('div', { class: 'lx-vaultname-styles' },
        el('span', { class: 'lx-vaultname-label', text: 'Vault name' }),
        el('div', { class: 'lx-vaultname-rowline' }, vaultNameRow, vaultNameAccessory),
      ),
    ),
  )

  function commitVaultName(): void {
    const editable = vaultNameEditable
    if (!editable.classList.contains('lx-editing')) return
    editable.classList.remove('lx-editing')
    const vault = activeVault()
    const next = vaultNameInput.value.trim()
    if (!vault || !next || next === vault.name) {
      vaultNameInput.value = vault?.name ?? ''
      return
    }
    void rpc.call('vault.rename', { vaultId: vault.id, name: next }).catch(() => undefined)
  }
  vaultNameInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault()
      commitVaultName()
    } else if (event.key === 'Escape') {
      vaultNameInput.value = activeVault()?.name ?? ''
      vaultNameEditable.classList.remove('lx-editing')
    }
  })
  vaultNameInput.addEventListener('blur', commitVaultName)

  const vaultNamePreview = el('div', { class: 'lx-vaultname-preview' }, vaultNameEditable)
  const vaultNameplateLayer = el('div', {
    class: 'lx-vaultname-nameplate lx-vaultname-nameplate-empty',
    attrs: {
      tabindex: '0',
      title: 'Vault nameplate — right-click to change or remove',
      'aria-label': 'Vault nameplate. Right-click to change or remove.',
      'aria-haspopup': 'menu',
    },
  })
  // The media layer follows the text in DOM order for easy user theming, but
  // CSS keeps it behind both the displayed name and the rename input. Its
  // picker is exposed only through the name block's context menu.
  const vaultNameBlock = el('div', { class: 'lx-vaultname-fadein' }, vaultNamePreview, vaultNameplateLayer)
  const profileRow = el('div', { class: 'lx-setting-profile' }, avatarContainer, vaultNameBlock)

  function buildPlacementCard(): HTMLElement {
    const choices: Array<{ value: WorkspacePlacement; label: string }> = [
      { value: 'overlay', label: 'Overlay' },
      { value: 'dock', label: 'Half-Dock' },
    ]
    const controls = el('div', { class: 'lx-toggle-placement-controls' })
    const buttons = choices.map(({ value, label }) => {
      const button = el('button', {
        class: 'lx-toggle-card-btn lx-toggle-placement-btn',
        text: label,
        attrs: { type: 'button', 'data-action': `set-placement-${value}`, title: `${label} — double-click to show/hide the workspace` },
      })
      // Double-click toggles workspace visibility (single-click still selects).
      button.addEventListener('dblclick', () => {
        store.set({ overlayVisible: !store.get().overlayVisible })
      })
      controls.appendChild(button)
      return { value, button }
    })
    const card = el('div', { class: 'lx-toggle-card lx-toggle-placement-card' },
      controls,
    )
    syncables.push(() => {
      const current = store.get().settings.ui.placement
      for (const { value, button } of buttons) {
        const active = current === value
        button.classList.toggle('lx-toggle-placement-active', active)
        button.setAttribute('aria-pressed', String(active))
      }
    })
    return card
  }

  function buildWidgetCard(): HTMLElement {
    const toggleBtn = el('button', {
      class: 'lx-toggle-card-btn lx-toggle-widget-toggle-btn',
      text: 'Toggle Widget',
      attrs: { type: 'button', 'data-action': 'toggle-widget' },
    })
    const resetBtn = el('button', {
      class: 'lx-toggle-card-btn lx-toggle-widget-reset-btn',
      text: 'Reset Coordinates',
      attrs: { type: 'button', 'data-action': 'reset-widget-pos' },
    })
    const controls = el('div', { class: 'lx-toggle-placement-controls lx-toggle-widget-controls' }, toggleBtn, resetBtn)
    const card = el('div', { class: 'lx-toggle-card lx-toggle-widget-card' }, controls)
    syncables.push(() => {
      const on = store.get().settings.ui.widgetEnabled
      toggleBtn.classList.toggle('lx-toggle-on', on)
      toggleBtn.setAttribute('aria-pressed', String(on))
    })
    return card
  }

  const toggleCards = el('div', { class: 'lx-toggle-cards' },
    buildPlacementCard(),
    buildWidgetCard(),
  )
  // The quick controls share the banner's positioned `.lx-container`, just
  // like the edit button, so user CSS can treat the entire header as one art
  // surface without reaching across separate layout branches.
  bannerStage.appendChild(toggleCards)

  const header = el('header', { class: 'lx-setting-header' }, bannerContainer, profileRow)

  // ── Vault statistics ──
  const statsTiles = new Map<string, HTMLElement>()
  const statsGrid = el('div', { class: 'lx-vaultstats' },
    ...['Notes', 'Folders', 'Total Words', 'Total Characters', 'Total Tokens'].map((label) => {
      const value = el('div', { class: 'lx-vaultstat-value', text: '—' })
      statsTiles.set(label, value)
      return el('div', { class: 'lx-vaultstat' }, el('div', { class: 'lx-vaultstat-label', text: label }), value)
    }),
  )

  const vaultBlock = el('section', { class: 'lx-setting-vault' },
    el('div', { class: 'lx-container' },
      statsGrid,
    ),
  )

  // ── Art controls folded into their owning settings surfaces ──
  // The profile avatar itself owns avatar/decoration picking through its
  // context menu. Only widget art still needs standalone picker tiles.
  type TileKind = 'widget' | 'widget-decor'

  function buildTile(action: string, title: string, kind: TileKind): HTMLElement {
    const wrapper = el('div', { class: 'lx-setting-tile-wrapper' })
    const tile = el('div', { class: `lx-setting-tile lx-setting-tile-${kind}` },
      el('button', {
        class: 'lx-setting-tilebutton',
        attrs: { type: 'button', 'data-action': action, title: `${title} — upload or pick a recent`, 'aria-label': title },
      },
        el('div', { class: 'lx-setting-tile-content' }, wrapper),
      ),
    )
    syncables.push(() => syncTile(wrapper))
    return tile
  }

  /** Tile art follows the live asset for its action; placeholder otherwise. */
  function syncTile(wrapper: HTMLElement): void {
    const asset = tileAsset(wrapper)
    wrapper.replaceChildren()
    if (asset.url) {
      wrapper.appendChild(mediaThumbEl('lx-setting-tile-img', asset.url, asset.mime))
    } else {
      wrapper.appendChild(el('span', { class: 'lx-setting-tile-placeholder' }, icon('imagePlus', 18)))
    }
  }

  /** Map a widget tile wrapper to the URL + MIME it previews. */
  function tileAsset(wrapper: HTMLElement): { url: string | null; mime: string | null } {
    const key = (wrapper.closest('.lx-setting-tilebutton') as HTMLElement | null)?.dataset.action
    const ui = store.get().settings.ui
    switch (key) {
      case 'pick-widget-icon': return { url: ui.widgetIconUrl, mime: ui.widgetIconMime }
      case 'pick-widget-decor': return { url: ui.widgetDecorUrl, mime: ui.widgetDecorMime }
      default: return { url: null, mime: null }
    }
  }

  const avatarControls = el('div', {
    class: 'lx-setting-tile-controls lx-setting-tile-controls-avatar',
    attrs: { 'aria-label': 'Vault avatar size and radius' },
  },
    el('div', { class: 'lx-setting-label', text: 'Vault Avatar Size' }),
    buildTileSlider('Size', 48, 72,
      () => Math.min(72, store.get().settings.ui.avatarSize),
      (value) => patchSettings((s) => ({ ...s, ui: { ...s.ui, avatarSize: value } })),
      (value) => `${value}px`,
    ),
    buildTileSlider('Radius', 0, 50,
      () => store.get().settings.ui.avatarRadius,
      (value) => patchSettings((s) => ({ ...s, ui: { ...s.ui, avatarRadius: value } })),
      (value) => `${value}%`,
    ),
  )

  const widgetControls = el('div', {
    class: 'lx-setting-tile-controls lx-setting-tile-controls-widget',
    attrs: { 'aria-label': 'Widget size and radius' },
  },
    buildTileSlider('Size', 24, 64,
      () => store.get().settings.ui.widgetSize,
      (value) => patchSettings((s) => ({ ...s, ui: { ...s.ui, widgetSize: value } })),
      (value) => `${value}px`,
    ),
    buildTileSlider('Radius', 0, 50,
      () => store.get().settings.ui.widgetRadius,
      (value) => patchSettings((s) => ({ ...s, ui: { ...s.ui, widgetRadius: value } })),
      (value) => `${value}%`,
    ),
  )

  const widgetCustomization = el('div', {
    class: 'lx-setting-widget-customization',
    attrs: { 'aria-label': 'Widget icon and decoration' },
  },
    el('div', { class: 'lx-setting-label', text: 'Widget Icon & Decoration' }),
    el('div', { class: 'lx-setting-tile-row lx-setting-widget-tile-row' },
      buildTile('pick-widget-icon', 'Widget icon', 'widget'),
      buildTile('pick-widget-decor', 'Widget decoration', 'widget-decor'),
    ),
    widgetControls,
  )

  const body = el('div', { class: 'lx-setting-body' }, vaultBlock)

  // ── Scroll area: the settings cards ──
  const scroll = el('div', { class: 'lx-setting-scroll' },
    buildCard('editor', 'Editor', [
      buildSwitch('Auto-pair brackets', 'Close brackets and quotes as you type.',
        () => store.get().settings.editor.autoPair,
        (value) => patchSettings((s) => ({ ...s, editor: { ...s.editor, autoPair: value } })),
      ),
      buildSegmented<ViewMode>('Default markdown view', 'Applied to notes that have not been switched manually.',
        [
          { value: 'source', label: 'Source' },
          { value: 'live', label: 'Live preview' },
          { value: 'reading', label: 'Reading' },
        ],
        () => store.get().settings.editor.viewMode,
        (value) => patchSettings((s) => ({ ...s, editor: { ...s.editor, viewMode: value } })),
      ),
      buildRange('Editor font size', 'Applies to the source editor in every pane.', 11, 20,
        () => store.get().settings.editor.fontSize,
        (value) => patchSettings((s) => ({ ...s, editor: { ...s.editor, fontSize: value } })),
        (value) => `${value}px`,
      ),
      buildSwitch('Line numbers', 'Show the gutter in Source and Live modes.',
        () => store.get().settings.editor.lineNumbers,
        (value) => patchSettings((s) => ({ ...s, editor: { ...s.editor, lineNumbers: value } })),
      ),
      buildSwitch('Spellcheck', 'Use the browser spell checker while editing.',
        () => store.get().settings.editor.spellcheck,
        (value) => patchSettings((s) => ({ ...s, editor: { ...s.editor, spellcheck: value } })),
      ),
      buildSwitch('Word wrap', 'Wrap long lines instead of scrolling horizontally in the source editor.',
        () => store.get().settings.editor.wordWrap,
        (value) => patchSettings((s) => ({ ...s, editor: { ...s.editor, wordWrap: value } })),
      ),
      buildSelect<'0' | '500' | '1200' | '2500' | '5000'>('Autosave delay', 'How long after you stop typing a note is written to storage.',
        [
          { value: '500', label: 'Fast (0.5 s)' },
          { value: '1200', label: 'Balanced (1.2 s)' },
          { value: '2500', label: 'Relaxed (2.5 s)' },
          { value: '5000', label: 'Slow (5 s)' },
          { value: '0', label: 'Manual (Ctrl+S only)' },
        ],
        () => String(store.get().settings.editor.autosaveMs) as '0' | '500' | '1200' | '2500' | '5000',
        (value) => patchSettings((s) => ({ ...s, editor: { ...s.editor, autosaveMs: Number(value) } })),
      ),
    ], true),

    buildCard('widget', 'Floating Widget', [
      buildSwitch('Snap to edge', 'The widget glides to the nearest screen edge after a drag.',
        () => store.get().settings.ui.widgetSnap,
        (value) => patchSettings((s) => ({ ...s, ui: { ...s.ui, widgetSnap: value } })),
      ),
      buildSwitch('Snap animation', 'Animate snap and programmatic moves instead of jumping.',
        () => store.get().settings.ui.widgetSnapAnim,
        (value) => patchSettings((s) => ({ ...s, ui: { ...s.ui, widgetSnapAnim: value } })),
      ),
      buildRange('Snap animation duration', 'How long the snap glide takes.', 0, 600,
        () => store.get().settings.ui.widgetSnapAnimMs,
        (value) => patchSettings((s) => ({ ...s, ui: { ...s.ui, widgetSnapAnimMs: value } })),
        (value) => `${value}ms`,
      ),
      buildRange('Transparency', 'How see-through the widget is when idle (100% = solid).', 40, 100,
        () => Math.round(store.get().settings.ui.widgetOpacity * 100),
        (value) => patchSettings((s) => ({ ...s, ui: { ...s.ui, widgetOpacity: value / 100 } })),
        (value) => `${value}%`,
      ),
      widgetCustomization,
    ]),

    buildCard('overlay', 'Overlay', [
      buildSwitch('Open workspace on load', '',
        () => store.get().settings.ui.overlayOpenOnLoad,
        (value) => patchSettings((s) => ({ ...s, ui: { ...s.ui, overlayOpenOnLoad: value } })),
      ),
      buildRange('Overlay Opacity', '', 35, 100,
        () => Math.round(store.get().settings.ui.overlayOpacity * 100),
        (value) => patchSettings((s) => ({ ...s, ui: { ...s.ui, overlayOpacity: value / 100 } })),
        (value) => `${value}%`,
      ),
      buildActionRow('Reset window size', '', 'reset-window-size', 'Reset window size'),
      buildActionRow('Reset panes & splits', '', 'reset-panes', 'Reset panes'),
    ]),

    buildCard('half-dock', 'Half-dock', [
      buildRange('Half-dock width', 'Width of the docked workspace panel.', DOCK_MIN_DEFAULT, DOCK_MAX_DEFAULT,
        () => store.get().settings.ui.dockWidth,
        (value) => patchSettings((s) => ({ ...s, ui: { ...s.ui, dockWidth: value } })),
        (value) => `${value}px`,
      ),
      buildActionRow('Reset dock width', '', 'reset-dock-width', 'Reset dock width'),
      buildActionRow('Reset panes & splits', '', 'reset-panes', 'Reset panes'),
    ]),

    buildCard('sidebar', 'Sidebar', [
      buildSwitch('Ask before deleting', 'Confirm before notes and folders are deleted.',
        () => store.get().settings.tree.confirmDelete,
        (value) => patchSettings((s) => ({ ...s, tree: { ...s.tree, confirmDelete: value } })),
      ),
      buildSwitch('Show file extension', 'Display the ".md" suffix on note rows.',
        () => store.get().settings.tree.showExtension,
        (value) => patchSettings((s) => ({ ...s, tree: { ...s.tree, showExtension: value } })),
      ),
      buildSegmented<'icon' | 'text'>('Sort button', 'Choose how the sort control displays as.',
        [
          { value: 'icon', label: 'Icon' },
          { value: 'text', label: 'Words' },
        ],
        () => store.get().settings.tree.sortButtonStyle,
        (value) => patchSettings((s) => ({ ...s, tree: { ...s.tree, sortButtonStyle: value } })),
      ),
    ]),

    buildCard('statusbar', 'Status Bar', [
      buildSwitch('Words', 'Word count of the open note.',
        () => store.get().settings.statusbar.words,
        (value) => patchSettings((s) => ({ ...s, statusbar: { ...s.statusbar, words: value } })),
      ),
      buildSwitch('Characters', 'Character count of the open note.',
        () => store.get().settings.statusbar.characters,
        (value) => patchSettings((s) => ({ ...s, statusbar: { ...s.statusbar, characters: value } })),
      ),
      buildSwitch('Lines', 'Line count of the open note.',
        () => store.get().settings.statusbar.lines,
        (value) => patchSettings((s) => ({ ...s, statusbar: { ...s.statusbar, lines: value } })),
      ),
      buildSwitch('Tokens', 'Estimated tokens (characters ÷ 4) of the open note.',
        () => store.get().settings.statusbar.tokens,
        (value) => patchSettings((s) => ({ ...s, statusbar: { ...s.statusbar, tokens: value } })),
      ),
      buildSwitch('Show saved text', 'Left-side Saved / Unsaved changes / Saving… indicator.',
        () => store.get().settings.statusbar.showSaved,
        (value) => patchSettings((s) => ({ ...s, statusbar: { ...s.statusbar, showSaved: value } })),
      ),
      buildSwitch('Show edited time', 'Right-side "edited … ago" timestamp.',
        () => store.get().settings.statusbar.showEdited,
        (value) => patchSettings((s) => ({ ...s, statusbar: { ...s.statusbar, showEdited: value } })),
      ),
    ]),

    buildCard('vault', 'Vault', [
      buildSwitch('Show Vault Statistics', 'Show the Vault Statistics block in this settings page.',
        () => store.get().settings.ui.showVaultRow,
        (value) => patchSettings((s) => ({ ...s, ui: { ...s.ui, showVaultRow: value } })),
      ),
      buildSwitch('Show Nameplate Image', 'Render the uploaded nameplate behind the workspace vault bar.',
        () => store.get().settings.ui.showNameplate,
        (value) => patchSettings((s) => ({ ...s, ui: { ...s.ui, showNameplate: value } })),
      ),
      avatarControls,
      buildRange('Vault name font size', 'Applies only to the workspace vault bar.', 11, 24,
        () => store.get().settings.ui.vaultNameFontSize,
        (value) => patchSettings((s) => ({ ...s, ui: { ...s.ui, vaultNameFontSize: value } })),
        (value) => `${value}px`,
      ),
    ]),
  )

  const manifest = ctx.manifest
  const container = el('div', { class: 'lx-settings lx-settings-v2' }, header, body, scroll)

  // ── Live sync: banner, avatar, vault name, position readout, tiles ──
  function activeVault() {
    const { vaults, activeVaultId } = store.get()
    return vaults.find((v) => v.id === activeVaultId) ?? null
  }

  /**
   * Signature-guarded media rebuilds: swapping an <img> for a <video> on
   * every sync would reload the asset, so the media children only re-render
   * when their url+mime signature actually changes.
   */
  let bannerSig = ''
  let avatarSig = ''
  let avatarDecorSig = ''
  let vaultNameplateSig = ''

  function syncHeaderAndBody(): void {
    const ui = store.get().settings.ui
    const vault = activeVault()

    // Banner: a real media node (not a CSS background) so video banners
    // actually play. The gradient underneath doubles as the empty state.
    const nextBannerSig = `${ui.bannerUrl ?? ''}|${ui.bannerMime ?? ''}`
    if (nextBannerSig !== bannerSig) {
      bannerSig = nextBannerSig
      banner.replaceChildren()
      if (ui.bannerUrl) {
        banner.appendChild(mediaThumbEl('lx-banner-media', ui.bannerUrl, ui.bannerMime, { alt: 'Settings banner' }))
      }
      banner.classList.toggle('lx-banner-empty', !ui.bannerUrl)
    }

    // Avatar + decoration (Discord-style): refresh only on url/mime change.
    const nextAvatarSig = `${vault?.pfp ?? ''}|${vault?.pfpMime ?? ''}`
    const nextDecorSig = `${vault?.pfpDecor ?? ''}|${vault?.pfpDecorMime ?? ''}`
    if (nextAvatarSig !== avatarSig || nextDecorSig !== avatarDecorSig) {
      avatarSig = nextAvatarSig
      avatarDecorSig = nextDecorSig
      avatarWrapper.replaceChildren()
      if (vault?.pfp) {
        avatarWrapper.appendChild(mediaThumbEl('lx-setting-avatar-img', vault.pfp, vault.pfpMime ?? null, { alt: 'Vault avatar' }))
      } else {
        avatarWrapper.appendChild(el('span', { class: 'lx-setting-avatar-placeholder' }, icon('vault', 22)))
      }
      if (vault?.pfpDecor) {
        avatarWrapper.appendChild(mediaThumbEl('lx-setting-avatar-decor', vault.pfpDecor, vault.pfpDecorMime ?? null))
      }
    }

    // The drawer header avatar remains a stable profile preview. Avatar
    // size/radius target the workspace vault button; the widget art preview
    // still mirrors its card's radius control through a local property.
    widgetCustomization.style.setProperty('--lx-setting-preview-radius', `${ui.widgetRadius}%`)

    // Merge the active vault nameplate into the drawer name block. Rebuild
    // only when URL/MIME changes so animated/video plates keep playing.
    const nextNameplateSig = `${vault?.nameplate ?? ''}|${vault?.nameplateMime ?? ''}`
    if (nextNameplateSig !== vaultNameplateSig) {
      vaultNameplateSig = nextNameplateSig
      vaultNameplateLayer.replaceChildren()
      if (vault?.nameplate) {
        vaultNameplateLayer.appendChild(mediaThumbEl(
          'lx-vaultname-nameplate-media',
          vault.nameplate,
          vault.nameplateMime ?? null,
        ))
      }
      vaultNameplateLayer.classList.toggle('lx-vaultname-nameplate-empty', !vault?.nameplate)
    }

    // Drawer identity text has its own fixed typography. The configurable
    // vault-name scale is reserved for `.lx-vault-name-input` in the tree.
    vaultNameCurrent.textContent = vault?.name ?? 'No vault'
    if (document.activeElement !== vaultNameInput) vaultNameInput.value = vault?.name ?? ''

    vaultBlock.classList.toggle('lx-hidden', !ui.showVaultRow)
  }

  // ── Stats (debounced; the drawer fetches only the active vault) ──
  let statsTimer: ReturnType<typeof setTimeout> | null = null
  async function refreshStats(): Promise<void> {
    const vault = activeVault()
    if (!vault) {
      for (const tile of statsTiles.values()) tile.textContent = '—'
      return
    }
    try {
      const stats = await rpc.call<VaultStats>('vault.stats', { vaultId: vault.id })
      statsTiles.get('Notes')!.textContent = stats.files.toLocaleString()
      statsTiles.get('Folders')!.textContent = stats.folders.toLocaleString()
      statsTiles.get('Total Words')!.textContent = stats.words.toLocaleString()
      statsTiles.get('Total Characters')!.textContent = stats.characters.toLocaleString()
      statsTiles.get('Total Tokens')!.textContent = `~${stats.tokens.toLocaleString()}`
    } catch { /* vault switched mid-flight */ }
  }
  function queueStatsRefresh(): void {
    if (statsTimer) clearTimeout(statsTimer)
    statsTimer = setTimeout(() => {
      statsTimer = null
      void refreshStats()
    }, 300)
  }

  // ── Action delegation (one listener, data-action attributes) ──
  const pick = (
    slot: ImageSlot,
    title: string,
    recentsTitle?: string,
    showRecents = true,
  ) => () => {
    const ui = store.get().settings.ui
    const vault = activeVault()
    if (slot.startsWith('vault-') && !vault) return

    let currentUrl: string | null = null
    let currentMime: string | null = null
    switch (slot) {
      case 'vault-pfp':
        currentUrl = vault?.pfp ?? null
        currentMime = vault?.pfpMime ?? null
        break
      case 'vault-decor':
        currentUrl = vault?.pfpDecor ?? null
        currentMime = vault?.pfpDecorMime ?? null
        break
      case 'vault-nameplate':
        currentUrl = vault?.nameplate ?? null
        currentMime = vault?.nameplateMime ?? null
        break
      case 'widget-icon':
        currentUrl = ui.widgetIconUrl
        currentMime = ui.widgetIconMime
        break
      case 'widget-decor':
        currentUrl = ui.widgetDecorUrl
        currentMime = ui.widgetDecorMime
        break
      case 'banner':
        currentUrl = ui.bannerUrl
        currentMime = ui.bannerMime
        break
    }

    void openImagePicker(ctx, rpc, {
      slot,
      vaultId: slot.startsWith('vault-') ? vault?.id : undefined,
      currentUrl,
      currentMime,
      title,
      recentsTitle,
      showRecents,
    }).catch(() => undefined)
  }

  const pickVaultAvatar = pick('vault-pfp', 'Vault avatar', 'Recent Vault Avatars')
  const pickVaultDecor = pick('vault-decor', 'Avatar decoration', 'Recent Decorations')
  const pickVaultNameplate = pick('vault-nameplate', 'Vault nameplate', undefined, false)

  async function showAvatarArtMenu(x: number, y: number): Promise<void> {
    try {
      const { selectedKey } = await ctx.ui.showContextMenu({
        position: { x, y },
        items: [
          { key: 'avatar', label: 'Change Vault Avatar…' },
          { key: 'decoration', label: 'Change Vault Decoration…' },
        ],
      })
      if (selectedKey === 'avatar') pickVaultAvatar()
      if (selectedKey === 'decoration') pickVaultDecor()
    } catch {
      // A closing drawer can retire the host menu while it is awaiting input.
    }
  }

  const onAvatarContextMenu = (event: MouseEvent): void => {
    event.preventDefault()
    event.stopPropagation()
    void showAvatarArtMenu(event.clientX, event.clientY + 4)
  }
  const onAvatarMenuKey = (event: KeyboardEvent): void => {
    if (event.key !== 'ContextMenu' && !(event.shiftKey && event.key === 'F10')) return
    event.preventDefault()
    event.stopPropagation()
    const rect = avatarWrapper.getBoundingClientRect()
    void showAvatarArtMenu(rect.left + rect.width / 2, rect.bottom + 4)
  }
  avatarWrapper.addEventListener('contextmenu', onAvatarContextMenu)
  avatarWrapper.addEventListener('keydown', onAvatarMenuKey)
  disposer.push(() => {
    avatarWrapper.removeEventListener('contextmenu', onAvatarContextMenu)
    avatarWrapper.removeEventListener('keydown', onAvatarMenuKey)
  })

  async function showNameplateMenu(x: number, y: number): Promise<void> {
    try {
      const { selectedKey } = await ctx.ui.showContextMenu({
        position: { x, y },
        items: [{ key: 'nameplate', label: 'Change or Remove Vault Nameplate…' }],
      })
      if (selectedKey === 'nameplate') pickVaultNameplate()
    } catch {
      // The host retires a pending menu if the drawer closes.
    }
  }

  const onNameplateContextMenu = (event: MouseEvent): void => {
    const target = event.target
    if (target instanceof Element && target.closest('.lx-vaultname-input, .lx-vaultname-accessory')) return
    event.preventDefault()
    event.stopPropagation()
    void showNameplateMenu(event.clientX, event.clientY + 4)
  }
  const onNameplateMenuKey = (event: KeyboardEvent): void => {
    if (event.target !== vaultNameplateLayer) return
    if (event.key !== 'ContextMenu' && !(event.shiftKey && event.key === 'F10')) return
    event.preventDefault()
    event.stopPropagation()
    const rect = vaultNameBlock.getBoundingClientRect()
    void showNameplateMenu(rect.left + rect.width / 2, rect.bottom + 4)
  }
  vaultNameBlock.addEventListener('contextmenu', onNameplateContextMenu)
  vaultNameBlock.addEventListener('keydown', onNameplateMenuKey)
  disposer.push(() => {
    vaultNameBlock.removeEventListener('contextmenu', onNameplateContextMenu)
    vaultNameBlock.removeEventListener('keydown', onNameplateMenuKey)
  })

  // Action delegation, matched to the REAL host lifecycle (verified against
  // lumiverse frontend/src/lib/spindle/placement-helper.ts +
  // ui-events-helper.ts): the drawer tab root is created DETACHED and the
  // host attaches it only while our tab is active, detaching it again on
  // tab switches and drawer closes; mount('settings_extensions') behaves
  // the same way. The documented bindActionHandlers contract is "the
  // target must be connected and live when binding" — a call at setup
  // throws and takes the whole extension down — and the host retires the
  // binding itself whenever the root leaves the document. So: bind on the
  // detached→connected transition, unbind-first so rebinds never stack.
  const ACTION_HANDLERS = {
    'set-placement-overlay': () => patchSettings((s) => ({ ...s, ui: { ...s.ui, placement: 'overlay' } })),
    'set-placement-dock': () => patchSettings((s) => ({ ...s, ui: { ...s.ui, placement: 'dock' } })),
    'toggle-widget': () => patchSettings((s) => ({ ...s, ui: { ...s.ui, widgetEnabled: !s.ui.widgetEnabled } })),
    // Banner and nameplate use no-recents picker conventions; nameplate
    // picking is invoked by its context menu rather than this delegation.
    'pick-widget-icon': pick('widget-icon', 'Widget icon', 'Recent Widget Icons'),
    'pick-widget-decor': pick('widget-decor', 'Widget decoration', 'Recent Widget Decorations'),
    'pick-banner': pick('banner', 'Settings banner', undefined, false),
    'edit-vault-name': () => {
      vaultNameEditable.classList.add('lx-editing')
      vaultNameInput.focus()
      vaultNameInput.select()
    },
    'reset-widget-pos': () => actions.resetWidgetSpot(),
    'reset-window-size': () => actions.resetWindowSize(),
    'reset-dock-width': () => {
      if (actions.resetDockWidth) {
        actions.resetDockWidth()
      } else {
        patchSettings((s) => ({ ...s, ui: { ...s.ui, dockWidth: DEFAULT_SETTINGS.ui.dockWidth } }))
      }
    },
    'reset-panes': () => actions.resetPanesAndSplits(),
  }

  let unbindActions: (() => void) | null = null
  let wasConnected = false
  let bindingFrame = 0
  const drawerGutterHosts = new Set<HTMLElement>()
  const syncDrawerGutterHosts = (connected: boolean): void => {
    const next = new Set<HTMLElement>()
    if (connected) {
      const directParent = container.parentElement
      if (directParent && directParent !== document.body) next.add(directParent)
      let node = directParent
      while (node && node !== document.body && node !== document.documentElement) {
        const overflowY = getComputedStyle(node).overflowY
        if (overflowY === 'auto' || overflowY === 'scroll' || overflowY === 'overlay') next.add(node)
        node = node.parentElement
      }
    }
    for (const host of drawerGutterHosts) {
      if (!next.has(host)) {
        host.classList.remove('lx-drawer-panelcontent-stable')
        drawerGutterHosts.delete(host)
      }
    }
    for (const host of next) {
      host.classList.add('lx-drawer-panelcontent-stable')
      drawerGutterHosts.add(host)
    }
  }
  /**
   * Decorative (muted + looping) videos in the header — banner, avatar,
   * nameplate — stop playing when the host detaches the drawer tab (tab
   * switch / drawer close) and reattaches it later: Chromium does NOT
   * re-trigger `autoplay` on reinsertion. Resume every muted looping video.
   */
  const resumeHeaderVideos = () => {
    for (const v of container.querySelectorAll<HTMLVideoElement>('video')) {
      if (!v.muted || !v.loop || !v.paused) continue
      try { void v.play() } catch { /* autoplay policy — ignore */ }
    }
  }
  // Backstop for mid-session pauses: a muted looping video has no controls,
  // so any pause is unwanted — resume it (covers the detach-pauses and any
  // browser-initiated pause that reattach alone wouldn't catch).
  const resumeOnPause = (event: Event) => {
    const v = event.target
    if (!(v instanceof HTMLVideoElement)) return
    if (!v.muted || !v.loop || !v.paused) return
    try { void v.play() } catch { /* autoplay policy — ignore */ }
  }
  container.addEventListener('pause', resumeOnPause, true)
  disposer.push(() => container.removeEventListener('pause', resumeOnPause, true))

  const syncBinding = () => {
    const connected = container.isConnected
    syncDrawerGutterHosts(connected)
    if (connected && !wasConnected) {
      // The previous binding was retired by the host on detach (or never
      // existed); the returned unbind stays safe to call after the host's
      // automatic cleanup, so unbind-first can never double-listen.
      unbindActions?.()
      unbindActions = ctx.ui.events.bindActionHandlers(container, ACTION_HANDLERS, { attribute: 'data-action' })
      // Reattach resets autoplay state — restart the decorative videos.
      requestAnimationFrame(resumeHeaderVideos)
    }
    wasConnected = connected
  }
  const scheduleSyncBinding = () => {
    cancelAnimationFrame(bindingFrame)
    bindingFrame = requestAnimationFrame(syncBinding)
  }
  // drawerTab.onActivate is the documented signal for tab switches TO us —
  // but a drawer close→reopen on the SAME tab produces no activation event,
  // so a cheap mutation observer is the backstop for host reattachment in
  // every case (drawer, settings mount, either host build).
  const attachObserver = new MutationObserver(() => {
    if (container.isConnected !== wasConnected) scheduleSyncBinding()
  })
  attachObserver.observe(document.documentElement, { childList: true, subtree: true })
  if (drawerTab) disposer.push(drawerTab.onActivate(scheduleSyncBinding))
  disposer.push(() => {
    attachObserver.disconnect()
    cancelAnimationFrame(bindingFrame)
    syncDrawerGutterHosts(false)
    unbindActions?.()
    unbindActions = null
  })
  scheduleSyncBinding() // covers hosts whose root is already connected

  if (drawerTab) {
    drawerTab.root.appendChild(container)

    // Settings → Extensions keeps a compact card with a jump button.
    const openPanelBtn = el('button', { class: 'lx-modal-btn' }, icon('notebookPen', 14), el('span', { text: 'Open settings panel' }))
    openPanelBtn.addEventListener('click', () => drawerTab?.activate())
    const card = el('div', { class: 'lx-settings lx-settings-card' },
      el('div', { class: 'lx-settings-title' },
        icon('notebookText', 18),
        el('div', {},
          el('div', { class: 'lx-settings-name', text: 'Luminote' }),
          el('div', { class: 'lx-settings-sub', text: `v${ctx.manifest.version ?? '1.0.0'} · Settings live in the Luminote sidebar tab.` }),
        ),
      ),
      el('div', { class: 'lx-setting-row lx-setting-actions' }, openPanelBtn),
    )
    settingsMountRoot.appendChild(card)
    disposer.push(() => card.remove())
    disposer.push(() => drawerTab?.destroy())
  } else {
    settingsMountRoot.appendChild(container)
  }

  syncHeaderAndBody()
  for (const sync of syncables) sync()
  void refreshStats()

  // Reflect backend-driven changes (other tab, settings/image/vault ops).
  disposer.push(store.subscribeKey('settings', () => {
    syncHeaderAndBody()
    for (const sync of syncables) sync()
  }))
  disposer.push(store.subscribeKey('vaults', () => {
    syncHeaderAndBody()
    for (const sync of syncables) sync()
    queueStatsRefresh()
  }))
  disposer.push(store.subscribeKey('activeVaultId', () => {
    syncHeaderAndBody()
    queueStatsRefresh()
  }))
  disposer.push(store.subscribeKey('entries', queueStatsRefresh))
  disposer.push(store.subscribeKey('overlayVisible', () => {
    for (const sync of syncables) sync()
  }))
  disposer.push(() => { if (statsTimer) clearTimeout(statsTimer) })

  return {
    destroy() {
      disposer.dispose()
      container.remove()
    },
  }
}
