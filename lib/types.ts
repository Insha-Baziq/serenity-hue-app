export type Channel = "shopify" | "tiktok";
export type MappingStatus = "confirmed" | "review" | "unmapped";
export type PaymentStatus = "paid" | "pending" | "refunded";
export type FulfillmentStatus = "fulfilled" | "unfulfilled" | "partial";

export type ProductInventory = {
  id: string;
  productId: string;
  product: string;
  variant: string;
  sku: string;
  quantity: number;
  sold7d: number;
  sold30d: number;
  dailySalesRate: number;
  daysLeft: number | null;
  leadTime: string;
  leadTimeDays: number | null;
  packagingType: string;
  unitsPerBox: number;
  onHandBoxes: number;
  mapping: MappingStatus;
  mappingConfidence: string;
  isLowStock: boolean;
  reorderNow: boolean;
  imageTone: "blush" | "smoke" | "taupe" | "amber" | "rose";
  isBundle?: boolean;
};

export type InventoryChannel = "master" | "shopify" | "tiktok";

export type ChannelInventoryRow = {
  variantId: string;
  productId: string;
  product: string;
  variant: string;
  sku: string;
  imageTone: "blush" | "smoke" | "taupe" | "amber" | "rose";
  master: number | null;
  shopify: number;
  tiktok: number | null;
  sold7d: number;
  sold30d: number;
  leadTime: string;
  packagingType: string;
};

export type ChannelInventorySnapshot = {
  rows: ChannelInventoryRow[];
  tiktokSyncedAt: string | null;
  sync: SyncSnapshot;
};

export type InventoryLedgerEntry = {
  id: string;
  item: string;
  inventory: InventoryChannel;
  changeType: "manual_edit" | "sale" | "allocation_push" | "reconcile_fix" | "bundle_deduct";
  actor: string;
  isSystem: boolean;
  quantityBefore: number | null;
  quantityAfter: number | null;
  quantityDelta: number;
  reference: string;
  createdAt: string;
};

export type PackagingMaterial = {
  id: string;
  title: string;
  quantity: number;
  reorderPoint: number;
  leadTimeDays: number | null;
  updatedBy: string;
  updatedAt: string;
};

export type InventoryAlert = {
  id: string;
  key: string;
  kind: "reorder" | "low_stock" | "packaging" | "mapping";
  severity: "critical" | "warning" | "info";
  title: string;
  detail: string;
  firstSeenAt: string;
  lastSeenAt: string;
};

export type StockMovement = {
  id: string;
  item: string;
  delta: number;
  reason: string;
  source: Channel | "manual";
  reference: string;
  createdAt: string;
};

export type OrderLineItem = {
  id: string;
  title: string;
  variant: string;
  sku: string;
  quantity: number;
  unitPrice: number;
  imageTone: "blush" | "smoke" | "taupe" | "amber" | "rose";
};

export type Parcel2GoDeliveryEvent = {
  id: string;
  key: string;
  label: string;
  occurredAt: string;
};

export type Parcel2GoMatchMethod = "order_reference" | "customer_email" | "customer_phone" | "delivery_address";

export type Parcel2GoDelivery = {
  id: string;
  orderLineId: string;
  courier: string;
  service: string;
  status: string;
  paidAt?: string;
  collectionDate?: string;
  estimatedDeliveryAt?: string;
  trackingUrl?: string;
  matchMethod?: Parcel2GoMatchMethod;
  events: Parcel2GoDeliveryEvent[];
};

export type Parcel2GoShipmentOption = {
  id: string;
  orderLineId: string;
  courier: string;
  service: string;
  status: string;
  collectionDate?: string;
  estimatedDeliveryAt?: string;
};

export type Order = {
  id: string;
  sourceOrderId: string;
  adminUrl?: string;
  number: string;
  channel: Channel;
  customer: string;
  email: string;
  phone: string;
  address: string[];
  payment: PaymentStatus;
  fulfillment: FulfillmentStatus;
  createdAt: string;
  subtotal: number;
  shipping: number;
  tax: number;
  total: number;
  items: OrderLineItem[];
  deliveries: Parcel2GoDelivery[];
};

export type SyncSnapshot = {
  lastSyncedAt?: string;
  status: "healthy" | "syncing" | "attention";
  message: string;
  liveChannels: number;
};

export type Employee = {
  id: string;
  name: string;
  email: string;
  image?: string;
  createdAt: string;
  lastSeenAt?: string;
  status: "active" | "offline";
};

export type InventorySnapshot = {
  products: ProductInventory[];
  packaging: PackagingMaterial[];
  alerts: InventoryAlert[];
  recentMovements: StockMovement[];
  sync: SyncSnapshot;
};
