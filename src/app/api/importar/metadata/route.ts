import { detectMonthBlocks } from "@/lib/sheets/legacyImporter";
import { listSheetNames, readSheetRaw } from "@/lib/sheets/sheetsClient";
import { jsonError, jsonOk } from "@/lib/http";

export const runtime = "nodejs";

export async function GET() {
  try {
    const sheetNames = await listSheetNames();

    const legacyCandidates = sheetNames.filter((name) => /^\d{4}$/.test(name));
    const metadata = await Promise.all(
      legacyCandidates.map(async (sheetName) => {
        const firstRowOnly = await readSheetRaw(sheetName, "A1:ZZ1");
        const firstRow = firstRowOnly[0] ?? [];
        const monthBlocks = detectMonthBlocks(firstRow);

        return {
          sheetName,
          monthBlocks
        };
      })
    );

    return jsonOk({
      data: {
        sheetNames,
        legacyCandidates: metadata
      }
    });
  } catch (error) {
    return jsonError(error);
  }
}
