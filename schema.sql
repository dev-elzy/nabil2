-- Skema Database D1 Undangan Pernikahan Nabil & Izza (Website 2 - terisolasi dengan prefix v2_)

CREATE TABLE IF NOT EXISTS v2_guests (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  category TEXT DEFAULT 'Umum',
  phone TEXT,
  sent INTEGER DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS v2_rsvps (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  city TEXT,
  category TEXT DEFAULT 'Umum',
  attendance TEXT NOT NULL,
  pax INTEGER DEFAULT 1,
  message TEXT,
  is_visible INTEGER DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Indexing untuk query cepat
CREATE INDEX IF NOT EXISTS idx_v2_guests_name ON v2_guests(name);
CREATE INDEX IF NOT EXISTS idx_v2_guests_created ON v2_guests(created_at);
CREATE INDEX IF NOT EXISTS idx_v2_rsvps_created ON v2_rsvps(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_v2_rsvps_visible_created ON v2_rsvps(is_visible, created_at);

CREATE TABLE IF NOT EXISTS v2_site_config (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
