import { NextResponse, type NextRequest } from "next/server";

const LOCALES = ["en", "hi"];

/** Redirect un-prefixed paths to /en or /hi (Accept-Language, then cookie). */
export function middleware(req: NextRequest) {
  const { pathname, search } = req.nextUrl;
  const first = pathname.split("/")[1] ?? "";
  if (LOCALES.includes(first)) return NextResponse.next();

  const cookie = req.cookies.get("sahamati-locale")?.value;
  const accept = req.headers.get("accept-language") ?? "";
  const locale = cookie && LOCALES.includes(cookie) ? cookie : /^\s*hi\b/i.test(accept) ? "hi" : "en";
  const url = req.nextUrl.clone();
  url.pathname = `/${locale}${pathname === "/" ? "" : pathname}`;
  url.search = search;
  return NextResponse.redirect(url);
}

export const config = {
  // Skip Next internals, API routes, files with an extension, and the backend paths that
  // next.config.mjs passes through to the API when NEXT_PUBLIC_API_BASE=same-origin (v1/*, version).
  matcher: ["/((?!_next|api|v1/|v1$|version$|.*\\..*).*)"],
};
