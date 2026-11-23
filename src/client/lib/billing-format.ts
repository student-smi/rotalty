export function formatINR(paise: number) {
  const rupees = paise / 100;
  return rupees.toLocaleString("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: rupees % 1 ? 2 : 0 });
}

export function formatUsdMicro(micro: number) {
  return `$${(micro / 1_000_000).toFixed(micro >= 10_000_000 ? 2 : 4)}`;
}

export function formatShortDate(isoDay: string) {
  const d = new Date(`${isoDay}T00:00:00Z`);
  return d.toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "UTC" });
}

export function formatMonth(yyyyMm: string) {
  const d = new Date(`${yyyyMm}-01T00:00:00Z`);
  return d.toLocaleDateString("en-IN", { month: "short", year: "2-digit", timeZone: "UTC" });
}

export function formatDateIN(value: string | number | Date | null | undefined) {
  if (value === null || value === undefined) return "—";
  return new Date(value).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

export function formatDateTimeIN(value: string | number | Date | null | undefined) {
  if (value === null || value === undefined) return "—";
  return new Date(value).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
}

export const num = (n: number | null | undefined) => (n ?? 0).toLocaleString("en-IN");
