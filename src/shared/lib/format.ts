export function fmtDate(d: Date | string | null | undefined, tz = "UTC", locale = "en-GB"): string {
  if (!d) return "";
  return new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", year: "numeric", timeZone: tz }).format(
    new Date(d),
  );
}

export function fmtDateTime(d: Date | string | null | undefined, tz = "UTC", locale = "en-GB"): string {
  if (!d) return "";
  return new Intl.DateTimeFormat(locale, {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: tz,
    timeZoneName: "short",
  }).format(new Date(d));
}

export function relative(d: Date | string | null | undefined, from = new Date()): string {
  if (!d) return "";
  const diff = new Date(d).getTime() - from.getTime();
  const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
  const abs = Math.abs(diff);
  if (abs < 3_600_000) return rtf.format(Math.round(diff / 60_000), "minute");
  if (abs < 86_400_000) return rtf.format(Math.round(diff / 3_600_000), "hour");
  return rtf.format(Math.round(diff / 86_400_000), "day");
}

export function plural(n: number, word: string, pluralWord = `${word}s`) {
  return `${n} ${n === 1 ? word : pluralWord}`;
}

export function shortId(id: string) {
  return id.slice(0, 8).toUpperCase();
}

export function authorsText(a: string[] | null | undefined) {
  return (a ?? []).join(", ");
}
