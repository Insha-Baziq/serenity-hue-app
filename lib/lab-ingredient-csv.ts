export type LabIngredientImportRow = {
  title: string;
  quantityGrams?: number;
  reorderPointGrams?: number;
};

type ParseOptions = { maxRows?: number };

function readCsvRows(source: string) {
  const rows: string[][] = [];
  let row: string[] = [];
  let value = "";
  let quoted = false;
  let quoteClosed = false;

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (quoted) {
      if (character === '"' && source[index + 1] === '"') {
        value += '"';
        index += 1;
      } else if (character === '"') {
        quoted = false;
        quoteClosed = true;
      } else {
        value += character;
      }
      continue;
    }

    if (character === '"') {
      if (value.length || quoteClosed) throw new Error(`Invalid CSV quoting near row ${rows.length + 1}`);
      quoted = true;
    } else if (character === ",") {
      row.push(value);
      value = "";
      quoteClosed = false;
    } else if (character === "\n" || character === "\r") {
      if (character === "\r" && source[index + 1] === "\n") index += 1;
      row.push(value);
      if (row.some((cell) => cell.trim())) rows.push(row);
      row = [];
      value = "";
      quoteClosed = false;
    } else if (quoteClosed) {
      if (!/\s/.test(character)) throw new Error(`Unexpected text after a quoted value near row ${rows.length + 1}`);
    } else {
      value += character;
    }
  }

  if (quoted) throw new Error("A quoted CSV value is not closed.");
  row.push(value);
  if (row.some((cell) => cell.trim())) rows.push(row);
  return rows;
}

function normalizedHeader(value: string) {
  return value.replace(/^\uFEFF/, "").trim().toLowerCase().replace(/[\s()-]+/g, "_").replace(/_+/g, "_").replace(/^_|_$/g, "");
}

function optionalGrams(value: string | undefined, rowNumber: number, label: string) {
  const input = value?.trim() ?? "";
  if (!input) return undefined;
  const amount = Number(input);
  if (!Number.isFinite(amount) || amount < 0) throw new Error(`Row ${rowNumber}: ${label} must be zero or a positive number of grams.`);
  return amount;
}

/** Parses an ingredient inventory CSV. Blank quantities remain explicitly uncounted. */
export function parseLabIngredientCsv(source: string, { maxRows = 500 }: ParseOptions = {}): LabIngredientImportRow[] {
  const rows = readCsvRows(source);
  if (!rows.length) throw new Error("The CSV is empty. Add a header and at least one ingredient.");

  const headers = rows[0].map(normalizedHeader);
  const ingredientColumn = headers.findIndex((header) => ["ingredient", "ingredient_name", "name", "title"].includes(header));
  if (ingredientColumn < 0) throw new Error("The CSV needs an ingredient column (ingredient, ingredient_name, name, or title).");
  const quantityColumn = headers.findIndex((header) => ["quantity_grams", "on_hand_grams", "quantity_g", "on_hand_g", "quantity"].includes(header));
  const reorderColumn = headers.findIndex((header) => ["reorder_point_grams", "reorder_point_g", "reorder_point"].includes(header));
  if (new Set(headers).size !== headers.length) throw new Error("The CSV contains duplicate column headings.");

  const dataRows = rows.slice(1);
  if (!dataRows.length) throw new Error("The CSV has no ingredient rows.");
  if (dataRows.length > maxRows) throw new Error(`Import at most ${maxRows} ingredients at a time.`);

  return dataRows.map((cells, index) => {
    const rowNumber = index + 2;
    if (cells.length > headers.length && cells.slice(headers.length).some((cell) => cell.trim())) {
      throw new Error(`Row ${rowNumber}: there are more values than column headings.`);
    }
    const title = cells[ingredientColumn]?.trim() ?? "";
    if (!title) throw new Error(`Row ${rowNumber}: ingredient name is required.`);
    if (title.length > 180) throw new Error(`Row ${rowNumber}: ingredient names must be 180 characters or fewer.`);
    const quantityGrams = optionalGrams(cells[quantityColumn], rowNumber, "Quantity");
    const reorderPointGrams = optionalGrams(cells[reorderColumn], rowNumber, "Reorder point");
    return { title, quantityGrams, reorderPointGrams };
  });
}
