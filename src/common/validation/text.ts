export function normalizeText(value: string): string {
  return value.normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase();
}

export function escapeSearch(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function normalizePhone(value: string): string {
  return normalizeText(value).replace(/[\s()+.-]/g, "");
}
