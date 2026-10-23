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
  // Skip Next internals, API routes and files with an extension.
  matcher: ["/((?!_next|api|.*\\..*).*)"],
};
