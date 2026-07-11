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
export function middleware(req: NextRequest): NextResponse {
  const expected = process.env.ADMIN_BASIC_AUTH;
  if (!expected) return NextResponse.next();

  const header = req.headers.get('authorization');
  if (header?.startsWith('Basic ')) {
    try {
      if (atob(header.slice(6)) === expected) return NextResponse.next();
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
