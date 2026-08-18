/**
 * Vendored Lucide icon data (MIT, lucide.dev) + a minimal createElement —
 * the ~50 icons Luminote uses, frozen at lucide 0.544.0. Replacing the full
 * `lucide` package dependency (27 MB of fonts/umd/cjs) with this table.
 */
export type IconNode = Array<[string, Record<string, string>]>

export function createElement(node: IconNode, attrs: Record<string, string> = {}): SVGElement {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg")
  for (const [k, v] of Object.entries(attrs)) svg.setAttribute(k, v)
  for (const [tag, tagAttrs] of node) {
    const child = document.createElementNS("http://www.w3.org/2000/svg", tag)
    for (const [k, v] of Object.entries(tagAttrs)) child.setAttribute(k, v)
    svg.appendChild(child)
  }
  return svg
}

export type LucideName =
  | 'arrowUpDown'
  | 'bookText'
  | 'braces'
  | 'chartColumn'
  | 'check'
  | 'chevronDown'
  | 'chevronRight'
  | 'chevronUp'
  | 'chevronsDownUp'
  | 'chevronsUpDown'
  | 'circleAlert'
  | 'clock'
  | 'code'
  | 'columns2'
  | 'ellipsis'
  | 'ellipsisVertical'
  | 'eye'
  | 'file'
  | 'fileCode'
  | 'fileImage'
  | 'filePlus'
  | 'filePlus2'
  | 'fileText'
  | 'files'
  | 'folder'
  | 'folderOpen'
  | 'folderPlus'
  | 'folderTree'
  | 'imagePlus'
  | 'info'
  | 'loaderCircle'
  | 'maximize'
  | 'maximize2'
  | 'minus'
  | 'notebookPen'
  | 'notebookText'
  | 'panelRightClose'
  | 'panelRightOpen'
  | 'pencil'
  | 'penLine'
  | 'plus'
  | 'triangleAlert'
  | 'rows2'
  | 'save'
  | 'search'
  | 'settings'
  | 'spellCheck'
  | 'squarePen'
  | 'trash'
  | 'type'
  | 'vault'
  | 'wrapText'
  | 'x'

export const LUCIDE_NODES: Record<LucideName, IconNode> = 
{
 'arrowUpDown': [
  [
   'path',
   {
    'd': 'm21 16-4 4-4-4'
   }
  ],
  [
   'path',
   {
    'd': 'M17 20V4'
   }
  ],
  [
   'path',
   {
    'd': 'm3 8 4-4 4 4'
   }
  ],
  [
   'path',
   {
    'd': 'M7 4v16'
   }
  ]
 ],
 'bookText': [
  [
   'path',
   {
    'd': 'M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H19a1 1 0 0 1 1 1v18a1 1 0 0 1-1 1H6.5a1 1 0 0 1 0-5H20'
   }
  ],
  [
   'path',
   {
    'd': 'M8 11h8'
   }
  ],
  [
   'path',
   {
    'd': 'M8 7h6'
   }
  ]
 ],
 'braces': [
  [
   'path',
   {
    'd': 'M8 3H7a2 2 0 0 0-2 2v5a2 2 0 0 1-2 2 2 2 0 0 1 2 2v5c0 1.1.9 2 2 2h1'
   }
  ],
  [
   'path',
   {
    'd': 'M16 21h1a2 2 0 0 0 2-2v-5c0-1.1.9-2 2-2a2 2 0 0 1-2-2V5a2 2 0 0 0-2-2h-1'
   }
  ]
 ],
 'chartColumn': [
  [
   'path',
   {
    'd': 'M3 3v16a2 2 0 0 0 2 2h16'
   }
  ],
  [
   'path',
   {
    'd': 'M18 17V9'
   }
  ],
  [
   'path',
   {
    'd': 'M13 17V5'
   }
  ],
  [
   'path',
   {
    'd': 'M8 17v-3'
   }
  ]
 ],
 'check': [
  [
   'path',
   {
    'd': 'M20 6 9 17l-5-5'
   }
  ]
 ],
 'chevronDown': [
  [
   'path',
   {
    'd': 'm6 9 6 6 6-6'
   }
  ]
 ],
 'chevronRight': [
  [
   'path',
   {
    'd': 'm9 18 6-6-6-6'
   }
  ]
 ],
 'chevronUp': [
  [
   'path',
   {
    'd': 'm18 15-6-6-6 6'
   }
  ]
 ],
 'chevronsDownUp': [
  [
   'path',
   {
    'd': 'm7 20 5-5 5 5'
   }
  ],
  [
   'path',
   {
    'd': 'm7 4 5 5 5-5'
   }
  ]
 ],
 'chevronsUpDown': [
  [
   'path',
   {
    'd': 'm7 15 5 5 5-5'
   }
  ],
  [
   'path',
   {
    'd': 'm7 9 5-5 5 5'
   }
  ]
 ],
 'circleAlert': [
  [
   'circle',
   {
    'cx': '12',
    'cy': '12',
    'r': '10'
   }
  ],
  [
   'line',
   {
    'x1': '12',
    'x2': '12',
    'y1': '8',
    'y2': '12'
   }
  ],
  [
   'line',
   {
    'x1': '12',
    'x2': '12.01',
    'y1': '16',
    'y2': '16'
   }
  ]
 ],
 'clock': [
  [
   'path',
   {
    'd': 'M12 6v6l4 2'
   }
  ],
  [
   'circle',
   {
    'cx': '12',
    'cy': '12',
    'r': '10'
   }
  ]
 ],
 'code': [
  [
   'path',
   {
    'd': 'm16 18 6-6-6-6'
   }
  ],
  [
   'path',
   {
    'd': 'm8 6-6 6 6 6'
   }
  ]
 ],
 'columns2': [
  [
   'rect',
   {
    'width': '18',
    'height': '18',
    'x': '3',
    'y': '3',
    'rx': '2'
   }
  ],
  [
   'path',
   {
    'd': 'M12 3v18'
   }
  ]
 ],
 'ellipsis': [
  [
   'circle',
   {
    'cx': '12',
    'cy': '12',
    'r': '1'
   }
  ],
  [
   'circle',
   {
    'cx': '19',
    'cy': '12',
    'r': '1'
   }
  ],
  [
   'circle',
   {
    'cx': '5',
    'cy': '12',
    'r': '1'
   }
  ]
 ],
 'ellipsisVertical': [
  [
   'circle',
   {
    'cx': '12',
    'cy': '12',
    'r': '1'
   }
  ],
  [
   'circle',
   {
    'cx': '12',
    'cy': '5',
    'r': '1'
   }
  ],
  [
   'circle',
   {
    'cx': '12',
    'cy': '19',
    'r': '1'
   }
  ]
 ],
 'eye': [
  [
   'path',
   {
    'd': 'M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0'
   }
  ],
  [
   'circle',
   {
    'cx': '12',
    'cy': '12',
    'r': '3'
   }
  ]
 ],
 'file': [
  [
   'path',
   {
    'd': 'M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z'
   }
  ],
  [
   'path',
   {
    'd': 'M14 2v4a2 2 0 0 0 2 2h4'
   }
  ]
 ],
 'fileCode': [
  [
   'path',
   {
    'd': 'M4 22h14a2 2 0 0 0 2-2V7l-5-5H6a2 2 0 0 0-2 2v4'
   }
  ],
  [
   'path',
   {
    'd': 'M14 2v4a2 2 0 0 0 2 2h4'
   }
  ],
  [
   'path',
   {
    'd': 'm5 12-3 3 3 3'
   }
  ],
  [
   'path',
   {
    'd': 'm9 18 3-3-3-3'
   }
  ]
 ],
 'fileImage': [
  [
   'path',
   {
    'd': 'M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z'
   }
  ],
  [
   'path',
   {
    'd': 'M14 2v4a2 2 0 0 0 2 2h4'
   }
  ],
  [
   'circle',
   {
    'cx': '10',
    'cy': '12',
    'r': '2'
   }
  ],
  [
   'path',
   {
    'd': 'm20 17-1.296-1.296a2.41 2.41 0 0 0-3.408 0L9 22'
   }
  ]
 ],
 'filePlus': [
  [
   'path',
   {
    'd': 'M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z'
   }
  ],
  [
   'path',
   {
    'd': 'M14 2v4a2 2 0 0 0 2 2h4'
   }
  ],
  [
   'path',
   {
    'd': 'M9 15h6'
   }
  ],
  [
   'path',
   {
    'd': 'M12 18v-6'
   }
  ]
 ],
 'filePlus2': [
  [
   'path',
   {
    'd': 'M4 22h14a2 2 0 0 0 2-2V7l-5-5H6a2 2 0 0 0-2 2v4'
   }
  ],
  [
   'path',
   {
    'd': 'M14 2v4a2 2 0 0 0 2 2h4'
   }
  ],
  [
   'path',
   {
    'd': 'M3 15h6'
   }
  ],
  [
   'path',
   {
    'd': 'M6 12v6'
   }
  ]
 ],
 'fileText': [
  [
   'path',
   {
    'd': 'M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z'
   }
  ],
  [
   'path',
   {
    'd': 'M14 2v4a2 2 0 0 0 2 2h4'
   }
  ],
  [
   'path',
   {
    'd': 'M10 9H8'
   }
  ],
  [
   'path',
   {
    'd': 'M16 13H8'
   }
  ],
  [
   'path',
   {
    'd': 'M16 17H8'
   }
  ]
 ],
 'files': [
  [
   'path',
   {
    'd': 'M15 2a2 2 0 0 1 1.414.586l4 4A2 2 0 0 1 21 8v7a2 2 0 0 1-2 2h-8a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2z'
   }
  ],
  [
   'path',
   {
    'd': 'M15 2v4a2 2 0 0 0 2 2h4'
   }
  ],
  [
   'path',
   {
    'd': 'M5 7a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2h8a2 2 0 0 0 1.732-1'
   }
  ]
 ],
 'folder': [
  [
   'path',
   {
    'd': 'M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z'
   }
  ]
 ],
 'folderOpen': [
  [
   'path',
   {
    'd': 'm6 14 1.5-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.54 6a2 2 0 0 1-1.95 1.5H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H18a2 2 0 0 1 2 2v2'
   }
  ]
 ],
 'folderPlus': [
  [
   'path',
   {
    'd': 'M12 10v6'
   }
  ],
  [
   'path',
   {
    'd': 'M9 13h6'
   }
  ],
  [
   'path',
   {
    'd': 'M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z'
   }
  ]
 ],
 'folderTree': [
  [
   'path',
   {
    'd': 'M20 10a1 1 0 0 0 1-1V6a1 1 0 0 0-1-1h-2.5a1 1 0 0 1-.8-.4l-.9-1.2A1 1 0 0 0 15 3h-2a1 1 0 0 0-1 1v5a1 1 0 0 0 1 1Z'
   }
  ],
  [
   'path',
   {
    'd': 'M20 21a1 1 0 0 0 1-1v-3a1 1 0 0 0-1-1h-2.9a1 1 0 0 1-.88-.55l-.42-.85a1 1 0 0 0-.92-.6H13a1 1 0 0 0-1 1v5a1 1 0 0 0 1 1Z'
   }
  ],
  [
   'path',
   {
    'd': 'M3 5a2 2 0 0 0 2 2h3'
   }
  ],
  [
   'path',
   {
    'd': 'M3 3v13a2 2 0 0 0 2 2h3'
   }
  ]
 ],
 'imagePlus': [
  [
   'path',
   {
    'd': 'M16 5h6'
   }
  ],
  [
   'path',
   {
    'd': 'M19 2v6'
   }
  ],
  [
   'path',
   {
    'd': 'M21 11.5V19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h7.5'
   }
  ],
  [
   'path',
   {
    'd': 'm21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21'
   }
  ],
  [
   'circle',
   {
    'cx': '9',
    'cy': '9',
    'r': '2'
   }
  ]
 ],
 'info': [
  [
   'circle',
   {
    'cx': '12',
    'cy': '12',
    'r': '10'
   }
  ],
  [
   'path',
   {
    'd': 'M12 16v-4'
   }
  ],
  [
   'path',
   {
    'd': 'M12 8h.01'
   }
  ]
 ],
 'loaderCircle': [
  [
   'path',
   {
    'd': 'M21 12a9 9 0 1 1-6.219-8.56'
   }
  ]
 ],
 'maximize': [
  [
   'path',
   {
    'd': 'M8 3H5a2 2 0 0 0-2 2v3'
   }
  ],
  [
   'path',
   {
    'd': 'M21 8V5a2 2 0 0 0-2-2h-3'
   }
  ],
  [
   'path',
   {
    'd': 'M3 16v3a2 2 0 0 0 2 2h3'
   }
  ],
  [
   'path',
   {
    'd': 'M16 21h3a2 2 0 0 0 2-2v-3'
   }
  ]
 ],
 'maximize2': [
  [
   'path',
   {
    'd': 'M15 3h6v6'
   }
  ],
  [
   'path',
   {
    'd': 'm21 3-7 7'
   }
  ],
  [
   'path',
   {
    'd': 'm3 21 7-7'
   }
  ],
  [
   'path',
   {
    'd': 'M9 21H3v-6'
   }
  ]
 ],
 'minus': [
  [
   'path',
   {
    'd': 'M5 12h14'
   }
  ]
 ],
 'notebookPen': [
  [
   'path',
   {
    'd': 'M13.4 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7.4'
   }
  ],
  [
   'path',
   {
    'd': 'M2 6h4'
   }
  ],
  [
   'path',
   {
    'd': 'M2 10h4'
   }
  ],
  [
   'path',
   {
    'd': 'M2 14h4'
   }
  ],
  [
   'path',
   {
    'd': 'M2 18h4'
   }
  ],
  [
   'path',
   {
    'd': 'M21.378 5.626a1 1 0 1 0-3.004-3.004l-5.01 5.012a2 2 0 0 0-.506.854l-.837 2.87a.5.5 0 0 0 .62.62l2.87-.837a2 2 0 0 0 .854-.506z'
   }
  ]
 ],
 'notebookText': [
  [
   'path',
   {
    'd': 'M2 6h4'
   }
  ],
  [
   'path',
   {
    'd': 'M2 10h4'
   }
  ],
  [
   'path',
   {
    'd': 'M2 14h4'
   }
  ],
  [
   'path',
   {
    'd': 'M2 18h4'
   }
  ],
  [
   'rect',
   {
    'width': '16',
    'height': '20',
    'x': '4',
    'y': '2',
    'rx': '2'
   }
  ],
  [
   'path',
   {
    'd': 'M9.5 8h5'
   }
  ],
  [
   'path',
   {
    'd': 'M9.5 12H16'
   }
  ],
  [
   'path',
   {
    'd': 'M9.5 16H14'
   }
  ]
 ],
 'pencil': [
  [
   'path',
   {
    'd': 'M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z'
   }
  ],
  [
   'path',
   {
    'd': 'm15 5 4 4'
   }
  ]
 ],
 'penLine': [
  [
   'path',
   {
    'd': 'M13 21h8'
   }
  ],
  [
   'path',
   {
    'd': 'M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z'
   }
  ]
 ],
 'plus': [
  [
   'path',
   {
    'd': 'M5 12h14'
   }
  ],
  [
   'path',
   {
    'd': 'M12 5v14'
   }
  ]
 ],
 'triangleAlert': [
  [
   'path',
   {
    'd': 'm21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3'
   }
  ],
  [
   'path',
   {
    'd': 'M12 9v4'
   }
  ],
  [
   'path',
   {
    'd': 'M12 17h.01'
   }
  ]
 ],
 'rows2': [
  [
   'rect',
   {
    'width': '18',
    'height': '18',
    'x': '3',
    'y': '3',
    'rx': '2'
   }
  ],
  [
   'path',
   {
    'd': 'M3 12h18'
   }
  ]
 ],
 'save': [
  [
   'path',
   {
    'd': 'M15.2 3a2 2 0 0 1 1.4.6l3.8 3.8a2 2 0 0 1 .6 1.4V19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z'
   }
  ],
  [
   'path',
   {
    'd': 'M17 21v-7a1 1 0 0 0-1-1H8a1 1 0 0 0-1 1v7'
   }
  ],
  [
   'path',
   {
    'd': 'M7 3v4a1 1 0 0 0 1 1h7'
   }
  ]
 ],
 'search': [
  [
   'path',
   {
    'd': 'm21 21-4.34-4.34'
   }
  ],
  [
   'circle',
   {
    'cx': '11',
    'cy': '11',
    'r': '8'
   }
  ]
 ],
 'settings': [
  [
   'path',
   {
    'd': 'M9.671 4.136a2.34 2.34 0 0 1 4.659 0 2.34 2.34 0 0 0 3.319 1.915 2.34 2.34 0 0 1 2.33 4.033 2.34 2.34 0 0 0 0 3.831 2.34 2.34 0 0 1-2.33 4.033 2.34 2.34 0 0 0-3.319 1.915 2.34 2.34 0 0 1-4.659 0 2.34 2.34 0 0 0-3.32-1.915 2.34 2.34 0 0 1-2.33-4.033 2.34 2.34 0 0 0 0-3.831A2.34 2.34 0 0 1 6.35 6.051a2.34 2.34 0 0 0 3.319-1.915'
   }
  ],
  [
   'circle',
   {
    'cx': '12',
    'cy': '12',
    'r': '3'
   }
  ]
 ],
 'spellCheck': [
  [
   'path',
   {
    'd': 'm6 16 6-12 6 12'
   }
  ],
  [
   'path',
   {
    'd': 'M8 12h8'
   }
  ],
  [
   'path',
   {
    'd': 'm16 20 2 2 4-4'
   }
  ]
 ],
 'squarePen': [
  [
   'path',
   {
    'd': 'M12 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7'
   }
  ],
  [
   'path',
   {
    'd': 'M18.375 2.625a1 1 0 0 1 3 3l-9.013 9.014a2 2 0 0 1-.853.505l-2.873.84a.5.5 0 0 1-.62-.62l.84-2.873a2 2 0 0 1 .506-.852z'
   }
  ]
 ],
 'trash': [
  [
   'path',
   {
    'd': 'M10 11v6'
   }
  ],
  [
   'path',
   {
    'd': 'M14 11v6'
   }
  ],
  [
   'path',
   {
    'd': 'M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6'
   }
  ],
  [
   'path',
   {
    'd': 'M3 6h18'
   }
  ],
  [
   'path',
   {
    'd': 'M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2'
   }
  ]
 ],
 'type': [
  [
   'path',
   {
    'd': 'M12 4v16'
   }
  ],
  [
   'path',
   {
    'd': 'M4 7V5a1 1 0 0 1 1-1h14a1 1 0 0 1 1 1v2'
   }
  ],
  [
   'path',
   {
    'd': 'M9 20h6'
   }
  ]
 ],
 'vault': [
  [
   'rect',
   {
    'width': '18',
    'height': '18',
    'x': '3',
    'y': '3',
    'rx': '2'
   }
  ],
  [
   'circle',
   {
    'cx': '7.5',
    'cy': '7.5',
    'r': '.5',
    'fill': 'currentColor'
   }
  ],
  [
   'path',
   {
    'd': 'm7.9 7.9 2.7 2.7'
   }
  ],
  [
   'circle',
   {
    'cx': '16.5',
    'cy': '7.5',
    'r': '.5',
    'fill': 'currentColor'
   }
  ],
  [
   'path',
   {
    'd': 'm13.4 10.6 2.7-2.7'
   }
  ],
  [
   'circle',
   {
    'cx': '7.5',
    'cy': '16.5',
    'r': '.5',
    'fill': 'currentColor'
   }
  ],
  [
   'path',
   {
    'd': 'm7.9 16.1 2.7-2.7'
   }
  ],
  [
   'circle',
   {
    'cx': '16.5',
    'cy': '16.5',
    'r': '.5',
    'fill': 'currentColor'
   }
  ],
  [
   'path',
   {
    'd': 'm13.4 13.4 2.7 2.7'
   }
  ],
  [
   'circle',
   {
    'cx': '12',
    'cy': '12',
    'r': '2'
   }
  ]
 ],
 'wrapText': [
  [
   'path',
   {
    'd': 'm16 16-3 3 3 3'
   }
  ],
  [
   'path',
   {
    'd': 'M3 12h14.5a1 1 0 0 1 0 7H13'
   }
  ],
  [
   'path',
   {
    'd': 'M3 19h6'
   }
  ],
  [
   'path',
   {
    'd': 'M3 5h18'
   }
  ]
 ],
 'x': [
  [
   'path',
   {
    'd': 'M18 6 6 18'
   }
  ],
  [
   'path',
   {
    'd': 'm6 6 12 12'
   }
  ]
 ],
 'panelRightClose': [
  [
   'rect',
   {
    'width': '18',
    'height': '18',
    'x': '3',
    'y': '3',
    'rx': '2'
   }
  ],
  [
   'path',
   {
    'd': 'M15 3v18'
   }
  ],
  [
   'path',
   {
    'd': 'm8 9 3 3-3 3'
   }
  ]
 ],
 'panelRightOpen': [
  [
   'rect',
   {
    'width': '18',
    'height': '18',
    'x': '3',
    'y': '3',
    'rx': '2'
   }
  ],
  [
   'path',
   {
    'd': 'M15 3v18'
   }
  ],
  [
   'path',
   {
    'd': 'm10 15-3-3 3-3'
   }
  ]
 ]
}
