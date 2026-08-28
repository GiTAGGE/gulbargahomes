export type Listing = "Rent" | "Sale";

export type PropertyStatus = "Available" | "Rented" | "Sold";

export type PropertyType =
  | "House"
  | "Flat"
  | "Villa"
  | "Plot"
  | "Commercial"
  | "PG";

export type Furnishing = "Fully Furnished" | "Semi Furnished" | "Unfurnished";

export type Facing = "East" | "West" | "North" | "South";

export interface Nearby {
  schools: string[];
  hospitals: string[];
  busStop: string;
  railway: string;
}

export interface Faq {
  question: string;
  answer: string;
}

export interface PropertyVideo {
  title: string;
  src: string;
  youtubeUrl: string;
  thumbnail: string;
}

export interface Property {
  slug: string;
  title: string;
  listing: Listing;
  status: PropertyStatus;
  propertyType: PropertyType;
  bhk: number | null;
  price: number;
  priceSuffix: string;
  area: number;
  locality: string;
  city: string;
  facing: Facing;
  vastu: boolean;
  vegetarian: "Yes" | "Preferred" | "Not Required";
  bachelors: "Allowed" | "Not Allowed";
  family: "Preferred" | "Allowed";
  parking: string;
  bathrooms: number;
  furnished: Furnishing;
  featured: boolean;
  isNew: boolean;
  coverImage: string;
  gallery: string[];
  videos: PropertyVideo[];
  description: string;
  body: string;
  amenities: string[];
  rules: string[];
  nearby: Nearby;
  faq: Faq[];
  mapQuery: string;
}

export function propertyHasVideo(property: Pick<Property, "videos">): boolean {
  return property.videos.some((video) => video.src || video.youtubeUrl);
}
