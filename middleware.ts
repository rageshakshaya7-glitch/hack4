import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { verifyToken, COOKIE_NAME } from "./lib/auth/jwt";

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Static files and internal Next.js paths are bypassed
  if (
    pathname.startsWith("/_next") ||
    pathname.startsWith("/favicon.ico") ||
    pathname.startsWith("/api/auth") || // Public auth API routes
    pathname.startsWith("/images")
  ) {
    return NextResponse.next();
  }

  const token = request.cookies.get(COOKIE_NAME)?.value;
  const payload = token ? await verifyToken(token) : null;

  const isPublicAuthRoute =
    pathname === "/login" ||
    pathname === "/register" ||
    pathname === "/forgot-password" ||
    pathname === "/reset-password";

  // Redirect logged-in users visiting login/register/etc. to their home dashboard
  if (isPublicAuthRoute && payload) {
    let redirectPath = "/portal";
    if (payload.role === "ADMIN") redirectPath = "/admin";
    else if (payload.role === "STAFF") redirectPath = "/staff";
    return NextResponse.redirect(new URL(redirectPath, request.url));
  }

  // Allow public auth routes for unauthenticated users
  if (isPublicAuthRoute) {
    return NextResponse.next();
  }

  // Root path redirect
  if (pathname === "/") {
    if (!payload) {
      return NextResponse.redirect(new URL("/login", request.url));
    }
    let redirectPath = "/portal";
    if (payload.role === "ADMIN") redirectPath = "/admin";
    else if (payload.role === "STAFF") redirectPath = "/staff";
    return NextResponse.redirect(new URL(redirectPath, request.url));
  }

  // Protected route boundaries
  const isAdminRoute = pathname.startsWith("/admin");
  const isStaffRoute = pathname.startsWith("/staff");
  const isPortalRoute = pathname.startsWith("/portal");

  if (isAdminRoute || isStaffRoute || isPortalRoute) {
    if (!payload) {
      const loginUrl = new URL("/login", request.url);
      loginUrl.searchParams.set("from", pathname);
      return NextResponse.redirect(loginUrl);
    }

    if (isAdminRoute && payload.role !== "ADMIN") {
      return NextResponse.redirect(new URL("/403", request.url));
    }

    if (isStaffRoute && payload.role !== "ADMIN" && payload.role !== "STAFF") {
      return NextResponse.redirect(new URL("/403", request.url));
    }

    if (isPortalRoute && payload.role !== "CUSTOMER") {
      return NextResponse.redirect(new URL("/403", request.url));
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/admin/:path*",
    "/staff/:path*",
    "/portal/:path*",
    "/login",
    "/register",
    "/forgot-password",
    "/reset-password",
    "/",
  ],
};

