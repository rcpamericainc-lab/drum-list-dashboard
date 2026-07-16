"use client";

import { useMemo, useRef, useState } from "react";

import { ItemStatusBadge } from "@/components/item-status-badge";
import type { Database, OrderItem, OrderStatus } from "@/lib/database.types";
import { createClient } from "@/lib/supabase/browser";
import { ordersToCsv } from "@/lib/csv";
import { ORDER_STATUSES, STATUS_META } from "@/lib/order-status";
import { formatDate, formatWeekLabel } from "@/lib/order-week";
import {
  getBaseDelivery,
  isCancelled,
  isFulfilled,
  isMoved,
  isNoCutoffRoute,
  itemDeliveryDate,
  itemWeeks,
  normalizeItems,
  returningQty,
  rollupStatus,
} from "@/lib/order-items";

export type OfficeOrder = Database["public"]["Tables"]["orders"]["Row"];

type SortKey =
  | "route"
  | "customer"
  | "placed_by"
  | "date_needed"
  | "delivery"
  | "placed"
  | "invoice"
  | "availability";

/** Comparable value for a column; numbers sort numerically, strings alphabetically. */
function sortValue(o: OfficeOrder, key: SortKey): string | number {
  switch (key) {
    case "route": {
      const n = Number(o.route_number);
      return Number.isFinite(n) ? n : Number.POSITIVE_INFINITY;
    }
    case "customer":
      return o.customer_name.toLowerCase();
    case "placed_by":
      return (o.driver_name ?? "").toLowerCase();
    case "date_needed":
      return o.date_needed;
    case "delivery":
      return getBaseDelivery(o) ?? "";
    case "placed":
      return o.created_at;
    case "invoice":
      return (o.invoice_number ?? "").toLowerCase();
    case "availability":
      return ORDER_STATUSES.indexOf(rollupStatus(o.items));
  }
}

/** An order counts as invoiced once it has a non-blank invoice number. */
function hasInvoice(o: OfficeOrder): boolean {
  return (o.invoice_number ?? "").trim() !== "";
}


/** "Jul 7, 3:00 PM" — the office computer's local (Eastern) time. */
function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function OfficeDashboard({
  initialOrders,
}: {
  initialOrders: OfficeOrder[];
}) {
  const supabase = useMemo(() => createClient(), []);
  // Normalize so every item carries a status (pre-migration rows fall back to
  // the order's status).
  const [orders, setOrders] = useState<OfficeOrder[]>(() =>
    initialOrders.map((o) => ({ ...o, items: normalizeItems(o) })),
  );
  // Empty = all routes; otherwise the specific routes to show together.
  const [selectedRoutes, setSelectedRoutes] = useState<string[]>([]);
  const [statusFilter, setStatusFilter] = useState<
    OrderStatus | "moved" | "all"
  >("all");
  const [invoiceFilter, setInvoiceFilter] = useState<"all" | "with" | "without">(
    "all",
  );
  const [weekFilter, setWeekFilter] = useState("all");
  const [dayFilter, setDayFilter] = useState("all");
  const [fulfillmentFilter, setFulfillmentFilter] = useState<
    "all" | "pending" | "fulfilled" | "cancelled"
  >("all");
  const [returnsFilter, setReturnsFilter] = useState<"all" | "has_returns">(
    "all",
  );
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>("placed");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [pageSize, setPageSize] = useState(25);
  const [page, setPage] = useState(1);
  // The invoice value when an input was focused, so we can skip no-op saves and
  // roll back to it if the write fails.
  const invoiceFocusRef = useRef("");

  const routes = useMemo(
    () => Array.from(new Set(orders.map((o) => o.route_number))).sort(),
    [orders],
  );
  const weeks = useMemo(
    () =>
      Array.from(
        new Set(orders.flatMap((o) => o.items.flatMap((it) => itemWeeks(o, it)))),
      )
        .sort()
        .reverse(),
    [orders],
  );
  const deliveryDays = useMemo(
    () =>
      Array.from(
        new Set(
          orders.flatMap((o) =>
            o.items
              .map((it) => itemDeliveryDate(o, it))
              .filter((d): d is string => d !== null),
          ),
        ),
      )
        .sort()
        .reverse(),
    [orders],
  );

  // An order matches if ANY of its items matches — the whole order stays visible
  // so its context (customer, other items) is never split apart.
  const filtered = orders.filter(
    (o) =>
      (selectedRoutes.length === 0 ||
        selectedRoutes.includes(o.route_number)) &&
      (statusFilter === "all" ||
        (statusFilter === "moved"
          ? o.items.some(isMoved)
          : o.items.some((it) => it.status === statusFilter))) &&
      (invoiceFilter === "all" ||
        (invoiceFilter === "with" ? hasInvoice(o) : !hasInvoice(o))) &&
      (weekFilter === "all" ||
        o.items.some((it) => itemWeeks(o, it).includes(weekFilter))) &&
      (dayFilter === "all" ||
        o.items.some((it) => itemDeliveryDate(o, it) === dayFilter)) &&
      (fulfillmentFilter === "all" ||
        o.items.some((it) =>
          fulfillmentFilter === "pending"
            ? it.fulfillment == null
            : it.fulfillment === fulfillmentFilter,
        )) &&
      (returnsFilter === "all" ||
        o.items.some((it) => returningQty(it) > 0)),
  );

  const sorted = [...filtered].sort((a, b) => {
    const va = sortValue(a, sortKey);
    const vb = sortValue(b, sortKey);
    let cmp =
      typeof va === "number" && typeof vb === "number"
        ? va - vb
        : String(va).localeCompare(String(vb));
    if (cmp === 0) cmp = a.created_at.localeCompare(b.created_at); // stable tiebreak
    return sortDir === "asc" ? cmp : -cmp;
  });

  const hasFilters =
    selectedRoutes.length > 0 ||
    statusFilter !== "all" ||
    invoiceFilter !== "all" ||
    weekFilter !== "all" ||
    dayFilter !== "all" ||
    fulfillmentFilter !== "all" ||
    returnsFilter !== "all";

  // Pagination. Reset to page 1 whenever the filter set changes, using React's
  // adjust-state-during-render pattern (no effect, so no cascading renders).
  const filterKey = JSON.stringify([
    [...selectedRoutes].sort(),
    statusFilter,
    invoiceFilter,
    weekFilter,
    dayFilter,
    fulfillmentFilter,
    returnsFilter,
    pageSize,
  ]);
  const [lastFilterKey, setLastFilterKey] = useState(filterKey);
  if (filterKey !== lastFilterKey) {
    setLastFilterKey(filterKey);
    setPage(1);
  }
  const totalPages = Math.max(1, Math.ceil(sorted.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const pageStart = (currentPage - 1) * pageSize;
  const pageOrders = sorted.slice(pageStart, pageStart + pageSize);
  const rangeStart = sorted.length === 0 ? 0 : pageStart + 1;
  const rangeEnd = pageStart + pageOrders.length;

  function handleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  }

  function toggleRoute(route: string) {
    setSelectedRoutes((prev) =>
      prev.includes(route)
        ? prev.filter((r) => r !== route)
        : [...prev, route],
    );
  }

  // Persist a new items array for an order. Optimistic update + rollback; the
  // rollup status is recomputed so the availability filter/exports stay right.
  async function persistItems(
    order: OfficeOrder,
    nextItems: OrderItem[],
    failMessage: string,
  ) {
    setError(null);
    const nextStatus = rollupStatus(nextItems);
    const previous = orders;
    setOrders((os) =>
      os.map((o) =>
        o.id === order.id ? { ...o, items: nextItems, status: nextStatus } : o,
      ),
    );
    setBusyId(order.id);

    const { error: updateError } = await supabase
      .from("orders")
      .update({ items: nextItems, status: nextStatus })
      .eq("id", order.id);

    setBusyId(null);
    if (updateError) {
      setOrders(previous); // rollback
      setError(`${failMessage}: ${updateError.message}`);
    }
  }

  // Set one item's stock availability. Marking out-of-stock is an action, not a
  // resting state: it pushes the item one unit forward (a day for 4/6/14, a
  // week otherwise) and reopens it, so it can be pushed again next time. The
  // scheduled date is derived from the bump count; the original date is kept.
  function setItemStatus(order: OfficeOrder, index: number, next: OrderStatus) {
    const current = order.items[index];
    if (!current) return;

    if (next === "out_of_stock") {
      const nextItems = order.items.map((it, i) =>
        i === index
          ? { ...it, status: "open" as const, bumps: (it.bumps ?? 0) + 1 }
          : it,
      );
      persistItems(order, nextItems, "Couldn't move the item");
      return;
    }

    if (current.status === next) return;
    const nextItems = order.items.map((it, i) =>
      i === index ? { ...it, status: next } : it,
    );
    persistItems(order, nextItems, "Couldn't update availability");
  }

  // Cancel (soft-retire) or restore items — office only. Cancelling sets
  // fulfillment to "cancelled"; restoring clears it back to pending. `indices`
  // is a list of item positions, or "all" for the whole order.
  function setItemsCancelled(
    order: OfficeOrder,
    indices: number[] | "all",
    cancelled: boolean,
  ) {
    const hit = (i: number) => indices === "all" || indices.includes(i);
    const nextItems: OrderItem[] = order.items.map((it, i) =>
      hit(i)
        ? { ...it, fulfillment: cancelled ? ("cancelled" as const) : null }
        : it,
    );
    persistItems(
      order,
      nextItems,
      cancelled ? "Couldn't cancel" : "Couldn't restore",
    );
  }

  async function saveInvoice(id: string, rawValue: string) {
    if (rawValue === invoiceFocusRef.current) return; // unchanged
    setError(null);
    const normalized = rawValue.trim() === "" ? null : rawValue.trim();
    setOrders((os) =>
      os.map((o) => (o.id === id ? { ...o, invoice_number: normalized } : o)),
    );

    const { error: updateError } = await supabase
      .from("orders")
      .update({ invoice_number: normalized })
      .eq("id", id);

    if (updateError) {
      const reverted =
        invoiceFocusRef.current.trim() === ""
          ? null
          : invoiceFocusRef.current.trim();
      setOrders((os) =>
        os.map((o) => (o.id === id ? { ...o, invoice_number: reverted } : o)),
      );
      setError(`Couldn't save invoice number: ${updateError.message}`);
    }
  }

  function updateInvoiceLocal(id: string, invoice_number: string) {
    setOrders((os) =>
      os.map((o) => (o.id === id ? { ...o, invoice_number } : o)),
    );
  }

  function exportCurrentView() {
    if (sorted.length === 0) {
      setError("No orders match the current filters — nothing to export.");
      return;
    }
    setError(null);

    const parts = ["orders"];
    if (selectedRoutes.length > 0)
      parts.push(`routes-${[...selectedRoutes].sort().join("-")}`);
    if (statusFilter !== "all") parts.push(statusFilter);
    if (invoiceFilter !== "all") parts.push(`invoice-${invoiceFilter}`);
    if (fulfillmentFilter !== "all") parts.push(fulfillmentFilter);
    if (returnsFilter !== "all") parts.push("returns");
    if (dayFilter !== "all") parts.push(`day-${dayFilter}`);
    if (weekFilter !== "all") parts.push(`week-${weekFilter}`);

    const blob = new Blob([ordersToCsv(sorted)], {
      type: "text/csv;charset=utf-8;",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${parts.join("_")}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  function printCurrentView() {
    if (sorted.length === 0) {
      setError("No orders match the current filters — nothing to print.");
      return;
    }
    setError(null);

    const activeFilters: string[] = [];
    if (selectedRoutes.length > 0)
      activeFilters.push(
        `Route${selectedRoutes.length === 1 ? "" : "s"}: ${[...selectedRoutes].sort().join(", ")}`,
      );
    if (statusFilter !== "all")
      activeFilters.push(
        `Availability: ${statusFilter === "moved" ? "Moved" : STATUS_META[statusFilter].label}`,
      );
    if (invoiceFilter !== "all")
      activeFilters.push(
        `Invoice: ${invoiceFilter === "with" ? "With invoice #" : "Without invoice #"}`,
      );
    if (fulfillmentFilter !== "all")
      activeFilters.push(
        `Fulfillment: ${fulfillmentFilter[0].toUpperCase()}${fulfillmentFilter.slice(1)}`,
      );
    if (returnsFilter !== "all") activeFilters.push("Has returns");
    if (dayFilter !== "all")
      activeFilters.push(`Delivery day: ${formatDate(dayFilter)}`);
    if (weekFilter !== "all")
      activeFilters.push(`Order week: ${formatWeekLabel(weekFilter)}`);

    const win = window.open("", "_blank", "width=1000,height=720");
    if (!win) {
      setError("Couldn't open the print window — check your pop-up blocker.");
      return;
    }
    win.document.write(
      buildPrintHtml(sorted, activeFilters, window.location.origin),
    );
    win.document.close();
  }

  const sortProps = { sortKey, sortDir, onSort: handleSort };

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="space-y-4 border border-[#1A1A1A]/10 bg-white p-4 shadow-sm">
        <div>
          <span className="text-xs font-semibold uppercase text-[#444444]">
            Routes
          </span>
          <div className="mt-1 flex flex-wrap gap-2">
            <RouteChip
              active={selectedRoutes.length === 0}
              onClick={() => setSelectedRoutes([])}
            >
              All routes
            </RouteChip>
            {routes.map((r) => (
              <RouteChip
                key={r}
                active={selectedRoutes.includes(r)}
                onClick={() => toggleRoute(r)}
              >
                Route {r}
              </RouteChip>
            ))}
          </div>
        </div>
        <div className="flex flex-wrap items-end gap-4">
          <FilterSelect
            label="Availability"
            value={statusFilter}
            onChange={(v) => setStatusFilter(v as OrderStatus | "moved" | "all")}
            options={[
              { value: "all", label: "All" },
              { value: "open", label: STATUS_META.open.label },
              { value: "in_stock", label: STATUS_META.in_stock.label },
              { value: "moved", label: "Moved" },
            ]}
          />
          <FilterSelect
            label="Invoice"
            value={invoiceFilter}
            onChange={(v) => setInvoiceFilter(v as "all" | "with" | "without")}
            options={[
              { value: "all", label: "All" },
              { value: "with", label: "With invoice #" },
              { value: "without", label: "Without invoice #" },
            ]}
          />
          <FilterSelect
            label="Delivery day"
            value={dayFilter}
            onChange={setDayFilter}
            options={[
              { value: "all", label: "All days" },
              ...deliveryDays.map((d) => ({ value: d, label: formatDate(d) })),
            ]}
          />
          <FilterSelect
            label="Order week"
            value={weekFilter}
            onChange={setWeekFilter}
            options={[
              { value: "all", label: "All weeks" },
              ...weeks.map((w) => ({ value: w, label: formatWeekLabel(w) })),
            ]}
          />
          <FilterSelect
            label="Fulfillment"
            value={fulfillmentFilter}
            onChange={(v) =>
              setFulfillmentFilter(
                v as "all" | "pending" | "fulfilled" | "cancelled",
              )
            }
            options={[
              { value: "all", label: "All" },
              { value: "pending", label: "Pending" },
              { value: "fulfilled", label: "Fulfilled" },
              { value: "cancelled", label: "Cancelled" },
            ]}
          />
          <FilterSelect
            label="Returns"
            value={returnsFilter}
            onChange={(v) => setReturnsFilter(v as "all" | "has_returns")}
            options={[
              { value: "all", label: "All" },
              { value: "has_returns", label: "Has returns" },
            ]}
          />
          {hasFilters && (
            <button
              type="button"
              onClick={() => {
                setSelectedRoutes([]);
                setStatusFilter("all");
                setInvoiceFilter("all");
                setWeekFilter("all");
                setDayFilter("all");
                setFulfillmentFilter("all");
                setReturnsFilter("all");
              }}
              className="ml-auto h-10 border border-[#888888]/40 bg-white px-3 text-sm font-semibold uppercase text-[#444444] hover:bg-[#F5F5F5]"
            >
              Clear filters
            </button>
          )}
        </div>
      </div>

      {/* Export */}
      <div className="flex flex-wrap items-center gap-3 border border-[#1A1A1A]/10 bg-white p-4 shadow-sm">
        <button
          type="button"
          onClick={exportCurrentView}
          className="h-10 bg-[#009ACE] px-4 text-sm font-semibold uppercase text-white transition hover:bg-[#0084B0]"
        >
          Export CSV
        </button>
        <button
          type="button"
          onClick={printCurrentView}
          className="h-10 border border-[#009ACE] bg-white px-4 text-sm font-semibold uppercase text-[#1A1A1A] transition hover:bg-[#009ACE] hover:text-white"
        >
          Print
        </button>
        <span className="text-sm text-[#888888]">
          Export or print the {filtered.length} order
          {filtered.length === 1 ? "" : "s"} matching the filters above.
        </span>
      </div>

      {error && (
        <p className="border border-red-200 bg-red-50 px-3 py-2 text-sm font-medium text-red-700">
          {error}
        </p>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm font-medium text-[#888888]">
          Showing{" "}
          <span className="text-[#1A1A1A]">
            {rangeStart}–{rangeEnd}
          </span>{" "}
          of {filtered.length} matching · {orders.length} total
        </p>
        <PaginationBar
          page={currentPage}
          totalPages={totalPages}
          pageSize={pageSize}
          onPage={setPage}
          onPageSize={(n) => {
            setPageSize(n);
            setPage(1);
          }}
        />
      </div>

      {/* Orders table — one row per item, order details span the group */}
      <div className="overflow-x-auto border border-[#1A1A1A]/10 bg-white shadow-sm">
        <table className="w-full min-w-[900px] text-left text-sm">
          <thead className="border-b border-[#888888]/25 bg-[#1A1A1A] text-xs uppercase text-white">
            <tr>
              <SortHeader label="Route" columnKey="route" {...sortProps} />
              <Th>Product</Th>
              <SortHeader label="Customer" columnKey="customer" {...sortProps} />
              <SortHeader label="Placed by" columnKey="placed_by" {...sortProps} />
              <SortHeader
                label="Date needed"
                columnKey="date_needed"
                {...sortProps}
              />
              <Th>Delivery</Th>
              <SortHeader label="Time placed" columnKey="placed" {...sortProps} />
              <SortHeader label="Invoice #" columnKey="invoice" {...sortProps} />
              <SortHeader
                label="Availability"
                columnKey="availability"
                {...sortProps}
              />
              <Th>Fulfillment</Th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#888888]/20">
            {sorted.length === 0 ? (
              <tr>
                <td
                  colSpan={10}
                  className="px-4 py-12 text-center text-[#888888]"
                >
                  {orders.length === 0
                    ? "No orders have been placed yet."
                    : "No orders match these filters."}
                </td>
              </tr>
            ) : (
              pageOrders.flatMap((o) => {
                const items = o.items;
                const n = items.length;
                const busy = busyId === o.id;
                const allCancelled = items.length > 0 && items.every(isCancelled);
                return items.map((it, idx) => (
                  <tr
                    key={`${o.id}:${idx}`}
                    className={`hover:bg-[#F5F5F5] ${idx === 0 ? "border-t-2 border-[#1A1A1A]/15" : ""}`}
                  >
                    {idx === 0 && (
                      <Td
                        rowSpan={n}
                        className="align-top font-semibold text-[#1A1A1A]"
                      >
                        {o.route_number}
                      </Td>
                    )}
                    <Td className="align-top">
                      <div className="max-w-[240px] break-words">
                        {it.product_name}
                      </div>
                      {it.quantity > 1 && (
                        <div className="text-xs text-[#888888]">
                          Qty {it.quantity}
                        </div>
                      )}
                    </Td>
                    {idx === 0 && (
                      <Td rowSpan={n} className="align-top">
                        <div>{o.customer_name}</div>
                        {o.customer_address && (
                          <div className="text-xs text-[#888888]">
                            {o.customer_address}
                          </div>
                        )}
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() =>
                            setItemsCancelled(o, "all", !allCancelled)
                          }
                          className="mt-1 text-xs font-semibold uppercase text-[#888888] underline-offset-2 hover:text-[#B00020] hover:underline disabled:opacity-50"
                        >
                          {allCancelled ? "Restore order" : "Cancel order"}
                        </button>
                      </Td>
                    )}
                    {idx === 0 && (
                      <Td rowSpan={n} className="align-top">
                        {o.driver_name ?? "—"}
                      </Td>
                    )}
                    {idx === 0 && (
                      <Td rowSpan={n} className="align-top">
                        {formatDate(o.date_needed)}
                      </Td>
                    )}
                    <Td className="align-top">
                      <ItemDelivery order={o} item={it} />
                    </Td>
                    {idx === 0 && (
                      <Td
                        rowSpan={n}
                        className="align-top whitespace-nowrap"
                      >
                        {formatDateTime(o.created_at)}
                      </Td>
                    )}
                    {idx === 0 && (
                      <Td rowSpan={n} className="align-top">
                        <input
                          type="text"
                          value={o.invoice_number ?? ""}
                          placeholder="Add #"
                          onFocus={(e) => {
                            invoiceFocusRef.current = e.target.value;
                          }}
                          onChange={(e) =>
                            updateInvoiceLocal(o.id, e.target.value)
                          }
                          onBlur={(e) => saveInvoice(o.id, e.target.value)}
                          className="h-9 w-28 border border-[#888888]/50 bg-white px-2 text-sm text-[#1A1A1A] outline-none placeholder:text-[#888888] focus:border-[#009ACE] focus:ring-2 focus:ring-[#009ACE]/20"
                        />
                      </Td>
                    )}
                    <Td className="align-top">
                      {isCancelled(it) ? (
                        <span className="text-xs text-[#888888]">
                          {STATUS_META[it.status].label}
                        </span>
                      ) : (
                        <select
                          value={it.status}
                          disabled={busy}
                          title={
                            isNoCutoffRoute(o.route_number)
                              ? "No-cutoff route — out-of-stock moves to the next day"
                              : undefined
                          }
                          onChange={(e) =>
                            setItemStatus(o, idx, e.target.value as OrderStatus)
                          }
                          className="h-9 border border-[#888888]/50 bg-white px-2 text-sm font-semibold text-[#1A1A1A] outline-none focus:border-[#009ACE] focus:ring-2 focus:ring-[#009ACE]/20 disabled:opacity-50"
                        >
                          {ORDER_STATUSES.map((s) => (
                            <option key={s} value={s}>
                              {STATUS_META[s].label}
                            </option>
                          ))}
                        </select>
                      )}
                    </Td>
                    <Td className="align-top">
                      <ItemFulfillment
                        item={it}
                        busy={busy}
                        onCancel={() => setItemsCancelled(o, [idx], true)}
                        onRestore={() => setItemsCancelled(o, [idx], false)}
                      />
                    </Td>
                  </tr>
                ));
              })
            )}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div className="flex justify-end">
          <PaginationBar
            page={currentPage}
            totalPages={totalPages}
            pageSize={pageSize}
            onPage={setPage}
            onPageSize={(n) => {
              setPageSize(n);
              setPage(1);
            }}
          />
        </div>
      )}
    </div>
  );
}

const PAGE_SIZES = [25, 50, 100];

/** Prev/next pager with a page indicator and a rows-per-page selector. */
function PaginationBar({
  page,
  totalPages,
  pageSize,
  onPage,
  onPageSize,
}: {
  page: number;
  totalPages: number;
  pageSize: number;
  onPage: (updater: (p: number) => number) => void;
  onPageSize: (n: number) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <button
        type="button"
        onClick={() => onPage((p) => Math.max(1, p - 1))}
        disabled={page <= 1}
        className="h-9 border border-[#888888]/40 bg-white px-3 text-sm font-semibold uppercase text-[#444444] transition hover:bg-[#F5F5F5] disabled:cursor-not-allowed disabled:opacity-40"
      >
        ‹ Prev
      </button>
      <span className="px-1 text-sm font-medium text-[#444444]">
        Page {page} of {totalPages}
      </span>
      <button
        type="button"
        onClick={() => onPage((p) => Math.min(totalPages, p + 1))}
        disabled={page >= totalPages}
        className="h-9 border border-[#888888]/40 bg-white px-3 text-sm font-semibold uppercase text-[#444444] transition hover:bg-[#F5F5F5] disabled:cursor-not-allowed disabled:opacity-40"
      >
        Next ›
      </button>
      <label className="ml-2 flex items-center gap-1.5 text-sm text-[#888888]">
        Rows
        <select
          value={pageSize}
          onChange={(e) => onPageSize(Number(e.target.value))}
          className="h-9 border border-[#888888]/50 bg-white px-2 text-sm text-[#1A1A1A] outline-none focus:border-[#009ACE] focus:ring-2 focus:ring-[#009ACE]/20"
        >
          {PAGE_SIZES.map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}

/**
 * Per-item fulfillment cell: the driver's delivery report (Fulfilled with the
 * delivered/returning counts and any note) or a muted "Pending", plus the
 * office-only Cancel/Restore control.
 */
function ItemFulfillment({
  item,
  busy,
  onCancel,
  onRestore,
}: {
  item: OrderItem;
  busy: boolean;
  onCancel: () => void;
  onRestore: () => void;
}) {
  const returning = returningQty(item);
  return (
    <div className="flex flex-col items-start gap-1">
      {item.fulfillment ? (
        <ItemStatusBadge item={item} />
      ) : (
        <span className="text-xs font-medium text-[#888888]">Pending</span>
      )}
      {isFulfilled(item) && item.quantity_fulfilled != null && (
        <span className="text-xs text-[#444444]">
          {item.quantity_fulfilled} of {item.quantity} delivered
          {returning > 0 && (
            <span className="font-semibold text-[#B00020]">
              {" · "}
              {returning} returning
            </span>
          )}
        </span>
      )}
      {item.note && (
        <span className="max-w-[220px] break-words text-xs italic text-[#888888]">
          “{item.note}”
        </span>
      )}
      <button
        type="button"
        disabled={busy}
        onClick={isCancelled(item) ? onRestore : onCancel}
        className="text-xs font-semibold uppercase text-[#888888] underline-offset-2 hover:text-[#B00020] hover:underline disabled:opacity-50"
      >
        {isCancelled(item) ? "Restore" : "Cancel"}
      </button>
    </div>
  );
}

/**
 * Per-item delivery cell. A pushed item shows its original date struck through
 * with the current scheduled date beside it (the original shifted forward by
 * however many times it has been marked out of stock).
 */
function ItemDelivery({
  order,
  item,
}: {
  order: OfficeOrder;
  item: OrderItem;
}) {
  const base = getBaseDelivery(order);
  if (base === null) return <>—</>;
  if (isMoved(item)) {
    return (
      <span className="inline-flex flex-wrap items-baseline gap-x-1.5">
        <span className="text-[#888888] line-through decoration-[#009ACE] decoration-2">
          {formatDate(base)}
        </span>
        <span className="font-semibold text-[#009ACE]">
          {formatDate(itemDeliveryDate(order, item)!)}
        </span>
      </span>
    );
  }
  return <>{formatDate(base)}</>;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Build a self-contained, branded HTML document for printing the current view.
 * One row per item so per-item availability + delivery are visible; the order's
 * shared details repeat down its items.
 */
function buildPrintHtml(
  orders: OfficeOrder[],
  activeFilters: string[],
  origin: string,
): string {
  const printedAt = new Date().toLocaleString("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  });

  let itemCount = 0;
  const rows = orders
    .map((o) => {
      const n = o.items.length;
      return o.items
        .map((it, idx) => {
          itemCount++;
          const delivery = itemDeliveryDate(o, it);
          const shared =
            idx === 0
              ? `
          <td class="route" rowspan="${n}">${escapeHtml(o.route_number)}</td>`
              : "";
          const sharedTail =
            idx === 0
              ? `
          <td rowspan="${n}">${escapeHtml(o.customer_name)}${o.customer_address ? `<br><span class="addr">${escapeHtml(o.customer_address)}</span>` : ""}</td>
          <td rowspan="${n}">${escapeHtml(o.driver_name ?? "—")}</td>
          <td rowspan="${n}">${escapeHtml(formatDate(o.date_needed))}</td>`
              : "";
          const sharedTail2 =
            idx === 0
              ? `
          <td rowspan="${n}">${o.invoice_number ? escapeHtml(o.invoice_number) : "—"}</td>`
              : "";
          const returning = returningQty(it);
          const fulfillmentCell = isCancelled(it)
            ? "Cancelled"
            : isFulfilled(it)
              ? `Fulfilled${
                  it.quantity_fulfilled != null
                    ? ` (${it.quantity_fulfilled} of ${it.quantity})`
                    : ""
                }${returning > 0 ? `<br><span class="back">${returning} returning</span>` : ""}${
                  it.note ? `<br><span class="addr">${escapeHtml(it.note)}</span>` : ""
                }`
              : "Pending";
          return `
        <tr${idx === 0 ? ' class="order-start"' : ""}>${shared}
          <td>${escapeHtml(it.product_name)}${it.quantity > 1 ? ` <span class="qty">×${it.quantity}</span>` : ""}</td>${sharedTail}
          <td>${delivery ? escapeHtml(formatDate(delivery)) : "—"}</td>${sharedTail2}
          <td class="status">${escapeHtml(STATUS_META[it.status].label)}</td>
          <td>${fulfillmentCell}</td>
        </tr>`;
        })
        .join("");
    })
    .join("");

  const filterLine =
    activeFilters.length > 0
      ? `Filters: ${escapeHtml(activeFilters.join("  •  "))}`
      : "All orders (no filters applied)";

  const count = `${orders.length} order${orders.length === 1 ? "" : "s"} · ${itemCount} item${itemCount === 1 ? "" : "s"}`;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>Order Management — RCP America</title>
<style>
  * { box-sizing: border-box; }
  html { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  body {
    margin: 32px;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    color: #1A1A1A;
  }
  .head {
    display: flex; justify-content: space-between; align-items: flex-start; gap: 24px;
    border-bottom: 3px solid #009ACE; padding-bottom: 16px; margin-bottom: 16px;
  }
  .head img { height: 44px; width: auto; display: block; }
  .eyebrow {
    margin: 12px 0 0; font-size: 11px; font-weight: 700; letter-spacing: 0.06em;
    text-transform: uppercase; color: #009ACE;
  }
  h1 { margin: 2px 0 0; font-size: 26px; letter-spacing: -0.01em; }
  .meta { text-align: right; font-size: 12px; color: #444444; line-height: 1.6; white-space: nowrap; }
  .meta strong { color: #1A1A1A; }
  .filters { font-size: 12px; color: #444444; margin: 0 0 16px; }
  table { width: 100%; border-collapse: collapse; font-size: 12px; }
  thead th {
    background: #1A1A1A; color: #ffffff; text-align: left; padding: 8px 10px;
    font-size: 10px; font-weight: 700; letter-spacing: 0.04em; text-transform: uppercase;
  }
  tbody td { padding: 7px 10px; border-bottom: 1px solid #dddddd; vertical-align: top; }
  tbody tr.order-start td { border-top: 2px solid #bbbbbb; }
  td.route { font-weight: 700; }
  td.status { text-transform: capitalize; }
  .qty { color: #888888; }
  .addr { font-size: 10px; color: #888888; }
  .back { font-size: 10px; font-weight: 700; color: #B00020; }
  tfoot td { padding-top: 12px; font-size: 11px; color: #888888; }
  @page { size: landscape; margin: 0.5in; }
</style>
</head>
<body onload="window.focus(); window.print();">
  <div class="head">
    <div>
      <img src="${escapeHtml(origin)}/rcp-america-wordmark.png" alt="RCP America" />
      <p class="eyebrow">Office</p>
      <h1>Order Management</h1>
    </div>
    <div class="meta">
      <div><strong>${escapeHtml(count)}</strong></div>
      <div>Printed ${escapeHtml(printedAt)}</div>
    </div>
  </div>
  <p class="filters">${filterLine}</p>
  <table>
    <thead>
      <tr>
        <th>Route</th><th>Product</th><th>Customer</th><th>Placed by</th>
        <th>Date needed</th><th>Delivery</th><th>Invoice #</th><th>Availability</th>
        <th>Fulfillment</th>
      </tr>
    </thead>
    <tbody>${rows}
    </tbody>
  </table>
</body>
</html>`;
}

type Option = { value: string; label: string };

function FilterSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: Option[];
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs font-semibold uppercase text-[#444444]">
        {label}
      </span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-10 border border-[#888888]/50 bg-white px-3 text-sm text-[#1A1A1A] outline-none focus:border-[#009ACE] focus:ring-2 focus:ring-[#009ACE]/20"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function RouteChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`border px-3 py-1.5 text-sm font-semibold transition ${
        active
          ? "border-[#009ACE] bg-[#009ACE] text-white"
          : "border-[#888888]/40 bg-white text-[#444444] hover:bg-[#F5F5F5]"
      }`}
    >
      {children}
    </button>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return <th className="px-4 py-3 font-semibold">{children}</th>;
}

function SortHeader({
  label,
  columnKey,
  sortKey,
  sortDir,
  onSort,
}: {
  label: string;
  columnKey: SortKey;
  sortKey: SortKey;
  sortDir: "asc" | "desc";
  onSort: (key: SortKey) => void;
}) {
  const active = sortKey === columnKey;
  return (
    <th className="px-4 py-3 font-semibold">
      <button
        type="button"
        onClick={() => onSort(columnKey)}
        className="inline-flex items-center gap-1 whitespace-nowrap uppercase transition hover:text-white/80"
      >
        {label}
        <span
          aria-hidden
          className={active ? "text-[#009ACE]" : "text-white/30"}
        >
          {active ? (sortDir === "asc" ? "▲" : "▼") : "↕"}
        </span>
      </button>
    </th>
  );
}

function Td({
  children,
  className = "",
  rowSpan,
}: {
  children: React.ReactNode;
  className?: string;
  rowSpan?: number;
}) {
  return (
    <td rowSpan={rowSpan} className={`px-4 py-3 text-[#444444] ${className}`}>
      {children}
    </td>
  );
}
