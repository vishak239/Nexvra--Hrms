import { NextResponse, type NextRequest } from "next/server";

// UX convenience only: send visitors without a session cookie to /login.
// Real authorization happens in Django on every API call.
const PUBLIC = ["/login", "/forgot-password", "/reset-password"];

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (PUBLIC.some((p) => pathname.startsWith(p))) return NextResponse.next();
  if (!req.cookies.has("nexvra_session")) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.search = pathname === "/" ? "" : `?next=${encodeURIComponent(pathname)}`;
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  // Skip API proxy, Next internals and static brand assets.
  matcher: ["/((?!api/|_next/|brand/|favicon.ico).*)"],
};
