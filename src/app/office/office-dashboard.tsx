"use client";

import { useMemo, useRef, useState } from "react";

import { StatusBadge } from "@/components/status-badge";
import type { Database, OrderStatus } from "@/lib/database.types";
import { createClient } from "@/lib/supabase/browser";
import { ordersToCsv } from "@/lib/csv";
import { ORDER_STATUSES, STATUS_META } from "@/lib/order-status";
import {
  formatDate,
  formatWeekLabel,
  parseDateKey,
  toDateKey,
} from "@/lib/order-week";
import { getRoute } from "@/lib/routes";

export type OfficeOrder = Database["public"]["Tables"]["orders"]["Row"];

/** A route with no delivery cutoff (4, 6, 14) is auto in-stock and locked. */
function isNoCutoffRoute(routeNumber: string): boolean {
  return !getRoute(routeNumber)?.cutoff;
}

/** Shift a 'YYYY-MM-DD' key by a whole number of weeks. */
function shiftWeeks(key: string, weeks: number): string {
  const d = parseDateKey(key);
  d.setDate(d.getDate() + weeks * 7);
  return toDateKey(d);
}

export function OfficeDashboard({
  initialOrders,
}: {
  initialOrders: OfficeOrder[];
}) {
  const supabase = useMemo(() => createClient(), []);
  const [orders, setOrders] = useState<OfficeOrder[]>(initialOrders);
  const [routeFilter, setRouteFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState<OrderStatus | "all">("all");
  const [weekFilter, setWeekFilter] = useState("all");
  const [dayFilter, setDayFilter] = useState("all");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // The invoice value when an input was focused, so we can skip no-op saves and
  // roll back to it if the write fails.
  const invoiceFocusRef = useRef("");

  const routes = useMemo(
    () => Array.from(new Set(orders.map((o) => o.route_number))).sort(),
    [orders],
  );
  const weeks = useMemo(
    () =>
      Array.from(new Set(orders.map((o) => o.order_week)))
        .sort()
        .reverse(),
    [orders],
  );
  const deliveryDays = useMemo(
    () =>
      Array.from(
        new Set(
          orders
            .map((o) => o.delivery_date)
            .filter((d): d is string => d !== null),
        ),
      )
        .sort()
        .reverse(),
    [orders],
  );

  const filtered = orders.filter(
    (o) =>
      (routeFilter === "all" || o.route_number === routeFilter) &&
      (statusFilter === "all" || o.status === statusFilter) &&
      (weekFilter === "all" || o.order_week === weekFilter) &&
      (dayFilter === "all" || o.delivery_date === dayFilter),
  );

  const hasFilters =
    routeFilter !== "all" ||
    statusFilter !== "all" ||
    weekFilter !== "all" ||
    dayFilter !== "all";

  // Setting an order out-of-stock pushes its delivery to the following week;
  // moving it back to open/in-stock restores the original week. The shift is the
  // difference between the two states, so any transition lands correctly.
  async function setStockStatus(order: OfficeOrder, next: OrderStatus) {
    if (order.status === next) return;
    setError(null);

    const shift =
      (next === "out_of_stock" ? 1 : 0) -
      (order.status === "out_of_stock" ? 1 : 0);
    const order_week =
      shift === 0 ? order.order_week : shiftWeeks(order.order_week, shift);
    const delivery_date =
      shift === 0 || order.delivery_date === null
        ? order.delivery_date
        : shiftWeeks(order.delivery_date, shift);

    const previous = orders;
    setOrders((os) =>
      os.map((o) =>
        o.id === order.id ? { ...o, status: next, order_week, delivery_date } : o,
      ),
    );
    setBusyId(order.id);

    const { error: updateError } = await supabase
      .from("orders")
      .update({ status: next, order_week, delivery_date })
      .eq("id", order.id);

    setBusyId(null);
    if (updateError) {
      setOrders(previous); // rollback
      setError(`Couldn't update availability: ${updateError.message}`);
    }
  }

  // Invoice numbers are typed by office staff. Keep local state in sync on every
  // keystroke (so export/print see the latest) and persist on blur.
  function updateInvoiceLocal(id: string, invoice_number: string) {
    setOrders((os) =>
      os.map((o) => (o.id === id ? { ...o, invoice_number } : o)),
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

  function exportCurrentView() {
    if (filtered.length === 0) {
      setError("No orders match the current filters — nothing to export.");
      return;
    }
    setError(null);

    const parts = ["orders"];
    if (routeFilter !== "all") parts.push(`route-${routeFilter}`);
    if (statusFilter !== "all") parts.push(statusFilter);
    if (dayFilter !== "all") parts.push(`day-${dayFilter}`);
    if (weekFilter !== "all") parts.push(`week-${weekFilter}`);

    const blob = new Blob([ordersToCsv(filtered)], {
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
    if (filtered.length === 0) {
      setError("No orders match the current filters — nothing to print.");
      return;
    }
    setError(null);

    const activeFilters: string[] = [];
    if (routeFilter !== "all") activeFilters.push(`Route ${routeFilter}`);
    if (statusFilter !== "all")
      activeFilters.push(`Availability: ${STATUS_META[statusFilter].label}`);
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
      buildPrintHtml(filtered, activeFilters, window.location.origin),
    );
    win.document.close();
  }

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex flex-wrap items-end gap-4 border border-[#1A1A1A]/10 bg-white p-4 shadow-sm">
        <FilterSelect
          label="Route"
          value={routeFilter}
          onChange={setRouteFilter}
          options={[
            { value: "all", label: "All routes" },
            ...routes.map((r) => ({ value: r, label: `Route ${r}` })),
          ]}
        />
        <FilterSelect
          label="Availability"
          value={statusFilter}
          onChange={(v) => setStatusFilter(v as OrderStatus | "all")}
          options={[
            { value: "all", label: "All" },
            ...ORDER_STATUSES.map((s) => ({
              value: s,
              label: STATUS_META[s].label,
            })),
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
        {hasFilters && (
          <button
            type="button"
            onClick={() => {
              setRouteFilter("all");
              setStatusFilter("all");
              setWeekFilter("all");
              setDayFilter("all");
            }}
            className="ml-auto h-10 border border-[#888888]/40 bg-white px-3 text-sm font-semibold uppercase text-[#444444] hover:bg-[#F5F5F5]"
          >
            Clear filters
          </button>
        )}
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

      <p className="text-sm font-medium text-[#888888]">
        Showing {filtered.length} of {orders.length} orders
      </p>

      {/* Orders table */}
      <div className="overflow-x-auto border border-[#1A1A1A]/10 bg-white shadow-sm">
        <table className="w-full min-w-[880px] text-left text-sm">
          <thead className="border-b border-[#888888]/25 bg-[#1A1A1A] text-xs uppercase text-white">
            <tr>
              <Th>Route</Th>
              <Th>Products</Th>
              <Th>Customer</Th>
              <Th>Placed by</Th>
              <Th>Date needed</Th>
              <Th>Delivery</Th>
              <Th>Invoice #</Th>
              <Th>Availability</Th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#888888]/20">
            {filtered.length === 0 ? (
              <tr>
                <td
                  colSpan={8}
                  className="px-4 py-12 text-center text-[#888888]"
                >
                  {orders.length === 0
                    ? "No orders have been placed yet."
                    : "No orders match these filters."}
                </td>
              </tr>
            ) : (
              filtered.map((o) => {
                const busy = busyId === o.id;
                const locked = isNoCutoffRoute(o.route_number);
                return (
                  <tr key={o.id} className="hover:bg-[#F5F5F5]">
                    <Td className="font-semibold text-[#1A1A1A]">
                      {o.route_number}
                    </Td>
                    <Td>
                      <ul className="space-y-0.5">
                        {(o.items ?? []).map((it, i) => (
                          <li key={i} className="whitespace-nowrap">
                            <span className="font-semibold text-[#1A1A1A]">
                              {it.quantity}×
                            </span>{" "}
                            {it.product_name}
                          </li>
                        ))}
                      </ul>
                    </Td>
                    <Td>
                      <div>{o.customer_name}</div>
                      {o.customer_address && (
                        <div className="text-xs text-[#888888]">
                          {o.customer_address}
                        </div>
                      )}
                    </Td>
                    <Td>{o.driver_name ?? "—"}</Td>
                    <Td>{formatDate(o.date_needed)}</Td>
                    <Td>
                      {o.delivery_date === null ? (
                        "—"
                      ) : o.status === "out_of_stock" ? (
                        <span className="inline-flex flex-wrap items-baseline gap-x-1.5">
                          <span className="text-[#888888] line-through decoration-[#009ACE] decoration-2">
                            {formatDate(shiftWeeks(o.delivery_date, -1))}
                          </span>
                          <span className="font-semibold text-[#009ACE]">
                            {formatDate(o.delivery_date)}
                          </span>
                        </span>
                      ) : (
                        formatDate(o.delivery_date)
                      )}
                    </Td>
                    <Td>
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
                    <Td>
                      {locked ? (
                        <span
                          title="No-cutoff route — automatically in-stock"
                          className="inline-flex"
                        >
                          <StatusBadge status={o.status} />
                        </span>
                      ) : (
                        <select
                          value={o.status}
                          disabled={busy}
                          onChange={(e) =>
                            setStockStatus(o, e.target.value as OrderStatus)
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
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
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
 * Rendered into a fresh window so it prints cleanly without the app chrome.
 * Auto-invokes the print dialog on load (waits for the logo image via onload).
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

  const rows = orders
    .map(
      (o) => `
        <tr>
          <td class="route">${escapeHtml(o.route_number)}</td>
          <td>${(o.items ?? []).map((it) => escapeHtml(`${it.quantity}× ${it.product_name}`)).join("<br>")}</td>
          <td>${escapeHtml(o.customer_name)}${o.customer_address ? `<br><span class="addr">${escapeHtml(o.customer_address)}</span>` : ""}</td>
          <td>${escapeHtml(o.driver_name ?? "—")}</td>
          <td>${escapeHtml(formatDate(o.date_needed))}</td>
          <td>${o.delivery_date ? escapeHtml(formatDate(o.delivery_date)) : "—"}</td>
          <td>${escapeHtml(formatWeekLabel(o.order_week))}</td>
          <td>${o.invoice_number ? escapeHtml(o.invoice_number) : "—"}</td>
          <td class="status">${escapeHtml(STATUS_META[o.status].label)}</td>
        </tr>`,
    )
    .join("");

  const filterLine =
    activeFilters.length > 0
      ? `Filters: ${escapeHtml(activeFilters.join("  •  "))}`
      : "All orders (no filters applied)";

  const count = `${orders.length} order${orders.length === 1 ? "" : "s"}`;

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
  tbody tr:nth-child(even) { background: #F5F5F5; }
  td.route { font-weight: 700; }
  td.status { text-transform: capitalize; }
  .addr { font-size: 10px; color: #888888; }
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
        <th>Route</th><th>Products</th><th>Customer</th><th>Placed by</th>
        <th>Date needed</th><th>Delivery</th><th>Order week</th><th>Invoice #</th><th>Availability</th>
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

function Th({ children }: { children: React.ReactNode }) {
  return <th className="px-4 py-3 font-semibold">{children}</th>;
}

function Td({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return <td className={`px-4 py-3 text-[#444444] ${className}`}>{children}</td>;
}
