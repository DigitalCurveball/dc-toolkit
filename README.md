# dc-toolkit

The code every Digital Curveball site runs unchanged: the Astro and Cloudflare setup, the quality gate, the comparison of a port with its concept, the contact form's server side, `robots.txt`, a few small helpers and the QA workflow. Each site is an Astro project (static output, Keystatic for content, Cloudflare Workers for hosting) made from a private template; this package holds the parts that must be the same everywhere, so a fix reaches every site through one update instead of a copy in each.

It ships source (`.mjs`, `.ts`, `.astro`) with no build step, and is installed from a version tag:

```json
"dc-toolkit": "github:DigitalCurveball/dc-toolkit#vX.Y.Z"
```

where `vX.Y.Z` is the newest tag, the top entry in `CHANGELOG.md`.

Its peers (Astro, the Cloudflare adapter, React, Keystatic, the sitemap, Playwright, axe and Wrangler) are the site's own dependencies, at the site's versions. `astro` being a peer is also what makes Astro compile this package's files.

MIT licence.

## `defineSite()`

A site's whole `astro.config.mjs`:

```js
// @ts-check
import { fontProviders } from 'astro/config';
import { defineSite } from 'dc-toolkit';

export default defineSite({
  site: 'https://example.com',
  fonts: [/* the site's families, self-hosted */],
  contactForm: true,
  sitemap: { filter: (page) => !page.includes('/drafts/') },
});
```

It takes any Astro setting, plus two of its own: `contactForm` (off unless set) injects `/api/contact`, and `sitemap` passes options to `@astrojs/sitemap`. A site's own `integrations` come after the toolkit's, and its `vite` settings are merged with them. It is a wrapper rather than an integration because Astro 7 moves `config.adapter` into the integration list once, before any hook runs, so an integration cannot add the adapter.

What it adds, and why each is there:

- **The Cloudflare adapter, for builds only.** With the adapter present, `astro dev` runs server routes inside workerd, which has no filesystem and no CommonJS, so Keystatic's editor dies with "exports is not defined" and its local mode cannot write files. Dev runs on Node, production on workerd.
- **`react-dom/server` aliased to `react-dom/server.edge` for builds.** React 19 on Cloudflare needs the edge build, or the deployed Worker fails with "MessageChannel is not defined".
- **`cloudflare:workers` aliased to a stand-in under `astro dev`.** Server routes read bindings from that module, which only exists inside workerd. The stand-in has no bindings, so a route that needs one takes a dev path, as the contact route does by printing the message.
- **`session: false`.** Nothing uses Astro sessions, and with them on the adapter adds a `SESSION` KV binding with no ID, which `wrangler preview` refuses, so every branch preview fails to deploy.
- **The CMS left out of branch previews.** Keystatic Cloud reads and saves `main` from any deployment, so a preview's editor would show `main`'s content and could commit fields `main`'s schema rejects. Workers Builds sets `WORKERS_CI_BRANCH`; when it is set and not `main`, React and Keystatic are left out and a stand-in answers `/keystatic`. The stand-in also keeps a Worker script in the build: without one the adapter emits a static-only deployment, and Wrangler refuses `assets.run_worker_first` when there is no script to run first. `main` must match the production branch in Cloudflare's build settings.
- **The sitemap and `robots.txt`** (below).

What stays in each site: `site`, fonts, Markdown settings and its own integrations; `wrangler.jsonc`, including `assets.run_worker_first`, which lists `/api/contact` only when `contactForm` is on; `lighthouserc.json`; and everything with a look.

## The checks

`dc-qa` runs axe-core (WCAG 2 A and AA), a horizontal-overflow check and a covered-text check at 320, 400, 768 and 1280px, plus link, heading-order and meta checks once per page. axe runs at the narrowest and widest widths only; the middle two rarely differ and each scan costs a second or two. A second job in the QA workflow runs Lighthouse against the budgets in the site's `lighthouserc.json` (performance 95, accessibility 100, SEO 95), taking the median of three runs because a single run on a shared runner is noisy.

| When | Target | How |
|---|---|---|
| Before porting a concept | The approved concept in `public/concepts/` | Actions tab, "Run workflow", target `concept`; or locally, `pnpm exec dc-qa --dir public/concepts --path /<file>.html` |
| Every push to `main`, and every pull request, touching design, dependencies or the runtime | The build, served inside the runner | automatic |
| Locally, before pushing | The build | `pnpm build && pnpm qa` |
| After launch | The live public site | `pnpm exec dc-qa --url https://… --external` |
| Every month on a care plan, and once at launch | The live public site | a scheduled workflow runs this package, at the version the template uses, with `--json <file>`, which also writes the results as data for the report |

Running it against the concept **before** porting gives a baseline. The port should equal or beat it, and a concept usually carries a few failures of its own, which is much better found before rebuilding it than after.

Local runs need browser system libraries once, which a WSL machine lacks: `sudo npx playwright install-deps chromium`, from a real terminal.

**A red run never blocks a deploy.** Cloudflare builds from `main` independently, which is deliberate: a client's CMS save must always reach the site. What a red run blocks is the launch checklist, which is a human step.

**Path filters matter.** Keystatic commits on every save, and content cannot change contrast or layout. Running a browser on each save would spend both GitHub's Actions minutes and Cloudflare's build minutes for nothing.

Bare `href="#"` links are counted, not failed: they are expected until launch. External links are only checked with `--external`, so a flaky third party cannot turn a design check red.

**Every page must be listed.** The gate checks the paths in the site's `package.json` `qa` script (`"qa": "dc-qa --dir dist/client --path /,/about/,/contact/"`), the QA workflow hands the same paths to Lighthouse, and `dc-check-routing` reads them too, so a new page means one edit there. Unlisted pages are never checked, and nothing warns you.

### The routing check

`pnpm check:routing` (`"check:routing": "dc-check-routing"`) builds the site, runs the built Worker under `wrangler dev` with every call to it logged, and requests each page, a made-up URL and the CMS, both as a browser page load and as a bot. It fails unless pages and made-up URLs are answered by the static asset layer without the Worker, and the paths in `run_worker_first` always reach it. It also asks `wrangler deploy --dry-run` whether the deploy config would be accepted. It leaves `dist/` holding the build it checked, so after `--branch preview`, run `pnpm build` before `pnpm qa` or comparing output: a preview build has no CMS.

| When | How |
|---|---|
| After changing `wrangler.jsonc`'s `assets`, adding a server route, or updating the Cloudflare adapter | `pnpm check:routing`, then `pnpm check:routing --branch preview` |
| Before launch | Both, once more |

Run both forms: a branch build leaves the CMS out, and differs enough to fail on its own. It is not in CI: it needs two builds and a local Workers runtime per run, and routing changes are rare and deliberate.

It refuses to start while any `workerd` process is running. Killing a `wrangler dev` wrapper leaves `wrangler` alive, watching the build folder and holding the port; the next run then answers from an old server against rebuilt files, and everything 404s. That once produced a false "not_found_handling breaks asset serving". Stop the process tree: `workerd`'s parent is `wrangler`, which `ps` names "MainThread".

### What the checks caught on the first site, within a day

Both will recur, so check them early rather than waiting for the gate.

**No canonical URL and no Open Graph tags at all.** Every link shared with the client, or posted anywhere, would have been a bare URL with no title card. That is why the meta check exists, why a site needs `site` set in `astro.config.mjs`, and why it needs a social card image.

**A Google Fonts `<link>` cost about 2,040ms of render-blocking**, holding performance at 91 and first contentful paint at 2.8s, because text cannot paint until a third party responds. Self-hosting through Astro's `fonts` config fixed it: performance 98 to 99, first contentful paint 0.8s, layout shift 0, and no requests to Google from visitors' browsers at all.

### What axe does not catch

A careful manual pass on one site found three contrast failures where axe reported two: it does not evaluate `::placeholder` text. The gate is a floor, not a ceiling. Translucent text, placeholders and disabled states still need eyes on them.

Nor does axe see **text another element paints over**, and neither does the overflow check: an approved concept passed both with its hero photo covering the ends of the intro's lines from 800 to 1440px, because the photo's box was positioned (for its absolutely placed image) and the copy beside it was not. So `dc-qa` asks, at three points along each line of visible text, what is on top (`src/covered-text.mjs`). It fails only when that thing paints there: an image, or a background inside a positioned element or another stacking context. An ordinary block's background is painted beneath all text, so a block pulled up by a negative margin passes, as do transparent overlays (a stretched link), visually hidden text, a wordmark clipped by its box and the answer in a closed `<details>`. Each line is scrolled to the middle of the viewport first, where a sticky header is not in the way.

### Comparing a port with its concept

`dc-compare` is the side-by-side pass of a port, measured rather than eyeballed. After a build:

```sh
pnpm exec dc-compare --concept public/concepts/<file>.html            # the home page
pnpm exec dc-compare --concept public/concepts/pages/about.html --path /about/
```

It loads both at 320, 400, 640, 768, 1024, 1280 and 1440px (`--widths` takes the concept's own breakpoints too) and compares every element of every class the two pages share, in document order: a port lifts the concept's CSS as it stands, so the class names match and nothing needs listing. A box's x, width and height are compared as they are, and its position down the page from the top of its section, so a change above does not flag everything below. It lists classes found in only one page, which is how a missing part shows, and an element shown in one and hidden in the other. Differences within a pixel are ignored (`--tolerance`).

It reports and never fails: a change made to the concept on purpose shows in it for good. On the first port it was run on, every box matched except the three changes made deliberately, which also confirmed the self-hosted fonts set text at the concept's widths.

## The QA workflow

`.github/workflows/qa.yml` here is a reusable workflow. A site's own `.github/workflows/qa.yml` keeps the triggers and calls it:

```yaml
on:
  push:
    branches: [main]
    paths: [/* design, dependency and runtime files */]
  pull_request:
    paths: [/* the same */]
  workflow_dispatch:
    inputs:
      target: { type: choice, default: build, options: [build, concept] }
      concept_file: { type: string, default: index.html }

jobs:
  qa:
    uses: DigitalCurveball/dc-toolkit/.github/workflows/qa.yml@vX.Y.Z   # the same tag as the dependency
    with:
      target: ${{ inputs.target || 'build' }}
      concept_file: ${{ inputs.concept_file || 'index.html' }}
```

Its inputs: `target` (`build` or `concept`), `concept_dir` (default `public/concepts`) and `concept_file` (default `index.html`).

## The contact form

A form that sends each message to the owner's inbox through a route on the site's own Worker, `/api/contact`, and Cloudflare Email Service. No other company receives the message, nothing is stored on the site, and no form account is needed per site. The route and its rules are here; the form itself (`ContactForm.astro`) is the site's, since every site styles it, and the site's `src/lib/contact.ts` re-exports `dc-toolkit/contact` and holds its Turnstile site key.

| Part | Where |
|---|---|
| The route | `src/routes/contact.ts`, injected by `defineSite({ contactForm: true })`; its work is `src/contact-handler.ts`, which `test/contact-route.test.ts` runs through every refusal |
| The rules the form and route share | `src/contact.ts`, exported as `dc-toolkit/contact` |
| The form, and the site key | the site's `ContactForm.astro` and `src/lib/contact.ts` |
| Routing and bindings | the site's `wrangler.jsonc`: `run_worker_first`, and the bindings block |

### How a message travels

1. The page is prerendered like every other. Without JavaScript the form is hidden and a line points to the email address, because the bot check needs scripts.
2. When the visitor first touches the form, Cloudflare Turnstile loads. Nothing contacts Turnstile before then.
3. On Send, Turnstile runs and issues a token, good for one message and five minutes. The script posts the form to `/api/contact` in the background, so a refusal keeps what was typed.
4. The route checks the request (below), then emails the owner, with the visitor's address as Reply-To. The owner presses Reply to answer.
5. The form is replaced by the "sent" text.

Under `astro dev` there is no Worker, so the route checks the form and prints the email to the terminal instead of sending it.

### What stops abuse

Everything the page checks, the route checks again: anything can post to `/api/contact` without the page.

| Threat | Defence |
|---|---|
| Using the form to email other people | The `send_email` binding is pinned to the owner's verified inbox (`destination_address`) and to one sender, so even a bug in the route cannot email anyone else. The route never sends to the address the visitor typed |
| Header injection (smuggling `Bcc:` or a second address in) | Name and email reject control characters and line breaks; the email must be one address with no commas, spaces, angle brackets or quotes. The subject is fixed text plus the name. The email is plain text, so nothing typed renders as HTML |
| Posts from other sites, or with no Origin | Astro's `security.checkOrigin` refuses cross-site form posts; the route also refuses any request whose `Origin` is missing or not this site |
| Huge requests | Anything over 32 KB is refused before it is read |
| Automated spam | Turnstile, verified server-side: the token must pass Cloudflare's check, be issued for this form's action, and on this hostname. A token works once |
| A bot that gets past Turnstile | The honeypot, a field only bots fill: the route tells it "sent" and sends nothing |
| Floods from one visitor | Three messages a minute per IP address, through the Workers rate-limiting binding, checked before any other work |
| A test key left in production | Cloudflare's test secrets pass every token, so the route accepts one only on localhost and refuses every message elsewhere |
| Leaking what visitors wrote | Logs carry outcome codes only, never the message. "Email preview" is turned off for the sending domain (below) |

None of it depends on this code being secret: the binding's limits, Turnstile and the rate limit are enforced by Cloudflare, and every secret is per site, in Cloudflare. **What none of it stops:** a person typing spam by hand, or a paid service solving Turnstile. The rate limit caps either, and the worst case is unwanted email in the owner's inbox. The form goes live only on Workers Paid, where a flood costs requests, not the whole account's daily allowance.

### Going live

After the domain's DNS is in the Cloudflare account, and before or at launch.

In the Cloudflare dashboard:

1. **Workers Paid** for the account, if it is not already. Email Sending is not on Workers Free.
2. **Onboard `forms.<domain>`** under Compute → Email Service → Email Sending → Onboard Domain. A subdomain, never the root domain: onboarding writes a DMARC record, and the root domain's belongs to the email provider. Its records then sit under `forms.` only (`_dmarc.forms.`, `cf-bounce.forms.`); check the root's are untouched. Then turn off **Email preview** in that domain's settings, so Cloudflare keeps no copy of messages.
3. **Add the owner's inbox** under Email Routing → **Destination Addresses**, never Email Routing's Onboard Domain, which takes the domain's MX records from its email provider. Cloudflare emails the address a link to click.
4. **Create the Turnstile widget** (Turnstile → Add widget): Managed mode, with the domain and the workers.dev draft address as hostnames. The site key goes in the site's repo; the secret key goes on the Worker under Settings → Variables and Secrets, as a **Secret** named `TURNSTILE_SECRET_KEY`.

In the site's repo:

5. The site's `src/lib/contact.ts`: `SITE_KEY` becomes the widget's site key.
6. `astro.config.mjs` has `contactForm: true`, and `wrangler.jsonc` lists `/api/contact` in `run_worker_first` and has the bindings block: the owner's inbox (in both `destination_address` and `CONTACT_TO`: if they differ, every send is refused), the sender on `forms.<domain>`, and a rate-limit `namespace_id` no other Worker in the account uses.
7. `pnpm check:routing`, push, then send a real message from the draft and reply to it: it should arrive from "Website contact form" at `website@forms.<domain>`, and Reply should go to the sender.

Branch previews get none of the bindings (the adapter writes their `previews` block itself), so a preview's form answers "unavailable".

### Testing locally

The built Worker can run with the bindings simulated, so nothing is sent. With a real site key in the site's `src/lib/contact.ts`, set it back to `TEST_SITE_KEY` for the test build: a real key fails on localhost. Copy `dist/server/wrangler.json` with the bindings block added and `"vars": { "CONTACT_TO": "…", "CONTACT_FROM": "…", "TURNSTILE_SECRET_KEY": "1x0000000000000000000000000000000AA" }` (Cloudflare's always-pass test secret; `2x…AA` always fails), run `wrangler dev --config` on the copy, and post with an `Origin` header matching the local address. The simulated send is listed, Reply-To included, at `/cdn-cgi/local/explorer/api/local/email/sending`. The simulator refuses a message without `to`, which is why the route always passes `CONTACT_TO`. Stop the whole process tree afterwards and check `pgrep -x workerd` prints nothing (The routing check, above).

## `robots.txt`

A route, prerendered like a page, rather than a file in `public/`, so its Sitemap line is built from the site's `site` and stays right when `site` changes at launch. It allows everything, then asks 32 AI-training crawlers to stay out, with the list Cloudflare's managed robots.txt carried on 2026-10-03. Cloudflare's managed file is switched off on every site's zone, because its Content-Signal line fails Lighthouse's robots.txt audit, which held every live page's SEO score at 92. Unlike the managed file, this list does not update itself: compare it with Cloudflare's now and then, and release the change here so every site gets it.

## The helpers

- `dc-toolkit/EmailLink.astro`: an email link harvesters can't lift from the HTML. Neither `name@domain` nor `mailto:` is written into the page; the two halves sit in separate attributes and a script joins them in the browser. Without JavaScript it reads "info [at] example.com". Unstyled: a parent styles it with `:global(a)`.
- `dc-toolkit/email-links`: that script on its own, for pages whose Markdown renders addresses the same way.
- `dc-toolkit/paths`: `isCurrentPage(href, pathname)`, for `aria-current` on the current menu link.
- `dc-toolkit/text`: `parseBold(text)`, which splits `**bold**` in content into parts a component renders as `<b>`, instead of storing HTML.

## Releasing

1. `pnpm test`.
2. Nothing client-specific in the repo: a grep for every client's name and for a Turnstile site key prints nothing (the command, with its list of names, is kept with the business's records).
3. Bump `version` in `package.json` and add a `CHANGELOG.md` entry.
4. Commit, then `git tag vX.Y.Z && git push origin main vX.Y.Z`.

A site with Renovate receives it in one pull request, which moves the `github:` dependency and the QA workflow's `@vX.Y.Z` together and is checked by QA before it is merged. A site without Renovate is bumped by hand: both refs in one commit, then its gate.
