# Live TikTok and Shopify Product Crosswalk

**Audited:** 2026-08-21. Every current TikTok `ACTIVATE` listing was read through the seller-authorised TikTok product-detail API. Each conclusion is based on the listing description and, where required, its original product image, not title similarity alone.

## Result

- Live TikTok listings audited: **24**
- Confirmed direct Shopify product matches: **18**
- Confirmed TikTok virtual bundles: **4**
- Listings needing an exact size confirmation: **2**
- Unidentified or unmatched live TikTok listings: **0**

The four virtual bundles have no one-to-one Shopify product because one TikTok sale consumes multiple physical products. They must be represented as component deductions, not as a regular single-product `channel_mapping`.

## Every Live TikTok Listing

| TikTok listing | TikTok ID | Qty | Shopify match or required component deductions | Audit result |
| --- | --- | ---: | --- | --- |
| 20% THD Vitamin C + Astaxanthin Serum 30ml | `1729881618337077866` | 5 | Serenity Hue Lab Twist 20% THD Vitamin C + Astaxanthin Serum 30ml x1 | Confirmed: description specifies the same 20% THD Vitamin C and Astaxanthin serum. |
| Lash Serum & Brow Kit | `1729828280298478186` | 24 | Long Lash Serum x1; Brow Follicle BioActivator x1 | Confirmed virtual bundle: live image shows both products. |
| Lash & Perfume Bundle | `1729787169768774250` | 25 | Long Lash Serum x1; The Beginning Perfume 20ml x1 | Confirmed virtual bundle: description explicitly names both products. |
| Under Eye Serum & Perfume | `1729787210817837674` | 90 | Snow Lift Peptide Under/Hooded Eye Serum x1; The Beginning Perfume 20ml x1 | Confirmed virtual bundle: description explicitly names both products. |
| The Beginning Perfume 2 x 20ml | `1729787213774363242` | 94 | Serenity Hue Perfume The Beginning 20ml x2 | Confirmed: description explicitly says 2 x 20ml. |
| The Beginning Perfume 20ml | `1729787173784296042` | 109 | Serenity Hue Perfume The Beginning 20ml x1 | Confirmed: description explicitly says 20ml Eau de Parfum. |
| Summer Bundle | `1729775874675612266` | 14 | Glow up Bundle x1: Snow Lift Serum, Long Lash Serum, Brow Follicle BioActivator, Pouch + 5 Spoolies | Confirmed: description names the two serums, Brow Follicle BioActivator, pouch, and spoolies. |
| Fuel + Tint Brow Tinting Mud 35g | `1729692906874051178` | 86 | Fuel & Tint - Brow Tinting Mud 35g x1 | Confirmed: description explicitly identifies Brow Tinting Mud 35g. |
| Lash Serum + Under Eye Serum Duo | `1729638607145638506` | 8 | Long Lash Serum x1; Snow Lift Peptide Under/Hooded Eye Serum x1 | **Confirmed virtual bundle.** Corrects the previous Glow up Bundle match: the TikTok description says this contains only the two serums. |
| 2 x Peptide SnowLift Eye Serum 8ml | `1729638563661519466` | 3 | Snow Lift Peptide Under/Hooded Eye Serum x2 | Confirmed: title and description identify the same eye serum as a two-pack. |
| 2 x Eyelash Growth Serum | `1729635949953849962` | 12 | Long Lash Serum x2 | Confirmed: description explicitly says 2 x Serenity Hue Pro Lash Serum. |
| Eyelash Growth Serum | `1729587772809255530` | 13 | Long Lash Serum x1 | Confirmed: description identifies Serenity Hue Pro Lash Serum. |
| Peptide SnowLift Eye Serum 8ml | `1729511153129593450` | 10 | Snow Lift Peptide Under/Hooded Eye Serum x1 | Confirmed: description identifies the same peptide eye serum. |
| Brow Lamination Clay 35g | `1729456593869835882` | 7 | Brow hydrate and rescue gel - Fuel & Lamination Clay, 35g x1 | Confirmed: description explicitly identifies the salon-size 35g clay. |
| Large Extra Hold Brow Primer | `1729456591670054506` | 70 | Brow Super Hold Powder Fuel & Bake - Brow Baking Powder | **Size review required:** TikTok description calls this a 10g salon size; the current Shopify mapping is the 35g variant. |
| Reusable Double-Sided Facial Cleaning Towel | `1729427557085843050` | 0 | Gentle Reusable Double-Sided Round Facial Cleaning Pad x1 | Confirmed: same reusable double-sided cleaning item; wording differs only as towel versus pad. |
| Brow Shape, Hold & Grow Duo | `1729429043083185770` | 67 | Brow Shape, Hold & Grow Duo, Makeup, Powder x1 | Confirmed: description names the Brow Pomade and Brow Baking Powder duo. |
| Pouch + 5 Brow Spoolies | `1729427787512581738` | 35 | 5 Spoolies + 1 Custom-Made Serenity Hue Pouch x1 | Confirmed: description explicitly says five spoolies and pouch. |
| All-Day Hold & Grow Lamination Duo | `1729427558490148458` | 26 | All-Day Hold & Grow Lamination Duo x1 | Confirmed: description names the Brow Baking Powder, Brow Lamination Clay, and free spoolies set. |
| Brow Growth & Hold Kit | `1729427559489572458` | 54 | Serenity Hue Brow Growth & Hold Kit x1 | Confirmed: description names Brow Pomade, Brow Lamination Clay, Brow Baking Powder, pouch, and five spoolies. |
| Extra Hold Brow Primer | `1729401004979949162` | 18 | Brow Super Hold Powder Fuel & Bake - Brow Baking Powder travel size | **Size review required:** this is clearly Brow Baking Powder, but the TikTok description does not state a size, so its current 5g Shopify match remains unverified. |
| Brow Treatment Pomade (7 shades) | `1729401002070871658` | 353 | Brow Pomade (7 Shades) x1 | Confirmed: description explicitly identifies Brow Pomade with seven shades. |
| Day Rescue Treatment Clear Matte Gel | `1729401004890426986` | 17 | Brow Lamination Clay Rescue - Serenity Hue x1 | Confirmed: description identifies the 10g AM Brow Lamination Clay / rescue formula. |
| Brow Conditioning Gel / Follicle BioActivator | `1729401004657970794` | 1 | Brow Follicle BioActivator x1 | Confirmed: description says it is now called Brow Follicle BioActivator. |

## Required Mapping Changes

1. Replace the current direct mapping for `1729638607145638506`. It is not the Shopify Glow up Bundle. Store it as a TikTok virtual bundle with Long Lash Serum x1 and Snow Lift Serum x1.
2. Store all four virtual bundles as component rules. A TikTok order must deduct each listed component from master inventory exactly once per bundle sold.
3. Confirm the physical size of the two Brow Baking Powder listings with the client before treating their Shopify variant links as verified:
   - `1729456591670054506` says **10g** in TikTok while the Shopify mapping says **35g**.
   - `1729401004979949162` has no TikTok size in its description; its Shopify mapping currently assumes **5g**.

## Shopify Products Without a Dedicated Live TikTok Listing

| Shopify product | Note |
| --- | --- |
| Lash Magic Bundle | No dedicated active TikTok listing. |
| UNDER EYE SERUM GO ALL IN BUNDLE | No dedicated active TikTok listing. |
| copper peptide 1 | No active TikTok listing; the historic TikTok mapping points to a listing that is not live. |

## Implementation Finding

The product identities are now known. The current reconciliation code still does not apply TikTok virtual-bundle component rules when an order arrives, so it cannot yet perform the required component-level master deduction automatically. That is the next implementation task; the product audit no longer blocks it.
