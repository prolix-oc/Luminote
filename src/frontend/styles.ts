import { HighlightStyle } from '@codemirror/language'
import { EditorView } from '@codemirror/view'
import { tags } from '@lezer/highlight'

/**
 * Luminote stylesheet. Everything keys off `--lumiverse-*` theme variables
 * so the extension inherits the user's theme, accent color and dark/light
 * preference. Injected once via `ctx.dom.addStyle`.
 */
export const OVERLAY_CSS = `
/* ── Shell ─────────────────────────────────────────────────────────── */

.lx-app-mount {
  z-index: 60;
}

.lx-overlay {
  position: fixed;
  display: flex;
  flex-direction: column;
  box-sizing: border-box;
  min-width: 520px;
  min-height: 340px;
  background: color-mix(in srgb, var(--lcs-glass-bg, var(--lumiverse-bg)) 88%, transparent);
  color: var(--lumiverse-text);
  border: 1px solid var(--lumiverse-border);
  border-radius: var(--lumiverse-radius-xl);
  box-shadow: 0 18px 60px rgba(0, 0, 0, 0.20), 0 2px 10px rgba(0, 0, 0, 0.20);
  backdrop-filter: blur(6px) saturate(1.03);
  overflow: hidden;
  font-family: inherit;
  font-size: calc(13px * var(--lumiverse-font-scale, 1));
  line-height: 1.45;
}

.lx-hidden {
  display: none !important;
}

.lx-overlay * {
  box-sizing: border-box;
  min-width: 0;
}

.lx-icon {
  flex: none;
  display: block;
}

.lx-icon-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: none;
  width: 26px;
  height: 26px;
  border: none;
  border-radius: var(--lumiverse-radius);
  background: transparent;
  color: var(--lumiverse-text-muted);
  cursor: pointer;
  transition: background var(--lumiverse-transition-fast, 120ms) ease, color var(--lumiverse-transition-fast, 120ms) ease;
  padding: 0;
}

.lx-icon-btn:hover {
  background: transparent;
  color: var(--lumiverse-text);
}

/* ── Primary action (scoped accent button) ────────────────── */


.lx-action-btn {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 5px 11px;
  background: var(--lumiverse-fill-subtle);
  border-radius: var(--lumiverse-radius-sm);
  color: var(--lumiverse-text-muted);
  font-size: calc(11px * var(--lumiverse-font-scale, 1));
  font-weight: 500;
  white-space: nowrap;
  transition: all var(--lumiverse-transition-fast);
}

.lx-action-btn.add-note {
  background: var(--lumiverse-primary);
  color: var(--lumiverse-primary-contrast);
}

.lx-action-btn:hover {
  background: var(--lumiverse-fill-subtle);
  color: var(--lumiverse-text);
}

.lx-action-btn.add-note {
  background: var(--lumiverse-primary);
  color: var(--lumiverse-primary-contrast);
}

.lx-action-btn.add-note:hover {
  opacity: .9;
  background: var(--lumiverse-primary);
  color: var(--lumiverse-primary-contrast);
}

/* ── Title bar ─────────────────────────────────────────────────────── */

.lx-titlebar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 2px 16px;
  background: transparent;
  cursor: grab;
  user-select: none;
  -webkit-user-select: none;
  touch-action: none;
}

.lx-titlebar:active {
  cursor: grabbing;
}

.lx-overlay.lx-maximized .lx-titlebar {
  cursor: default;
}

/* The vault name only appears while the window is minimized — the spacer
   keeps the window controls pinned right in every state. */
.lx-vault-name {
  display: none;
  font-size: 12px;
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
  color: var(--lumiverse-text);
}

.lx-overlay.lx-minimized .lx-vault-name {
  display: inline;
}

.lx-titlebar .lx-spacer {
  flex: 1;
  min-width: 0;
}

.lx-titlebar-btn[hidden] {
  display: none;
}

/* Maximized: fill the viewport, edges squared. Minimized: titlebar only. */
.lx-overlay.lx-maximized {
  border-radius: 0;
  border: none;
  box-shadow: none;
}

.lx-overlay.lx-minimized {
  min-height: 0;
  overflow: hidden;
}

.lx-overlay.lx-minimized .lx-body,
.lx-overlay.lx-minimized .lx-statusbar,
.lx-overlay.lx-minimized .lx-resizer,
.lx-overlay.lx-maximized .lx-resizer {
  display: none !important;
}

.lx-overlay.lx-minimized .lx-titlebar {
  border-bottom-color: transparent;
}

/* ── Body layout ───────────────────────────────────────────────────── */

.lx-body {
  position: relative;
  display: flex;
  flex: 1;
  min-height: 0;
  contain: layout style;
}

.lx-sidebar {
  position: relative;
  display: flex;
  flex-direction: column;
  width: 252px;
  flex: none;
  background: color-mix(in srgb, var(--lumiverse-bg) 90%, transparent);
  min-width: 180px;
  max-width: 290px;
}

/* The handle overlays the body instead of consuming layout width, so the
   sidebar/editor boundary shifts seamlessly as it is dragged. */
.lx-sidebar-handle {
  position: absolute;
  top: 0;
  bottom: 0;
  right: -5px;
  width: 9px;
  z-index: 9;
  cursor: col-resize;
}

.lx-editor-region {
  position: relative;
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  contain: layout;
}

/* ── Topbar ────────────────────────────────────────────────────────── */

.lx-topbar {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 3px;
  padding: 0;
  min-height: 36px;
  background: var(--lumiverse-fill-medium);
}

/* The search box lives in a collapsible panel under the topbar; the
   topbar itself only carries the toggle button. */
.lx-search-panel {
  display: flex;
  align-items: center;
  padding: 6px 8px;
  background: var(--lumiverse-fill);
  min-width: 0;
}

.lx-search-panel[hidden] {
  display: none;
}

.lx-icon-btn.lx-search-active,
.lx-icon-btn.lx-search-active:hover {
  background: transparent;
  color: var(--lumiverse-text);
}

.lx-search {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 1;
  min-width: 0;
  padding: 3px 10px;
  border: 1px solid var(--lumiverse-border);
  border-radius: var(--lumiverse-radius-md);
  background: var(--lumiverse-fill);
  transition: border-color var(--lumiverse-transition-fast), box-shadow var(--lumiverse-transition-fast);
}

.lx-search:focus-within {
  border-color: var(--lumiverse-primary-muted);
  box-shadow: 0 0 0 3px var(--lumiverse-primary-010);
}

.lx-search svg {
    color: var(--lumiverse-text-dim);
}

.lx-search-input {
  width: 100%;
  min-width: 0;
  border: none;
  background: transparent;
  color: var(--lumiverse-text);
  font-size: calc(12.5px * var(--lumiverse-font-scale, 1));
  outline: none;
  font-family: inherit;
  -webkit-appearance: none;
}

/* ── Tree ──────────────────────────────────────────────────────────── */

.lx-tree-scroller {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  overflow-x: hidden;
  padding: 4px 8px 24px;
  border-right: 1px solid var(--lumiverse-primary-020);
}

.lx-tree-scroller.lx-tree-root-drop {
  outline: 1.5px dashed color-mix(in srgb, var(--lumiverse-accent, var(--lumiverse-primary)) 55%, transparent);
  outline-offset: -4px;
  border-radius: var(--lumiverse-radius, 8px);
}

.lx-root-drop-hint {
  display: none;
  padding: 6px 10px;
  font-size: calc(11px * var(--lumiverse-font-scale, 1));
  color: var(--lumiverse-accent, var(--lumiverse-primary));
  text-align: center;
}

.lx-tree-scroller.lx-tree-root-drop .lx-root-drop-hint {
  display: block;
}

.lx-tree {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 0;
}

.lx-tree-empty {
  padding: 22px 14px;
  color: var(--lumiverse-text-dim);
  font-size: calc(12px * var(--lumiverse-font-scale, 1));
  text-align: center;
  line-height: 1.5;
}

.lx-row {
  display: flex;
  align-items: center;
  gap: 2px;
  height: 27px;
  padding-right: 4px;
  border-radius: 6px;
  cursor: pointer;
  color: var(--lumiverse-text-muted);
  user-select: none;
  -webkit-user-select: none;
  transition: background 90ms ease;
}

.lx-row:hover {
  background: var(--lumiverse-fill-subtle);
  color: var(--lumiverse-text);
}

.lx-row-active {
  background: color-mix(in srgb, var(--lumiverse-accent, var(--lumiverse-primary)) 16%, transparent) !important;
  color: var(--lumiverse-text);
}

.lx-row-active .lx-row-icon {
  color: var(--lumiverse-accent, var(--lumiverse-primary));
}

.lx-row-dragging {
  opacity: 0.45;
}

.lx-row-caret {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  flex: none;
  border: none;
  background: transparent;
  color: var(--lumiverse-text-dim);
  cursor: pointer;
  padding: 0;
  transition: transform 100ms ease;
}

.lx-row-caret svg {
  transform: rotate(90deg);
}

.lx-row-caret.lx-caret-closed svg {
  transform: rotate(0deg);
}

.lx-caret-hidden {
  visibility: hidden;
}

.lx-row-icon {
  display: inline-flex;
  align-items: center;
  flex: none;
  color: var(--lumiverse-text-dim);
}

.lx-row-folder .lx-row-icon {
  color: color-mix(in srgb, var(--lumiverse-accent, var(--lumiverse-primary)) 75%, var(--lumiverse-text));
}

.lx-row-label {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: calc(12.5px * var(--lumiverse-font-scale, 1));
}

.lx-row-menu-btn {
  width: 22px;
  height: 22px;
  opacity: 0;
}

.lx-row:hover .lx-row-menu-btn,
.lx-row-menu-btn:focus-visible {
  opacity: 1;
}

.lx-row-match .lx-row-label {
  color: var(--lumiverse-accent, var(--lumiverse-primary));
}

.lx-drop-into {
  outline: 1.5px solid color-mix(in srgb, var(--lumiverse-accent, var(--lumiverse-primary)) 70%, transparent);
  outline-offset: -1.5px;
  background: color-mix(in srgb, var(--lumiverse-accent, var(--lumiverse-primary)) 14%, transparent) !important;
}

.lx-drag-line {
  display: none;
  position: absolute;
  height: 2px;
  background: var(--lumiverse-accent, var(--lumiverse-primary));
  border-radius: 2px;
  pointer-events: none;
  z-index: 5;
}

.lx-row-renaming {
  background: var(--lumiverse-fill-subtle);
}

.lx-rename-input {
  flex: 1;
  min-width: 0;
  height: 22px;
  border: 1px solid color-mix(in srgb, var(--lumiverse-accent, var(--lumiverse-primary)) 65%, transparent);
  border-radius: 5px;
  background: var(--lumiverse-fill);
  color: var(--lumiverse-text);
  font-size: calc(12.5px * var(--lumiverse-font-scale, 1));
  font-family: inherit;
  padding: 0 6px;
  outline: none;
}

/* ── New note / New folder row ─────────────────────────────────────── */

.lx-tree-actions {
  position: relative;
  display: flex;
  justify-content: center;
  flex-wrap: wrap;
  flex-shrink: 0;
  gap: 6px;
  padding: 4px 2px;
  background: var(--lumiverse-fill);
  border-top: 1px solid var(--lumiverse-border);
}

/* ── Vault bar ─────────────────────────────────────────────────────── */

.lx-vault-bar {
  position: relative;
  height: 56px;
  min-height: 44px;
  inset-inline-start: 1px;
  display: inline-flex;
  justify-content: space-between;
  align-items: center;
  padding: 0px 10px 0px 0px;
  z-index: 10;
}

.lx-vault-bar-nameplate {
  position: absolute;
  height: calc(100% + 2px);
  width: calc(100% + 1px);
  z-index: 0;
  overflow: hidden;
  pointer-events: none;
}



.lx-vault-bar-nameplate-media {
  border-radius: 10px;
  position: absolute;
  inset-inline-end: 0;
  width: auto;
  height: 100%;
  object-fit: cover;
  object-position: right;
  opacity: .7;
}

.lx-vault-bar > .lx-vault-pfp,
.lx-vault-bar > .lx-vault-name-input,
.lx-vault-bar > .lx-icon-btn {
  position: relative;
  z-index: 1;
}

.lx-vault-pfp {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: none;
  padding: 0;
  border: 0;
  cursor: auto;
}



.lx-vault-pfp-img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  border-radius: inherit;
}

/* Avatar decoration (Discord-style): larger than the circle, floats over it. */
.lx-vault-pfp.lx-vault-pfp-decorated {
  overflow: visible;
}

.lx-vault-pfp-decor {
  position: absolute;
  min-width: 115% !important; /* Important so it doesn't get overwritten */
  height: 115%;
  z-index: 1;
}

.lx-vault-settings-btn {
  position: relative;
  height: 25px;
  width: 25px;
  display: flex;
  align-items: center;
  justify-content: center;
  margin: 0;
  border-radius: var(--lumiverse-radius);
  line-height: 0;
}

.lx-vault-settings-btn svg {
  height: 20px;
  width: 20px;
}

.lx-vault-name-input {
  flex: 1;
  min-width: 0;
  height: 26px;
  inset-inline-start: 8px;
  border-radius: var(--lumiverse-radius, 8px);
  background: transparent;
  color: var(--lumiverse-text);
  font-weight: 600;
  padding: 0 7px;
  border: 0;
  outline: none;
  pointer-events: none;
}

.lx-vault-name-input:focus {
  border-color: transparent;
}

.lx-vault-name-input:disabled {
  color: var(--lumiverse-text-dim);
}

/* ── Panes ─────────────────────────────────────────────────────────── */

.lx-pane-root {
  flex: 1;
  min-height: 0;
}

.lx-split {
  display: flex;
  min-width: 0;
  min-height: 0;
  width: 100%;
  height: 100%;
}

.lx-split-col {
  flex-direction: column;
}

.lx-pane {
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  background: color-mix(in srgb, var(--lumiverse-bg) 90%, transparent);
}

/* Pane dividers are invisible grab strips, matching the overlay resizers
   (.lx-resizer-*) and the sidebar handle: a transparent hit area that
   overlaps both neighbors (negative margins) so no visible seam remains;
   only the resize cursor reveals them. */
.lx-pane-divider {
  flex: none;
  z-index: 8;
}

.lx-divider-row {
  width: 6px;
  margin: 0 -3px;
  cursor: col-resize;
}

.lx-divider-col {
  height: 7px;
  margin: -3px 0;
  cursor: row-resize;
}

/* Obsidian's view header (its own row, below the tab strip): breadcrumb
   title on the left, view actions on the right. */
.lx-view-header {
  display: flex;
  align-items: center;
  flex: 0 1 auto;
  gap: 4px;
  min-height: 38px;
  background: var(--lumiverse-fill);
  overflow-x: auto;
  overflow-y: hidden;
}

.lx-view-header-title-container {
  width: 100%;
  min-width: 0;
  display: flex;
  justify-content: center;
  flex: 0 1 auto;
  padding-inline-start: 14px;
  padding-right: 10px;
  gap: 4px;
  font-size: calc(12px * var(--lumiverse-font-scale, 1));
  text-overflow: ellipsis;
  white-space: nowrap;
  overflow: hidden;
}

.lx-view-header-title-parent {
  color: var(--lumiverse-text-dim);
}

.lx-view-header-title {
  flex: 0 1 auto;
  color: var(--lumiverse-text);
  font-weight: 600;
  white-space: nowrap;
  text-overflow: ellipsis;
  overflow: hidden;
}

.lx-view-header-title-empty {
  color: var(--lumiverse-text-dim);
  font-weight: 500;
}

.lx-view-actions {
  display: flex;
  align-items: center;
  padding-right: 6px;
  flex: none;
}

/* ── Pane tab strip (Obsidian-style) ───────────────────────────────── */

/* ── Obsidian-parity tab headers (items 2 & 2.1) ───────────────────────
   DOM: .lx-tab-header-container > .lx-tab-header-container-inner
        > .lx-tab-header[draggable] > .lx-tab-header-inner
        > (#icon, .lx-tab-header-inner-title, .lx-tab-header-inner-close-button)
        … then .lx-tab-header-new-tab + .lx-tab-header-spacer.
   Sizing tokens follow the host where they exist. */

.lx-pane {
  --lx-tab-width: 120px;
  --lx-tab-font-weight: 500;
}

/* Row 1 of a pane: the tab strip stands alone — no view buttons in here.
   Full-width so the inner strip's spacer soaks up the rest of the row. */
.lx-tab-header-container {
  position: relative;
  min-height: 36px;
  display: flex;
  flex: 0 0 auto;
  padding-right: 0px;
  padding-left: 4px;
  gap: 4px;
  background-color: var(--lumiverse-fill-medium);
  overflow: hidden;
}

.lx-tab-header-container-inner {
  min-width: 0;
  max-width: 100%;
  display: flex;
  flex: 0 1 auto;
  gap: 4px;
  margin: 6px 0 -1px 0px;
}

.lx-tab-header-container-inner::-webkit-scrollbar,
.lx-tab-header-container-inner::-webkit-scrollbar-thumb {
  display: none;
}

.lx-tab-header-container-inner.lx-tabstrip-dropping {
  outline: 1px dashed var(--lumiverse-primary-040, var(--lumiverse-primary-050, var(--lumiverse-accent, var(--lumiverse-primary))));
  outline-offset: -2px;
}

.lx-tab-header {
  position: relative;
  min-width: 0;
  width: var(--lx-tab-width);
  max-width: var(--lx-tab-width);
  display: flex;
  flex: 1 1 auto;
  padding-inline-start: 4px;
  padding-inline-end: 2px;
  border: 0;
  border-radius: 8px 8px 0 0;
  overflow: hidden;
}

/* Active Tab Colors */
.lx-tab-header.lx-tab-active, 
.lx-tab-header.lx-tab-active:hover {
  background: color-mix(in srgb, color-mix(in srgb, var(--lumiverse-bg) 90%, rgba(0, 0, 0, 0.15)) 40%, transparent);
  color: var(--lumiverse-text);
}

/* Non-active Tab color*/
.lx-tab-header.lx-tab:not(.lx-tab-header.lx-tab-active) {
   background: color-mix(in srgb, color-mix(in srgb, var(--lumiverse-bg) 90%, rgba(0, 0, 0, 0.15)) 25%, transparent);
}

/* The active tab of the focused pane reads as "current". */
.lx-pane-active .lx-tab-header.lx-tab-active .lx-tab-header-inner > .lx-icon,
.lx-pane-active .lx-tab-header.lx-tab-active .lx-tab-header-inner-title {
  color: var(--lumiverse-text);
}

/* Drop-target highlight while dragging a tab over another. */
.lx-tab-header.lx-tab-highlighted {
  box-shadow: inset 2px 0 0 var(--lumiverse-primary, var(--lumiverse-accent));
  background: var(--lumiverse-primary-010);
}

.lx-tab-header-inner {
  width: 100%;
  display: inline-flex;
  align-items: center;
  flex: 0 1 auto;
  padding-inline-start: 6px;
  padding-inline-end: 3px;
  overflow: hidden;
}

.lx-tab-header-inner > .lx-icon {
  flex: none;
  opacity: 0.75;
}

.lx-tab-header-inner-title {
  width: 100%;
  min-width: 0;
  flex: 1 1 auto;
  color: var(--lumiverse-text-muted);
  font-size: calc(10.5px * var(--lumiverse-font-scale, 1));
  font-weight: var(--lx-tab-font-weight);
  text-overflow: ellipsis;
  white-space: nowrap;
  overflow: hidden;
}

.lx-tab-header-inner-close-button {
  min-width: 0;
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  justify-content: center;
  padding: 0px;
  color: var(--lumiverse-text-dim);
  pointer-events: all;
  cursor: pointer;
  overflow: hidden;
}

.lx-tab-header-inner-close-button.lx-tab-close svg {
  width: 14px;
  height: 14px;
}

.lx-tab-header-inner-close-button:hover {
  background: var(--lumiverse-fill-subtle);
  color: var(--lumiverse-text);
}

/* Close affordance: always on the active tab, hover-revealed elsewhere. */
.lx-tab-header:not(.lx-tab-active) .lx-tab-header-inner-close-button {
  visibility: hidden;
}

@media (hover: hover) {
  .lx-tab-header:not(.lx-tab-active):hover .lx-tab-header-inner-close-button {
    visibility: visible;
  }
}

.lx-tab-header-new-tab {
display: flex;
  align-items: center;
  margin-inline-start: -4px;
  color: var(--lumiverse-text-dim);
  cursor: pointer;
  -webkit-app-region: no-drag;
}

.lx-icon-btn.lx-clickable-icon.lx-new-tab-btn {
  padding-left: 6px;
}

.lx-new-tab-btn svg {
  width: 16px;
  height: 16px;
}

.lx-clickable-icon {
  display: inline-flex;
  width: 18px;
  height: 18px;
  border: revert-layer;
  background: transparent;
  color: var(--lumiverse-text-dim);
  cursor: pointer;
}

.lx-clickable-icon:hover {
  color: var(--lumiverse-text);
}

.lx-tab-header-spacer {
  min-width: 2px;
}

/* (Legacy alias kept for the tablist drop state.) */
.lx-tabstrip-dropping .lx-tab-header-new-tab {
  opacity: 0.65;
}

.lx-segmented {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  border-radius: var(--lumiverse-radius-sm);
  background: color-mix(in srgb, var(--lumiverse-text) 8%, transparent);
}

.lx-segmented-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
  padding: 0 5px;
  border: none;
  border-radius: 5px;
  background: transparent;
  color: var(--lumiverse-text-dim);
  font-size: calc(11px * var(--lumiverse-font-scale, 1));
  font-family: inherit;
  white-space: nowrap;
  cursor: pointer;
  transition: all 100ms ease;
}

.lx-segmented-btn:hover {
  color: var(--lumiverse-text);
}

.lx-segmented-active,
.lx-segmented-active:hover {
  background: var(--lumiverse-fill);
  color: var(--lumiverse-accent, var(--lumiverse-primary));
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.25);
}

.lx-pane-btn {
  width: 24px;
  height: 24px;
}

.lx-pane-body {
  position: relative;
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  border-right: 1px solid var(--lumiverse-primary-020);
  overflow: hidden;
}

.lx-leaf-editor-host {
  flex: 1;
  min-height: 0;
  overflow: auto;
}

.lx-leaf-editor-host .cm-editor {
  height: 100%;
}

.lx-pane-empty {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
  color: var(--lumiverse-text-dim);
  background: var(--lumiverse-fill);
}

.lx-pane-empty-title {
  margin: 4px 0 0;
  color: var(--lumiverse-text-muted);
  font-weight: 600;
}

.lx-pane-empty-hint {
  margin: 0;
  font-size: calc(12px * var(--lumiverse-font-scale, 1));
}

/* ── Reading mode ──────────────────────────────── */
/* Mirrors ISLAND_BASE_CSS (the shadow-DOM island sheet) so light-DOM
   markup pieces render exactly like chat / islands. Keep in step. */

.lx-markup-piece,
.lx-html-island {
  font-size: calc(14px * var(--lumiverse-font-scale, 1));
  line-height: 1.65;
  color: var(--lumiverse-text);
  word-wrap: break-word;
  overflow-wrap: break-word;
  padding: 2px 16px;
}

.lx-leaf-editor-host > .lx-markup-piece:first-child,
.lx-leaf-editor-host > .lx-html-island:first-child {
  padding-top: 12px;
}

.lx-leaf-editor-host > .lx-markup-piece:last-child,
.lx-leaf-editor-host > .lx-html-island:last-child {
  padding-bottom: 36px;
}

.lx-markup-piece p { margin: 0 0 0.5em; }
.lx-markup-piece p:last-child { margin-bottom: 0; }

.lx-markup-piece h1,
.lx-markup-piece h2,
.lx-markup-piece h3,
.lx-markup-piece h4,
.lx-markup-piece h5,
.lx-markup-piece h6 { margin: 0.7em 0 0.35em; font-weight: 600; }

.lx-markup-piece h1 { font-size: 1.35em; }
.lx-markup-piece h2 { font-size: 1.2em; }
.lx-markup-piece h3 { font-size: 1.1em; }
.lx-markup-piece h4 { font-size: 1em; }
.lx-markup-piece h5 { font-size: 0.95em; }
.lx-markup-piece h6 { font-size: 0.9em; }

.lx-markup-piece ul,
.lx-markup-piece ol { padding-left: 1.4em; margin: 4px 0; list-style-position: outside; }
.lx-markup-piece li { margin: 2px 0; }
.lx-markup-piece ul li { list-style: disc; }
.lx-markup-piece ol li { list-style: decimal; }

.lx-markup-piece blockquote {
  border-left: 2px solid var(--lumiverse-primary-020);
  padding: 6px 12px;
  margin: 8px 0;
  background: var(--lumiverse-primary-010);
  border-radius: 0 var(--lcs-radius-xs) var(--lcs-radius-xs) 0;
  color: var(--lumiverse-prose-blockquote);
  font-style: italic;
}

.lx-markup-piece hr {
  border: none;
  border-top: 1px solid var(--lumiverse-border);
  margin: 12px 0;
}

.lx-markup-piece code {
  padding: 2px 6px;
  border-radius: 4px;
  background: var(--lumiverse-fill-subtle);
  border: 1px solid var(--lcs-glass-border);
  font-family: "SF Mono", "Fira Code", "JetBrains Mono", "Menlo", "Consolas", monospace;
  font-size: 0.88em;
  color: var(--lumiverse-primary-text);
}

.lx-markup-piece a,
.lx-prose-link {
  color: var(--lumiverse-prose-link, var(--lumiverse-primary-text));
  text-decoration: none;
  transition: color var(--lumiverse-transition-fast), text-decoration var(--lumiverse-transition-fast);
}

.lx-markup-piece a:hover,
.lx-prose-link:hover {
  text-decoration: underline;
  filter: brightness(1.15);
}

.lx-prose-italic { color: var(--lumiverse-prose-italic); font-style: italic; }
.lx-prose-bold { color: var(--lumiverse-prose-bold); font-weight: 600; }
.lx-prose-inline-emphasis { color: var(--lumiverse-prose-bold); font-weight: 600; }
.lx-prose-dialogue { color: var(--lumiverse-prose-dialogue); }

.lx-prose-image-wrap {
  display: inline-block;
  margin: 8px 0;
  max-width: var(--prose-image-max-width, 240px);
  max-height: var(--prose-image-max-height, 240px);
  overflow: hidden;
  border-radius: var(--lcs-radius-sm);
  border: 1px solid var(--lumiverse-border);
  background: var(--lumiverse-fill-subtle);
  cursor: pointer;
  transition: border-color var(--lumiverse-transition-fast), box-shadow var(--lumiverse-transition-fast), transform var(--lumiverse-transition-fast);
}

.lx-prose-image-wrap:hover {
  border-color: var(--lumiverse-primary-040);
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.35);
  transform: scale(1.02);
}

.lx-prose-image,
.lx-markup-piece img {
  display: block;
  max-width: 100%;
  max-height: var(--prose-image-max-height, 240px);
  object-fit: contain;
  border-radius: var(--lcs-radius-sm);
  cursor: pointer;
}

.lx-prose-table,
.lx-markup-piece table {
  width: 100%;
  border-collapse: collapse;
  margin: 8px 0;
  border: 1px solid var(--lumiverse-border);
  border-radius: var(--lcs-radius-xs);
  overflow: hidden;
}

.lx-prose-table-head,
.lx-markup-piece th {
  font-weight: 600;
  background: var(--lumiverse-primary-010);
  border: 1px solid var(--lumiverse-border);
  padding: 8px 12px;
  text-align: left;
  font-size: calc(13px * var(--lumiverse-font-scale, 1));
}

.lx-prose-table-cell,
.lx-markup-piece td {
  padding: 8px 12px;
  border: 1px solid var(--lumiverse-border);
  font-size: calc(13px * var(--lumiverse-font-scale, 1));
}

.lx-prose-table-row:nth-child(even) td,
.lx-markup-piece tr:nth-child(even) td {
  background: var(--lumiverse-bg-dark);
}

.lx-code-block {
  position: relative;
  margin: 10px 0;
  border-radius: 10px;
  overflow: hidden;
  background: var(--lumiverse-fill-strong);
  border: 1px solid var(--lumiverse-border);
}

.lx-code-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px 14px;
  background: var(--lumiverse-fill-subtle);
  border-bottom: 1px solid var(--lumiverse-border);
}

.lx-code-lang {
  font-family: "SF Mono", "Fira Code", "JetBrains Mono", "Menlo", "Consolas", monospace;
  font-size: 0.72em;
  font-weight: 500;
  color: var(--lumiverse-text-dim);
  text-transform: uppercase;
  letter-spacing: 0.05em;
  user-select: none;
}

.lx-code-copy {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 3px 8px;
  border-radius: 6px;
  border: none;
  background: transparent;
  color: var(--lumiverse-text-dim);
  font-family: inherit;
  font-size: 0.72em;
  cursor: pointer;
  opacity: 0;
  transition: opacity 150ms ease, color 150ms ease, background 150ms ease;
}

.lx-code-block:hover .lx-code-copy { opacity: 1; }
.lx-code-copy:hover {
  color: var(--lumiverse-text);
  background: var(--lumiverse-fill-subtle);
}
.lx-code-copied {
  opacity: 1 !important;
  color: var(--lumiverse-success) !important;
}

.lx-code-block pre {
  margin: 0;
  padding: 14px;
  overflow-x: auto;
  white-space: pre;
}

.lx-code-block pre code {
  font-family: "SF Mono", "Fira Code", "JetBrains Mono", "Menlo", "Consolas", monospace;
  font-size: 0.85em;
  line-height: 1.6;
  color: var(--lumiverse-text);
  background: none;
  padding: 0;
  border: none;
  border-radius: 0;
  tab-size: 2;
}

.lx-markup-piece pre {
  padding: 14px;
  border-radius: 10px;
  background: var(--lumiverse-fill-strong);
  border: 1px solid var(--lumiverse-border);
  overflow-x: auto;
  margin: 10px 0;
  white-space: pre-wrap;
  word-wrap: break-word;
}

.lx-markup-piece pre code {
  padding: 0;
  background: none;
  border: none;
  font-size: 0.85em;
  line-height: 1.6;
  color: var(--lumiverse-text);
  white-space: pre-wrap;
}

.lx-markup-piece details { margin: 0.35em 0; }
.lx-markup-piece summary { cursor: pointer; font-weight: 600; }

/* highlight.js palette (matches chat theme tokens) */
.hljs-keyword, .hljs-selector-tag, .hljs-tag { color: #ff7b9c; }
.hljs-string, .hljs-attr { color: #a5d6a7; }
.hljs-number, .hljs-literal { color: #f0a875; }
.hljs-comment, .hljs-quote { color: #7f848e; font-style: italic; }
.hljs-function, .hljs-title { color: #82aaff; }
.hljs-variable, .hljs-name { color: #c792ea; }
.hljs-built_in, .hljs-type { color: #ffcb6b; }
.hljs-symbol, .hljs-bullet { color: #89ddff; }
.hljs-meta { color: #7f97a8; }
.hljs-emphasis { font-style: italic; }
.hljs-strong { font-weight: 700; }
.hljs-deletion { color: #ff6c6b; }
.hljs-addition { color: #98c379; }

/* ── Live preview decorations ─────────────────────────────────────── */

.lx-lp-h1, .lx-lp-h2, .lx-lp-h3, .lx-lp-h4, .lx-lp-h5, .lx-lp-h6 {
  line-height: 1.35 !important;
}

.lx-lp-h1 { font-size: 1.5em !important; font-weight: 700; }
.lx-lp-h2 { font-size: 1.3em !important; font-weight: 700; }
.lx-lp-h3 { font-size: 1.15em !important; font-weight: 700; }
.lx-lp-h4, .lx-lp-h5, .lx-lp-h6 { font-size: 1.05em !important; font-weight: 700; }

.lx-lp-h1, .lx-lp-h2, .lx-lp-h3, .lx-lp-h4, .lx-lp-h5, .lx-lp-h6 {
  color: var(--lumiverse-text);
}

.lx-lp-em { color: var(--lumiverse-prose-italic); font-style: italic; }
.lx-lp-strong { color: var(--lumiverse-prose-bold); font-weight: 600; }
.lx-lp-strike { text-decoration: line-through; }

.lx-lp-code {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 0.88em;
  background: color-mix(in srgb, var(--lumiverse-text) 8%, transparent);
  padding: 0.1em 0.3em;
  border-radius: 4px;
  color: var(--lumiverse-primary-text);
}

.lx-lp-fenced {
  background: color-mix(in srgb, var(--lumiverse-text) 4%, transparent);
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 0.92em;
  border-radius: 4px;
}

.lx-lp-quote { color: var(--lumiverse-text-muted); font-style: italic; }
.lx-lp-url { color: var(--lumiverse-text-dim); font-size: 0.85em; }
.lx-lp-link { color: var(--lumiverse-accent, var(--lumiverse-primary)); }
/* The rule itself: transparent dashes on a normal-height line (so gutter
   and content never drift), with the divider painted inside the line box. */
.lx-lp-hr {
  color: transparent;
}

.lx-lp-hr-line {
  background: linear-gradient(
      to right,
      var(--lumiverse-border),
      var(--lumiverse-border)
    ) center / 100% 1px no-repeat;
}

/* ── Status bar ────────────────────────────────────────────────────── */

.lx-statusbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  height: 26px;
  flex: none;
  padding: 0 16px;
  border-top: 1px solid var(--lumiverse-border);
  background: var(--lumiverse-bg);
  color: var(--lumiverse-text-dim);
  font-size: calc(11px * var(--lumiverse-font-scale, 1));
  user-select: none;
  -webkit-user-select: none;
  z-index: 2;
}

.lx-status-save {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  flex: none;
}

.lx-status-save-icon {
  display: inline-flex;
  align-items: center;
}

.lx-status-save-label {
  color: var(--lumiverse-text);
}

/* Save-state colors key off Lumiverse's own state tokens (item 3) — but only
   the ICON carries them; the label always reads as regular body text. */
.lx-save-saved .lx-status-save-icon { color: var(--lumiverse-success); }
.lx-save-dirty .lx-status-save-icon { color: var(--lumiverse-warning); }
.lx-save-error .lx-status-save-icon { color: var(--lumiverse-error); }
.lx-save-saving .lx-status-save-icon { color: var(--lumiverse-text-dim); }

/* ── Live-preview HTML/SVG islands (item 1) ────────────────────────────
   The widget host sits inside CodeMirror's flow; the actual island content
   lives in an open shadow root (.lx-html-island, styles in render.ts) and
   stays fully interactive — the header strip is the only edit affordance. */

.lx-live-island {
  display: block;
  position: relative;
}

/* Meant to emulate Lumiverse _list_ and other styles so Luminote's html
islands appear similar to Lumiverse's native chat. */
.lx-live-island.lx-live-island-html {
  position: relative;
  max-width: 100%;
  display: flow-root;
  overscroll-behavior-y: contain;
  -webkit-overflow-scrolling: touch;
  scrollbar-width: thin;
  scrollbar-color: color-mix(in srgb, var(--lumiverse-border) 55%, transparent) transparent;
  transition: opacity .22s ease, transform .22s ease;
  overflow: visible;
}

.lx-live-island-header {
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 0px 8px;
  border-radius: 8px 8px 0 0;
  color: var(--lumiverse-text-dim);
  background: var(--lumiverse-fill);
  font-size: calc(10px * var(--lumiverse-font-scale, 1));
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  user-select: none;
  cursor: text;
  transition: color var(--lumiverse-transition-fast, 120ms ease), background var(--lumiverse-transition-fast, 120ms ease);
}

.lx-live-island-header > .lx-icon {
  flex: none;
  opacity: 0.8;
}

.lx-live-island-title {
  text-overflow: ellipsis;
  white-space: nowrap;
  overflow: hidden;
}

.lx-live-island-edit {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  padding: 2px;
  border: none;
  border-radius: 4px;
  background: transparent;
  color: inherit;
  cursor: pointer;
}

.lx-live-island-edit:hover {
  color: var(--lumiverse-text);
  background: var(--lumiverse-fill-subtle-hover, var(--lumiverse-fill-hover));
}

.lx-live-island-empty {
  color: var(--lumiverse-text-dim);
  font-size: calc(12px * var(--lumiverse-font-scale, 1));
  font-style: italic;
}

.lx-live-svg {
  display: block;
  position: relative;
}

.lx-live-svg-frame svg {
  max-width: 100%;
  max-height: 420px;
}

.lx-live-svg-frame svg:not([width]) {
  width: min(420px, 100%);
  display: block;
  margin: 0 auto;
}

.lx-save-saving .lx-icon,
.lx-save-saving svg {
  animation: lx-spin 1s linear infinite;
}

@keyframes lx-spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

.lx-status-right {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  justify-content: flex-end;
  min-width: 0;
}

.lx-status-stats {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.lx-status-edited {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  flex: none;
}

/* ── Resizers ──────────────────────────────────────────────────────── */

.lx-resizer {
  position: absolute;
  z-index: 8;
  touch-action: none;
}

.lx-resizer-left {
  top: 0;
  left: 0;
  width: 8px;
  height: 100%;
  cursor: ew-resize;
}

.lx-resizer-right {
  top: 0;
  right: -3px;
  width: 8px;
  height: 100%;
  cursor: ew-resize;
}

.lx-resizer-bottom {
  left: 0;
  bottom: -3px;
  height: 8px;
  width: 100%;
  cursor: ns-resize;
}

.lx-resizer-corner {
  right: 0px;
  bottom: 0px;
  width: 16px;
  height: 16px;
  cursor: nwse-resize;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--lumiverse-text-dim);
}

.lx-resizer-corner svg {
  opacity: 0.3;
  stroke-width: 2.5;
}

.lx-resizer-corner:hover svg {
  opacity: 0.85;
  color: var(--lumiverse-accent, var(--lumiverse-primary));
}

/* ── Toast ─────────────────────────────────────────────────────────── */

.lx-toast {
  position: absolute;
  left: 50%;
  bottom: 46px;
  transform: translateX(-50%);
  z-index: 40;
  padding: 7px 13px;
  border-radius: 8px;
  background: color-mix(in srgb, var(--lumiverse-fill) 88%, var(--lumiverse-accent, var(--lumiverse-primary)));
  border: 1px solid color-mix(in srgb, var(--lumiverse-accent, var(--lumiverse-primary)) 40%, transparent);
  color: var(--lumiverse-text);
  font-size: calc(12px * var(--lumiverse-font-scale, 1));
  box-shadow: 0 6px 24px rgba(0, 0, 0, 0.4);
  animation: lx-toast-in 160ms ease;
  max-width: 82%;
  text-align: center;
  pointer-events: none;
}

.lx-toast-out {
  opacity: 0;
  transition: opacity 450ms ease;
}

@keyframes lx-toast-in {
  from { opacity: 0; transform: translateX(-50%) translateY(6px); }
  to { opacity: 1; transform: translateX(-50%) translateY(0); }
}

/* ── Float widget ─────────────────────────────────────────────────── */

.lx-widget-btn {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 100%;
  padding: 0;
  border: 1px solid var(--lumiverse-border);
  background: color-mix(in srgb, var(--lumiverse-fill) 82%, transparent);
  color: var(--lumiverse-text);
  cursor: pointer;
  box-shadow: 0 4px 18px rgba(0, 0, 0, 0.35);
  transition: all var(--lumiverse-transition-fast, 140ms) ease;
  user-select: none;
  -webkit-user-select: none;
  touch-action: none;
}

.lx-widget-btn:hover {
  transform: scale(1.06);
  color: var(--lumiverse-accent, var(--lumiverse-primary));
  border-color: color-mix(in srgb, var(--lumiverse-accent, var(--lumiverse-primary)) 55%, transparent);
}


/* ── Settings drawer ──────────────────────────────────────────────── */

/* Applied at runtime to the drawer's actual overflow ancestor. Reserving the
   gutter prevents lx-card expansion from shifting panel content sideways. */
.lx-drawer-panelcontent-stable,
.lx-settings-v2 {
  scrollbar-gutter: stable;
}

.lx-settings {
  display: flex;
  flex-direction: column;
  gap: 18px;
  padding: 4px 2px;
  color: var(--lumiverse-text);
  font-size: calc(13px * var(--lumiverse-font-scale, 1));
}

.lx-settings-title {
  display: flex;
  align-items: center;
  gap: 11px;
  color: var(--lumiverse-accent, var(--lumiverse-primary));
}

.lx-settings-name {
  font-size: calc(15px * var(--lumiverse-font-scale, 1));
  font-weight: 700;
  color: var(--lumiverse-text);
}

.lx-settings-sub {
  font-size: calc(12px * var(--lumiverse-font-scale, 1));
  color: var(--lumiverse-text-dim);
}

.lx-settings-section {
  display: flex;
  flex-direction: column;
  gap: 2px;
  border-top: 1px solid var(--lumiverse-border);
  padding-top: 10px;
}

.lx-settings-heading {
  margin: 0 0 6px;
  font-size: calc(11px * var(--lumiverse-font-scale, 1));
  font-weight: 700;
  letter-spacing: 0.07em;
  text-transform: uppercase;
  color: var(--lumiverse-text-dim);
}

.lx-setting-row {
  display: flex;
  gap: 6px;
  flex-direction: row;
  justify-content: space-between;
  align-items: center;
}

.lx-setting-label {
  font-size: calc(14px * var(--lumiverse-font-scale, 1));
  font-weight: 500;
}

.lx-setting-hint {
  font-size: calc(11px * var(--lumiverse-font-scale, 1));
  color: var(--lumiverse-text-dim);
}

.lx-setting-actions {
  justify-content: flex-start;
}

/* switch */
.lx-switch {
  position: relative;
  display: inline-block;
  flex: none;
}

.lx-switch input {
  position: absolute;
  opacity: 0;
  width: 0;
  height: 0;
}

.lx-switch-track {
  display: block;
  width: 34px;
  height: 19px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--lumiverse-text) 16%, transparent);
  cursor: pointer;
  transition: background 140ms ease;
  position: relative;
}

.lx-switch-thumb {
  position: absolute;
  top: 2.5px;
  left: 2.5px;
  width: 14px;
  height: 14px;
  border-radius: 50%;
  background: #fff;
  transition: transform 140ms ease;
}

.lx-switch input:checked + .lx-switch-track {
  background: var(--lumiverse-accent, var(--lumiverse-primary));
}

.lx-switch input:checked + .lx-switch-track .lx-switch-thumb {
  transform: translateX(15px);
}

.lx-switch input:focus-visible + .lx-switch-track {
  outline: 2px solid color-mix(in srgb, var(--lumiverse-accent, var(--lumiverse-primary)) 70%, transparent);
  outline-offset: 2px;
}

/* Fully lx-scoped range anatomy. Compact .lx-setting-slider controls and the
   settings range rows share these visual primitives. */
.lx-slider-trackarea {
  position: relative;
  display: flex;
  align-items: center;
  flex: 1;
  min-height: 20px;
  min-width: 0;
  cursor: pointer;
  touch-action: pan-y;
  user-select: none;
  -webkit-user-select: none;
}

.lx-slider-track {
  position: relative;
  width: 100%;
  height: 6px;
  border-radius: 3px;
  background: rgba(128, 128, 128, 0.15);
}

.lx-slider-fill {
  position: absolute;
  top: 0;
  left: 0;
  height: 100%;
  border-radius: inherit;
  background: var(--lumiverse-primary);
  opacity: 0.8;
  pointer-events: none;
}

.lx-slider-thumb {
  position: absolute;
  top: 50%;
  width: 14px;
  height: 14px;
  border: 2px solid var(--lumiverse-bg);
  border-radius: 50%;
  background: var(--lumiverse-primary);
  transform: translate(-50%, -50%);
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.25), 0 0 0 1px var(--lumiverse-primary-020);
  pointer-events: none;
}

.lx-slider-trackarea > .lx-slider-input {
  -webkit-appearance: none;
  appearance: none;
  position: absolute;
  inset: 0;
  z-index: 2;
  width: 100%;
  height: 100%;
  min-height: 0;
  margin: 0;
  padding: 0;
  opacity: 0;
  cursor: pointer;
  touch-action: pan-y;
}

.lx-slider-input:focus-visible {
  outline: none;
}

.lx-slider-input:focus-visible + .lx-slider-track .lx-slider-thumb {
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.25), 0 0 0 3px var(--lumiverse-primary-020);
}

/* Compact setting slider row — label/track/value, shared by the tile
   controls (avatar/widget Size & Radius) and the settings range rows. */
.lx-setting-control {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.lx-setting-slider {
  display: flex;
  align-items: center;
  gap: 4px;
}

.lx-setting-slider-label {
  flex: none;
  padding: 0 10px 0 0;
  width: 42px;
  font-size: calc(10.5px * var(--lumiverse-font-scale, 1));
  font-weight: 600;
  color: var(--lumiverse-text-muted);
}

.lx-setting-slider-value {
  flex: none;
  padding: 0 0 0 10px;
  min-width: 42px;
  font-size: calc(10.5px * var(--lumiverse-font-scale, 1));
  color: var(--lumiverse-text-dim);
  font-variant-numeric: tabular-nums;
}

/* select */
.lx-select {
  background: var(--lumiverse-fill);
  color: var(--lumiverse-text);
  border: 1px solid var(--lumiverse-border);
  border-radius: 7px;
  font-size: calc(12.5px * var(--lumiverse-font-scale, 1));
  padding: 4px 8px;
  outline: none;
}

.lx-select:focus {
  border-color: color-mix(in srgb, var(--lumiverse-accent, var(--lumiverse-primary)) 60%, transparent);
}

.lx-settings-note {
  margin: 2px 0 4px;
  font-size: calc(12px * var(--lumiverse-font-scale, 1));
  line-height: 1.55;
  color: var(--lumiverse-text-dim);
}

/* ── Modals & misc ────────────────────────────────────────────────── */

.lx-stats-grid {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 4px 16px;
  padding: 4px 2px 10px;
}

.lx-stats-value {
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  color: var(--lumiverse-text);
}

.lx-stats-label {
  color: var(--lumiverse-text-muted);
  font-size: calc(12.5px * var(--lumiverse-font-scale, 1));
}

.lx-stats-note {
  margin: 0;
  padding-top: 6px;
  font-size: calc(11.5px * var(--lumiverse-font-scale, 1));
  color: var(--lumiverse-text-dim);
  border-top: 1px solid var(--lumiverse-border);
}

.lx-modal-input {
  width: 100%;
  height: 32px;
  margin: 10px 0;
  padding: 0 10px;
  border: 1px solid var(--lumiverse-border);
  border-radius: 8px;
  background: var(--lumiverse-fill);
  color: var(--lumiverse-text);
  font-family: inherit;
  font-size: calc(13px * var(--lumiverse-font-scale, 1));
  outline: none;
}

.lx-modal-input:focus {
  border-color: color-mix(in srgb, var(--lumiverse-accent, var(--lumiverse-primary)) 65%, transparent);
}

.lx-modal-input-error {
  border-color: var(--lumiverse-error) !important;
}

.lx-modal-hint {
  margin: 0;
  font-size: calc(12px * var(--lumiverse-font-scale, 1));
  color: var(--lumiverse-text-muted);
}

.lx-modal-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  width: 100%;
  height: 32px;
  border: none;
  border-radius: 8px;
  background: var(--lumiverse-accent, var(--lumiverse-primary));
  color: var(--lumiverse-accent-fg);
  font-family: inherit;
  font-size: calc(13px * var(--lumiverse-font-scale, 1));
  font-weight: 600;
  cursor: pointer;
  transition: filter 120ms ease;
}

.lx-modal-btn:hover { filter: brightness(1.1); }
.lx-modal-btn:disabled { opacity: 0.55; cursor: default; }

.lx-perm-banner {
  position: fixed;
  left: 50%;
  bottom: 22px;
  transform: translateX(-50%);
  z-index: 70;
  max-width: 480px;
  padding: 10px 16px;
  border-radius: 10px;
  background: var(--lumiverse-fill);
  border: 1px solid color-mix(in srgb, #e5b567 55%, transparent);
  color: var(--lumiverse-text);
  font-size: calc(12.5px * var(--lumiverse-font-scale, 1));
  line-height: 1.5;
  box-shadow: 0 10px 34px rgba(0, 0, 0, 0.45);
}

.lx-perm-banner em { color: #e5b567; font-style: normal; font-weight: 600; }

/* Narrow overlay panes: shrink the vault switcher affordances. */
@media (max-width: 760px) {
  .lx-pane-title { max-width: 30%; }
  .lx-status-stats { display: none; }
}

/* ── Sidebar toggle (pinned beside the firstmost tab of the left-most
   split by the editor feature; re-parented there on every render) ─────── */
.lx-side-toggle-wrap {
  display: inline-flex;
  align-items: center;
  flex: none;
  align-self: center;
}

.lx-tab-strip-inner > .lx-side-toggle-wrap {
  margin-inline-end: 2px;
}

.lx-side-toggle-wrap .lx-side-toggle {
  width: 24px;
  height: 24px;
}

/* Makes the toggle slightly larger */
.lx-side-toggle-wrap .lx-side-toggle svg {
  width: 20px;
  height: 20px;
}

/* Sidebar collapsed: the body hands all width to the editor region (the
   resize handle lives inside the sidebar, so it tucks away with it). */
.lx-overlay.lx-side-collapsed .lx-body > .lx-sidebar,
.lx-shell.lx-side-collapsed .lx-body > .lx-sidebar {
  display: none;
}

/* ── Sort button: text mode (current order as words) ────────────────── */
.lx-icon-btn.lx-sort-btn.lx-sort-btn-text {
  width: auto;
  padding: 0 8px;
}

.lx-sort-label {
  font-size: calc(11px * var(--lumiverse-font-scale, 1));
  font-weight: 500;
  line-height: 1;
  color: var(--lumiverse-text-muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 120px;
}

.lx-sort-btn.lx-sort-btn-text:hover .lx-sort-label {
  color: var(--lumiverse-text);
}

/* ── Dock shell (workspace mounted in a host dock panel) ───────────── */
.luminote-dock-root {
  position: relative;
  height: 100%;
  min-height: 0;
  display: flex;
  flex-direction: column;
  contain: layout style;
}

.lx-dock-shell {
  position: relative;
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
  box-sizing: border-box;
  background: color-mix(in srgb, var(--lcs-glass-bg, var(--lumiverse-bg)) 88%, transparent);
  color: var(--lumiverse-text);
  overflow: hidden;
  font-family: inherit;
  font-size: calc(13px * var(--lumiverse-font-scale, 1));
  line-height: 1.45;
  contain: layout;
  will-change: width;
}

.lx-shell {
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
  box-sizing: border-box;
  background: color-mix(in srgb, var(--lcs-glass-bg, var(--lumiverse-bg)) 88%, transparent);
  color: var(--lumiverse-text);
  overflow: hidden;
  font-family: inherit;
  font-size: calc(13px * var(--lumiverse-font-scale, 1));
  line-height: 1.45;
}

.lx-shell * {
  box-sizing: border-box;
  min-width: 0;
}



/* ── Smushed tabs ────────────────────────────────────────────────────── */
/* When the strip shrinker squeezes a tab past the point its title can be
   read it pins an inline max-width: 40px on .lx-tab-header-inner — the
   attribute selector below keys off that marker so the title hides safely
   and only the close button remains visible. */
.lx-tab-header-inner[style*="max-width: 40px"] .lx-tab-header-inner-title {
  display: none;
}

/* ── Widget custom art (icon + decoration) ───────────────────────────── */
/* Same layering math as the vault avatar decoration: the icon FILLS the
   button (the parent's overflow clip keeps its corners), and with a
   decoration on, clipping opens up and the decor floats over at
   --decoration-to-avatar-ratio scale, centered via the shared position var. */
.lx-widget-btn.lx-widget-decorated {
  overflow: visible;
}

.lx-widget-icon {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: cover;
  border-radius: inherit;
  pointer-events: none;
}

.lx-widget-icon-decor {
  position: absolute;
  inset-inline-start: var(--custom-avatar-avatar-decoration-border-position, calc((1 - var(--decoration-to-avatar-ratio, 1)) / 2 * 100%));
  inset-block-start: var(--custom-avatar-avatar-decoration-border-position, calc((1 - var(--decoration-to-avatar-ratio, 1.2)) / 2 * 100%));
  width: calc(var(--decoration-to-avatar-ratio, 1.2) * 100%);
  height: calc(var(--decoration-to-avatar-ratio, 1.2) * 100%);
  pointer-events: none;
  z-index: 2;
}

/* ── Status bar metric grid ──────────────────────────────────────────── */
.lx-status-stats {
  display: inline-flex;
  gap: 8px;
}

.lx-status-stat {
  white-space: nowrap;
}

/* ── Settings drawer v2 — Discord-profile layout ─────────────────────── */

.lx-setting-header {
  display: flex;
  flex-direction: column;
  gap: 0;
}

.lx-setting-profile {
  position: relative;
  min-height: 100px;
  display: flex;
  align-items: center;
  margin-top: -54px;
  padding: 0px 18px 0 32px;
}

.lx-setting-profile .lx-vaultname-fadein {
  position: relative;
  height: fit-content;
  width: fit-content;
  display: inline-flex;
  inset-inline-end: 8px;
  flex: 1;
  background: var(--lumiverse-bg-deep);
  border-radius: var(--lumiverse-radius-md);
  border-top: 1px solid var(--lumiverse-border-neutral);
  border-bottom: 1px solid var(--lumiverse-border-neutral);
}

.lx-vaultname-preview {
  position: relative;
  inset-inline-start: 16px;
  z-index: 2;
  pointer-events: auto;
}

.lx-vaultname-nameplate {
  position: absolute;
  inset: 0;
  z-index: 1;
  display: block;
  width: 100%;
  height: 100%;
  padding: 0;
  overflow: hidden;
  border: 0;
  border-radius: inherit;
  background: transparent;
  cursor: context-menu;
}

.lx-vaultname-nameplate:focus-visible {
  outline: 2px solid var(--lumiverse-primary-muted);
  outline-offset: 2px;
}

.lx-vaultname-nameplate-media {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: cover;
  pointer-events: none;
}

.lx-setting-header-banner-container .lx-container {
  position: relative;
}

.lx-banner {
  height: 172px;
  background: var(--lumiverse-bg-deep);
  border-radius: 8px 8px 0 0;
  overflow: hidden;
}

.lx-banner-media {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
  pointer-events: none;
}

.lx-banner-overlay {
  position: absolute;
  inset: 0;
  border-radius: 8px 8px 0 0;
  background: linear-gradient(180deg, transparent 38%,
    color-mix(in srgb, var(--lumiverse-bg-deep) 68%, transparent) 72%,
    var(--lumiverse-bg-deep) 100%);
  pointer-events: none;
}

.lx-banner-edit {
  position: absolute;
  top: 8px;
  right: 8px;
  width: 26px;
  height: 26px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--lumiverse-radius);
  background: var(--lumiverse-fill);
  color: var(--lumiverse-text-dim);
  cursor: pointer;
  visibility: hidden;
  opacity: 0;
  transition: opacity 140ms ease;
  z-index: 10;
}

.lx-banner-edit:hover {
  color: var(--lumiverse-text-muted);
}

.lx-setting-header-banner-container:hover .lx-banner-edit,
.lx-setting-header-banner-container:focus-within .lx-banner-edit,
.lx-banner-edit:focus-visible {
  visibility: visible;
  opacity: 1;
}

@media (hover: none) {
  .lx-banner-edit {
    visibility: visible;
    opacity: 1;
  }
}

/* ── Settings drawer v2 — Discord-profile layout ─────────────────────── */

.lx-setting-avatar-container {
  width: 100px;
  height: 100px;
  flex: none;
}

.lx-setting-avatar-wrapper {
  position: relative;
  width: 100px;
  height: 100px;
  border-radius: 50%;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: var(--lumiverse-text-dim);
  background: var(--lumiverse-fill-subtle);
  cursor: context-menu;
}

.lx-setting-avatar-wrapper::before {
  content: "";
  position: absolute;
  width: 115px;
  height: 115px;
  border-radius: 50%;
  background: var(--lumiverse-bg-deep);
  z-index: 1;
}

.lx-setting-avatar-img {
  position: relative;
  width: 100%;
  height: 100%;
  object-fit: cover;
  border-radius: 50%;
  z-index: 2;
}

.lx-setting-avatar-decor {
  position: absolute;
  min-width: 115px; /* Without min-width, decoration appears as an oval. */
  height: 115px;
  z-index: 3;
}

/* ── Settings drawer — Quick toggles ─────────────────────── */

.lx-toggle-cards {
  position: absolute;
  top: 6px;
  left: 6px;
  display: inline-flex;
  align-items: center;
  flex-wrap: wrap;
  flex-direction: row;
  gap: 3px;
}

.lx-toggle-card {
  display: inline-flex;
  align-items: center;
  padding: 2px 2px;
  background: color-mix(in srgb, var(--lumiverse-bg-deep) 66%, transparent);
  color: color-mix(in srgb, var(--lumiverse-primary) 78%, var(--lumiverse-text));
  border-radius: 999px;
  border: 1px solid color-mix(in srgb, var(--lumiverse-primary) 28%, transparent);
  font-size: calc(9px * var(--lumiverse-font-scale, 1));
  font-weight: 700;
  letter-spacing: .08em;
  text-transform: uppercase;
  transition: background 150ms ease, border-color 150ms ease;
}

.lx-toggle-card-btn {
  min-width: 24px;
  height: 16px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0px 5px;
  border-radius: inherit;
  font-size: calc(8.5px * var(--lumiverse-font-scale, 1));
  font-weight: 700;
  letter-spacing: .08em;
  text-transform: uppercase;
  transition: background 150ms ease, border-color 150ms ease;
}

.lx-toggle-card-btn:hover {
  background: var(--lumiverse-fill-hover);
}

.lx-toggle-card:focus-visible {
  outline: 1px solid var(--lumiverse-border-hover);
  outline-offset: 1px;
}

.lx-toggle-placement-controls {
  border-radius: inherit;
}

.lx-toggle-placement-active,
.lx-toggle-placement-active:hover {
  color: var(--lumiverse-primary-contrast);
  background: var(--lumiverse-accent, var(--lumiverse-primary));
}

.lx-toggle-on,
.lx-toggle-on:hover {
  color: var(--lumiverse-primary-contrast);
  background: var(--lumiverse-accent, var(--lumiverse-primary));
}

/* Body: vault statistics and customization groups. */
.lx-setting-body {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.lx-setting-vault .lx-container {
  display: flex;
  flex-direction: column;
  gap: 4px;
  border: 1px solid var(--lumiverse-border);
  border-radius: 12px;
  background: var(--lumiverse-fill-subtle);
  padding: 8px;
}

.lx-vaultname-editable {
  display: flex;
}

.lx-vaultname-styles {
  display: inline-flex;
  flex-direction: column;
  padding: 8px 0;
}

.lx-vaultname-label {
  position: relative;
  display: block;
  font-size: calc(11px * var(--lumiverse-font-scale, 1));
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--lumiverse-text-dim);
}

/* The rename pencil is hover-reveal chrome (same rule as the banner edit). */
.lx-vaultname-rowline {
  display: inline-flex;
  align-items: center;
  margin-inline-start: 8px;
  gap: 4px;
  min-width: 0;
}

.lx-vaultnamerow {
  display: inline-flex;
  min-width: 0;
}

.lx-vaultname-accessory {
  display: inline-flex;
  align-items: center;
  flex: none;
  visibility: hidden;
  opacity: 0;
  pointer-events: auto;
  /* Instant visibility flip: the fade rides opacity; transitioning the
     discrete visibility property makes computed-style reads race. */
  transition: opacity 140ms ease;
}

.lx-vaultname-fadein:hover .lx-vaultname-accessory,
.lx-vaultname-editable.lx-editing .lx-vaultname-accessory,
.lx-vaultname-accessory:focus-within {
  visibility: visible;
  opacity: 1;
}

.lx-vaultname-content {
  min-width: 0;
  flex: 1;
}

.lx-vaultname-current {
  display: inline-block;
  color: var(--lumiverse-text);
  font-size: calc(22px * var(--lumiverse-font-scale, 1));
  font-weight: 700;
  letter-spacing: .04em;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.lx-vaultname-input {
  width: 100%;
  outline-offset: 0;
  outline: 0;
  padding-block: 0;
  padding-inline: 0;
  font-size: calc(22px * var(--lumiverse-font-scale, 1));
  font-weight: 700;
  letter-spacing: .04em;
  background: var(--lumiverse-fill);
  border: 0;
  border-radius: 8px;
  color: var(--lumiverse-text);
  display: none;
  pointer-events: auto;
}

.lx-vaultname-editable.lx-editing .lx-vaultname-current {
  display: none;
}

.lx-vaultname-editable.lx-editing .lx-vaultname-input {
  display: block;
}

.lx-vaultstats {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(90px, 1fr));
  gap: 4px;
}

.lx-vaultstat {
  display: inline-flex;
  padding: 4px 0;
  background: var(--lumiverse-fill-subtle);
  border-radius: var(--lumiverse-radius);
  justify-content: center;
  align-items: center;
  flex-direction: column;
}

.lx-vaultstat-label {
  font-size: calc(9px * var(--lumiverse-font-scale, 1));
  font-weight: 500;
  letter-spacing: 0.06em;
  color: var(--lumiverse-text-dim);
}

.lx-vaultstat-value {
  font-size: calc(11px * var(--lumiverse-font-scale, 1));
  font-weight: 500;
}

.lx-setting-widget-customization {
  display: flex;
  flex-direction: column;
  gap: 9px;
  padding-top: 8px;
}

.lx-setting-tile-row {
  display: flex;
  align-items: center;
  gap: 14px;
}

.lx-setting-tile {
  display: flex;
  flex-direction: column;
}

.lx-setting-tilebutton {
  width: 88px;
  height: 88px;
  padding: 0;
  border-radius: 50%;
  border: 1px solid var(--lumiverse-border);
  background: var(--lumiverse-fill-subtle);
  overflow: hidden;
  cursor: pointer;
}

.lx-setting-tilebutton:hover {
  border-color: var(--lumiverse-border-hover);
}

.lx-setting-tile-content,
.lx-setting-tile-wrapper {
  width: 100%;
  height: 100%;
}

.lx-setting-tile-wrapper {
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--lumiverse-text-dim);
  overflow: hidden;
}

.lx-setting-tile-img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

/* Widget previews mirror the widget-radius slider after moving into the
   host-rendered .lx-setting-section-widget card. */
.lx-setting-widget-customization .lx-setting-tilebutton,
.lx-setting-widget-customization .lx-setting-tile-content,
.lx-setting-widget-customization .lx-setting-tile-wrapper,
.lx-setting-widget-customization .lx-setting-tile-img {
  border-radius: var(--lx-setting-preview-radius, 50%);
}

/* Compact tile controls remain independently targetable through their
   context hooks after moving into .lx-card-vault / .lx-setting-section-widget. */
.lx-card-vault .lx-setting-tile-controls-avatar,
.lx-setting-section-widget .lx-setting-tile-controls-widget {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}

.lx-setting-slider-track {
  height: 6px;
  border-radius: 3px;
}

.lx-setting-slider-fill {
  background: var(--lumiverse-primary);
}

.lx-setting-slider-thumb {
  width: 14px;
  height: 14px;
}

/* Scroll area: the collapsible settings cards. */
.lx-setting-scroll {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.lx-card {
  background: var(--lumiverse-fill-subtle);
  border: 1px solid var(--lumiverse-border);
  border-radius: var(--lumiverse-radius-md);
  overflow: hidden;
  transition: border-color var(--lumiverse-transition-fast);
}

.lx-card:hover {
  border-color: var(--lumiverse-border-hover);
}

.lx-card-host {
  display: contents;
}

.lx-setting-section-header {
  padding: 10px 12px;
}

.lx-setting-section-body {
  display: flex;
  flex-direction: column;
  padding: 0 12px;
  gap: 6px;
}

/* ── Image picker popup ("Select an Image") ──────────────────────────── */
.lx-popup-root,
.lx-lm-body-inner,
.lx-lm-content {
  display: flex;
  flex-direction: column;
}

.lx-lm-content {
  gap: 14px;
}

.lx-lm-select {
  display: flex;
  gap: 14px;
  align-items: stretch;
}

.lx-lm-current {
  width: 116px;
  height: 116px;
  flex: none;
  border-radius: 12px;
  border: 1px solid var(--lumiverse-border);
  background: var(--lumiverse-fill-subtle);
  overflow: hidden;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--lumiverse-text-dim);
}

.lx-lm-current-img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.lx-lm-current-wide {
  width: 204px;
  height: 72px;
  align-self: center;
  border-radius: var(--lumiverse-radius-md);
}

.lx-lm-select-side {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.lx-lm-select-title {
  font-size: calc(14.5px * var(--lumiverse-font-scale, 1));
  font-weight: 700;
}

.lx-lm-select-desc {
  font-size: calc(12px * var(--lumiverse-font-scale, 1));
  color: var(--lumiverse-text-dim);
}

.lx-lm-select-actions {
  display: flex;
  gap: 8px;
  margin-top: auto;
  padding-top: 8px;
}

.lx-lm-error {
  font-size: calc(11.5px * var(--lumiverse-font-scale, 1));
  color: var(--lumiverse-error);
}

/* Crop stage (avatar slots) — vanilla mirror of the host's avatar resizer:
   circle spotlight mask + cover-scaled, pannable preview + zoom slider.
   Extensions: darkened outside-window mask + rule-of-thirds grid for rect
   crops, a rotate/flip/reset toolbar, and a height-capped square stage so
   the picker modal never scrolls. */
.lx-crop {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.lx-crop-stage {
  position: relative;
  width: min(100%, 320px);
  margin: 0 auto;
  aspect-ratio: 1;
  overflow: hidden;
  border-radius: 12px;
  background: var(--lumiverse-bg-tertiary, var(--lumiverse-bg));
  cursor: grab;
  touch-action: none;
  user-select: none;
}

/* Wide stages (banner) are taller than the crop window so the darkened
   "outside the window" area is visible above/below the 17:6 crop. */
.lx-crop-stage.lx-crop-stage-wide {
  width: 100%;
  margin: 0;
  aspect-ratio: 16 / 9;
}

.lx-crop-stage.lx-crop-dragging {
  cursor: grabbing;
}

.lx-crop-media {
  position: absolute;
  max-width: none;
  pointer-events: none;
  user-select: none;
}

/* The crop window (mask) is centered and sized in JS to stay CONTAINED within
   the contain-fitted media */
.lx-crop-mask {
  position: absolute;
  left: 50%;
  top: 50%;
  transform: translate(-50%, -50%);
  pointer-events: none;
  border: 5px solid #fff;
  box-shadow: 0 0 0 9999px rgba(0, 0, 0, 0.55);
}

.lx-crop-mask-round {
  border-radius: 50%;
}

/* Rule-of-thirds gridlines, rect crops only (the round avatar mask stays a
   clean circle). */
.lx-crop-mask-rect::before,
.lx-crop-mask-rect::after {
  content: '';
  position: absolute;
  inset: 0;
  pointer-events: none;
}

.lx-crop-mask-rect::before {
  background: linear-gradient(
    to right,
    transparent 33.2%, rgba(255, 255, 255, 0.35) 33.2%, rgba(255, 255, 255, 0.35) 33.8%,
    transparent 33.8%, transparent 66.2%,
    rgba(255, 255, 255, 0.35) 66.2%, rgba(255, 255, 255, 0.35) 66.8%, transparent 66.8%
  );
}

.lx-crop-mask-rect::after {
  background: linear-gradient(
    to bottom,
    transparent 33.2%, rgba(255, 255, 255, 0.35) 33.2%, rgba(255, 255, 255, 0.35) 33.8%,
    transparent 33.8%, transparent 66.2%,
    rgba(255, 255, 255, 0.35) 66.2%, rgba(255, 255, 255, 0.35) 66.8%, transparent 66.8%
  );
}

.lx-crop-toolbar {
  display: flex;
  align-items: center;
  gap: 2px;
}

.lx-crop-tool {
  width: 28px;
  height: 28px;
}

.lx-crop-reset {
  margin-left: auto;
  padding: 4px 10px;
  border: none;
  border-radius: var(--lumiverse-radius, 8px);
  background: transparent;
  color: var(--lumiverse-text-muted);
  font-size: calc(12px * var(--lumiverse-font-scale, 1));
  font-weight: 600;
  cursor: pointer;
  transition: background var(--lumiverse-transition-fast, 120ms) ease, color var(--lumiverse-transition-fast, 120ms) ease;
}

.lx-crop-reset:hover {
  background: var(--lumiverse-fill-subtle);
  color: var(--lumiverse-text);
}

.lx-crop-zoom-label {
  display: flex;
  align-items: center;
  gap: 10px;
  flex: 1;
  color: var(--lumiverse-text-muted);
}

.lx-crop-zoom {
  flex: 1;
  accent-color: var(--lumiverse-accent);
}

.lx-crop-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}

.lx-lm-recents-header h2 {
  margin: 0;
  font-size: calc(12px * var(--lumiverse-font-scale, 1));
  font-weight: 700;
}

.lx-lm-recents-header p {
  margin: 2px 0 8px;
  font-size: calc(11.5px * var(--lumiverse-font-scale, 1));
  color: var(--lumiverse-text-dim);
}

.lx-lm-slots {
  display: grid;
  grid-template-columns: repeat(6, 1fr);
  gap: 8px;
}

/* The wrap is only a positioning context for the trash overlay — the button
   itself carries the square aspect-ratio so the wrap's height is always
   definite (a percentage-height button inside an aspect-ratio wrapper can
   collapse to zero when no placeholder slot establishes the row height). */
.lx-lm-slot-wrap {
  position: relative;
}

.lx-lm-slot-btn {
  width: 100%;
  aspect-ratio: 1;
  padding: 0;
  border: 1px solid var(--lumiverse-border);
  border-radius: 10px;
  overflow: hidden;
  background: transparent;
  cursor: pointer;
}

/* Per-recent trash affordance (Discord-style, hover-revealed). */
.lx-lm-slot-trash {
  position: absolute;
  top: 2px;
  right: 2px;
  z-index: 2;
  width: 22px;
  height: 22px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: none;
  border-radius: var(--lumiverse-radius-sm);
  background: var(--lumiverse-fill-subtle);
  color: var(--lumiverse-text-muted);
  cursor: pointer;
  pointer-events: auto;
  opacity: 0;
  transition: opacity 120ms ease, color 120ms ease;
}

.lx-lm-slot-wrap:hover .lx-lm-slot-trash,
.lx-lm-slot-trash:focus-visible {
  opacity: 1;
}

.lx-lm-slot-trash:hover {
  color: var(--lumiverse-error);
}

.lx-lm-slot-btn:hover:not(:disabled) {
  border-color: color-mix(in srgb, var(--lumiverse-accent, var(--lumiverse-primary)) 60%, transparent);
}

.lx-lm-slot-btn:disabled {
  cursor: default;
}

.lx-lm-slot {
  display: block;
  width: 100%;
  height: 100%;
}

.lx-lm-slot img,
.lx-lm-slot video,
.lx-lm-slot-media {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.lx-lm-slot-empty {
  background:
    repeating-linear-gradient(45deg, transparent 0 6px,
      color-mix(in srgb, var(--lumiverse-border) 55%, transparent) 6px 7px),
    var(--lumiverse-fill-subtle);
}

.lx-popup-root.lx-lm-busy {
  opacity: 0.55;
  pointer-events: none;
}

/* Every image/video Luminote renders is presentational — the interactive
   surface is always the PARENT button/container (tile, slot button, pfp
   button, widget button, banner container), exactly like Discord's avatar
   decoration layer (aria-hidden visuals). Keeping the media itself out of
   the hit-test chain also stops composited <video> layers from swallowing
   clicks in minimal embedders. */
.lx-banner-media,
.lx-lm-current-img,
.lx-lm-slot-media,
.lx-setting-avatar-decor,
.lx-setting-avatar-img,
.lx-setting-tile-img,
.lx-vault-bar-nameplate-media,
.lx-vault-pfp-decor,
.lx-vault-pfp-img,
.lx-widget-icon,
.lx-widget-icon-decor {
  pointer-events: none;
}
`

export const ISLAND_BASE_CSS = `
  :host {
    display: flow-root;
    position: relative;
    max-width: 100%;
    font-size: calc(14px * var(--lumiverse-font-scale, 1));
    line-height: 1.65;
    color: var(--lumiverse-text);
    word-wrap: break-word;
    overflow-wrap: break-word;
    /* Luminote addition (not in upstream's base sheet): the live editor wraps
       islands in CodeMirror's .cm-content — monospace, white-space:
       break-spaces, word-break: break-word. Those are inherited, so without
       these pins live islands inherit all three and render differently from
       reading mode and chat. */
    white-space: normal;
    word-break: normal;
    font-family: var(--lumiverse-font-family, -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif);
  }

  *,
  *::before,
  *::after {
    box-sizing: border-box;
  }

  q {
    quotes: none;
  }

  q::before,
  q::after {
    content: none;
  }

  p {
    margin: 0 0 0.5em;
  }

  p:last-child {
    margin-bottom: 0;
  }

  em,
  .lx-prose-italic {
    color: var(--lumiverse-prose-italic);
    font-style: italic;
  }

  strong,
  .lx-prose-bold {
    font-weight: 600;
    color: var(--lumiverse-prose-bold);
  }

  .lx-prose-inline-emphasis {
    font-weight: 600;
    color: var(--lumiverse-prose-bold);
  }

  .lx-prose-dialogue {
    color: var(--lumiverse-prose-dialogue);
  }

  span[style*="color"] .lx-prose-dialogue,
  span[style*="color"] em,
  span[style*="color"] .lx-prose-italic,
  span[style*="color"] strong,
  span[style*="color"] .lx-prose-bold,
  span[style*="color"] .lx-prose-inline-emphasis,
  font .lx-prose-dialogue,
  font em,
  font .lx-prose-italic,
  font strong,
  font .lx-prose-bold,
  font .lx-prose-inline-emphasis {
    color: inherit;
  }

  .lx-prose-dialogue em,
  .lx-prose-dialogue .lx-prose-italic,
  .lx-prose-dialogue strong,
  .lx-prose-dialogue .lx-prose-bold,
  .lx-prose-dialogue .lx-prose-inline-emphasis {
    color: inherit;
  }

  code {
    padding: 2px 6px;
    border-radius: 4px;
    background: var(--lumiverse-fill-subtle);
    border: 1px solid var(--lcs-glass-border);
    font-family: "SF Mono", "Fira Code", "JetBrains Mono", "Menlo", "Consolas", monospace;
    font-size: 0.88em;
    color: var(--lumiverse-primary-text);
  }

  .lx-code-block {
    position: relative;
    margin: 10px 0;
    border-radius: 10px;
    overflow: hidden;
    background: var(--lumiverse-fill-strong);
    border: 1px solid var(--lumiverse-border);
  }

  .lx-code-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 6px 14px;
    background: var(--lumiverse-fill-subtle);
    border-bottom: 1px solid var(--lumiverse-border);
  }

  .lx-code-lang {
    font-family: "SF Mono", "Fira Code", "JetBrains Mono", "Menlo", "Consolas", monospace;
    font-size: 0.72em;
    font-weight: 500;
    color: var(--lumiverse-text-dim);
    text-transform: uppercase;
    letter-spacing: 0.05em;
    user-select: none;
  }

  .lx-code-copy {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    padding: 3px 8px;
    border-radius: 6px;
    border: none;
    background: transparent;
    color: var(--lumiverse-text-dim);
    font-family: inherit;
    font-size: 0.72em;
    cursor: pointer;
    opacity: 0;
    transition: opacity 150ms ease, color 150ms ease, background 150ms ease;
  }

  .lx-code-block:hover .lx-code-copy {
    opacity: 1;
  }

  .lx-code-copy:hover {
    color: var(--lumiverse-text);
    background: var(--lumiverse-fill-subtle);
  }

  .lx-code-copied {
    opacity: 1 !important;
    color: var(--lumiverse-success) !important;
  }

  .lx-code-block pre {
    margin: 0;
    padding: 14px;
    overflow-x: auto;
    white-space: pre;
  }

  .lx-code-block pre code {
    font-family: "SF Mono", "Fira Code", "JetBrains Mono", "Menlo", "Consolas", monospace;
    font-size: 0.85em;
    line-height: 1.6;
    color: var(--lumiverse-text);
    background: none;
    padding: 0;
    border: none;
    border-radius: 0;
    tab-size: 2;
  }

  pre {
    padding: 14px;
    border-radius: 10px;
    background: var(--lumiverse-fill-strong);
    border: 1px solid var(--lumiverse-border);
    overflow-x: auto;
    margin: 10px 0;
    white-space: pre-wrap;
    word-wrap: break-word;
  }

  pre code {
    padding: 0;
    background: none;
    border: none;
    font-size: 0.85em;
    line-height: 1.6;
    color: var(--lumiverse-text);
    white-space: pre-wrap;
  }

  blockquote {
    border-left: 2px solid var(--lumiverse-primary-020);
    padding-left: 12px;
    margin: 8px 0;
    background: var(--lumiverse-primary-010);
    border-radius: 0 var(--lcs-radius-xs) var(--lcs-radius-xs) 0;
    padding: 6px 12px;
    color: var(--lumiverse-prose-blockquote);
    font-style: italic;
  }

  h1 { font-size: 1.35em; font-weight: 600; margin: 0.7em 0 0.35em; }
  h2 { font-size: 1.2em; font-weight: 600; margin: 0.7em 0 0.35em; }
  h3 { font-size: 1.1em; font-weight: 600; margin: 0.7em 0 0.35em; }
  h4 { font-size: 1em; font-weight: 600; margin: 0.7em 0 0.35em; }
  h5 { font-size: 0.95em; font-weight: 600; margin: 0.7em 0 0.35em; }
  h6 { font-size: 0.9em; font-weight: 600; margin: 0.7em 0 0.35em; }

  hr {
    border: none;
    border-top: 1px solid var(--lumiverse-border);
    margin: 12px 0;
  }

  ul,
  ol {
    padding-left: 1.4em;
    margin: 4px 0;
    list-style-position: outside;
  }

  li {
    margin: 2px 0;
  }

  ul li {
    list-style: disc;
  }

  ol li {
    list-style: decimal;
  }

  a,
  .lx-prose-link {
    color: var(--lumiverse-prose-link, var(--lumiverse-primary-text));
    text-decoration: none;
    transition: color var(--lumiverse-transition-fast), text-decoration var(--lumiverse-transition-fast);
  }

  a:hover,
  .lx-prose-link:hover {
    text-decoration: underline;
    filter: brightness(1.15);
  }

  .lx-prose-image-wrap {
    display: inline-block;
    margin: 8px 0;
    max-width: var(--prose-image-max-width, 240px);
    max-height: var(--prose-image-max-height, 240px);
    overflow: hidden;
    border-radius: var(--lcs-radius-sm);
    var(--lumiverse-primary)
    background: var(--lumiverse-fill-subtle, rgba(255, 255, 255, 0.04));
    cursor: pointer;
    transition: border-color var(--lumiverse-transition-fast), box-shadow var(--lumiverse-transition-fast), transform var(--lumiverse-transition-fast);
  }

  .lx-prose-image-wrap:hover {
    border-color: var(--lumiverse-primary-040, rgba(140, 130, 255, 0.4));
    box-shadow: 0 4px 20px rgba(0, 0, 0, 0.35);
    transform: scale(1.02);
  }

  .lx-prose-image,
  img {
    display: block;
    max-width: 100%;
    max-height: var(--prose-image-max-height, 240px);
    object-fit: contain;
    border-radius: var(--lcs-radius-sm);
    cursor: pointer;
  }

  .lx-prose-table,
  table {
    width: 100%;
    border-collapse: collapse;
    margin: 8px 0;
    border: 1px solid var(--lumiverse-border);
    border-radius: var(--lcs-radius-xs);
    overflow: hidden;
  }

  .lx-prose-table-head,
  th {
    font-weight: 600;
    background: var(--lumiverse-primary-010);
    border: 1px solid var(--lumiverse-border);
    padding: 8px 12px;
    text-align: left;
    font-size: calc(13px * var(--lumiverse-font-scale, 1));
  }

  .lx-prose-table-cell,
  td {
    padding: 8px 12px;
    border: 1px solid var(--lumiverse-border);
    font-size: calc(13px * var(--lumiverse-font-scale, 1));
  }

  .lx-prose-table-row:nth-child(even) td,
  tr:nth-child(even) td {
    background: var(--lumiverse-bg-dark);
  }

  video,
  audio {
    max-width: 100%;
    border-radius: var(--lcs-radius-sm);
    margin: 8px 0;
  }

  iframe {
    max-width: 100%;
    max-height: 400px;
    border-radius: var(--lcs-radius-sm);
    border: 1px solid var(--lumiverse-border);
    margin: 8px 0;
  }

  .spindle-message-tag-pending {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    margin: 8px 0;
    padding: 7px 10px;
    border: 1px solid color-mix(in srgb, var(--lumiverse-primary) 22%, var(--lumiverse-border));
    border-radius: 999px;
    background: color-mix(in srgb, var(--lumiverse-primary) 8%, transparent);
    color: var(--lumiverse-text-muted);
    font-size: calc(12px * var(--lumiverse-font-scale, 1));
    line-height: 1.2;
    letter-spacing: 0.01em;
  }

  .spindle-message-tag-pending-dot {
    width: 7px;
    height: 7px;
    border-radius: 999px;
    background: var(--lumiverse-primary);
    box-shadow: 0 0 0 0 color-mix(in srgb, var(--lumiverse-primary, #8c82ff) 45%, transparent);
    animation: spindle-message-tag-pending-pulse 1.25s ease-in-out infinite;
  }

  @keyframes spindle-message-tag-pending-pulse {
    0%,
    100% {
      opacity: 0.45;
      transform: scale(0.9);
      box-shadow: 0 0 0 0 color-mix(in srgb, var(--lumiverse-primary, #8c82ff) 30%, transparent);
    }

    50% {
      opacity: 1;
      transform: scale(1);
      box-shadow: 0 0 0 5px transparent;
    }
  }
`

// ── Syntax colors (theme-driven via Lumiverse CSS vars) ─────────────────

export const lumiverseHighlight = HighlightStyle.define([
  { tag: tags.heading, color: 'var(--lumiverse-text)', fontWeight: '700' },
  { tag: tags.emphasis, color: 'var(--lumiverse-prose-italic)', fontStyle: 'italic' },
  { tag: tags.strong, color: 'var(--lumiverse-prose-bold)', fontWeight: '600' },
  { tag: tags.strikethrough, textDecoration: 'line-through', color: 'var(--lumiverse-text)' },
  { tag: tags.monospace, color: 'var(--lumiverse-primary-text)' },
  { tag: [tags.link, tags.url], color: 'var(--lumiverse-accent, var(--lumiverse-primary))', textDecoration: 'underline 1px color-mix(in srgb, var(--lumiverse-accent, var(--lumiverse-primary)) 50%, transparent)' },
  { tag: tags.quote, color: 'var(--lumiverse-text-muted)' },
  { tag: [tags.comment, tags.meta, tags.processingInstruction], color: 'var(--lumiverse-text-dim)' },
  { tag: [tags.tagName, tags.keyword], color: 'var(--lumiverse-accent, var(--lumiverse-primary))' },
  { tag: tags.attributeName, color: 'var(--lumiverse-prose-bold)' },
  { tag: [tags.attributeValue, tags.string], color: 'var(--lumiverse-prose-dialogue)' },
  { tag: [tags.number, tags.bool, tags.atom], color: 'var(--lumiverse-primary-text)' },
  { tag: tags.propertyName, color: 'var(--lumiverse-prose-italic)' },
])

export const editorTheme = EditorView.theme({
  '&': {
    height: '100%',
    fontSize: 'var(--lx-editor-font-size, 14px)',
    backgroundColor: 'transparent',
    color: 'var(--lumiverse-text)',
  },
  '.cm-content': {
    padding: '10px 14px 30vh',
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace',
    lineHeight: '1.65',
  },
  '&.cm-focused': { outline: 'none' },
  '.cm-scroller': {
	scrollbarWidth: 'none',
    fontFamily: 'inherit',
    overflow: 'auto',
  },
  '.cm-gutters': {
    backgroundColor: 'transparent',
    border: 'none',
    color: 'var(--lumiverse-text-dim)',
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
  },
  '.cm-activeLine': {
    backgroundColor: 'var(--lumiverse-fill-subtle)',
  },
  '.cm-activeLineGutter': {
    backgroundColor: 'transparent',
    color: 'var(--lumiverse-text-muted)',
  },
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground': {
    backgroundColor: 'color-mix(in srgb, var(--lumiverse-accent, var(--lumiverse-primary)) 26%, transparent)',
  },
  '.cm-selectionMatch': {
    backgroundColor: 'color-mix(in srgb, var(--lumiverse-accent, var(--lumiverse-primary)) 18%, transparent)',
  },
  '.cm-searchMatch': {
    backgroundColor: 'color-mix(in srgb, #e5b567 35%, transparent)',
    outline: '1px solid color-mix(in srgb, #e5b567 55%, transparent)',
  },
  '.cm-searchMatch-selected': {
    backgroundColor: 'color-mix(in srgb, #e5b567 55%, transparent)',
  },
  '.cm-panels': {
    backgroundColor: 'var(--lumiverse-fill)',
    color: 'var(--lumiverse-text)',
    borderBottom: '1px solid var(--lumiverse-border)',
  },
  '.cm-panels input, .cm-panels button': {
    backgroundColor: 'var(--lumiverse-fill-subtle)',
    color: 'var(--lumiverse-text)',
    border: '1px solid var(--lumiverse-border)',
    borderRadius: '6px',
  },
  '.cm-tooltip': {
    backgroundColor: 'var(--lumiverse-fill)',
    color: 'var(--lumiverse-text)',
    border: '1px solid var(--lumiverse-border)',
  },
  '.cm-cursor': {
    borderLeftColor: 'var(--lumiverse-text)',
  },
  '.cm-dropCursor': {
    borderLeftColor: 'var(--lumiverse-text)',
  },
  // ── Previously-unthemed base elements (CodeMirror defaults) ──────────
  // These shipped with hardcoded light/dark colors; now keyed to Lumiverse
  // tokens so the editor stays coherent with the host theme.
  '.cm-placeholder': {
    color: 'var(--lumiverse-text-dim)',
  },
  '.cm-specialChar': {
    color: 'var(--lumiverse-text-dim)',
  },
  '.cm-matchingBracket': {
    backgroundColor: 'color-mix(in srgb, var(--lumiverse-accent, var(--lumiverse-primary)) 28%, transparent)',
  },
  '.cm-nonmatchingBracket': {
    backgroundColor: 'color-mix(in srgb, var(--lumiverse-error) 32%, transparent)',
  },
  '.cm-button': {
    backgroundImage: 'none',
    backgroundColor: 'var(--lumiverse-fill-subtle)',
    color: 'var(--lumiverse-text)',
    border: '1px solid var(--lumiverse-border)',
    borderRadius: '6px',
  },
  '.cm-button:active': {
    backgroundImage: 'none',
    backgroundColor: 'var(--lumiverse-fill)',
  },
  '.cm-textfield': {
    backgroundColor: 'var(--lumiverse-fill-subtle)',
    color: 'var(--lumiverse-text)',
    border: '1px solid var(--lumiverse-border)',
  },
})
