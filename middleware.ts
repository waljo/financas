import { NextRequest, NextResponse } from "next/server";

function readBasicAuthConfig() {
  const user = process.env.APP_BASIC_AUTH_USER?.trim();
  const pass = process.env.APP_BASIC_AUTH_PASS?.trim();
  if (!user || !pass) return null;
  return { user, pass };
}

function unauthorized() {
  return new NextResponse("Unauthorized", {
    status: 401,
    headers: {
      "WWW-Authenticate": 'Basic realm="FinancasG", charset="UTF-8"'
    }
  });
}

function shouldBypass(pathname: string): boolean {
  if (pathname.startsWith("/_next/")) return true;
  if (pathname === "/favicon.ico") return true;
  if (pathname === "/api/health") return true;
  if (pathname === "/sw.js") return true;
  if (pathname === "/manifest.webmanifest") return true;
  return false;
}

export function middleware(request: NextRequest) {
  const config = readBasicAuthConfig();
  if (!config) return NextResponse.next();

  const { pathname } = request.nextUrl;
  if (shouldBypass(pathname)) return NextResponse.next();

  const auth = request.headers.get("authorization");
  if (!auth?.startsWith("Basic ")) {
    return unauthorized();
  }

  const encoded = auth.slice("Basic ".length).trim();
  let decoded = "";
  try {
    decoded = atob(encoded);
  } catch {
    return unauthorized();
  }

  const separatorIndex = decoded.indexOf(":");
  if (separatorIndex < 0) {
    return unauthorized();
  }

  const user = decoded.slice(0, separatorIndex);
  const pass = decoded.slice(separatorIndex + 1);
  if (user !== config.user || pass !== config.pass) {
    return unauthorized();
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/:path*"]
};
