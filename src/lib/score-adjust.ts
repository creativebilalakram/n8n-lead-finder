// Boost a lead's score based on website modernity.
// Outdated sites = bigger opportunity = higher score bonus.
// Mapping (websiteScore -> bonus): 1->+27, 2->+24, 3->+21, 4->+18, 5->+15,
// 6->+9, 7->+6, 8->+3, 9->+1, 10->0.
export function websiteScoreBonus(websiteScore: number | null | undefined): number {
  if (typeof websiteScore !== "number" || !Number.isFinite(websiteScore)) return 0;
  const s = Math.max(1, Math.min(10, Math.round(websiteScore)));
  if (s >= 10) return 0;
  if (s >= 6) return (10 - s) * 3; // 9->3, 8->6, 7->9, 6->12 ... wait
  // outdated tier (1-5): bigger jumps
  return 15 + (6 - s) * 3; // 5->15, 4->18, 3->21, 2->24, 1->27
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