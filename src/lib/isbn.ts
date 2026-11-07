export function normalizeIsbn(raw: string): string {
  return raw.replace(/[\s-]/g, "").toUpperCase();
}

export function isValidIsbn10(isbn: string): boolean {
  if (!/^\d{9}[\dX]$/.test(isbn)) return false;
  let sum = 0;
  for (let i = 0; i < 10; i++) {
    const v = isbn[i] === "X" ? 10 : Number(isbn[i]);
    sum += v * (10 - i);
  }
  return sum % 11 === 0;
}

export function isValidIsbn13(isbn: string): boolean {
  if (!/^\d{13}$/.test(isbn)) return false;
  let sum = 0;
  for (let i = 0; i < 13; i++) sum += Number(isbn[i]) * (i % 2 === 0 ? 1 : 3);
  return sum % 10 === 0;
}

export function isbn10to13(isbn10: string): string {
  const core = "978" + isbn10.slice(0, 9);
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += Number(core[i]) * (i % 2 === 0 ? 1 : 3);
  return core + ((10 - (sum % 10)) % 10);
}

/** Returns a canonical ISBN-13 for a valid ISBN-10/13, or null. */
export function toIsbn13(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const n = normalizeIsbn(raw);
  if (isValidIsbn13(n)) return n;
  if (isValidIsbn10(n)) return isbn10to13(n);
  return null;
}

export function looksLikeIsbn(raw: string): boolean {
  const n = normalizeIsbn(raw);
  return /^(\d{9}[\dX]|\d{13})$/.test(n);
}
