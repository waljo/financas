function normalizeBaseUrl(baseUrl) {
  const trimmed = String(baseUrl ?? "").trim();
  if (!trimmed) {
    throw new Error("Informe a URL base do backend.");
  }
  return trimmed.replace(/\/+$/, "");
}

async function safeJson(response) {
  const text = await response.text();
  if (!text.trim()) return null;
  try {
    return JSON.parse(text);
  } catch {
    return { message: text };
  }
}

function errorMessageFromPayload(payload, fallbackMessage) {
  if (payload && typeof payload === "object" && typeof payload.message === "string") {
    return payload.message;
  }
  return fallbackMessage;
}

export async function getJson(baseUrl, path) {
  const url = `${normalizeBaseUrl(baseUrl)}${path}`;
  const response = await fetch(url);
  const payload = await safeJson(response);
  if (!response.ok) {
    throw new Error(errorMessageFromPayload(payload, `Falha no GET ${path}`));
  }
  return payload;
}

export async function postJson(baseUrl, path, body) {
  const url = `${normalizeBaseUrl(baseUrl)}${path}`;
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  const payload = await safeJson(response);
  if (!response.ok) {
    throw new Error(errorMessageFromPayload(payload, `Falha no POST ${path}`));
  }
  return payload;
}

