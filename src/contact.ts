// The contact form's rules, shared by a site's form (its ContactForm.astro, through its
// src/lib/contact.ts) and the Worker route defineSite() injects (src/routes/contact.ts). The route
// checks everything again: the form's own limits only help people, because anything can post to
// the route without the page. How it all fits: README, "The contact form".

// Cloudflare's test site key, which passes everyone on any host. A site uses it under
// `astro dev`, and until its own widget exists; its src/lib/contact.ts holds its real key.
export const TEST_SITE_KEY = '1x00000000000000000000AA';

// Turnstile tags each token with the action it was issued for, and the route rejects a token
// issued for anything else.
export const TURNSTILE_ACTION = 'contact';

// The honeypot: a field people never see or reach, which form-filling bots tend to complete.
export const HONEYPOT = 'website';

export const LIMITS = { name: 100, email: 254, message: 5000 } as const;

// The largest request the route reads. A full message is at most 5,000 characters (20 KB in the
// worst case of UTF-8) plus the form's other fields and multipart framing.
export const MAX_BODY_BYTES = 32 * 1024;

export interface ContactMessage {
  name: string;
  email: string;
  message: string;
}

export type ParsedForm =
  | { kind: 'ok'; message: ContactMessage; token: string }
  | { kind: 'honeypot' }
  | { kind: 'invalid' };

// One address, with nothing in it that means something in an email header: no spaces, commas,
// angle brackets or quotes, so it can sit in Reply-To and only ever be one address.
const EMAIL = /^[^\s@<>()",;:\\[\]]+@[^\s@<>()",;:\\[\]]+\.[^\s@<>()",;:\\[\]]+$/;

// Control characters. A name or address never has any; a message may keep tabs and line breaks.
const CONTROL = /[\u0000-\u001f\u007f]/;
const CONTROL_IN_TEXT = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;

/** Reads and checks a submitted form. Fields the form doesn't have are ignored. */
export function parseContactForm(form: FormData): ParsedForm {
  const text = (key: string) => {
    const value = form.get(key);
    return typeof value === 'string' ? value : null;
  };

  if ((text(HONEYPOT) ?? '') !== '') return { kind: 'honeypot' };

  const name = text('name')?.trim() ?? '';
  const email = text('email')?.trim() ?? '';
  const message = (text('message') ?? '').replace(/\r\n?/g, '\n').trim();
  const token = text('cf-turnstile-response') ?? '';

  const valid =
    name.length > 0 &&
    name.length <= LIMITS.name &&
    !CONTROL.test(name) &&
    email.length <= LIMITS.email &&
    EMAIL.test(email) &&
    message.length > 0 &&
    message.length <= LIMITS.message &&
    !CONTROL_IN_TEXT.test(message) &&
    token.length > 0 &&
    token.length <= 2048;

  return valid ? { kind: 'ok', message: { name, email, message }, token } : { kind: 'invalid' };
}

/** The email the owner receives: plain text, so nothing a visitor types can render as HTML. */
export function contactEmail({ name, email, message }: ContactMessage, hostname: string) {
  return {
    subject: `Website message from ${name}`,
    text: [
      `Name: ${name}`,
      `Email: ${email}`,
      '',
      message,
      '',
      '--',
      `Sent from the contact form on ${hostname}. Reply to answer ${name} directly.`,
    ].join('\n'),
  };
}
