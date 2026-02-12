import { AppError } from "@/lib/errors";

const TOKEN_HEADER = "X-APP-TOKEN";

function readEnvRequired(name: string) {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new AppError(
      `Variavel obrigatoria ausente para sync mobile: ${name}`,
      500,
      "MOBILE_SYNC_ENV_MISSING"
    );
  }
  return value;
}

function normalizeBaseUrl(baseUrl: string) {
  return baseUrl.trim().replace(/\/+$/, "");
}

function withRouteQuery(baseUrl: string, endpoint: string) {
  const separator = baseUrl.includes("?") ? "&" : "?";
  return `${baseUrl}${separator}route=${encodeURIComponent(endpoint)}`;
}

function buildEndpointCandidates(baseUrl: string, endpoint: string) {
  const normalized = normalizeBaseUrl(baseUrl);
  const directPath = `${normalized}/${endpoint}`;
  const routeQuery = withRouteQuery(normalized, endpoint);

  if (directPath === routeQuery) return [directPath];
  return [directPath, routeQuery];
}

async function safeReadBody(response: Response) {
  const text = await response.text();
  if (!text.trim()) return null;

  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

export async function requestAppsScript(endpoint: string, init?: RequestInit) {
  const baseUrl = readEnvRequired("APPS_SCRIPT_WEB_APP_URL");
  const appToken = readEnvRequired("APPS_SCRIPT_APP_TOKEN");
  const candidates = buildEndpointCandidates(baseUrl, endpoint);

  let lastError: unknown = null;

  for (const url of candidates) {
    try {
      const response = await fetch(url, {
        ...init,
        headers: {
          "Content-Type": "application/json",
          [TOKEN_HEADER]: appToken,
          ...(init?.headers ?? {})
        },
        cache: "no-store"
      });

      const body = await safeReadBody(response);

      if (!response.ok) {
        const message =
          body && typeof body === "object" && "message" in body && typeof body.message === "string"
            ? body.message
            : `Apps Script retornou ${response.status}`;
        lastError = new AppError(message, 502, "APPS_SCRIPT_HTTP_ERROR", {
          endpoint,
          url,
          status: response.status,
          body
        });
        continue;
      }

      return {
        url,
        body
      };
    } catch (error) {
      lastError = error;
    }
  }

  throw new AppError("Falha ao conectar no Apps Script Web App", 502, "APPS_SCRIPT_UNAVAILABLE", {
    endpoint,
    cause: lastError instanceof Error ? lastError.message : String(lastError ?? "unknown")
  });
}
