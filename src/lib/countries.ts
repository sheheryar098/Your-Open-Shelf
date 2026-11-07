/** ISO 3166-1 alpha-2 codes. Names come from Intl.DisplayNames so they can be localized. */
export const COUNTRY_CODES = (
  "AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ " +
  "CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR " +
  "GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO " +
  "JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR " +
  "MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO " +
  "RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV " +
  "TW TZ UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW"
).split(" ");

const CURRENCY: Record<string, string> = {
  US: "USD", GB: "GBP", CA: "CAD", AU: "AUD", NZ: "NZD", IE: "EUR", DE: "EUR", FR: "EUR", NL: "EUR",
  ES: "EUR", IT: "EUR", PT: "EUR", BE: "EUR", AT: "EUR", FI: "EUR", IN: "INR", PK: "PKR", JP: "JPY",
  SG: "SGD", ZA: "ZAR", NG: "NGN", KE: "KES", SE: "SEK", NO: "NOK", DK: "DKK", CH: "CHF", BR: "BRL", MX: "MXN",
};

const displayNames = new Intl.DisplayNames(["en"], { type: "region" });

export function countryName(code: string | null | undefined, locale = "en"): string {
  if (!code) return "";
  try {
    if (locale === "en") return displayNames.of(code.toUpperCase()) ?? code;
    return new Intl.DisplayNames([locale], { type: "region" }).of(code.toUpperCase()) ?? code;
  } catch {
    return code;
  }
}

export function defaultCurrency(code: string): string | null {
  return CURRENCY[code] ?? null;
}

export function isCountryCode(code: unknown): code is string {
  return typeof code === "string" && COUNTRY_CODES.includes(code.toUpperCase());
}

/** Localized labels for address fields (§4.4). Defaults cover most countries. */
export function addressLabels(code: string | null | undefined) {
  switch (code) {
    case "US": return { region: "State", postal: "ZIP code", regionRequired: true, postalRequired: true };
    case "CA": return { region: "Province / territory", postal: "Postal code", regionRequired: true, postalRequired: true };
    case "AU": return { region: "State / territory", postal: "Postcode", regionRequired: true, postalRequired: true };
    case "GB": return { region: "County (optional)", postal: "Postcode", regionRequired: false, postalRequired: true };
    case "IE": return { region: "County", postal: "Eircode", regionRequired: false, postalRequired: false };
    case "NZ": return { region: "Region (optional)", postal: "Postcode", regionRequired: false, postalRequired: true };
    case "IN": return { region: "State", postal: "PIN code", regionRequired: true, postalRequired: true };
    case "JP": return { region: "Prefecture", postal: "Postal code", regionRequired: true, postalRequired: true };
    default: return { region: "State / province / region", postal: "Postal code", regionRequired: false, postalRequired: false };
  }
}

export function formatMoney(amount: number | string | null, currency: string | null, locale = "en"): string {
  if (amount === null || amount === undefined || !currency) return "";
  try {
    return new Intl.NumberFormat(locale, { style: "currency", currency }).format(Number(amount));
  } catch {
    return `${amount} ${currency}`;
  }
}
