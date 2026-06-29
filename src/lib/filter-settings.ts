import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { Json } from "@/integrations/supabase/types";
import type { Lead } from "./lead-types";
import { computeAdjustedScore } from "./score-adjust";
import {
  scoreRating,
  scoreReviews,
  scoreOwner,
  scoreDataDepth,
  scoreOpportunity,
  getSocialCount,
  getContactCount,
  hasValue,
} from "./lead-scoring";

export type FilterSettings = {
  minReviews: number;
  maxReviews: number;
  minRating: number;
  maxRating: number;
  activeOwnerDays: number;
  reviewsEnabled: boolean;
  ratingEnabled: boolean;
  ownerEnabled: boolean;
};

export const DEFAULT_FILTERS: FilterSettings = {
  minReviews: 20,
  maxReviews: 150,
  minRating: 4.2,
  maxRating: 4.8,
  activeOwnerDays: 60,
  reviewsEnabled: true,
  ratingEnabled: true,
  ownerEnabled: true,
};

const EVT = "lead-gen-filter-settings-changed";
const SETTINGS_KEY = "filter_settings";

let cachedSettings: FilterSettings = DEFAULT_FILTERS;
let settingsLoaded = false;

function coerceNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function coerceBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function normalizeFilterSettings(value: unknown): FilterSettings {
  const raw = value && typeof value === "object" ? (value as Partial<FilterSettings>) : {};
  return {
    minReviews: coerceNumber(raw.minReviews, DEFAULT_FILTERS.minReviews),
    maxReviews: coerceNumber(raw.maxReviews, DEFAULT_FILTERS.maxReviews),
    minRating: coerceNumber(raw.minRating, DEFAULT_FILTERS.minRating),
    maxRating: coerceNumber(raw.maxRating, DEFAULT_FILTERS.maxRating),
    activeOwnerDays: coerceNumber(raw.activeOwnerDays, DEFAULT_FILTERS.activeOwnerDays),
    reviewsEnabled: coerceBoolean(raw.reviewsEnabled, DEFAULT_FILTERS.reviewsEnabled),
    ratingEnabled: coerceBoolean(raw.ratingEnabled, DEFAULT_FILTERS.ratingEnabled),
    ownerEnabled: coerceBoolean(raw.ownerEnabled, DEFAULT_FILTERS.ownerEnabled),
  };
}

function emitSettingsChanged() {
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent(EVT));
}

export async function loadFilterSettings(): Promise<FilterSettings> {
  const { data, error } = await supabase
    .from("app_settings")
    .select("value")
    .eq("key", SETTINGS_KEY)
    .maybeSingle();
  if (error) throw error;
  cachedSettings = normalizeFilterSettings(data?.value);
  settingsLoaded = true;
  return cachedSettings;
}

export async function saveFilterSettings(s: FilterSettings): Promise<FilterSettings> {
  const next = normalizeFilterSettings(s);
  const previous = cachedSettings;
  cachedSettings = next;
  emitSettingsChanged();
  const { data, error } = await supabase
    .from("app_settings")
    .update({ value: next as unknown as Json })
    .eq("key", SETTINGS_KEY)
    .select("value")
    .single();
  if (error) {
    cachedSettings = previous;
    emitSettingsChanged();
    throw error;
  }
  cachedSettings = normalizeFilterSettings(data.value);
  settingsLoaded = true;
  emitSettingsChanged();
  return cachedSettings;
}

export function useFilterSettings(): [FilterSettings, (s: FilterSettings) => Promise<FilterSettings>, boolean] {
  const [s, setS] = useState<FilterSettings>(() => cachedSettings);
  const [loading, setLoading] = useState(!settingsLoaded);
  useEffect(() => {
    let cancelled = false;
    const sync = () => setS(cachedSettings);
    window.addEventListener(EVT, sync);
    setLoading(true);
    loadFilterSettings()
      .then((next) => {
        if (!cancelled) setS(next);
      })
      .catch(() => {
        if (!cancelled) setS(cachedSettings);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
      window.removeEventListener(EVT, sync);
    };
  }, []);
  const update = async (next: FilterSettings) => {
    const saved = await saveFilterSettings(next);
    setS(saved);
    return saved;
  };
  return [s, update, loading];
}

// ---- live re-evaluation (same logic as lead-scoring main filters) ----

function safeDate(v: unknown): Date | null {
  if (!v) return null;
  const d = new Date(v as string);
  return isNaN(d.getTime()) ? null : d;
}
function getOwnerUpdateDate(j: Record<string, unknown>): Date | null {
  const o = j.ownerUpdates as Record<string, unknown> | Record<string, unknown>[] | undefined;
  const first = Array.isArray(o) ? o[0] : o;
  const candidates = [
    first?.date,
    first?.updatedAt,
    j.ownerUpdateDate,
    j.lastOwnerUpdateDate,
    j.responseFromOwnerDate,
  ];
  for (const c of candidates) {
    const d = safeDate(c);
    if (d) return d;
  }
  return null;
}

export type Evaluation = {
  passed: boolean;
  rejectionReasons: string[];
  passesReviews: boolean;
  passesRating: boolean;
  activeOwner: boolean;
  ownerDays: number | null;
};

export function evaluateLead(lead: Lead, s: FilterSettings): Evaluation {
  const reviews = Number(lead.reviewsCount ?? 0);
  const rating = Number(lead.totalScore ?? 0);
  const ownerDate = getOwnerUpdateDate(lead as Record<string, unknown>);
  const storedOwnerDays = Number((lead as Record<string, unknown>).ownerUpdateAgeDays);
  const ownerDays = Number.isFinite(storedOwnerDays)
    ? storedOwnerDays
    : ownerDate === null
      ? null
      : Math.floor((Date.now() - ownerDate.getTime()) / 86400000);

  const passesReviews = !s.reviewsEnabled || (reviews >= s.minReviews && reviews <= s.maxReviews);
  const passesRating = !s.ratingEnabled || (rating >= s.minRating && rating <= s.maxRating);
  const activeOwner = !s.ownerEnabled || (ownerDays !== null && ownerDays <= s.activeOwnerDays);

  const rejectionReasons: string[] = [];
  if (s.reviewsEnabled && !passesReviews) {
    rejectionReasons.push(
      reviews < s.minReviews
        ? `reviews_too_low (${reviews} < ${s.minReviews})`
        : `reviews_too_high (${reviews} > ${s.maxReviews})`,
    );
  }
  if (s.ratingEnabled && !passesRating) {
    rejectionReasons.push(
      rating < s.minRating
        ? `rating_too_low (${rating} < ${s.minRating})`
        : `rating_too_high (${rating} > ${s.maxRating})`,
    );
  }
  if (s.ownerEnabled && !activeOwner) {
    rejectionReasons.push(
      ownerDays === null
        ? "no_owner_activity"
        : `owner_inactive (${ownerDays}d > ${s.activeOwnerDays}d)`,
    );
  }
  const passed = passesReviews && passesRating && activeOwner;
  return { passed, rejectionReasons, passesReviews, passesRating, activeOwner, ownerDays };
}

export function applyFiltersToLead(lead: Lead, s: FilterSettings): Lead {
  const e = evaluateLead(lead, s);
  // Live re-score from raw data using the user's CURRENT settings so the
  // displayed score stays in sync with the Settings page (reviews band,
  // rating band, active-owner threshold) instead of the value frozen at
  // scrape time.
  const j = lead as Record<string, unknown>;
  const reviewsCount = Number(j.reviewsCount ?? 0);
  const totalScore = Number(j.totalScore ?? 0);
  const ownerDate = getOwnerUpdateDate(j);

  let base = 0;
  base += s.reviewsEnabled ? scoreReviews(reviewsCount, s.minReviews, s.maxReviews) : 0;
  base += s.ratingEnabled ? scoreRating(totalScore, s.minRating, s.maxRating) : 0;
  base += s.ownerEnabled ? scoreOwner(ownerDate, s.activeOwnerDays) : 0;
  base += scoreDataDepth(j);
  base += scoreOpportunity(j);

  const socialCount = getSocialCount(j);
  const contactCount = getContactCount(j);
  base += socialCount > 0 ? Math.min(10, socialCount * 2) : -3;
  base += contactCount > 0 ? Math.min(10, contactCount * 2) : -3;
  if (hasValue(j.bookingLinks)) base += 6;
  if (Array.isArray(j.reviewsTags) && (j.reviewsTags as unknown[]).length > 0) base += 4;

  const websiteScore = (lead as Record<string, unknown>).websiteModernScore as
    | number
    | null
    | undefined;
  const { score, tier, bonus } = computeAdjustedScore(base, websiteScore);
  return {
    ...lead,
    passed: e.passed,
    rejectionReasons: e.rejectionReasons,
    leadScore: score,
    leadTier: tier,
    baseLeadScore: base,
    websiteScoreBonus: bonus,
  };
}