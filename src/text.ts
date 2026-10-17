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

/** A `tel:` link for a number as an Australian owner writes it: "0491 570 156" is "tel:+61491570156". */
export function telHref(phone: string) {
  const digits = phone.replace(/\D/g, '');
  return `tel:${digits.startsWith('0') ? `+61${digits.slice(1)}` : `+${digits}`}`;
}

/** One run of a line of copy: plain or bold, and a link (`href`) or the email address (`email`). */
export type CopyPart = { text: string; bold: boolean; href?: string; email?: boolean };

const LINK = /\[([^\]]+)\]\(([^)\s]+)\)/;
const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * A line of copy as an owner writes it in the CMS, split into the parts a component renders
 * (Copy.astro does): **bold**, [a label](/a/page/) for a link, and the site's phone number and
 * email address, each a link wherever the text has it. The copy stays one field the owner can
 * reword, and a link follows its words. Parts rather than HTML, for parseBold's reasons.
 */
export function parseCopy(text: string, { phone, email }: { phone?: string; email?: string } = {}): CopyPart[] {
  const contacts = [phone, email].filter((c): c is string => !!c);
  const between = contacts.length ? new RegExp(`(${contacts.map(escape).join('|')})`) : undefined;
  const parts: CopyPart[] = [];
  // split() with the link's two groups gives [text, label, href, text, label, href, …, text].
  const pieces = text.split(new RegExp(LINK.source));
  for (let i = 0; i < pieces.length; i += 3) {
    for (const { text: run, bold } of parseBold(pieces[i])) {
      for (const bit of between ? run.split(between) : [run]) {
        if (!bit) continue;
        if (bit === phone) parts.push({ text: bit, bold, href: telHref(bit) });
        else if (bit === email) parts.push({ text: bit, bold, email: true });
        else parts.push({ text: bit, bold });
      }
    }
    if (i + 1 < pieces.length) parts.push({ text: pieces[i + 1], bold: false, href: pieces[i + 2] });
  }
  return parts;
}

/** The copy without its marks, where a line is shown plain, as in a page's meta description. */
export const plainCopy = (text: string) =>
  parseCopy(text)
    .map((part) => part.text)
    .join('');
