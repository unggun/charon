import { connection } from "next/server";
import { db } from "@/lib/db";
import { parseFilters } from "@/lib/filters";
import { listOrders, countOrders } from "@/lib/queries";
import { OrdersTable } from "@/components/orders-table";
import type { OrdersListOptions } from "@/lib/queries";

const PAGE_SIZE = 50;

const VALID_SORTS = new Set<OrdersListOptions["sort"]>([
  "opened_at_ms",
  "closed_at_ms",
  "pnl_sol",
  "pnl_percent",
  "entry_mcap",
  "exit_mcap",
  "symbol",
]);

export default async function OrdersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await connection();
  const sp = await searchParams;
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) if (typeof v === "string") params.set(k, v);
  const filters = parseFilters(params);

  const page = Math.max(1, Number(params.get("page") ?? "1") || 1);
  const sortRaw = params.get("sort") ?? "closed_at_ms";
  const sort: OrdersListOptions["sort"] = VALID_SORTS.has(sortRaw as OrdersListOptions["sort"])
    ? (sortRaw as OrdersListOptions["sort"])
    : "closed_at_ms";
  const dirRaw = params.get("dir");
  const dir: "asc" | "desc" = dirRaw === "asc" ? "asc" : "desc";

  const total = countOrders(db, filters);
  const rows = listOrders(db, filters, { page, pageSize: PAGE_SIZE, sort, dir });

  return (
    <OrdersTable
      rows={rows}
      total={total}
      page={page}
      pageSize={PAGE_SIZE}
      sort={sort}
      dir={dir}
    />
  );
}
