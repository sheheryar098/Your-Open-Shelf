import Link from "next/link";
import { countryName, COUNTRY_CODES } from "@/shared/lib/countries";

export type Tone = "ok" | "warn" | "danger" | "info" | "accent" | "warm";

export function Badge({ children, tone }: { children: React.ReactNode; tone?: Tone }) {
  return <span className={`badge ${tone ? `badge-${tone}` : ""}`}>{children}</span>;
}

export function Stars({ value }: { value: number }) {
  const full = Math.round(value);
  return (
    <span className="stars" aria-label={`${value.toFixed(1)} out of 5`}>
      {"★".repeat(full)}
      {"☆".repeat(5 - full)}
    </span>
  );
}

export function CountrySelect({
  name = "country",
  defaultValue,
  required = true,
  only,
  id,
  includeBlank = true,
}: {
  name?: string;
  defaultValue?: string | null;
  required?: boolean;
  only?: string[];
  id?: string;
  includeBlank?: boolean;
}) {
  const codes = (only ?? COUNTRY_CODES).map((c) => ({ c, n: countryName(c) })).sort((a, b) => a.n.localeCompare(b.n));
  return (
    <select name={name} id={id ?? name} defaultValue={defaultValue ?? ""} required={required}>
      {includeBlank && <option value="">Choose a country…</option>}
      {codes.map(({ c, n }) => (
        <option key={c} value={c}>
          {n}
        </option>
      ))}
    </select>
  );
}

export function Empty({ children }: { children: React.ReactNode }) {
  return <div className="empty">{children}</div>;
}

/** "Show more" links for cursor-paginated lists. */
export function CursorPager({ nextHref, firstHref }: { nextHref: string | null; firstHref: string | null }) {
  if (!nextHref && !firstHref) return null;
  return (
    <nav className="pager" aria-label="Pagination">
      {firstHref && (
        <Link className="btn btn-sm" href={firstHref}>
          ← Back to start
        </Link>
      )}
      {nextHref && (
        <Link className="btn btn-sm" href={nextHref}>
          Show more →
        </Link>
      )}
    </nav>
  );
}

export function Tabs({
  items,
  current,
}: {
  items: { href: string; label: React.ReactNode; key: string }[];
  current: string;
}) {
  return (
    <nav className="tabs" aria-label="Sections">
      {items.map((i) => (
        <Link key={i.key} href={i.href} aria-current={i.key === current ? "page" : undefined}>
          {i.label}
        </Link>
      ))}
    </nav>
  );
}
