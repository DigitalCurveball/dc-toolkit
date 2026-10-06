# Changelog

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
