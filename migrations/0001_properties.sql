CREATE TABLE IF NOT EXISTS properties (
  slug TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  listing TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'Available',
  property_type TEXT NOT NULL,
  bhk INTEGER,
  price INTEGER NOT NULL DEFAULT 0,
  price_suffix TEXT NOT NULL DEFAULT '',
  area INTEGER NOT NULL DEFAULT 0,
  locality TEXT NOT NULL,
  city TEXT NOT NULL DEFAULT 'Gulbarga',
  facing TEXT NOT NULL DEFAULT 'East',
  vastu INTEGER NOT NULL DEFAULT 0,
  vegetarian TEXT NOT NULL DEFAULT 'Not Required',
  bachelors TEXT NOT NULL DEFAULT 'Allowed',
  family TEXT NOT NULL DEFAULT 'Allowed',
  parking TEXT NOT NULL DEFAULT '',
  bathrooms INTEGER NOT NULL DEFAULT 0,
  furnished TEXT NOT NULL DEFAULT 'Unfurnished',
  featured INTEGER NOT NULL DEFAULT 0,
  is_new INTEGER NOT NULL DEFAULT 1,
  cover_image TEXT NOT NULL DEFAULT '',
  gallery_json TEXT NOT NULL DEFAULT '[]',
  videos_json TEXT NOT NULL DEFAULT '[]',
  published_at TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  amenities_json TEXT NOT NULL DEFAULT '[]',
  rules_json TEXT NOT NULL DEFAULT '[]',
  nearby_json TEXT NOT NULL DEFAULT '{}',
  faq_json TEXT NOT NULL DEFAULT '[]',
  map_query TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS app_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_properties_listing ON properties (listing);
CREATE INDEX IF NOT EXISTS idx_properties_status ON properties (status);
CREATE INDEX IF NOT EXISTS idx_properties_locality ON properties (locality);
