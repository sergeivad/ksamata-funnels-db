import { NextRequest, NextResponse } from 'next/server';

/**
 * Optional HTTP Basic Auth for the whole admin (pages + API).
 *
 * Gate: environment variable ADMIN_BASIC_AUTH = "user:password".
 *  - unset/empty  → auth DISABLED (no-op) so local dev and any already-running
 *    deployment behind a private network keep working unchanged.
 *  - set          → every request must send a matching `Authorization: Basic`
 *    header, otherwise 401 with a WWW-Authenticate challenge.
 *
 * This is intentionally minimal: a single shared credential for an internal
 * tool. It is NOT a substitute for a real identity provider.
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

// Warn exactly once per process when auth is disabled, so a forgotten env var
// in an exposed deployment is at least visible in the logs (fail-open default).
let warnedAuthDisabled = false;

export function middleware(req: NextRequest): NextResponse {
  const expected = process.env.ADMIN_BASIC_AUTH;
  if (!expected) {
    if (!warnedAuthDisabled) {
      warnedAuthDisabled = true;
      console.warn(
        '[middleware] ADMIN_BASIC_AUTH is not set — admin auth is DISABLED and ' +
        'every page and API route is publicly reachable. Set ADMIN_BASIC_AUTH ' +
        '="user:password" to require Basic Auth.'
      );
    }
    return NextResponse.next();
  }

  const header = req.headers.get('authorization');
  if (header?.startsWith('Basic ')) {
    try {
      if (timingSafeEqual(decodeBase64Utf8(header.slice(6)), expected)) {
        return NextResponse.next();
      }
    } catch {
      // malformed base64 — fall through to challenge
    }
  }

  return new NextResponse('Authentication required', {
    status: 401,
    headers: { 'WWW-Authenticate': 'Basic realm="Ksamata Funnels Admin"' },
  });
}

// Guard everything except Next internals and static assets.
export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
