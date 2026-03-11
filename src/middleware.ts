import { NextRequest, NextResponse } from "next/server";

const BASE_ALLOWED_ORIGINS = [
  "http://localhost:3000",
  "http://localhost:5173",
  "http://localhost:8081",
  "https://waljofin.lovable.app",
  "https://lovable.app"
];

function parseEnvOrigins(): string[] {
  const raw = process.env.CORS_ALLOWED_ORIGINS?.trim();
  if (!raw) return [];
  return raw
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function isAllowedOrigin(origin: string): boolean {
  if (BASE_ALLOWED_ORIGINS.includes(origin)) return true;
  if (parseEnvOrigins().includes(origin)) return true;

  try {
    const { protocol, hostname } = new URL(origin);
    if (protocol !== "https:" && protocol !== "http:") return false;

    // Aceita subdominios gerados pelo Lovable (preview/publish).
    if (hostname === "lovable.app" || hostname.endsWith(".lovable.app")) {
      return true;
    }
  } catch {
    return false;
  }

  return false;
}

function appendCorsHeaders(response: NextResponse, origin: string): NextResponse {
  response.headers.set("Access-Control-Allow-Origin", origin);
  response.headers.set("Access-Control-Allow-Methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS");
  response.headers.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
  response.headers.set("Access-Control-Max-Age", "86400");
  response.headers.set("Vary", "Origin");
  return response;
}

export function middleware(request: NextRequest): NextResponse {
  const origin = request.headers.get("origin");
  const allowedOrigin = origin && isAllowedOrigin(origin) ? origin : "";
  const isApiRoute = request.nextUrl.pathname.startsWith("/api/");

  if (!isApiRoute) {
    return NextResponse.next();
  }

  if (request.method === "OPTIONS") {
    const response = new NextResponse(null, { status: 204 });
    if (allowedOrigin) {
      return appendCorsHeaders(response, allowedOrigin);
    }
    return response;
  }

  const response = NextResponse.next();
  if (allowedOrigin) {
    return appendCorsHeaders(response, allowedOrigin);
  }
  return response;
}

export const config = {
  matcher: ["/api/:path*"]
};
