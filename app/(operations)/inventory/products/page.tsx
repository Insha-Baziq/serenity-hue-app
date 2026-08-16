import { InventoryWorkspace } from "@/components/inventory-workspace";
import { getInventory } from "@/lib/repository";

export const dynamic = "force-dynamic";

export default async function ProductsPage() {
  const inventory = await getInventory();
  const products = inventory.products.map(({ mapping, mappingConfidence, ...product }) => {
    void mapping;
    void mappingConfidence;
    return product;
  });
  return <InventoryWorkspace initialInventory={{ products, sync: inventory.sync }} />;
}
