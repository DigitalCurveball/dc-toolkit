// Stands in for `cloudflare:workers` under `astro dev`, which runs on Node without the
// Cloudflare adapter (defineSite()), so the real module does not exist there. No bindings:
// routes that need one take their dev path instead, as src/routes/contact.ts does.
export const env: Record<string, unknown> = {};
