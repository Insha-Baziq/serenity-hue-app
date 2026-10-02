// VAT amounts are exact decimals with two places (the source app used
// numeric(12,2)). They are stored as integer hundredths ("minor units") so no
// value ever passes through binary floating point.

const MAX_MINOR = 99_999_999_999; // numeric(12,2) upper bound in hundredths

/**
 * Parses a typed or exported amount ("1,234.50", "£12", "-3.5") into minor
 * units. Returns null for blank input and throws for anything that is not an
 * exact amount with at most two decimal places.
 */
export function parseMoneyToMinor(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const text = String(value).replace(/[£$€,\s]/g, "");
  if (text === "") return null;
  const match = /^(-?)(\d+)(?:\.(\d{1,2}))?$/.exec(text);
  if (!match) throw new Error("Amounts must be numbers with at most two decimal places");
  const [, sign, whole, fraction = ""] = match;
  const minor = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  if (!Number.isSafeInteger(minor) || minor > MAX_MINOR) throw new Error("Amount is too large");
  return sign && minor !== 0 ? -minor : minor;
}

/** Minor units back to a plain decimal string ("1234.50"), or null. */
export function minorToDecimal(minor: number | null | undefined): string | null {
  if (minor === null || minor === undefined) return null;
  const sign = minor < 0 ? "-" : "";
  const absolute = Math.abs(minor);
  return `${sign}${Math.trunc(absolute / 100)}.${String(absolute % 100).padStart(2, "0")}`;
}

/** Display money with a fixed two decimals so server and browser output match. */
export function formatVatMoney(minor: number | null | undefined, currency: string | null = "GBP") {
  const decimal = minorToDecimal(minor);
  if (decimal === null) return "—";
  try {
    return new Intl.NumberFormat("en-GB", {
      style: "currency",
      currency: currency || "GBP",
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(Number(decimal));
  } catch {
    return `${decimal} ${currency ?? ""}`.trim();
  }
}
