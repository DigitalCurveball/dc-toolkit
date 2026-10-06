/**
 * Splits "a **b** c" into [{ text: 'a ', bold: false }, { text: 'b', bold: true }, ...]
 * so a component can render the bold parts as <b> in its own template.
 *
 * Why not store HTML in the content and use set:html? Markup injected that way
 * bypasses Astro's scoped styles, so the component's own `b` rule would not reach
 * it, and content could then inject arbitrary HTML.
 */
export function parseBold(text: string) {
  return text
    .split(/\*\*(.+?)\*\*/)
    .map((part, i) => ({ text: part, bold: i % 2 === 1 }))
    .filter((part) => part.text !== '');
}
