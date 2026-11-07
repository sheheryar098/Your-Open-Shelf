import "server-only";
import { cookies, headers } from "next/headers";
import { isCountryCode } from "@/shared/lib/countries";

export const COUNTRY_COOKIE = "yos_country";

/**
 * Best-guess country for a first-time visitor. Reads common CDN/edge geolocation headers and falls
 * back to the browser's Accept-Language region. Never treated as proof of residence.
 */
export async function suggestedCountry(): Promise<string | null> {
  const h = await headers();
  for (const name of [
    "x-vercel-ip-country",
    "cf-ipcountry",
    "cloudfront-viewer-country",
    "x-country-code",
    "x-appengine-country",
  ]) {
    const v = h.get(name)?.toUpperCase();
    if (v && isCountryCode(v)) return v;
  }
  const lang = h.get("accept-language") ?? "";
  const m = lang.match(/[a-z]{2,3}-([A-Z]{2})/);
  if (m && isCountryCode(m[1])) return m[1];
  return null;
}

/** The visitor's confirmed country preference, if any. */
export async function chosenCountry(): Promise<string | null> {
  const v = (await cookies()).get(COUNTRY_COOKIE)?.value?.toUpperCase();
  return v && isCountryCode(v) ? v : null;
}
