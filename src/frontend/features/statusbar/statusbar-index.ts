/**
 * Status-bar feature — the bottommost strip of the overlay.
 *
 * Left: save indicator (saved / unsaved changes / saving…).
 * Right: active note details (words, characters, lines, estimated tokens)
 * and when the note was last edited.
 */
import { el, createDisposer } from '../../dom'
import { icon } from '../../icons'
import type { Store } from '../../state'

export interface StatusbarFeature {
  destroy(): void
}

function formatCount(value: number): string {
  return value.toLocaleString()
}

function formatRelative(timestamp: number): string {
  const delta = Date.now() - timestamp
  if (delta < 45_000) return 'just now'
  const minutes = Math.round(delta / 60_000)
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours} h ago`
  const days = Math.round(hours / 24)
  if (days < 7) return `${days} d ago`
  return new Date(timestamp).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

export function createStatusbarFeature(store: Store, root: HTMLElement): StatusbarFeature {
  const disposer = createDisposer()

  const saveIconHolder = el('span', { class: 'lx-status-save-icon' })
  const saveLabel = el('span', { class: 'lx-status-save-label', text: 'Saved' })
  const saveIndicator = el('div', { class: 'lx-status-save', attrs: { role: 'status' } }, saveIconHolder, saveLabel)

  // Each metric gets its own scoped span so the Settings → Status Bar
  // toggles (and the stylesheet) can address them individually.
  const statWords = el('span', { class: 'lx-status-stat lx-status-words' })
  const statChars = el('span', { class: 'lx-status-stat lx-status-chars' })
  const statLines = el('span', { class: 'lx-status-stat lx-status-lines' })
  const statTokens = el('span', { class: 'lx-status-stat lx-status-tokens' })
  const statsEl = el('span', { class: 'lx-status-stats' }, statWords, statChars, statLines, statTokens)
  const editedEl = el('span', { class: 'lx-status-edited' }, icon('clock', 12), el('span', { class: 'lx-status-edited-text', text: '' }))
  const rightGroup = el('div', { class: 'lx-status-right' }, statsEl, editedEl)

  root.append(saveIndicator, rightGroup)

  function syncSaveIndicator(): void {
    const state = store.get().saveState
    saveIndicator.classList.remove('lx-save-dirty', 'lx-save-saving', 'lx-save-saved', 'lx-save-error')
    saveIconHolder.replaceChildren()
    if (state === 'dirty') {
      saveIndicator.classList.add('lx-save-dirty')
      saveIconHolder.append(icon('pencil', 12.5))
      saveLabel.textContent = 'Unsaved changes'
    } else if (state === 'saving') {
      saveIndicator.classList.add('lx-save-saving')
      saveIconHolder.append(icon('loaderCircle', 12.5))
      saveLabel.textContent = 'Saving…'
    } else if (state === 'error') {
      saveIndicator.classList.add('lx-save-error')
      saveIconHolder.append(icon('triangleAlert', 12.5))
      saveLabel.textContent = 'Save failed — edit or Ctrl+S to retry'
    } else {
      saveIndicator.classList.add('lx-save-saved')
      saveIconHolder.append(icon('check', 12.5))
      saveLabel.textContent = 'Saved'
    }
  }

  function syncDetails(): void {
    const { activeStats, activeModifiedAt, activeEntryId, entries } = store.get()
    const cfg = store.get().settings.statusbar
    const entry = activeEntryId ? entries.find((e) => e.id === activeEntryId) : null

    saveIndicator.classList.toggle('lx-hidden', !cfg.showSaved)

    statWords.textContent = activeStats ? `${formatCount(activeStats.words)} words` : ''
    statChars.textContent = activeStats ? `${formatCount(activeStats.characters)} chars` : ''
    statLines.textContent = activeStats ? `${formatCount(activeStats.lines)} lines` : ''
    statTokens.textContent = activeStats ? `~${formatCount(activeStats.tokens)} tokens` : ''
    statWords.classList.toggle('lx-hidden', !cfg.words)
    statChars.classList.toggle('lx-hidden', !cfg.characters)
    statLines.classList.toggle('lx-hidden', !cfg.lines)
    statTokens.classList.toggle('lx-hidden', !cfg.tokens)

    if (!entry || !activeStats) {
      statsEl.title = ''
      statWords.textContent = 'No note open'
      statWords.classList.remove('lx-hidden')
      editedEl.classList.add('lx-hidden')
      return
    }

    statsEl.title = entry.name
    editedEl.classList.toggle('lx-hidden', !cfg.showEdited)

    const editedText = editedEl.querySelector('.lx-status-edited-text')
    const when = activeModifiedAt ?? entry.modifiedAt
    const label = `edited ${formatRelative(when)}`
    if (editedText) editedText.textContent = label
    editedEl.title = new Date(when).toLocaleString()
  }

  syncSaveIndicator()
  syncDetails()

  disposer.push(store.subscribeKey('saveState', syncSaveIndicator))
  disposer.push(store.subscribeKey('activeStats', syncDetails))
  disposer.push(store.subscribeKey('activeModifiedAt', syncDetails))
  disposer.push(store.subscribeKey('activeEntryId', syncDetails))
  disposer.push(store.subscribeKey('entries', syncDetails))
  disposer.push(store.subscribeKey('settings', syncDetails))

  // Relative timestamps age — refresh every 30s.
  const interval = setInterval(syncDetails, 30_000)
  disposer.push(() => clearInterval(interval))

  return {
    destroy() {
      disposer.dispose()
      root.replaceChildren()
    },
  }
}
