/**
 * A short list of supported countries (ISO-style names) for the
 * location picker on the edit-profile screen.
 *
 * Eventually this will be driven by a geo-detect call + a full IANA list,
 * but for MVP a curated subset is enough to ship the UX.
 */

export const COUNTRIES = [
  'India',
  'United States',
  'United Kingdom',
  'Canada',
  'Australia',
  'Germany',
  'France',
  'Italy',
  'Spain',
  'Netherlands',
  'Singapore',
  'Japan',
  'South Korea',
  'Brazil',
  'Mexico',
  'Argentina',
  'United Arab Emirates',
  'Saudi Arabia',
  'South Africa',
  'Nigeria',
  'Kenya',
  'Indonesia',
  'Philippines',
  'Vietnam',
  'Thailand',
  'Turkey',
  'Sweden',
  'Norway',
  'Denmark',
  'Finland',
] as const;

export type Country = (typeof COUNTRIES)[number];

/** ISO 3166-1 alpha-2 codes for the supported countries. */
const COUNTRY_ISO: Record<string, string> = {
  India: 'IN',
  'United States': 'US',
  'United Kingdom': 'GB',
  Canada: 'CA',
  Australia: 'AU',
  Germany: 'DE',
  France: 'FR',
  Italy: 'IT',
  Spain: 'ES',
  Netherlands: 'NL',
  Singapore: 'SG',
  Japan: 'JP',
  'South Korea': 'KR',
  Brazil: 'BR',
  Mexico: 'MX',
  Argentina: 'AR',
  'United Arab Emirates': 'AE',
  'Saudi Arabia': 'SA',
  'South Africa': 'ZA',
  Nigeria: 'NG',
  Kenya: 'KE',
  Indonesia: 'ID',
  Philippines: 'PH',
  Vietnam: 'VN',
  Thailand: 'TH',
  Turkey: 'TR',
  Sweden: 'SE',
  Norway: 'NO',
  Denmark: 'DK',
  Finland: 'FI',
};

const ISO_BY_LOWER = new Map(
  Object.entries(COUNTRY_ISO).map(([name, iso]) => [name.toLowerCase(), iso]),
);

/** ISO code for a country name (case-insensitive), or for an ISO code itself. */
export function countryIso(country?: string | null): string | undefined {
  const v = country?.trim();
  if (!v) return undefined;
  if (/^[A-Za-z]{2}$/.test(v)) return v.toUpperCase();
  return ISO_BY_LOWER.get(v.toLowerCase());
}

/**
 * The country's real flag as an emoji (regional-indicator pair, rendered
 * by the system emoji font on Android and iOS). Empty when unknown.
 */
export function countryFlag(country?: string | null): string {
  const iso = countryIso(country);
  if (!iso) return '';
  const A = 0x1f1e6;
  return String.fromCodePoint(
    A + iso.charCodeAt(0) - 65,
    A + iso.charCodeAt(1) - 65,
  );
}

/** "🇮🇳 India" style label; falls back to the plain name. */
export function withFlag(country?: string | null): string {
  if (!country) return '';
  const flag = countryFlag(country);
  return flag ? `${flag} ${country}` : country;
}
