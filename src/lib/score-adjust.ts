// Boost a lead's score based on website modernity.
// Outdated sites = bigger opportunity = higher score bonus.
// Mapping: 1→+30, 2→+25, 3→+20, 4→+16, 5→+12, 6→+8, 7→+5, 8→+2, 9→+1, 10→0.
const BONUS_TABLE: Record<number, number> = {
  1: 30, 2: 25, 3: 20, 4: 16, 5: 12, 6: 8, 7: 5, 8: 2, 9: 1, 10: 0,
};
export function websiteScoreBonus(websiteScore: number | null | undefined): number {
  if (typeof websiteScore !== "number" || !Number.isFinite(websiteScore)) return 0;
  const s = Math.max(1, Math.min(10, Math.round(websiteScore)));
  return BONUS_TABLE[s] ?? 0;
}

export function adjustedTier(score: number): string {
  if (score >= 85) return "Hot";
  if (score >= 70) return "Warm";
  if (score >= 50) return "Mild";
  return "Cold";
}

export function computeAdjustedScore(
  baseScore: number | null | undefined,
  websiteScore: number | null | undefined,
): { score: number; tier: string; bonus: number } {
  const base = typeof baseScore === "number" && Number.isFinite(baseScore) ? baseScore : 0;
  const bonus = websiteScoreBonus(websiteScore);
  const score = base + bonus;
  return { score, tier: adjustedTier(score), bonus };
}