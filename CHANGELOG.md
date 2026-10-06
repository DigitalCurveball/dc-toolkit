# Changelog

## 0.1.2 (2026-10-06)

- The contact route's work moves, unchanged, into `src/contact-handler.ts`, with tests of every refusal and of the one success: Origin, size, the dev path, missing bindings, the rate limit (checked first), the honeypot, an invalid form, a test secret off localhost, a token that fails or belongs to another form or site, the email reaching only the owner, and a failed send logging only its code.
- `defineSite()` keeps a site's `vite.resolve.alias` when it is a list, which it broke into an object; the site's entries come first, so they win.
- The type test also checks the package's own source and tests.
- README: the examples name the newest tag rather than 0.1.0, and "What the checks caught on the first site" is back.

## 0.1.1 (2026-10-06)

`defineSite()` is typed as Astro's `defineConfig` is, generic over locales and font providers, so a site's `astro check` accepts a font's `options` (a local font's `variants`). A type test covers it.

## 0.1.0 (2026-10-06)

The first release: `defineSite()`, `dc-qa`, `dc-check-routing`, the contact route and its rules, `robots.txt`, the CMS stand-in for previews, `EmailLink`, `isCurrentPage`, `parseBold`, and the reusable QA workflow, moved out of `dc-astro-template`.
