import type { ActivityDetailValue, ActivityDetails } from "@/lib/types";

const SENSITIVE_ACTIVITY_KEY = /(address|email|phone|token|secret|password|oauth|credential|payload|cookie|authorization|refresh|access)/i;

function safeValue(value: ActivityDetailValue) {
  if (typeof value === "string") return value.length <= 500 ? value : undefined;
  if (typeof value === "number" || typeof value === "boolean" || value === null) return value;
  return value.filter((item): item is string | number => (typeof item === "string" && item.length <= 500) || typeof item === "number").slice(0, 50);
}

/** Removes fields that are not appropriate for a staff-facing activity feed. */
export function sanitizeActivityDetails(details: ActivityDetails | undefined): ActivityDetails {
  if (!details) return {};
  return Object.fromEntries(Object.entries(details).flatMap(([key, value]) => {
    if (SENSITIVE_ACTIVITY_KEY.test(key)) return [];
    const sanitized = safeValue(value);
    return sanitized === undefined ? [] : [[key, sanitized]];
  }));
}
