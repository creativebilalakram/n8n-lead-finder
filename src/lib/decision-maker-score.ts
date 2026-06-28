// Ported verbatim from the n8n Code node.
// Filters + dedupes + scores LinkedIn decision-maker candidates.

export type DMCandidate = {
  personName?: string;
  personTitle?: string;
  personProfileUrl?: string;
  confidence?: string;
  [k: string]: unknown;
};

export const RELEVANT_KEYWORDS = [
  "owner","founder","co-founder","ceo","president","principal","partner",
  "director","marketing","creative","content","brand","operations","manager",
  "office manager","practice manager","dentist","doctor","implant","cosmetic",
  "lead","head",
];

export const BLACKLIST_KEYWORDS = [
  "sales development","sales representative","account executive",
  "appointment setter","business development representative","bdr","sdr",
  "recruiter","intern",
];

export function scoreCandidate(p: DMCandidate): number {
  const name = (p.personName || "").toLowerCase();
  const title = (p.personTitle || "").toLowerCase();
  let s = 0;
  if (name.includes("alecia hardy")) s += 100;
  if (title.includes("owner")) s += 90;
  if (title.includes("founder")) s += 85;
  if (title.includes("ceo")) s += 80;
  if (title.includes("president")) s += 80;
  if (title.includes("director")) s += 60;
  if (title.includes("practice manager")) s += 55;
  if (title.includes("office manager")) s += 50;
  if (title.includes("operations")) s += 50;
  if (title.includes("marketing")) s += 45;
  if (title.includes("creative")) s += 40;
  if (title.includes("content")) s += 35;
  if (title.includes("dentist")) s += 30;
  if (title.includes("implant")) s += 20;
  if (title.includes("cosmetic")) s += 20;
  return s;
}

export function priorityForScore(score: number): "High" | "Medium" | "Low" {
  if (score >= 70) return "High";
  if (score >= 40) return "Medium";
  return "Low";
}

export function filterAndScore(people: DMCandidate[]): Array<DMCandidate & { decisionMakerScore: number; priority: "High" | "Medium" | "Low" }> {
  const filtered = people.filter((p) => {
    const name = (p.personName || "").toLowerCase();
    const title = (p.personTitle || "").toLowerCase();
    const conf = (p.confidence || "").toLowerCase();
    if (!name) return false;
    if (name.includes("alecia hardy")) return true;
    if (BLACKLIST_KEYWORDS.some((k) => title.includes(k))) return false;
    if ((conf === "high" || conf === "medium") && RELEVANT_KEYWORDS.some((k) => title.includes(k))) return true;
    return false;
  });

  const seen = new Set<string>();
  const unique = filtered.filter((p) => {
    const key = p.personProfileUrl || `${p.personName}-${p.personTitle}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  return unique
    .map((p) => {
      const sc = scoreCandidate(p);
      return { ...p, decisionMakerScore: sc, priority: priorityForScore(sc) };
    })
    .sort((a, b) => b.decisionMakerScore - a.decisionMakerScore);
}

export function normalizeBusinessKey(name: string, website?: string | null): string {
  const host = (website || "")
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .split("/")[0]
    .trim();
  if (host) return `host:${host}`;
  return `name:${name.toLowerCase().trim()}`;
}