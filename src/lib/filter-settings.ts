import { useEffect, useState } from "react";
import type { Lead } from "./lead-types";

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

const KEY = "lead-gen-filter-settings-v1";
const EVT = "lead-gen-filter-settings-changed";

export function loadFilterSettings(): FilterSettings {
  if (typeof window === "undefined") return DEFAULT_FILTERS;
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return DEFAULT_FILTERS;
    const parsed = JSON.parse(raw) as Partial<FilterSettings>;
    return { ...DEFAULT_FILTERS, ...parsed };
  } catch {
    return DEFAULT_FILTERS;
  }
}

export function saveFilterSettings(s: FilterSettings) {
  if (typeof window === "undefined") return;
  localStorage.setItem(KEY, JSON.stringify(s));
  window.dispatchEvent(new CustomEvent(EVT));
}

export function useFilterSettings(): [FilterSettings, (s: FilterSettings) => void] {
  const [s, setS] = useState<FilterSettings>(() => loadFilterSettings());
  useEffect(() => {
    const sync = () => setS(loadFilterSettings());
    window.addEventListener(EVT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(EVT, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);
  const update = (next: FilterSettings) => {
    saveFilterSettings(next);
    setS(next);
  };
  return [s, update];
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
  const ownerDays =
    ownerDate === null ? null : Math.floor((Date.now() - ownerDate.getTime()) / 86400000);

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
  return { ...lead, passed: e.passed, rejectionReasons: e.rejectionReasons };
}