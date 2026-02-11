const apiBase = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.trim() ?? "";

function buildUrl(path: string): string {
  if (!apiBase) return path;
  const prefix = apiBase.endsWith("/") ? apiBase.slice(0, -1) : apiBase;
  return `${prefix}${path.startsWith("/") ? path : `/${path}`}`;
}

export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(buildUrl(path), {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {})
    }
  });

  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.message ?? "Erro de comunicação com API");
  }

  return payload as T;
}
