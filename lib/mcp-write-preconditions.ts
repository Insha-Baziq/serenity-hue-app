export function assertAssistantExpectedValue(
  current: string | number | null,
  expected: string | number | null,
  field: string,
) {
  if (current !== expected) throw new Error(`MCP_STALE_STATE: ${field} changed since it was read`);
}
