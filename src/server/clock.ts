/** Overridable clock so deadline logic can be tested deterministically. */
let override: Date | null = null;

export function now(): Date {
  return override ? new Date(override) : new Date();
}

export function setNow(d: Date | null) {
  override = d;
}

export function addDays(d: Date, days: number): Date {
  return new Date(d.getTime() + days * 86_400_000);
}

export function addHours(d: Date, hours: number): Date {
  return new Date(d.getTime() + hours * 3_600_000);
}

/** Adds business days (Mon–Fri), keeping the time of day. Holidays are handled via support extensions. */
export function addBusinessDays(d: Date, days: number): Date {
  const out = new Date(d);
  let added = 0;
  while (added < days) {
    out.setUTCDate(out.getUTCDate() + 1);
    const dow = out.getUTCDay();
    if (dow !== 0 && dow !== 6) added++;
  }
  return out;
}
