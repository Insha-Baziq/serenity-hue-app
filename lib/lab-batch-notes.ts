export const LAB_BATCH_NOTES_MAX_LENGTH = 4_000;

export function normalizeLabBatchNotes(value: string): string {
  const notes = value.replace(/\r\n?/g, "\n").trim();
  if (notes.length > LAB_BATCH_NOTES_MAX_LENGTH) throw new Error("Keep batch notes within 4,000 characters");
  return notes;
}

export function nextLabBatchUpdatedAt(previous: string, now = Date.now()): string {
  const normalized = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(previous)
    ? `${previous.replace(" ", "T")}Z` : previous;
  const priorTime = Date.parse(normalized);
  return new Date(Math.max(now, Number.isNaN(priorTime) ? now : priorTime + 1)).toISOString();
}
