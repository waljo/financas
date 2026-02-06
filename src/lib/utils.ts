import { AppError } from "@/lib/errors";

export function parseNumber(value: unknown, fallback = 0): number {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : fallback;
  }

  if (typeof value !== "string") {
    return fallback;
  }

  const compact = value.replace(/\s/g, "");
  let normalized = compact;

  if (compact.includes(",") && compact.includes(".")) {
    // Formato comum pt-BR: 12.345,67
    normalized = compact.replace(/\./g, "").replace(",", ".");
  } else if (compact.includes(",")) {
    // Formato com virgula decimal: 123,45
    normalized = compact.replace(",", ".");
  }

  normalized = normalized.replace(/[^0-9.-]/g, "");

  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function parseBoolean(value: unknown): boolean {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    return ["true", "1", "sim", "yes", "y"].includes(normalized);
  }
  return false;
}

export function parseCsvNumbers(value: string): number[] {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => Number(item))
    .filter((item) => Number.isFinite(item))
    .map((item) => Math.trunc(item));
}

export function toIsoNow(): string {
  return new Date().toISOString();
}

export function ymFromDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new AppError(`Data invalida: ${value}`, 400, "INVALID_DATE");
  }
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

export function monthLabel(month: string): string {
  const [year, mon] = month.split("-").map((item) => Number(item));
  if (!year || !mon) {
    return month;
  }
  return `${String(mon).padStart(2, "0")}/${year}`;
}
