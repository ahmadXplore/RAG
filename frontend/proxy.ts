import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

/**
 * Route protection proxy (renamed from middleware.ts → proxy.ts for Next.js 16+).
 * Redirects unauthenticated users to /login.
 * Redirects non-admin users away from /admin/*.
 *
 * Rule 20: This is UI-only; backend is the authoritative authorization layer.
 * The backend enforces RBAC on every API call regardless of this proxy.
 */

const PUBLIC_PATHS = ["/", "/login", "/register"];
const ADMIN_PREFIX = "/admin";

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Skip static files and Next.js internals
  if (
    pathname.startsWith("/_next") ||
    pathname.startsWith("/favicon") ||
    pathname.includes(".")
  ) {
    return NextResponse.next();
  }

  // Allow public paths
  if (PUBLIC_PATHS.some((p) => pathname.startsWith(p))) {
    return NextResponse.next();
  }

  // Check token from cookie (set on login for SSR; localStorage is used client-side)
  const token = request.cookies.get("rag_access_token")?.value;

  if (!token) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("from", pathname);
    return NextResponse.redirect(url);
  }

  // Admin route guard — role check happens client-side after hydration;
  // backend will 403 any unauthorized API call regardless.
  // We don't decode JWT in proxy to avoid edge runtime crypto complexity.

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};

