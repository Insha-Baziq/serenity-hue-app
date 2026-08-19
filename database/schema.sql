PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS products (
  id TEXT PRIMARY KEY,
  shopify_product_id TEXT UNIQUE,
  title TEXT NOT NULL,
  handle TEXT,
  image_url TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS variants (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  shopify_variant_id TEXT UNIQUE,
  sku TEXT UNIQUE,
  title TEXT NOT NULL,
  available_quantity INTEGER NOT NULL DEFAULT 0,
  reorder_point INTEGER NOT NULL DEFAULT 0,
  lead_time_days INTEGER,
  packaging_type TEXT,
  units_per_box INTEGER NOT NULL DEFAULT 1,
  last_synced_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS variants_product_id_idx ON variants(product_id);
CREATE INDEX IF NOT EXISTS variants_sku_idx ON variants(sku);

CREATE TABLE IF NOT EXISTS channel_mappings (
  id TEXT PRIMARY KEY,
  variant_id TEXT NOT NULL REFERENCES variants(id) ON DELETE CASCADE,
  channel TEXT NOT NULL CHECK (channel IN ('shopify', 'tiktok')),
  external_product_id TEXT,
  external_variant_id TEXT,
  status TEXT NOT NULL DEFAULT 'confirmed' CHECK (status IN ('confirmed', 'review', 'unmapped')),
  multiplier INTEGER NOT NULL DEFAULT 1,
  confidence TEXT,
  notes TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  last_checked_at TEXT,
  UNIQUE (channel, external_variant_id)
);

CREATE TABLE IF NOT EXISTS packaging_materials (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  quantity INTEGER NOT NULL DEFAULT 0,
  reorder_point INTEGER NOT NULL DEFAULT 0,
  lead_time_days INTEGER,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS bundle_components (
  id TEXT PRIMARY KEY,
  bundle_name TEXT NOT NULL,
  bundle_type TEXT NOT NULL CHECK (bundle_type IN ('shopify', 'tiktok_virtual')),
  bundle_product_id TEXT REFERENCES products(id) ON DELETE CASCADE,
  tiktok_external_id TEXT,
  component_product_id TEXT REFERENCES products(id) ON DELETE CASCADE,
  component_variant_id TEXT REFERENCES variants(id) ON DELETE CASCADE,
  quantity_per_sale INTEGER NOT NULL DEFAULT 1,
  packaging_type TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(bundle_name, bundle_type, component_product_id, component_variant_id)
);

CREATE INDEX IF NOT EXISTS bundle_components_bundle_product_idx ON bundle_components(bundle_product_id);
CREATE INDEX IF NOT EXISTS bundle_components_tiktok_external_idx ON bundle_components(tiktok_external_id);

CREATE TABLE IF NOT EXISTS orders (
  id TEXT PRIMARY KEY,
  source TEXT NOT NULL CHECK (source IN ('shopify', 'tiktok')),
  source_order_id TEXT NOT NULL,
  order_number TEXT NOT NULL,
  customer_name TEXT,
  customer_email TEXT,
  customer_phone TEXT,
  shipping_address_json TEXT,
  currency TEXT NOT NULL DEFAULT 'GBP',
  total_amount INTEGER NOT NULL DEFAULT 0,
  subtotal_amount INTEGER NOT NULL DEFAULT 0,
  shipping_amount INTEGER NOT NULL DEFAULT 0,
  tax_amount INTEGER NOT NULL DEFAULT 0,
  financial_status TEXT NOT NULL DEFAULT 'pending',
  fulfillment_status TEXT NOT NULL DEFAULT 'unfulfilled',
  source_created_at TEXT NOT NULL,
  source_updated_at TEXT,
  imported_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (source, source_order_id)
);

CREATE INDEX IF NOT EXISTS orders_source_created_at_idx ON orders(source, source_created_at DESC);
CREATE INDEX IF NOT EXISTS orders_fulfillment_status_idx ON orders(fulfillment_status);

CREATE TABLE IF NOT EXISTS order_items (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  variant_id TEXT REFERENCES variants(id) ON DELETE SET NULL,
  source_line_item_id TEXT,
  title TEXT NOT NULL,
  variant_title TEXT,
  sku TEXT,
  quantity INTEGER NOT NULL,
  unit_price_amount INTEGER NOT NULL DEFAULT 0,
  image_url TEXT,
  UNIQUE (order_id, source_line_item_id)
);

CREATE INDEX IF NOT EXISTS order_items_order_id_idx ON order_items(order_id);

CREATE TABLE IF NOT EXISTS shipments (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL CHECK (provider IN ('parcel2go')),
  external_order_line_id TEXT NOT NULL,
  order_id TEXT REFERENCES orders(id) ON DELETE SET NULL,
  match_method TEXT CHECK (match_method IN ('order_reference', 'customer_email', 'customer_phone', 'delivery_address')),
  transaction_id TEXT,
  courier TEXT,
  service TEXT,
  source TEXT,
  status TEXT NOT NULL DEFAULT 'booked',
  paid_at TEXT,
  collection_date TEXT,
  estimated_delivery_at TEXT,
  tracking_url TEXT,
  last_synced_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (provider, external_order_line_id)
);

CREATE INDEX IF NOT EXISTS shipments_order_id_idx ON shipments(order_id, last_synced_at DESC);
CREATE INDEX IF NOT EXISTS shipments_provider_updated_idx ON shipments(provider, updated_at DESC);

CREATE TABLE IF NOT EXISTS shipment_events (
  id TEXT PRIMARY KEY,
  shipment_id TEXT NOT NULL REFERENCES shipments(id) ON DELETE CASCADE,
  event_key TEXT NOT NULL,
  label TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (shipment_id, event_key)
);

CREATE INDEX IF NOT EXISTS shipment_events_shipment_occurred_idx ON shipment_events(shipment_id, occurred_at);

CREATE TABLE IF NOT EXISTS stock_movements (
  id TEXT PRIMARY KEY,
  variant_id TEXT REFERENCES variants(id) ON DELETE CASCADE,
  packaging_material_id TEXT REFERENCES packaging_materials(id) ON DELETE CASCADE,
  quantity_delta INTEGER NOT NULL,
  reason TEXT NOT NULL,
  actor_name TEXT NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('manual', 'shopify', 'tiktok')),
  reference_id TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK ((variant_id IS NOT NULL) != (packaging_material_id IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS stock_movements_variant_created_idx ON stock_movements(variant_id, created_at DESC);

-- Three-inventory model: master physical stock, fetched channel display levels, and an audit ledger.
CREATE TABLE IF NOT EXISTS master_inventory (
  variant_id TEXT PRIMARY KEY REFERENCES variants(id) ON DELETE CASCADE,
  quantity INTEGER NOT NULL DEFAULT 0,
  anchored_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS channel_inventory (
  id TEXT PRIMARY KEY,
  variant_id TEXT REFERENCES variants(id) ON DELETE SET NULL,
  channel TEXT NOT NULL CHECK (channel IN ('shopify', 'tiktok')),
  external_product_id TEXT,
  external_sku_id TEXT,
  warehouse_id TEXT,
  available_quantity INTEGER NOT NULL DEFAULT 0,
  synced_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (channel, external_sku_id, warehouse_id)
);
CREATE INDEX IF NOT EXISTS channel_inventory_variant_idx ON channel_inventory(variant_id, channel);

CREATE TABLE IF NOT EXISTS inventory_ledger (
  id TEXT PRIMARY KEY,
  variant_id TEXT REFERENCES variants(id) ON DELETE SET NULL,
  inventory TEXT NOT NULL CHECK (inventory IN ('master', 'shopify', 'tiktok')),
  change_type TEXT NOT NULL CHECK (change_type IN ('manual_edit', 'sale', 'allocation_push', 'reconcile_fix', 'bundle_deduct')),
  actor TEXT NOT NULL,
  quantity_before INTEGER,
  quantity_after INTEGER,
  quantity_delta INTEGER NOT NULL,
  reference TEXT,
  result TEXT NOT NULL DEFAULT 'ok' CHECK (result IN ('ok', 'failed')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS inventory_ledger_created_idx ON inventory_ledger(created_at DESC);
CREATE INDEX IF NOT EXISTS inventory_ledger_variant_idx ON inventory_ledger(variant_id, created_at DESC);

CREATE TABLE IF NOT EXISTS inventory_order_applications (
  order_id TEXT PRIMARY KEY REFERENCES orders(id) ON DELETE CASCADE,
  stock_recorded_at TEXT,
  packaging_applied_at TEXT,
  state TEXT NOT NULL DEFAULT 'pending' CHECK (state IN ('baseline', 'pending', 'applied', 'needs_mapping')),
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS inventory_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS inventory_alerts (
  id TEXT PRIMARY KEY,
  alert_key TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL CHECK (kind IN ('reorder', 'low_stock', 'packaging', 'mapping')),
  severity TEXT NOT NULL CHECK (severity IN ('critical', 'warning', 'info')),
  title TEXT NOT NULL,
  detail TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'resolved')),
  first_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  resolved_at TEXT
);

CREATE INDEX IF NOT EXISTS inventory_alerts_status_seen_idx ON inventory_alerts(status, last_seen_at DESC);

CREATE TABLE IF NOT EXISTS sync_runs (
  id TEXT PRIMARY KEY,
  trigger TEXT NOT NULL CHECK (trigger IN ('manual', 'scheduled', 'webhook')),
  provider TEXT NOT NULL CHECK (provider IN ('direct', 'shopify', 'tiktok')),
  status TEXT NOT NULL CHECK (status IN ('running', 'succeeded', 'failed', 'skipped')),
  started_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  finished_at TEXT,
  records_seen INTEGER NOT NULL DEFAULT 0,
  records_changed INTEGER NOT NULL DEFAULT 0,
  message TEXT
);

CREATE TABLE IF NOT EXISTS sync_leases (
  name TEXT PRIMARY KEY,
  locked_until TEXT NOT NULL,
  owner_id TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS webhook_events (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  external_event_id TEXT NOT NULL,
  topic TEXT,
  received_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  processed_at TEXT,
  status TEXT NOT NULL DEFAULT 'received' CHECK (status IN ('received', 'processed', 'failed')),
  UNIQUE (provider, external_event_id)
);

CREATE TABLE IF NOT EXISTS tiktok_oauth_states (
  id TEXT PRIMARY KEY,
  state_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  used_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS tiktok_oauth_states_expires_idx ON tiktok_oauth_states(expires_at);

CREATE TABLE IF NOT EXISTS tiktok_connections (
  id TEXT PRIMARY KEY,
  shop_id TEXT UNIQUE,
  shop_cipher TEXT,
  open_id TEXT,
  user_type INTEGER,
  access_token TEXT NOT NULL,
  refresh_token TEXT NOT NULL,
  access_token_expires_at TEXT,
  refresh_token_expires_at TEXT,
  granted_scopes TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'deauthorized', 'expired')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS tiktok_connections_status_idx ON tiktok_connections(status, updated_at DESC);

CREATE TABLE IF NOT EXISTS tiktok_import_state (
  id TEXT PRIMARY KEY,
  backfill_completed_at TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Better Auth staff accounts and sessions.
CREATE TABLE IF NOT EXISTS "user" (
  id TEXT NOT NULL PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  emailVerified INTEGER NOT NULL,
  image TEXT,
  createdAt DATE NOT NULL,
  updatedAt DATE NOT NULL
);

CREATE TABLE IF NOT EXISTS "session" (
  id TEXT NOT NULL PRIMARY KEY,
  expiresAt DATE NOT NULL,
  token TEXT NOT NULL UNIQUE,
  createdAt DATE NOT NULL,
  updatedAt DATE NOT NULL,
  ipAddress TEXT,
  userAgent TEXT,
  userId TEXT NOT NULL REFERENCES "user" (id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS session_userId_idx ON "session" (userId);

CREATE TABLE IF NOT EXISTS "account" (
  id TEXT NOT NULL PRIMARY KEY,
  accountId TEXT NOT NULL,
  providerId TEXT NOT NULL,
  userId TEXT NOT NULL REFERENCES "user" (id) ON DELETE CASCADE,
  accessToken TEXT,
  refreshToken TEXT,
  idToken TEXT,
  accessTokenExpiresAt DATE,
  refreshTokenExpiresAt DATE,
  scope TEXT,
  password TEXT,
  createdAt DATE NOT NULL,
  updatedAt DATE NOT NULL
);

CREATE INDEX IF NOT EXISTS account_userId_idx ON "account" (userId);

CREATE TABLE IF NOT EXISTS "verification" (
  id TEXT NOT NULL PRIMARY KEY,
  identifier TEXT NOT NULL,
  value TEXT NOT NULL,
  expiresAt DATE NOT NULL,
  createdAt DATE NOT NULL,
  updatedAt DATE NOT NULL
);

CREATE INDEX IF NOT EXISTS verification_identifier_idx ON "verification" (identifier);
