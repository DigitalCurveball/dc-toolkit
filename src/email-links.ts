// Turns every <a data-user data-domain> on the page into a working mailto link. EmailLink
// renders that form, and so can a site's Markdown plugin for addresses in Markdown, so
// "name@domain" and "mailto:" never appear in the HTML that harvesters fetch. Imported from a
// <script>, it is bundled once per page however many links use it.
//
// The address may break after its @, where a long one would otherwise run out of a phone's
// column: "hello@a-longer-business-name.example.com.au" is wider than 320px. It breaks only where
// it has to.
for (const link of document.querySelectorAll<HTMLAnchorElement>('a[data-user][data-domain]')) {
  const { user, domain } = link.dataset as { user: string; domain: string };
  link.href = `mailto:${user}@${domain}`;
  link.replaceChildren(`${user}@`, document.createElement('wbr'), domain);
}
