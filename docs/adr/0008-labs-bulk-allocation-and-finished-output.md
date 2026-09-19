# 0008. Separate Labs bulk allocation from finished output

- **Status**: Accepted
- **Date**: 2026-09-18
- **Deciders**: Product change confirmed in implementation session

## Context

Labs produces a bulk formulation, while the team may package only part of that
formulation immediately. A counted ingredient should help with deductions, but a
missing or insufficient count must not prevent staff from recording the production
run. Finished stock is tracked at the exact physical-variant level, and a fill amount
can be measured in grams or milliliters depending on the product.

## Decision

We will keep ingredient calculations in grams and store a separate batch allocation
with a total output quantity, unit, packaged quantity, and derived remaining bulk.
Each formula may link to one exact physical variant and a per-unit fill quantity. A
packaging increase must fit within the batch total and produce a whole number of fill
units; the same transaction updates the physical variant quantity and writes the
packaging audit record.

Ingredient availability is advisory at batch creation. Known, sufficient ingredients
are deducted; uncounted or insufficient ingredients retain their current quantity and
are recorded in the batch snapshot without going negative.

## Alternatives considered

| Option | Why not |
|---|---|
| Block batch creation until every ingredient is counted and available | Prevents recording real production work and couples production history to an optional stock count. |
| Put remaining bulk into finished-product inventory | Remaining bulk is not packaged stock and cannot be sold as a finished unit without a fill event. |
| Convert grams to milliliters automatically | Density is product-specific; an implicit 1 g = 1 mL conversion would create false packaging quantities. |
| Treat every formula as a generic product parent | Master inventory is variant-aware, so output must identify the exact physical variant. |

## Consequences

The Labs flow can record production before an ingredient count is complete, and partial
packaging is visible without losing the bulk remainder. Finished inventory increases
only when a valid packaging increment is saved. The first version is intentionally
forward-only: reducing packaged output would require a separately audited stock
reversal because finished units may already have been sold.

## Notes for agents

Use the terms **packaged output** and **remaining bulk**. Do not call remaining bulk
finished stock, ingredient stock, or “unpackaged inventory.” Keep formula calculation
weight separate from measured fill volume unless an explicit, product-specific
conversion is introduced later.
