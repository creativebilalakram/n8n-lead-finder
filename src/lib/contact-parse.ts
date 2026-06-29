// Pure helpers for parsing ContactOut / raw pasted text into structured fields.

const EMAIL_RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
const PHONE_RE = /(\+?\d[\d\s().-]{7,}\d)/g;
const LINKEDIN_RE = /https?:\/\/(?:[a-z]{2,3}\.)?linkedin\.com\/in\/([A-Za-z0-9\-_%]+)\/?/i;
const LINKEDIN_CO_RE = /https?:\/\/(?:[a-z]{2,3}\.)?linkedin\.com\/company\/([A-Za-z0-9\-_%]+)\/?/i;
const INSTAGRAM_RE = /https?:\/\/(?:www\.)?instagram\.com\/([A-Za-z0-9._]+)\/?/i;
const FACEBOOK_RE = /https?:\/\/(?:www\.|web\.|m\.)?facebook\.com\/([A-Za-z0-9.\-_/]+)\/?/i;
const TWITTER_RE = /https?:\/\/(?:www\.)?(?:twitter\.com|x\.com)\/([A-Za-z0-9_]+)\/?/i;
const TIKTOK_RE = /https?:\/\/(?:www\.)?tiktok\.com\/(@[A-Za-z0-9._]+)\/?/i;
const YOUTUBE_RE = /https?:\/\/(?:www\.)?youtube\.com\/(?:@?[A-Za-z0-9._\-/]+)/i;

export function extractEmails(text: string): string[] {
  const matches = text.match(EMAIL_RE) ?? [];
  return Array.from(new Set(matches.map((m) => m.toLowerCase().trim())));
}

export function extractPhones(text: string): string[] {
  const matches = text.match(PHONE_RE) ?? [];
  const cleaned = matches
    .map((m) => m.replace(/[^\d+]/g, ""))
    .filter((m) => {
      const digits = m.replace(/\D/g, "");
      return digits.length >= 8 && digits.length <= 15;
    });
  return Array.from(new Set(cleaned));
}

function titleCase(s: string): string {
  return s
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

// "john-smith-1a2b3c" → "John Smith"; strips trailing hash-y suffixes.
export function linkedinSlugToName(slug: string): { first?: string; last?: string; full?: string } {
  const raw = decodeURIComponent(slug).replace(/_/g, "-");
  const parts = raw.split("-").filter(Boolean);
  // Drop trailing alphanumeric noise tokens (mostly digits or short hash)
  const nameParts: string[] = [];
  for (const p of parts) {
    if (/\d/.test(p) && p.length <= 8) break;
    nameParts.push(p);
  }
  if (!nameParts.length) return {};
  const full = titleCase(nameParts.join(" "));
  const [first, ...rest] = full.split(" ");
  return { first, last: rest.join(" ") || undefined, full };
}

export function extractLinkedIn(text: string): string | null {
  const m = text.match(LINKEDIN_RE);
  return m ? `https://www.linkedin.com/in/${m[1]}` : null;
}
export function extractLinkedInCompany(text: string): string | null {
  const m = text.match(LINKEDIN_CO_RE);
  return m ? `https://www.linkedin.com/company/${m[1]}` : null;
}
export function extractInstagram(text: string): string | null {
  const m = text.match(INSTAGRAM_RE);
  return m ? m[1] : null;
}
export function extractFacebook(text: string): string | null {
  const m = text.match(FACEBOOK_RE);
  return m ? `https://facebook.com/${m[1]}` : null;
}
export function extractTwitter(text: string): string | null {
  const m = text.match(TWITTER_RE);
  return m ? m[1] : null;
}
export function extractTikTok(text: string): string | null {
  const m = text.match(TIKTOK_RE);
  return m ? `https://tiktok.com/${m[1]}` : null;
}
export function extractYouTube(text: string): string | null {
  const m = text.match(YOUTUBE_RE);
  return m ? m[0] : null;
}

export type ParsedContact = {
  emails: string[];
  phones: string[];
  linkedin_url?: string;
  instagram_handle?: string;
  facebook_url?: string;
  twitter_handle?: string;
  derived_first?: string;
  derived_last?: string;
  derived_full?: string;
};

export function parseContactBlob(text: string): ParsedContact {
  const emails = extractEmails(text);
  const phones = extractPhones(text);
  const linkedin = extractLinkedIn(text);
  const result: ParsedContact = {
    emails,
    phones,
    linkedin_url: linkedin ?? undefined,
    instagram_handle: extractInstagram(text) ?? undefined,
    facebook_url: extractFacebook(text) ?? undefined,
    twitter_handle: extractTwitter(text) ?? undefined,
  };
  if (linkedin) {
    const slug = linkedin.split("/in/")[1]?.replace(/\/$/, "");
    if (slug) {
      const { first, last, full } = linkedinSlugToName(slug);
      result.derived_first = first;
      result.derived_last = last;
      result.derived_full = full;
    }
  }
  return result;
}