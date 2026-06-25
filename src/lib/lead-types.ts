export type Lead = {
  title?: string;
  categoryName?: string;
  address?: string;
  phone?: string;
  phones?: string[];
  emails?: string[];
  website?: string;
  totalScore?: number;
  reviewsCount?: number;
  leadScore?: number;
  leadTier?: string;
  redFlags?: string[];
  lovableUrl?: string;
  passed?: boolean;
  rejectionReasons?: string[];
  [k: string]: unknown;
};

export type SearchParamsSnapshot = {
  keywords: string[];
  countryCode: string;
  maxPlaces: number;
  minReviews: number;
  maxReviews: number;
  minRating: number;
  maxRating: number;
  activeOwnerDays: number;
};

export type SearchRecord = {
  id: string;
  createdAt: number;
  params: SearchParamsSnapshot;
  leads: Lead[];
  filteredOut: Lead[];
  total: number;
};