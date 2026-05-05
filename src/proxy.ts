import { NextRequest, NextResponse } from "next/server";

const CANONICAL_HOST = "indy-concert-aggregator-t288.vercel.app";
const VERCEL_PROJECT_HOST_PATTERN = /^indy-concert-aggregator(?:-[a-z0-9]+)?\.vercel\.app$/;

export function proxy(request: NextRequest) {
  const host = request.headers.get("host")?.toLowerCase().split(":")[0];

  if (!host || host === CANONICAL_HOST || !VERCEL_PROJECT_HOST_PATTERN.test(host)) {
    return NextResponse.next();
  }

  const url = request.nextUrl.clone();
  url.hostname = CANONICAL_HOST;
  url.protocol = "https";
  url.port = "";

  return NextResponse.redirect(url, 308);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"]
};
