export type LabQuantityUnit = "g" | "ml";

export type BatchAllocation = {
  total: number;
  packaged: number;
  remaining: number;
  unit: LabQuantityUnit;
};

const EPSILON = 1e-9;

function assertPositiveFinite(value: number, code: string) {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(code);
  }
}

function roundQuantity(value: number) {
  return Math.round((value + Number.EPSILON) * 1_000_000) / 1_000_000;
}

export function calculateBatchAllocation(
  total: number,
  packaged: number,
  unit: LabQuantityUnit,
): BatchAllocation {
  assertPositiveFinite(total, "BATCH_SIZE_INVALID");

  if (!Number.isFinite(packaged) || packaged < 0) {
    throw new Error("PACKAGED_QUANTITY_INVALID");
  }

  if (packaged - total > EPSILON) {
    throw new Error("PACKAGED_EXCEEDS_BATCH");
  }

  return {
    total,
    packaged,
    remaining: roundQuantity(Math.max(0, total - packaged)),
    unit,
  };
}

export function addPackagingIncrement(
  total: number,
  currentPackaged: number,
  addedQuantity: number,
  unit: LabQuantityUnit,
): BatchAllocation {
  calculateBatchAllocation(total, currentPackaged, unit);
  assertPositiveFinite(addedQuantity, "PACKAGING_INCREMENT_INVALID");
  return calculateBatchAllocation(total, roundQuantity(currentPackaged + addedQuantity), unit);
}

export function packagedUnits(
  packagedAmount: number,
  packagedUnit: LabQuantityUnit,
  fillQuantity: number,
  fillUnit: LabQuantityUnit,
) {
  assertPositiveFinite(packagedAmount, "PACKAGED_QUANTITY_INVALID");
  assertPositiveFinite(fillQuantity, "FILL_QUANTITY_INVALID");

  if (packagedUnit !== fillUnit) {
    throw new Error("PACKAGED_UNIT_MISMATCH");
  }

  const units = packagedAmount / fillQuantity;
  if (Math.abs(units - Math.round(units)) > EPSILON) {
    throw new Error("PACKAGED_NOT_WHOLE_UNITS");
  }

  return Math.round(units);
}

export function packagingInventoryEffect(finishedUnits: number, updateInventory: boolean) {
  if (!Number.isSafeInteger(finishedUnits) || finishedUnits < 0) {
    throw new Error("FINISHED_UNITS_INVALID");
  }
  return {
    shouldUpdate: updateInventory,
    quantityDelta: updateInventory ? finishedUnits : 0,
  };
}

export type IngredientDeductionStatus = "deducted" | "not_recorded";

export type IngredientDeduction = {
  status: IngredientDeductionStatus;
  before: number;
  after: number;
  required: number;
  deducted: number;
};

/**
 * Ingredient counts are advisory for Labs production. An uncounted or
 * insufficient ingredient must not block a batch and must never go negative.
 */
export function planIngredientDeduction(
  quantity: number,
  quantityKnown: boolean,
  required: number,
): IngredientDeduction {
  const before = Math.max(0, quantity);
  const normalizedRequired = Math.max(0, required);

  if (!quantityKnown || before + EPSILON < normalizedRequired) {
    return {
      status: "not_recorded",
      before,
      after: before,
      required: normalizedRequired,
      deducted: 0,
    };
  }

  return {
    status: "deducted",
    before,
    after: roundQuantity(before - normalizedRequired),
    required: normalizedRequired,
    deducted: normalizedRequired,
  };
}
