// Turns every <a data-user data-domain> on the page into a working mailto link. EmailLink
// renders that form, and so can a site's Markdown plugin for addresses in Markdown, so
// "name@domain" and "mailto:" never appear in the HTML that harvesters fetch. Imported from a
// <script>, it is bundled once per page however many links use it.
for (const link of document.querySelectorAll<HTMLAnchorElement>('a[data-user][data-domain]')) {
  const address = `${link.dataset.user}@${link.dataset.domain}`;
  link.href = `mailto:${address}`;
  link.textContent = address;
}
