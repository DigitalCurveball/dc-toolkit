# Changelog

## 0.7.1 (2026-10-18)

- **`dc-qa`'s link check tries a link again when the failure may be the network's**: a dropped connection ("fetch failed"), a 429 or a 5xx, up to three tries a second and then two apart, and only that link, not the run. A 404 still counts at once. A live check failed a page twice with "fetch failed" while it answered 200, and the whole run had to go again.
- **Each link is fetched once a run**, however many pages carry it: the header's and footer's links were fetched again on every page, about 28 of them on each of a ten-page site's.

## 0.7.0 (2026-10-17)

- **`parseCopy`, `plainCopy` and `telHref`** in `dc-toolkit/text`, and **`Copy.astro`**, new: a line of copy with `**bold**`, `[a label](/a/page/)` links, and the site's phone number and email address linked wherever they appear, the address through `EmailLink`. One demo site carried this as its own `src/lib/copy.ts` and `CopyLine.astro`, and a second needed it. The same parts as that copy's, with the email address added; the phone and the address are named in an options object, `parseCopy(text, { phone, email })`, where that copy took the phone alone. A site's own copy keeps working beside it, so nothing changes for a site until it switches.
- **`dc-toolkit/demo-form`**, new: a demo's form never sends; a submit shows the notice the form keeps in a `<template>`, in its live region. Two demo sites each carried the same lines in their forms' scripts, and their markup already works with this one.
- **`EmailLink`'s address may break after its @.** An address such as "hello@a-longer-business-name.example.com.au" is wider than a 320px column, and the script wrote the address as one unbreakable word. Nothing changes where an address fits.

## 0.6.1 (2026-10-13)

- `dc-compare` refuses a page that does not answer 200, the built page or the concept, rather than photographing the server's "not found" as if it were the page: a mistyped `--path` did exactly that.

## 0.6.0 (2026-10-13)

- **`dc-compare --shots` writes `review.html`** beside `index.html`: the report picturing only what needs a look, each band that differs and each page no concept drew, with a matching band a tick in its page's table. It is the one to send from a checkpoint; on one Growth port about 330 of its 2,198 pictures needed a look, and its largest checkpoint, 1,142 pictures, was refused whole as an artifact. The run's last line says how many pictures the review holds.
- **A page no concept drew is photographed whole**, one picture per width, rather than band by band: nothing needs lining up, and its pictures were most of a checkpoint's. Its band in `data.json` is "The whole page".
- **`dc-check-copy`**, new: every fragment of a client's approved copy must appear in a page, word for word, ignoring case, curly quotes and spacing; `--from`, `--to` and `--ignore` pick the copy out of the brief or the intake. Until now one site carried its own copy check. Tests in `test/copy.test.mjs`.
- **`dc-outline-text`**, new: lettering in a font as SVG paths, for a wordmark whose font may not be served, on fontkit like `dc-favicon`. Until now each site carried a copy of an opentype.js script for it, which this reproduces pixel for pixel.

## 0.5.0 (2026-10-12)

- **`dc-brand-assets`**, new: `public/favicon.ico` at 16, 32 and 48px from `public/favicon.svg`, and `src/assets/social-card.jpg` from the site's `scripts/social-card.html`, a page opened from disk so it uses the site's fonts and photos. Until now each site carried its own copy of a script for this, and the copies had begun to drift.
- **`dc-favicon`**, new: `public/favicon.svg` as one letter of the site's font, as paths, on a tile, for a brand with no mark; a variable font's axes, the tile's corner and the letter's height are options. It unpacks a WOFF2 to TTF first, since fontkit cannot make a variable instance from one.
- New dependencies `fontkit` and `wawoff2`. Tests in `test/brand.test.mjs`, with an open-licensed variable font as their fixture.

## 0.4.0 (2026-10-11)

- `dc-compare --shots` without `--concept` photographs a page no concept drew, such as one of several detail pages made from a designed pattern, into the same report, which says so. The pages a set never drew are the ones most in need of a look.

## 0.3.0 (2026-10-11)

- `dc-qa` checks **menu buttons** at every width where one shows: Enter opens the menu with `aria-expanded` saying so, Tab goes from the button into the menu, Escape closes it and puts focus back on the button, and two clicks open and close it. axe sees none of that, and an approved concept had its menu earlier in the source than its button, so Tab skipped it. It checks buttons with `aria-expanded` and `aria-controls` whose target is a `<nav>`, holds one or sits in one. A site that passed before can now fail, hence the minor version. Tests in `test/menu-buttons.test.mjs`.
- **`dc-compare --shots <dir>`**, new: each band of the page (the banner, header, each section, the footer) photographed in the build and the concept at each width, compared pixel by pixel with photos left out, and written to a report at `<dir>/index.html` that reads on a phone. It catches what moves no box: a colour, a border, a weight, a crop. Each band is put on a whole pixel before it is photographed, so identical text paints identically however far down the page it starts. Tests in `test/shots.test.mjs`, one of them end to end.
- New dependency `pixelmatch`, and `sharp` as a peer, which every site already has directly (the stack's traps).

## 0.2.0 (2026-10-07)

- `dc-qa` checks for **covered text** at every width: a line of visible text that another element paints over, such as copy under a positioned photo. Neither the overflow check nor axe sees it, and an approved concept had it. It fails only when what is on top paints there (an image, or a background inside a positioned element or other stacking context), so transparent overlays, visually hidden text, clipped wordmarks and closed `<details>` pass. A site that passed before can now fail, hence the minor version. Tests in `test/covered-text.test.mjs`, in a real browser, so the test workflow now installs Chromium.
- **`dc-compare`**, new: the side-by-side pass of a port, measured. It compares every element of every class the built page and its concept share, at each width, and lists the boxes that differ, with each box's position down the page measured from the top of its section, so a change above does not flag everything below. It reports and never fails.
- The static server both use moves out of `dc-qa` into `src/serve.mjs`, unchanged.

## 0.1.2 (2026-10-06)

- The contact route's work moves, unchanged, into `src/contact-handler.ts`, with tests of every refusal and of the one success: Origin, size, the dev path, missing bindings, the rate limit (checked first), the honeypot, an invalid form, a test secret off localhost, a token that fails or belongs to another form or site, the email reaching only the owner, and a failed send logging only its code.
- `defineSite()` keeps a site's `vite.resolve.alias` when it is a list, which it broke into an object; the site's entries come first, so they win.
- The type test also checks the package's own source and tests.
- README: the examples name the newest tag rather than 0.1.0, and "What the checks caught on the first site" is back.

## 0.1.1 (2026-10-06)

`defineSite()` is typed as Astro's `defineConfig` is, generic over locales and font providers, so a site's `astro check` accepts a font's `options` (a local font's `variants`). A type test covers it.

## 0.1.0 (2026-10-06)

The first release: `defineSite()`, `dc-qa`, `dc-check-routing`, the contact route and its rules, `robots.txt`, the CMS stand-in for previews, `EmailLink`, `isCurrentPage`, `parseBold`, and the reusable QA workflow, moved out of `dc-astro-template`.
