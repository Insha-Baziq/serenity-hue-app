import assert from "node:assert/strict";
import test from "node:test";
import { parseLabIngredientCsv } from "../lib/lab-ingredient-csv.ts";

test("ingredient CSV import accepts quoted names, gram counts, and blank uncounted quantities", () => {
  assert.deepEqual(parseLabIngredientCsv('\uFEFFingredient,quantity_grams,reorder_point_grams\r\n"Rose, Damask",12.5,30\r\n"Aloe ""Pure""",,\r\n'), [
    { title: "Rose, Damask", quantityGrams: 12.5, reorderPointGrams: 30 },
    { title: 'Aloe "Pure"', quantityGrams: undefined, reorderPointGrams: undefined },
  ]);
});

test("ingredient CSV import rejects a missing ingredient column and invalid negative amounts", () => {
  assert.throws(() => parseLabIngredientCsv("quantity_grams,reorder_point_grams\n12,3"), /ingredient column/i);
  assert.throws(() => parseLabIngredientCsv("title,quantity_grams\nRose,-1"), /row 2.*quantity/i);
});

test("ingredient CSV import skips blank lines and enforces the row limit", () => {
  assert.deepEqual(parseLabIngredientCsv("title\nRose\n\n"), [
    { title: "Rose", quantityGrams: undefined, reorderPointGrams: undefined },
  ]);
  assert.throws(() => parseLabIngredientCsv("title\nA\nB", { maxRows: 1 }), /at most 1 ingredient/i);
});
