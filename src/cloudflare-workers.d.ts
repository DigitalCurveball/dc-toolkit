// Types for the Workers runtime module that server routes read bindings from. The project has
// no @cloudflare/workers-types, so each route describes the bindings it uses (as
// src/routes/contact.ts does) and casts this to them.
declare module 'cloudflare:workers' {
  export const env: Record<string, unknown>;
}
