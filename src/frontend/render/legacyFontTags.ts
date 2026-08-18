/**
 * Ported from Lumiverse `frontend/src/lib/legacyFontTags.ts`.
 * Keep in step with upstream.
 */
function escapeHtmlAttribute(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function getAttributeValue(attributes: string, name: string): string | undefined {
  const match = attributes.match(
    new RegExp(`(?:^|\\s)${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i'),
  )
  return match?.slice(1).find((value) => value !== undefined)
}

/**
 * Converts deprecated HTML font tags to spans before rich HTML sanitization.
 * DOMPurify then applies the usual policy to the resulting style attribute.
 */
export function normalizeLegacyFontTags(html: string): string {
  return html
    .replace(/<font\b([^>]*)>/gi, (_match, attributes: string) => {
      const color = getAttributeValue(attributes, 'color')
      const style = getAttributeValue(attributes, 'style')
      const safeColor = color && /^[#\w\s(),.%+-]+$/.test(color) ? color : null
      const declarations = [
        safeColor ? `color:${safeColor}` : null,
        style?.trim() || null,
      ].filter((declaration): declaration is string => Boolean(declaration))

      return declarations.length > 0
        ? `<span style="${escapeHtmlAttribute(declarations.join(';'))}">`
        : '<span>'
    })
    .replace(/<\/font\s*>/gi, '</span>')
}
