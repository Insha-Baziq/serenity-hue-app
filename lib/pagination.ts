export type PaginationItem = number | "ellipsis";

/**
 * Keep page controls ordered and compact without hiding the current page.
 * A single helper prevents table views from drifting into subtly different pagination rules.
 */
export function getPageItems(currentPage: number, totalPages: number): PaginationItem[] {
  if (totalPages <= 6) return Array.from({ length: totalPages }, (_, index) => index + 1);

  const pages = new Set([1, totalPages, currentPage - 1, currentPage, currentPage + 1]);
  const ordered = [...pages]
    .filter((page) => page >= 1 && page <= totalPages)
    .sort((a, b) => a - b);
  const items: PaginationItem[] = [];

  ordered.forEach((page, index) => {
    if (index > 0 && page - ordered[index - 1] > 1) items.push("ellipsis");
    items.push(page);
  });

  return items;
}
