export type ContactSource =
  | "floating"
  | "header"
  | "mobile_menu"
  | "mobile_nav"
  | "footer"
  | "property_card"
  | "property_sticky";

export interface PropertyAnalyticsContext {
  property_slug?: string;
  property_title?: string;
  listing_type?: string;
  property_type?: string;
  locality?: string;
  bhk?: number | null;
  price?: number;
  price_band?: string;
  status?: string;
}
