import { getJson } from "../api/backend";
import { initDb, replaceFromBootstrapData, setSyncState } from "../db/store";

export async function bootstrapNow(baseUrl, options = {}) {
  const includeInactiveCategories =
    Object.prototype.hasOwnProperty.call(options, "includeInactiveCategories")
      ? Boolean(options.includeInactiveCategories)
      : true;

  await initDb();

  const query = includeInactiveCategories ? "1" : "0";
  const payload = await getJson(
    baseUrl,
    `/api/mobile/bootstrap?include_inactive_categories=${query}`
  );

  if (!payload || payload.ok !== true || !payload.data) {
    throw new Error("Resposta invalida do bootstrap.");
  }

  await replaceFromBootstrapData(payload.data);
  await setSyncState({
    last_sync_status: "success",
    last_sync_error: null
  });

  return payload;
}

