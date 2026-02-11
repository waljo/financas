import { NextRequest, NextResponse } from "next/server";

function resolveOrigin(origin: string | null): string {
  if (!origin) return "*";
  if (origin.endsWith(".lovable.dev")) return origin;
  if (origin.endsWith(".lovableproject.com")) return origin;
  return "https://financas-production-6edd.up.railway.app";
}

function corsHeaders(origin: string | null): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": resolveOrigin(origin),
    "Access-Control-Allow-Methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Max-Age": "86400"
  };
}

export function middleware(req: NextRequest) {
  const origin = req.headers.get("origin");

  if (req.method === "OPTIONS") {
    return new NextResponse(null, { status: 204, headers: corsHeaders(origin) });
  }

  const res = NextResponse.next();
  for (const [key, value] of Object.entries(corsHeaders(origin))) {
    res.headers.set(key, value);
  }
  return res;
}

export const config = {
  matcher: "/api/:path*"
};
