PRAGMA foreign_keys = ON;

-- Versioned migrations are recorded explicitly. Runtime requests never infer
-- migration state from the existence of a single table.
CREATE TABLE IF NOT EXISTS schema_migrations (
  version TEXT PRIMARY KEY,
  applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

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
  active INTEGER NOT NULL DEFAULT 1,
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
  cancelled_at TEXT,
  source_shop_id TEXT,
  source_created_at TEXT NOT NULL,
  source_updated_at TEXT,
  imported_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (source, source_order_id)
);

CREATE INDEX IF NOT EXISTS orders_source_created_at_idx ON orders(source, source_created_at DESC);
CREATE INDEX IF NOT EXISTS orders_created_id_idx ON orders(source_created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS orders_source_updated_at_idx ON orders(source, source_updated_at DESC);
CREATE INDEX IF NOT EXISTS orders_source_shop_updated_at_idx ON orders(source, source_shop_id, source_updated_at DESC);
CREATE INDEX IF NOT EXISTS orders_fulfillment_status_idx ON orders(fulfillment_status);

CREATE TABLE IF NOT EXISTS order_items (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  variant_id TEXT REFERENCES variants(id) ON DELETE SET NULL,
  source_line_item_id TEXT,
  source_product_id TEXT,
  source_variant_id TEXT,
  title TEXT NOT NULL,
  variant_title TEXT,
  sku TEXT,
  quantity INTEGER NOT NULL,
  unit_price_amount INTEGER NOT NULL DEFAULT 0,
  image_url TEXT,
  UNIQUE (order_id, source_line_item_id)
);

CREATE INDEX IF NOT EXISTS order_items_order_id_idx ON order_items(order_id);
CREATE INDEX IF NOT EXISTS order_items_order_source_variant_idx ON order_items(order_id, source_variant_id);

-- Full-text order search replaces unindexed case-folded substring scans over
-- orders and a correlated line-item subquery.
CREATE VIRTUAL TABLE IF NOT EXISTS order_search USING fts5(
  order_id UNINDEXED,
  order_number,
  customer_name,
  customer_email,
  line_items
);

CREATE TRIGGER IF NOT EXISTS order_search_orders_insert AFTER INSERT ON orders BEGIN
  INSERT INTO order_search (rowid, order_id, order_number, customer_name, customer_email, line_items)
  VALUES (new.rowid, new.id, new.order_number, COALESCE(new.customer_name, ''), COALESCE(new.customer_email, ''),
    COALESCE((SELECT group_concat(COALESCE(title, '') || ' ' || COALESCE(sku, ''), ' ') FROM order_items WHERE order_id = new.id), ''));
END;
CREATE TRIGGER IF NOT EXISTS order_search_orders_update AFTER UPDATE ON orders BEGIN
  DELETE FROM order_search WHERE rowid = old.rowid;
  INSERT INTO order_search (rowid, order_id, order_number, customer_name, customer_email, line_items)
  VALUES (new.rowid, new.id, new.order_number, COALESCE(new.customer_name, ''), COALESCE(new.customer_email, ''),
    COALESCE((SELECT group_concat(COALESCE(title, '') || ' ' || COALESCE(sku, ''), ' ') FROM order_items WHERE order_id = new.id), ''));
END;
CREATE TRIGGER IF NOT EXISTS order_search_orders_delete AFTER DELETE ON orders BEGIN
  DELETE FROM order_search WHERE rowid = old.rowid;
END;
CREATE TRIGGER IF NOT EXISTS order_search_items_insert AFTER INSERT ON order_items BEGIN
  DELETE FROM order_search WHERE rowid = (SELECT rowid FROM orders WHERE id = new.order_id);
  INSERT INTO order_search (rowid, order_id, order_number, customer_name, customer_email, line_items)
  SELECT o.rowid, o.id, o.order_number, COALESCE(o.customer_name, ''), COALESCE(o.customer_email, ''),
    COALESCE((SELECT group_concat(COALESCE(title, '') || ' ' || COALESCE(sku, ''), ' ') FROM order_items WHERE order_id = o.id), '')
  FROM orders o WHERE o.id = new.order_id;
END;
CREATE TRIGGER IF NOT EXISTS order_search_items_update AFTER UPDATE ON order_items BEGIN
  DELETE FROM order_search WHERE rowid = (SELECT rowid FROM orders WHERE id = new.order_id);
  INSERT INTO order_search (rowid, order_id, order_number, customer_name, customer_email, line_items)
  SELECT o.rowid, o.id, o.order_number, COALESCE(o.customer_name, ''), COALESCE(o.customer_email, ''),
    COALESCE((SELECT group_concat(COALESCE(title, '') || ' ' || COALESCE(sku, ''), ' ') FROM order_items WHERE order_id = o.id), '')
  FROM orders o WHERE o.id = new.order_id;
END;
CREATE TRIGGER IF NOT EXISTS order_search_items_delete AFTER DELETE ON order_items BEGIN
  DELETE FROM order_search WHERE rowid = (SELECT rowid FROM orders WHERE id = old.order_id);
  INSERT INTO order_search (rowid, order_id, order_number, customer_name, customer_email, line_items)
  SELECT o.rowid, o.id, o.order_number, COALESCE(o.customer_name, ''), COALESCE(o.customer_email, ''),
    COALESCE((SELECT group_concat(COALESCE(title, '') || ' ' || COALESCE(sku, ''), ' ') FROM order_items WHERE order_id = o.id), '')
  FROM orders o WHERE o.id = old.order_id;
END;

-- TikTok after-sales events are line-level and can arrive separately from the
-- order-status event. Keeping the latest status for each immutable event/line
-- identity makes cancellation and return restoration idempotent.
CREATE TABLE IF NOT EXISTS tiktok_after_sales_line_items (
  id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL CHECK (event_type IN ('cancel', 'return')),
  event_id TEXT NOT NULL,
  order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  source_line_item_id TEXT NOT NULL,
  source_variant_id TEXT,
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  status TEXT NOT NULL,
  return_type TEXT,
  source_updated_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (event_type, event_id, source_line_item_id)
);

CREATE INDEX IF NOT EXISTS tiktok_after_sales_order_idx
  ON tiktok_after_sales_line_items(order_id, event_type, status, source_updated_at DESC);

CREATE TABLE IF NOT EXISTS shipments (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL CHECK (provider IN ('parcel2go')),
  external_order_line_id TEXT NOT NULL,
  source_references_json TEXT NOT NULL DEFAULT '[]',
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
  shop_id TEXT,
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

-- Labs is a separate ingredient domain. Quantities are always stored in grams;
-- it never affects finished-product or packaging stock.
CREATE TABLE IF NOT EXISTS lab_ingredients (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL UNIQUE,
  quantity_grams REAL NOT NULL DEFAULT 0,
  quantity_known INTEGER NOT NULL DEFAULT 0,
  reorder_point_grams REAL NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS lab_ingredients_active_title_idx ON lab_ingredients(active, title);

CREATE TABLE IF NOT EXISTS lab_formulas (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL UNIQUE,
  subtitle TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS lab_formula_ingredients (
  id TEXT PRIMARY KEY,
  formula_id TEXT NOT NULL REFERENCES lab_formulas(id) ON DELETE RESTRICT,
  ingredient_id TEXT NOT NULL REFERENCES lab_ingredients(id) ON DELETE RESTRICT,
  percentage REAL,
  calculation TEXT NOT NULL CHECK (calculation IN ('fixed', 'remainder', 'manual')),
  phase TEXT,
  note TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  UNIQUE(formula_id, ingredient_id)
);
CREATE INDEX IF NOT EXISTS lab_formula_ingredients_formula_idx ON lab_formula_ingredients(formula_id, sort_order);

CREATE TABLE IF NOT EXISTS lab_batches (
  id TEXT PRIMARY KEY,
  formula_id TEXT NOT NULL REFERENCES lab_formulas(id) ON DELETE RESTRICT,
  batch_number TEXT NOT NULL UNIQUE,
  target_grams REAL NOT NULL CHECK (target_grams > 0),
  actor TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS lab_batches_formula_created_idx ON lab_batches(formula_id, created_at DESC);

CREATE TABLE IF NOT EXISTS lab_batch_ingredients (
  id TEXT PRIMARY KEY,
  batch_id TEXT NOT NULL REFERENCES lab_batches(id) ON DELETE RESTRICT,
  ingredient_id TEXT NOT NULL REFERENCES lab_ingredients(id) ON DELETE RESTRICT,
  required_grams REAL NOT NULL CHECK (required_grams > 0),
  quantity_before REAL NOT NULL,
  quantity_after REAL NOT NULL,
  UNIQUE(batch_id, ingredient_id)
);

CREATE TABLE IF NOT EXISTS lab_ingredient_ledger (
  id TEXT PRIMARY KEY,
  ingredient_id TEXT NOT NULL REFERENCES lab_ingredients(id) ON DELETE RESTRICT,
  batch_id TEXT REFERENCES lab_batches(id) ON DELETE RESTRICT,
  change_type TEXT NOT NULL CHECK (change_type IN ('manual_count', 'batch_deduct', 'batch_reversal')),
  actor TEXT NOT NULL,
  quantity_before REAL NOT NULL,
  quantity_after REAL NOT NULL,
  quantity_delta REAL NOT NULL,
  reference TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS lab_ingredient_ledger_ingredient_created_idx ON lab_ingredient_ledger(ingredient_id, created_at DESC);

-- Canonical physical catalogue. This is intentionally independent from the
-- Shopify mirror above: channel listings (including bundles) will map to these
-- rows later, rather than defining what can be counted as stock.
CREATE TABLE IF NOT EXISTS physical_inventory_items (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  variant_label TEXT NOT NULL DEFAULT '',
  description TEXT,
  shopify_product_id TEXT,
  quantity INTEGER NOT NULL DEFAULT 0,
  quantity_known INTEGER NOT NULL DEFAULT 0,
  packaging_type TEXT,
  reorder_point INTEGER NOT NULL DEFAULT 0,
  lead_time_days INTEGER,
  source_label TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS physical_inventory_items_active_title_idx ON physical_inventory_items(active, title, variant_label);

CREATE TABLE IF NOT EXISTS physical_inventory_variants (
  id TEXT PRIMARY KEY,
  physical_item_id TEXT NOT NULL REFERENCES physical_inventory_items(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  sku TEXT,
  quantity INTEGER NOT NULL DEFAULT 0,
  quantity_known INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(physical_item_id, title)
);

CREATE INDEX IF NOT EXISTS physical_inventory_variants_item_idx ON physical_inventory_variants(physical_item_id, sort_order, title);

CREATE TABLE IF NOT EXISTS physical_inventory_ledger (
  id TEXT PRIMARY KEY,
  physical_item_id TEXT NOT NULL REFERENCES physical_inventory_items(id) ON DELETE CASCADE,
  change_type TEXT NOT NULL CHECK (change_type IN ('initial_import', 'manual_edit', 'sale', 'reconcile_fix', 'bundle_deduct')),
  actor TEXT NOT NULL,
  quantity_before INTEGER,
  quantity_after INTEGER NOT NULL,
  quantity_delta INTEGER NOT NULL,
  reference TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS physical_inventory_ledger_item_created_idx ON physical_inventory_ledger(physical_item_id, created_at DESC);

-- Idempotent physical-stock applications. Each channel event is expanded into
-- one row per physical variant, so a bundle can safely deduct several exact
-- components while a repeated sync cannot deduct twice.
CREATE TABLE IF NOT EXISTS physical_inventory_applications (
  id TEXT PRIMARY KEY,
  source TEXT NOT NULL CHECK (source IN ('shopify', 'tiktok')),
  event_type TEXT NOT NULL CHECK (event_type IN ('sale', 'refund', 'cancel')),
  source_event_id TEXT NOT NULL,
  order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  order_line_item_id TEXT,
  physical_variant_id TEXT NOT NULL REFERENCES physical_inventory_variants(id) ON DELETE RESTRICT,
  quantity_delta INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(source, event_type, source_event_id, physical_variant_id)
);

CREATE INDEX IF NOT EXISTS physical_inventory_applications_order_idx ON physical_inventory_applications(order_id, created_at DESC);

-- Holds Shopify's authoritative, line-level refund events. Keeping the raw
-- identity here lets a later sync restore precisely the components that were
-- deducted for that order, without title matching or double restoration.
CREATE TABLE IF NOT EXISTS shopify_refund_line_items (
  id TEXT PRIMARY KEY,
  refund_id TEXT NOT NULL,
  order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  source_line_item_id TEXT NOT NULL,
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  restocked INTEGER NOT NULL DEFAULT 0,
  restock_type TEXT,
  processed_at TEXT,
  imported_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(refund_id, source_line_item_id)
);

CREATE INDEX IF NOT EXISTS shopify_refund_line_items_order_idx ON shopify_refund_line_items(order_id, processed_at DESC);

-- The cutover guard intentionally baselines historical orders once. New
-- orders can then be applied while later refunds for applied orders are still
-- allowed through the immutable application rows above.
CREATE TABLE IF NOT EXISTS physical_inventory_order_state (
  order_id TEXT PRIMARY KEY REFERENCES orders(id) ON DELETE CASCADE,
  sale_state TEXT NOT NULL CHECK (sale_state IN ('baseline', 'applied', 'needs_mapping')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Channel listings are intentionally separate from the physical catalogue. A
-- listing may be a standalone product, a variant, or a bundle composed of
-- several physical variants.
CREATE TABLE IF NOT EXISTS physical_channel_listings (
  id TEXT PRIMARY KEY,
  channel TEXT NOT NULL CHECK (channel IN ('shopify', 'tiktok')),
  external_product_id TEXT NOT NULL,
  external_variant_id TEXT,
  title TEXT NOT NULL,
  variant_title TEXT NOT NULL DEFAULT '',
  image_url TEXT,
  listing_url TEXT,
  channel_quantity INTEGER,
  listing_kind TEXT NOT NULL DEFAULT 'unknown' CHECK (listing_kind IN ('individual', 'bundle', 'unknown')),
  mapping_status TEXT NOT NULL DEFAULT 'unmapped' CHECK (mapping_status IN ('confirmed', 'review', 'unmapped')),
  source_note TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(channel, external_product_id, external_variant_id)
);

CREATE INDEX IF NOT EXISTS physical_channel_listings_channel_active_idx ON physical_channel_listings(channel, active, title);

-- A channel product can be associated with one master product for product
-- level organisation. This never replaces the exact variant-level component
-- map below, which is the only mapping used for stock deductions.
CREATE TABLE IF NOT EXISTS physical_channel_product_links (
  channel TEXT NOT NULL CHECK (channel IN ('shopify', 'tiktok')),
  external_product_id TEXT NOT NULL,
  physical_item_id TEXT NOT NULL REFERENCES physical_inventory_items(id) ON DELETE RESTRICT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (channel, external_product_id)
);

CREATE INDEX IF NOT EXISTS physical_channel_product_links_item_idx ON physical_channel_product_links(physical_item_id);

CREATE TABLE IF NOT EXISTS physical_listing_components (
  id TEXT PRIMARY KEY,
  listing_id TEXT NOT NULL REFERENCES physical_channel_listings(id) ON DELETE CASCADE,
  physical_variant_id TEXT NOT NULL REFERENCES physical_inventory_variants(id) ON DELETE RESTRICT,
  quantity_per_sale INTEGER NOT NULL CHECK (quantity_per_sale > 0),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(listing_id, physical_variant_id)
);

CREATE INDEX IF NOT EXISTS physical_listing_components_listing_idx ON physical_listing_components(listing_id);

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

CREATE INDEX IF NOT EXISTS webhook_events_status_received_idx ON webhook_events(status, received_at);

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

-- Orders, cancellations, and returns have independent per-shop clocks. A
-- shared cursor can skip a late after-sales event for an older order.
CREATE TABLE IF NOT EXISTS tiktok_sync_cursors (
  connection_id TEXT NOT NULL REFERENCES tiktok_connections(id) ON DELETE CASCADE,
  shop_id TEXT NOT NULL,
  stream TEXT NOT NULL CHECK (stream IN ('orders', 'after_sales_cancel', 'after_sales_return')),
  cursor_at TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (connection_id, shop_id, stream)
);

CREATE INDEX IF NOT EXISTS tiktok_sync_cursors_stream_updated_idx
  ON tiktok_sync_cursors(stream, updated_at DESC);

-- TikTok affiliate data is kept independently from ordinary TikTok Shop
-- orders: TikTok's seller affiliate records are the attribution authority.
CREATE TABLE IF NOT EXISTS tiktok_affiliate_orders (
  id TEXT PRIMARY KEY,
  connection_id TEXT NOT NULL REFERENCES tiktok_connections(id) ON DELETE CASCADE,
  shop_id TEXT NOT NULL,
  source_order_id TEXT NOT NULL,
  source_line_item_id TEXT NOT NULL,
  source_product_id TEXT,
  source_sku_id TEXT,
  product_title TEXT,
  creator_open_id TEXT,
  creator_username TEXT,
  quantity INTEGER NOT NULL DEFAULT 0,
  gross_amount_minor INTEGER NOT NULL DEFAULT 0,
  estimated_commission_minor INTEGER NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'GBP',
  status TEXT,
  source_created_at TEXT,
  source_updated_at TEXT,
  imported_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (shop_id, source_order_id, source_line_item_id)
);

CREATE INDEX IF NOT EXISTS tiktok_affiliate_orders_period_idx
  ON tiktok_affiliate_orders(shop_id, source_created_at DESC);
CREATE INDEX IF NOT EXISTS tiktok_affiliate_orders_creator_idx
  ON tiktok_affiliate_orders(shop_id, creator_open_id, creator_username);

CREATE TABLE IF NOT EXISTS tiktok_affiliate_videos (
  id TEXT PRIMARY KEY,
  connection_id TEXT NOT NULL REFERENCES tiktok_connections(id) ON DELETE CASCADE,
  shop_id TEXT NOT NULL,
  source_video_id TEXT NOT NULL,
  source_product_id TEXT,
  creator_open_id TEXT,
  creator_username TEXT,
  video_title TEXT,
  published_at TEXT,
  gross_amount_minor INTEGER NOT NULL DEFAULT 0,
  attributed_order_count INTEGER NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'GBP',
  source_updated_at TEXT,
  imported_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (shop_id, source_video_id)
);

CREATE INDEX IF NOT EXISTS tiktok_affiliate_videos_period_idx
  ON tiktok_affiliate_videos(shop_id, published_at DESC);

CREATE TABLE IF NOT EXISTS tiktok_affiliate_sync_status (
  connection_id TEXT NOT NULL REFERENCES tiktok_connections(id) ON DELETE CASCADE,
  shop_id TEXT NOT NULL,
  cursor_at TEXT,
  last_successful_at TEXT,
  last_attempted_at TEXT,
  last_error_at TEXT,
  last_error_message TEXT,
  initial_baseline_started_at TEXT,
  initial_baseline_completed_at TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (connection_id, shop_id)
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
