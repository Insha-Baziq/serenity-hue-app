export type Channel = "shopify" | "tiktok";
export type MappingStatus = "confirmed" | "review" | "unmapped";
export type PaymentStatus = "paid" | "pending" | "refunded";
export type FulfillmentStatus = "fulfilled" | "unfulfilled" | "partial" | "cancelled";

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
  tiktokProductLevel: number | null;
  sold7d: number;
  sold30d: number;
  leadTime: string;
  packagingType: string;
};

export type ChannelInventorySnapshot = {
  rows: ChannelInventoryRow[];
  tiktokSyncedAt: string | null;
  tiktokProductCount: number;
  sync: SyncSnapshot;
};

export type PhysicalInventoryItem = {
  id: string;
  title: string;
  variantLabel: string;
  quantity: number;
  quantityKnown: boolean;
  variantCount: number;
  packagingType: string;
  reorderPoint: number;
  leadTimeDays: number | null;
  imageUrl: string | null;
  imageTone: "blush" | "smoke" | "taupe" | "amber" | "rose";
  variants: PhysicalInventoryVariant[];
};

export type PhysicalInventoryVariant = {
  id: string;
  title: string;
  sku: string;
  quantity: number;
  quantityKnown: boolean;
};

export type PhysicalProductDetail = PhysicalInventoryItem & {
  description: string;
  sourceLabel: string;
  variants: PhysicalInventoryVariant[];
};

export type PhysicalInventoryRunwayDay = {
  date: string;
  shopify: number;
  tiktok: number;
};

export type PhysicalInventoryRunway = {
  daysAvailable: number;
  generatedAt: string;
  dailySales: PhysicalInventoryRunwayDay[];
};

export type PhysicalInventoryRunways = Record<string, PhysicalInventoryRunway>;

export type PhysicalInventoryAdjustment = {
  variantId: string;
  quantity: number;
};

export type PhysicalChannel = "shopify" | "tiktok";

export type PhysicalListingMappingStatus = "confirmed" | "review" | "unmapped";

export type PhysicalChannelListingComponent = {
  id: string;
  physicalVariantId: string;
  itemId: string;
  itemTitle: string;
  variantTitle: string;
  quantityPerSale: number;
};

export type PhysicalChannelListing = {
  id: string;
  channel: PhysicalChannel;
  externalProductId: string;
  externalVariantId: string | null;
  title: string;
  variantTitle: string;
  imageUrl: string | null;
  listingUrl: string | null;
  channelQuantity: number | null;
  kind: "individual" | "bundle" | "unknown";
  masterProductId: string | null;
  masterProductTitle: string | null;
  mappingStatus: PhysicalListingMappingStatus;
  sourceNote: string;
  components: PhysicalChannelListingComponent[];
};

export type ProductDetailVariant = {
  id: string;
  title: string;
  master: number | null;
  shopify: number;
  tiktok: number | null;
  sold7d: number;
  sold30d: number;
  dailySalesRate: number;
  daysCover: number | null;
};

export type ProductDetail = {
  id: string;
  title: string;
  handle: string;
  imageUrl: string | null;
  variants: ProductDetailVariant[];
  totals: {
    master: number | null;
    shopify: number;
    tiktok: number | null;
    sold7d: number;
    sold30d: number;
    dailySalesRate: number;
    daysCover: number | null;
  };
  shopifySyncedAt: string | null;
  tiktokSyncedAt: string | null;
  tiktokProductLevel: number | null;
  sync: SyncSnapshot;
  ledger: InventoryLedgerEntry[];
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

export type LabIngredient = {
  id: string;
  title: string;
  quantityGrams: number;
  quantityKnown: boolean;
  reorderPointGrams: number;
  usedByFormulaCount: number;
  updatedAt: string;
};

export type LabFormulaLine = {
  ingredientId: string;
  ingredient: string;
  percentage: number | null;
  calculation: "fixed" | "remainder" | "manual";
  phase: string;
  note: string;
  quantityGrams: number;
  quantityKnown: boolean;
};

export type LabFormula = {
  id: string;
  title: string;
  subtitle: string;
  notes: string;
  ingredientCount: number;
  lines: LabFormulaLine[];
  output: LabFormulaOutput | null;
};

export type LabQuantityUnit = "g" | "ml";

export type LabFormulaOutput = {
  id: string;
  physicalVariantId: string;
  product: string;
  variant: string;
  fillQuantity: number;
  fillUnit: LabQuantityUnit;
};

export type LabBatch = {
  id: string;
  formula: string;
  batchNumber: string;
  targetGrams: number;
  outputQuantity: number;
  outputUnit: LabQuantityUnit;
  packagedQuantity: number;
  remainingQuantity: number;
  packagedUnits: number;
  output: LabFormulaOutput | null;
  actor: string;
  createdAt: string;
};

export type LabBatchDetail = LabBatch & {
  formulaId: string;
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
  sourceReferences: string[];
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
  sourceReferences: string[];
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
  cancelledAt: string | null;
  createdAt: string;
  subtotal: number;
  shipping: number;
  tax: number;
  total: number;
  items: OrderLineItem[];
  deliveries: Parcel2GoDelivery[];
};

export type OrdersPageResult = {
  orders: Order[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
};

export type CustomerType = "repeat" | "one-time" | "guest";

export type Customer = {
  id: string;
  name: string;
  email: string;
  phone: string;
  channels: Channel[];
  orders: number;
  totalSpent: number;
  lastOrderAt: string;
  type: CustomerType;
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
