import test from "node:test";
import assert from "node:assert/strict";
import { addPackagingIncrement, calculateBatchAllocation, packagedUnits, packagingInventoryEffect, planIngredientDeduction } from "../lib/lab-production.ts";

test("batch allocation reports remaining bulk from the packaged amount", () => {
  assert.deepEqual(calculateBatchAllocation(5000, 1000, "ml"), {
    total: 5000,
    packaged: 1000,
    remaining: 4000,
    unit: "ml",
  });
});

test("batch allocation rejects packaged output above the batch size", () => {
  assert.throws(() => calculateBatchAllocation(5000, 5001, "ml"), /PACKAGED_EXCEEDS_BATCH/);
});

test("packaging adds a new amount to the saved packaged total", () => {
  assert.deepEqual(addPackagingIncrement(5000, 1000, 750, "ml"), {
    total: 5000,
    packaged: 1750,
    remaining: 3250,
    unit: "ml",
  });
});

test("packaging rejects zero, negative, and over-batch additions", () => {
  assert.throws(() => addPackagingIncrement(5000, 1000, 0, "ml"), /PACKAGING_INCREMENT_INVALID/);
  assert.throws(() => addPackagingIncrement(5000, 1000, -10, "ml"), /PACKAGING_INCREMENT_INVALID/);
  assert.throws(() => addPackagingIncrement(5000, 1000, 4001, "ml"), /PACKAGED_EXCEEDS_BATCH/);
});

test("packaged volume converts to finished units using the formula output size", () => {
  assert.equal(packagedUnits(1000, "ml", 10, "ml"), 100);
});

test("packaged output must be a whole number of finished units", () => {
  assert.throws(() => packagedUnits(1005, "ml", 10, "ml"), /PACKAGED_NOT_WHOLE_UNITS/);
});

test("packaged and fill units cannot be mixed without an explicit conversion", () => {
  assert.throws(() => packagedUnits(1000, "ml", 10, "g"), /PACKAGED_UNIT_MISMATCH/);
});

test("packaging can record finished units without changing master inventory", () => {
  assert.deepEqual(packagingInventoryEffect(100, false), { shouldUpdate: false, quantityDelta: 0 });
  assert.deepEqual(packagingInventoryEffect(100, true), { shouldUpdate: true, quantityDelta: 100 });
});

test("an uncounted ingredient does not block a batch or create a negative count", () => {
  assert.deepEqual(planIngredientDeduction(0, false, 350), {
    status: "not_recorded",
    before: 0,
    after: 0,
    required: 350,
    deducted: 0,
  });
});

test("an insufficient counted ingredient remains unchanged for an advisory batch", () => {
  assert.deepEqual(planIngredientDeduction(100, true, 350), {
    status: "not_recorded",
    before: 100,
    after: 100,
    required: 350,
    deducted: 0,
  });
});

test("a sufficient counted ingredient is deducted exactly once", () => {
  assert.deepEqual(planIngredientDeduction(1000, true, 350), {
    status: "deducted",
    before: 1000,
    after: 650,
    required: 350,
    deducted: 350,
  });
});
