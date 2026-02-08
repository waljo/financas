export function normalizeCategorySlug(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();
}

export function normalizeCategoryName(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}
