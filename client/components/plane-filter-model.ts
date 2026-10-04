/**
 * Send-screen filter model: chip options, conversion to the API shape,
 * human-readable summary, and "remember last used" persistence.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

import { COUNTRIES, withFlag } from '@/lib/countries';
import type { SentPlane } from '@/types/sent-plane';

export type GenderOption = 'any' | 'female' | 'male' | 'non-binary';
export type AgeOption = 'any' | '18-24' | '25-34' | '35-44' | '45+';
export type DistanceOption = 'anywhere' | '5' | '25' | '100' | '500';

export type PlaneFilterState = {
  gender: GenderOption;
  age: AgeOption;
  distance: DistanceOption;
  /** null = Anywhere */
  country: string | null;
};

export type ChipOption<T extends string> = { value: T; label: string };

export const DEFAULT_FILTERS: PlaneFilterState = {
  gender: 'any',
  age: 'any',
  distance: 'anywhere',
  country: null,
};

export const GENDER_OPTIONS: ChipOption<GenderOption>[] = [
  { value: 'any', label: 'Any' },
  { value: 'female', label: 'Female' },
  { value: 'male', label: 'Male' },
  { value: 'non-binary', label: 'Non-binary' },
];

export const AGE_OPTIONS: ChipOption<AgeOption>[] = [
  { value: 'any', label: 'Any' },
  { value: '18-24', label: '18–24' },
  { value: '25-34', label: '25–34' },
  { value: '35-44', label: '35–44' },
  { value: '45+', label: '45+' },
];

export const DISTANCE_OPTIONS: ChipOption<DistanceOption>[] = [
  { value: '5', label: '5 km' },
  { value: '25', label: '25 km' },
  { value: '100', label: '100 km' },
  { value: '500', label: '500 km' },
  { value: 'anywhere', label: 'Anywhere' },
];

const AGE_RANGES: Record<Exclude<AgeOption, 'any'>, [number, number]> = {
  '18-24': [18, 24],
  '25-34': [25, 34],
  '35-44': [35, 44],
  '45+': [45, 99],
};

/** API filters — keys omitted for "Any / Anywhere". */
export function toApiFilters(f: PlaneFilterState): NonNullable<SentPlane['filters']> {
  const out: NonNullable<SentPlane['filters']> = {};
  if (f.gender !== 'any') out.gender = f.gender;
  if (f.age !== 'any') out.ageRange = AGE_RANGES[f.age];
  if (f.distance !== 'anywhere') out.radiusKm = Number(f.distance);
  if (f.country) out.country = f.country;
  return out;
}

export function isDefaultFilters(f: PlaneFilterState): boolean {
  return (
    f.gender === 'any' &&
    f.age === 'any' &&
    f.distance === 'anywhere' &&
    f.country === null
  );
}

export function summarizeFilters(f: PlaneFilterState): string {
  const who =
    f.gender === 'any'
      ? 'Anyone'
      : (GENDER_OPTIONS.find((o) => o.value === f.gender)?.label ?? 'Anyone');
  const parts = [who];
  if (f.age !== 'any') parts.push(AGE_OPTIONS.find((o) => o.value === f.age)!.label);
  if (f.distance !== 'anywhere') parts.push(`within ${f.distance} km`);
  if (f.country) parts.push(`in ${withFlag(f.country)}`);
  if (f.distance === 'anywhere' && !f.country) parts.push('anywhere');
  return parts.join(' · ');
}

/** Compact label for filters stored on a sent plane, e.g. "Female · 45+ · ≤ 25 km". */
export function describeSentFilters(filters: SentPlane['filters']): string | null {
  if (!filters) return null;
  const parts: string[] = [];
  if (filters.gender && filters.gender !== 'any') {
    parts.push(GENDER_OPTIONS.find((o) => o.value === filters.gender)?.label ?? filters.gender);
  }
  if (filters.ageRange) {
    const [a, b] = filters.ageRange;
    parts.push(b >= 99 ? `${a}+` : `${a}–${b}`);
  }
  if (filters.radiusKm) parts.push(`≤ ${filters.radiusKm} km`);
  if (filters.country) parts.push(filters.country);
  return parts.length ? parts.join(' · ') : null;
}

// ── Persistence ─────────────────────────────────────────────────────────────

const STORAGE_KEY = 'swing/v1/send/filters';

function pick<T extends string>(v: unknown, opts: ChipOption<T>[], fallback: T): T {
  return opts.some((o) => o.value === v) ? (v as T) : fallback;
}

export async function loadSavedFilters(): Promise<PlaneFilterState | null> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as Partial<PlaneFilterState>;
    return {
      gender: pick(v.gender, GENDER_OPTIONS, 'any'),
      age: pick(v.age, AGE_OPTIONS, 'any'),
      distance: pick(v.distance, DISTANCE_OPTIONS, 'anywhere'),
      country:
        typeof v.country === 'string' &&
        (COUNTRIES as readonly string[]).includes(v.country)
          ? v.country
          : null,
    };
  } catch {
    return null;
  }
}

export async function saveFilters(f: PlaneFilterState): Promise<void> {
  try {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(f));
  } catch {
    /* best-effort */
  }
}
