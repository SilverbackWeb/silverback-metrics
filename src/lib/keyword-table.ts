/** Filters and sorting for the "All ranking keywords" table. Pure, unit-tested. */
import type { KeywordRow } from "./seo";

export const SORTS = { volume: "Searches", position: "Position", change: "Change", traffic: "Est. visits", keyword: "Keyword" } as const;
export type Sort = keyof typeof SORTS;
export const FILTERS = { all: "All", top3: "Top 3", page1: "Page 1", page2: "Page 2", deeper: "Page 3+", up: "Moved up", down: "Moved down", new: "New", lost: "Dropped out" } as const;
export type Filter = keyof typeof FILTERS;

export function filterSort(rows: KeywordRow[], lost: KeywordRow[], f: Filter, sort: Sort, q: string) {
  const pos = (r: KeywordRow) => r.position ?? 999;
  let list = f === "lost" ? lost : rows.filter((r) =>
    f === "top3" ? pos(r) <= 3 : f === "page1" ? pos(r) <= 10 : f === "page2" ? pos(r) > 10 && pos(r) <= 20 : f === "deeper" ? pos(r) > 20
      : f === "up" ? (r.change ?? 0) > 0 : f === "down" ? (r.change ?? 0) < 0 : f === "new" ? r.prev === null : true);
  if (q) list = list.filter((r) => r.keyword.includes(q.toLowerCase()));
  const by: Record<Sort, (a: KeywordRow, b: KeywordRow) => number> = {
    volume: (a, b) => (b.searchVolume ?? 0) - (a.searchVolume ?? 0) || pos(a) - pos(b),
    position: (a, b) => pos(a) - pos(b) || (b.searchVolume ?? 0) - (a.searchVolume ?? 0),
    change: (a, b) => (b.change ?? -999) - (a.change ?? -999),
    traffic: (a, b) => (b.etv ?? 0) - (a.etv ?? 0),
    keyword: (a, b) => a.keyword.localeCompare(b.keyword),
  };
  return [...list].sort(by[sort]);
}

