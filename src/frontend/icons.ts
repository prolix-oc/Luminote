/**
 * icons Luminote actually uses — Lucide SVG path data vendored in
 * icondata.ts (no emojis are used for iconography anywhere in the
 * extension). Plus two hand-drawn shapes Lucide lacks.
 */
import { LUCIDE_NODES, createElement, type IconNode } from './icondata'

export const iconNodes = {
  ...LUCIDE_NODES,
  cornerGrip: [
    ['polyline', { points: '22 12 22 22 12 22' }],
  ] as unknown as IconNode,
  restoreDown: [
    ['rect', { width: '14', height: '14', x: '8', y: '8', rx: '2', ry: '2' }],
    ['path', { d: 'M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2' }],
  ] as unknown as IconNode,
} as const

export type IconName = keyof typeof iconNodes

const SIZE_ATTRS = {
  width: '24',
  height: '24',
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  'stroke-width': '2',
  'stroke-linecap': 'round',
  'stroke-linejoin': 'round',
} as const

export function iconSvg(name: IconNode, size = 16): SVGElement {
  const svg = createElement(name, SIZE_ATTRS)
  svg.setAttribute('width', String(size))
  svg.setAttribute('height', String(size))
  svg.setAttribute('aria-hidden', 'true')
  svg.classList.add('lx-icon')
  return svg
}

export function icon(name: IconName, size = 16): SVGElement {
  return iconSvg(iconNodes[name], size)
}
