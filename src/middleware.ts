import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export function middleware(request: NextRequest) {
  // Protect the /warehouse route
  if (request.nextUrl.pathname.startsWith('/warehouse')) {
    const isAuthenticated = request.cookies.get('auth_session')?.value === 'authenticated';
    
    if (!isAuthenticated) {
      const loginUrl = new URL('/login', request.url);
      return NextResponse.redirect(loginUrl);
    }
  }
  
  return NextResponse.next();
}

export const config = {
  matcher: ['/warehouse/:path*'],
};
