import { NextRequest, NextResponse } from 'next/server';
// Cheap gate only (cookie present). Real verification + authorization happen in every API route and in the database (RLS).
export function middleware(req: NextRequest) {
  if (req.nextUrl.pathname === '/') return NextResponse.next();   // public landing page
  if (!req.cookies.get('ro_session')) { const u = new URL('/login', req.url); u.searchParams.set('next', req.nextUrl.pathname); return NextResponse.redirect(u); }
  return NextResponse.next();
}
export const config = { matcher: ['/((?!login|api|_next|favicon.ico).*)'] };