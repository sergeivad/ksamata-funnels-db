import { NextRequest, NextResponse } from 'next/server';

/**
 * Optional HTTP Basic Auth for the whole admin (pages + API).
 *
 * Gate: environment variable ADMIN_BASIC_AUTH = "user:password".
 *  - unset/empty/invalid (no ":") in **development** → auth DISABLED (no-op)
 *    so local dev keeps working unchanged. Logged once via console.warn.
 *  - unset/empty/invalid (no ":") in **production** (NODE_ENV=production)
 *    → fail CLOSED: every request (pages + API) gets a 503 rather than being
 *    silently exposed. A forgotten env var must never mean a public admin.
 *  - set (valid "user:password") → every request must send a matching
 *    `Authorization: Basic` header, otherwise 401 with a WWW-Authenticate
 *    challenge.
 *
 * This is intentionally minimal: a single shared credential for an internal
 * tool. It is NOT a substitute for a real identity provider.
 *
 * Kill-switch: environment variable ADMIN_AUTH_DISABLED = "true" turns auth
 * OFF entirely — every page and API route is served without any credential,
 * even in production and even when ADMIN_BASIC_AUTH is set. This is an explicit,
 * greppable opt-out (reversible by removing the variable). Because it makes the
 * admin publicly reachable, it must be set deliberately; it is never the
 * default.
 */
// Decode a base64 credential as UTF-8 (Edge-runtime safe — no Node Buffer).
// `atob` yields a Latin1 binary string, so re-decode the bytes as UTF-8 to
// support non-ASCII credentials.
function decodeBase64Utf8(b64: string): string {
  const binary = atob(b64);
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  return new TextDecoder('utf-8').decode(bytes);
}

// Constant-time string comparison (Edge-runtime safe — no Node crypto). Avoids
// leaking how many leading characters matched via early-return timing.
function timingSafeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const ab = enc.encode(a);
  const bb = enc.encode(b);
  if (ab.length !== bb.length) return false;
  let diff = 0;
  for (let i = 0; i < ab.length; i++) diff |= ab[i] ^ bb[i];
  return diff === 0;
}

// A configured credential must be non-empty and contain a "user:password"
// separator. Anything else (unset, empty string, missing ":") is treated as
// "not configured".
function isValidCredential(value: string | undefined): value is string {
  return typeof value === 'string' && value.length > 0 && value.includes(':');
}

export interface AuthEnv {
  ADMIN_BASIC_AUTH?: string;
  ADMIN_AUTH_DISABLED?: string;
  NODE_ENV?: string;
}

export type AuthDecision =
  | 'disabled'      // kill-switch on — auth OFF everywhere, pass through
  | 'open'          // not configured, dev — pass through
  | 'misconfigured' // not configured, production — fail closed (503)
  | 'unauthorized'  // configured, credentials missing/wrong — 401
  | 'ok';           // configured, credentials match — pass through

/**
 * Pure decision function — no NextRequest/NextResponse dependency — so it can
 * be unit tested directly without constructing Next.js request objects.
 */
export function resolveAuthDecision(env: AuthEnv, authHeader: string | null): AuthDecision {
  // Explicit kill-switch takes precedence over everything, including the
  // production fail-closed path. Auth is only disabled when set to exactly
  // "true", so a stray/typo'd value can never accidentally open the admin.
  if (env.ADMIN_AUTH_DISABLED === 'true') {
    return 'disabled';
  }

  const expected = env.ADMIN_BASIC_AUTH;

  if (!isValidCredential(expected)) {
    return env.NODE_ENV === 'production' ? 'misconfigured' : 'open';
  }

  if (authHeader?.startsWith('Basic ')) {
    try {
      if (timingSafeEqual(decodeBase64Utf8(authHeader.slice(6)), expected)) {
        return 'ok';
      }
    } catch {
      // malformed base64 — fall through to unauthorized
    }
  }

  return 'unauthorized';
}

// Warn exactly once per process when auth is disabled, so a forgotten env var
// in an exposed dev deployment is at least visible in the logs.
let warnedAuthDisabled = false;
let warnedAuthKilled = false;

export function middleware(req: NextRequest): NextResponse {
  const decision = resolveAuthDecision(process.env, req.headers.get('authorization'));

  switch (decision) {
    case 'disabled':
      if (!warnedAuthKilled) {
        warnedAuthKilled = true;
        console.warn(
          '[middleware] ADMIN_AUTH_DISABLED=true — admin auth is turned OFF and ' +
          'every page and API route is publicly reachable, regardless of ' +
          'ADMIN_BASIC_AUTH. Remove ADMIN_AUTH_DISABLED to restore Basic Auth.'
        );
      }
      return NextResponse.next();

    case 'open':
      if (!warnedAuthDisabled) {
        warnedAuthDisabled = true;
        console.warn(
          '[middleware] ADMIN_BASIC_AUTH is not set — admin auth is DISABLED and ' +
          'every page and API route is publicly reachable. Set ADMIN_BASIC_AUTH ' +
          '="user:password" to require Basic Auth.'
        );
      }
      return NextResponse.next();

    case 'misconfigured':
      return new NextResponse('Admin auth is not configured (ADMIN_BASIC_AUTH)', {
        status: 503,
      });

    case 'ok':
      return NextResponse.next();

    case 'unauthorized':
    default:
      return new NextResponse('Authentication required', {
        status: 401,
        headers: { 'WWW-Authenticate': 'Basic realm="Ksamata Funnels Admin"' },
      });
  }
}

// Guard everything except Next internals and static assets.
export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
