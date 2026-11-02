export type ContactSource =
  | "floating"
  | "header"
  | "mobile_menu"
  | "mobile_nav"
  | "footer"
  | "contact_page"
  | "property_card"
  | "property_sticky"
  | "home_hero"
  | "home_build"
  | "home_trust"
  | "service"
  | "design"
  | "project";

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
  contact_phone?: string;
  content_name?: string;
  page_type?: string;
}
