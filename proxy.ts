import { NextResponse, type NextRequest } from 'next/server';
import { COOKIE, verifySession } from './lib/auth';

// Redirects signed-out visitors to /login. API routes check auth themselves.
export async function proxy(req: NextRequest) {
  if (await verifySession(req.cookies.get(COOKIE)?.value)) return NextResponse.next();
  const url = new URL('/login', req.url);
  if (req.nextUrl.pathname !== '/') url.searchParams.set('next', req.nextUrl.pathname);
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ['/((?!login|api|_next|libarchive|favicon.ico|icon.svg|manifest.webmanifest).*)'],
};
