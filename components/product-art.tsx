import type { ProductInventory } from "@/lib/types";

type Tone = ProductInventory["imageTone"];

export function ProductArt({ tone = "blush", size = "small" }: { tone?: Tone; size?: "small" | "medium" }) {
  return (
    <span className={`product-art product-art--${tone} product-art--${size}`} aria-hidden="true">
      <span className="product-art__cap" />
      <span className="product-art__bottle" />
      <span className="product-art__shine" />
    </span>
  );
}
