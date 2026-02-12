import { NextRequest, NextResponse } from "next/server";

const DEFAULT_API_ORIGIN = "https://financas-production-6edd.up.railway.app";
const LOVED_SUFFIXES = [".lovable.dev", ".lovableproject.com", ".lovable.app"];

function envIsTrue(name: string): boolean {
  return process.env[name]?.trim().toLowerCase() === "true";
}

function normalizeOrigin(origin: string | null): string | null {
  if (!origin) return null;
  try {
    const url = new URL(origin);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url.origin;
  } catch {
    return null;
  }
}

function parseAllowedOrigins(): string[] {
  const raw = process.env.CORS_ALLOWED_ORIGINS?.trim();
  if (!raw) return [];
  return raw
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function originHost(origin: string): string {
  return new URL(origin).hostname.toLowerCase();
}

function matchesAllowedPattern(origin: string, pattern: string): boolean {
  const normalized = normalizeOrigin(pattern);
  if (normalized) return origin === normalized;

  const host = originHost(origin);
  const lowerPattern = pattern.toLowerCase();
  if (!lowerPattern.startsWith("*.")) return false;
  const suffix = lowerPattern.slice(1);
  return host.endsWith(suffix);
}

function isStrictlyAllowed(origin: string): boolean {
  const host = originHost(origin);
  if (host === "localhost" || host === "127.0.0.1") return true;
  if (LOVED_SUFFIXES.some((suffix) => host.endsWith(suffix))) return true;
  const extra = parseAllowedOrigins();
  return extra.some((pattern) => matchesAllowedPattern(origin, pattern));
}

function fallbackOrigin(): string {
  return (
    normalizeOrigin(process.env.CORS_FALLBACK_ORIGIN ?? null) ??
    normalizeOrigin(process.env.APP_BASE_URL ?? null) ??
    DEFAULT_API_ORIGIN
  );
}

function resolveOrigin(origin: string | null): string {
  const normalized = normalizeOrigin(origin);
  if (!normalized) return "*";

  const strictMode = envIsTrue("CORS_STRICT_MODE");
  if (!strictMode) return normalized;
  if (isStrictlyAllowed(normalized)) return normalized;
  return fallbackOrigin();
}

function corsHeaders(origin: string | null): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": resolveOrigin(origin),
    "Access-Control-Allow-Methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin"
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
