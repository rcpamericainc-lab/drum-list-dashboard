"use client";

import { useMemo, useState } from "react";

import type { Database, OrderStatus } from "@/lib/database.types";
import { createClient } from "@/lib/supabase/browser";
import { ORDER_STATUSES, STATUS_META } from "@/lib/order-status";
import { formatDate, formatWeekLabel } from "@/lib/order-week";

type OrderRow = Database["public"]["Tables"]["orders"]["Row"];
export type OfficeOrder = OrderRow & { driver: { name: string } | null };

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
  const [truckFilter, setTruckFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState<OrderStatus | "all">("all");
  const [weekFilter, setWeekFilter] = useState("all");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const trucks = useMemo(
    () => Array.from(new Set(orders.map((o) => o.truck_number))).sort(),
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
      (truckFilter === "all" || o.truck_number === truckFilter) &&
      (statusFilter === "all" || o.status === statusFilter) &&
      (weekFilter === "all" || o.order_week === weekFilter),
  );

  const hasFilters =
    truckFilter !== "all" || statusFilter !== "all" || weekFilter !== "all";

  async function setStatus(id: string, next: OrderStatus) {
    setError(null);
    const previous = orders;
    // Optimistic update
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

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex flex-wrap items-end gap-4 rounded-xl bg-white p-4 shadow-sm">
        <FilterSelect
          label="Truck"
          value={truckFilter}
          onChange={setTruckFilter}
          options={[
            { value: "all", label: "All trucks" },
            ...trucks.map((t) => ({ value: t, label: t })),
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
              setTruckFilter("all");
              setStatusFilter("all");
              setWeekFilter("all");
            }}
            className="ml-auto h-10 rounded-md border border-slate-300 bg-white px-3 text-sm font-medium text-slate-600 hover:bg-slate-50"
          >
            Clear filters
          </button>
        )}
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
              <Th>Truck</Th>
              <Th>Driver</Th>
              <Th>Date needed</Th>
              <Th>Order week</Th>
              <Th>Status</Th>
              <Th>Actions</Th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {filtered.length === 0 ? (
              <tr>
                <td
                  colSpan={8}
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
                    <Td>{o.truck_number}</Td>
                    <Td>{o.driver?.name ?? "—"}</Td>
                    <Td>{formatDate(o.date_needed)}</Td>
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

function StatusBadge({ status }: { status: OrderStatus }) {
  const meta = STATUS_META[status];
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold ${meta.badge}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${meta.dot}`} />
      {meta.label}
    </span>
  );
}
