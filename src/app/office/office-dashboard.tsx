"use client";

import { useMemo, useState } from "react";

import { StatusBadge } from "@/components/status-badge";
import type { Database, OrderStatus } from "@/lib/database.types";
import { createClient } from "@/lib/supabase/browser";
import { ordersToCsv } from "@/lib/csv";
import { ORDER_STATUSES, STATUS_META } from "@/lib/order-status";
import { formatDate, formatWeekLabel } from "@/lib/order-week";

export type OfficeOrder = Database["public"]["Tables"]["orders"]["Row"];

// Forward flow: pending -> confirmed -> fulfilled.
const NEXT_STATUS: Partial<Record<OrderStatus, OrderStatus>> = {
  pending: "confirmed",
  confirmed: "fulfilled",
};
const ADVANCE_LABEL: Partial<Record<OrderStatus, string>> = {
  pending: "Confirm",
  confirmed: "Fulfill",
};

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
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

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

  const filtered = orders.filter(
    (o) =>
      (routeFilter === "all" || o.route_number === routeFilter) &&
      (statusFilter === "all" || o.status === statusFilter) &&
      (weekFilter === "all" || o.order_week === weekFilter),
  );

  const hasFilters =
    routeFilter !== "all" || statusFilter !== "all" || weekFilter !== "all";

  async function setStatus(id: string, next: OrderStatus) {
    setError(null);
    const previous = orders;
    setOrders((os) => os.map((o) => (o.id === id ? { ...o, status: next } : o)));
    setBusyId(id);

    const { error: updateError } = await supabase
      .from("orders")
      .update({ status: next })
      .eq("id", id);

    setBusyId(null);
    if (updateError) {
      setOrders(previous); // rollback
      setError(`Couldn't update status: ${updateError.message}`);
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

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex flex-wrap items-end gap-4 rounded-xl bg-white p-4 shadow-sm">
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
          label="Status"
          value={statusFilter}
          onChange={(v) => setStatusFilter(v as OrderStatus | "all")}
          options={[
            { value: "all", label: "All statuses" },
            ...ORDER_STATUSES.map((s) => ({
              value: s,
              label: STATUS_META[s].label,
            })),
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
            }}
            className="ml-auto h-10 rounded-md border border-slate-300 bg-white px-3 text-sm font-medium text-slate-600 hover:bg-slate-50"
          >
            Clear filters
          </button>
        )}
      </div>

      {/* Export */}
      <div className="flex flex-wrap items-center gap-3 rounded-xl bg-white p-4 shadow-sm">
        <button
          type="button"
          onClick={exportCurrentView}
          className="h-10 rounded-md bg-emerald-700 px-4 text-sm font-semibold text-white transition hover:bg-emerald-800"
        >
          Export CSV
        </button>
        <span className="text-sm text-slate-500">
          Exports the {filtered.length} order
          {filtered.length === 1 ? "" : "s"} matching the filters above.
        </span>
      </div>

      {error && (
        <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      )}

      <p className="text-sm text-slate-500">
        Showing {filtered.length} of {orders.length} orders
      </p>

      {/* Orders table */}
      <div className="overflow-x-auto rounded-xl bg-white shadow-sm">
        <table className="w-full min-w-[880px] text-left text-sm">
          <thead className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <Th>Product</Th>
              <Th>Customer</Th>
              <Th>Route</Th>
              <Th>Placed by</Th>
              <Th>Date needed</Th>
              <Th>Delivery</Th>
              <Th>Order week</Th>
              <Th>Status</Th>
              <Th>Actions</Th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {filtered.length === 0 ? (
              <tr>
                <td
                  colSpan={9}
                  className="px-4 py-12 text-center text-slate-500"
                >
                  {orders.length === 0
                    ? "No orders have been placed yet."
                    : "No orders match these filters."}
                </td>
              </tr>
            ) : (
              filtered.map((o) => {
                const next = NEXT_STATUS[o.status];
                const busy = busyId === o.id;
                return (
                  <tr key={o.id} className="hover:bg-slate-50">
                    <Td className="font-medium text-slate-900">
                      {o.product_name}
                    </Td>
                    <Td>{o.customer_name}</Td>
                    <Td>{o.route_number}</Td>
                    <Td>{o.driver_name ?? "—"}</Td>
                    <Td>{formatDate(o.date_needed)}</Td>
                    <Td>{o.delivery_date ? formatDate(o.delivery_date) : "—"}</Td>
                    <Td>{formatWeekLabel(o.order_week)}</Td>
                    <Td>
                      <StatusBadge status={o.status} />
                    </Td>
                    <Td>
                      <div className="flex flex-wrap gap-2">
                        {next && (
                          <ActionButton
                            primary
                            disabled={busy}
                            onClick={() => setStatus(o.id, next)}
                          >
                            {ADVANCE_LABEL[o.status]}
                          </ActionButton>
                        )}
                        {o.status !== "cancelled" && o.status !== "fulfilled" && (
                          <ActionButton
                            disabled={busy}
                            onClick={() => setStatus(o.id, "cancelled")}
                          >
                            Cancel
                          </ActionButton>
                        )}
                        {o.status === "cancelled" && (
                          <ActionButton
                            disabled={busy}
                            onClick={() => setStatus(o.id, "pending")}
                          >
                            Reopen
                          </ActionButton>
                        )}
                        {o.status === "fulfilled" && (
                          <ActionButton
                            disabled={busy}
                            onClick={() => setStatus(o.id, "confirmed")}
                          >
                            Reopen
                          </ActionButton>
                        )}
                      </div>
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
      <span className="text-xs font-medium uppercase tracking-wide text-slate-500">
        {label}
      </span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-10 rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-900 outline-none focus:border-emerald-600 focus:ring-2 focus:ring-emerald-100"
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

function ActionButton({
  primary = false,
  disabled = false,
  onClick,
  children,
}: {
  primary?: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={`rounded-md px-3 py-1.5 text-xs font-semibold transition disabled:opacity-50 ${
        primary
          ? "bg-emerald-700 text-white hover:bg-emerald-800"
          : "border border-slate-300 bg-white text-slate-600 hover:bg-slate-50"
      }`}
    >
      {children}
    </button>
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
  return <td className={`px-4 py-3 text-slate-700 ${className}`}>{children}</td>;
}
