"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { StatusBadge } from "@/components/status-badge";
import type { Database, OrderStatus } from "@/lib/database.types";
import { createClient } from "@/lib/supabase/browser";
import { ORDER_STATUSES, STATUS_META } from "@/lib/order-status";
import {
  computeOrderWeek,
  formatDate,
  formatWeekLabel,
  toDateKey,
} from "@/lib/order-week";
import { ROUTES } from "@/lib/routes";

type Order = Database["public"]["Tables"]["orders"]["Row"];

const ROUTE_KEY = "fleetview.route";
const NAME_KEY = "fleetview.driverName";

const byDateNeeded = (a: Order, b: Order) =>
  a.date_needed.localeCompare(b.date_needed);

export default function OrderingPage() {
  const supabase = useMemo(() => createClient(), []);
  const today = toDateKey(new Date());

  const [route, setRoute] = useState<string>("");
  const [driverName, setDriverName] = useState("");
  const [productName, setProductName] = useState("");
  const [customerName, setCustomerName] = useState("");
  const [dateNeeded, setDateNeeded] = useState("");

  const [orders, setOrders] = useState<Order[]>([]);
  const [loadingOrders, setLoadingOrders] = useState(false);
  const [filter, setFilter] = useState<OrderStatus | "all">("all");

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState<{
    weekKey: string;
    productName: string;
  } | null>(null);

  // Restore the last-used route + name from this device.
  useEffect(() => {
    const savedRoute = localStorage.getItem(ROUTE_KEY);
    const savedName = localStorage.getItem(NAME_KEY);
    setRoute(savedRoute && ROUTES.includes(savedRoute) ? savedRoute : ROUTES[0] ?? "");
    if (savedName) setDriverName(savedName);
  }, []);

  // Persist route + name as they change.
  useEffect(() => {
    if (route) localStorage.setItem(ROUTE_KEY, route);
  }, [route]);
  useEffect(() => {
    localStorage.setItem(NAME_KEY, driverName);
  }, [driverName]);

  // Load orders for the selected route.
  useEffect(() => {
    if (!route) return;
    let cancelled = false;
    setLoadingOrders(true);
    supabase
      .from("orders")
      .select("*")
      .eq("route_number", route)
      .order("date_needed", { ascending: true })
      .then(({ data }) => {
        if (cancelled) return;
        setOrders(data ?? []);
        setLoadingOrders(false);
      });
    return () => {
      cancelled = true;
    };
  }, [route, supabase]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!route || !productName.trim() || !customerName.trim() || !dateNeeded) {
      setError("Please fill in route, product, customer, and date needed.");
      return;
    }

    setSubmitting(true);
    const orderWeek = computeOrderWeek(new Date());

    const { data, error: insertError } = await supabase
      .from("orders")
      .insert({
        route_number: route,
        driver_name: driverName.trim() || null,
        product_name: productName.trim(),
        customer_name: customerName.trim(),
        date_needed: dateNeeded,
        order_week: orderWeek,
      })
      .select()
      .single();

    setSubmitting(false);

    if (insertError || !data) {
      setError(insertError?.message ?? "Could not submit the order. Try again.");
      return;
    }

    setConfirmation({ weekKey: data.order_week, productName: data.product_name });
    setOrders((prev) => [...prev, data].sort(byDateNeeded));
    setProductName("");
    setCustomerName("");
    setDateNeeded("");
  }

  const filteredOrders =
    filter === "all" ? orders : orders.filter((o) => o.status === filter);

  return (
    <main className="min-h-screen bg-slate-100 px-4 py-5">
      <div className="mx-auto flex w-full max-w-2xl items-center justify-between">
        <div>
          <p className="text-sm font-medium uppercase tracking-wide text-emerald-700">
            Place an order
          </p>
          <h1 className="text-2xl font-semibold text-slate-950">FleetView</h1>
        </div>
        <Link
          href="/office"
          className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700"
        >
          Office view
        </Link>
      </div>

      <div className="mx-auto mt-5 w-full max-w-2xl space-y-6">
        {confirmation && (
          <div className="rounded-xl border-2 border-emerald-300 bg-emerald-50 p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-base font-semibold text-emerald-900">
                  Order placed ✓
                </p>
                <p className="mt-1 text-sm text-emerald-800">
                  <span className="font-medium">{confirmation.productName}</span>{" "}
                  landed in the{" "}
                  <span className="font-semibold">
                    {formatWeekLabel(confirmation.weekKey)}
                  </span>
                  .
                </p>
              </div>
              <button
                type="button"
                onClick={() => setConfirmation(null)}
                className="shrink-0 rounded-md px-2 py-1 text-sm font-medium text-emerald-800 hover:bg-emerald-100"
              >
                Dismiss
              </button>
            </div>
          </div>
        )}

        {/* Intake form */}
        <section className="rounded-xl bg-white p-5 shadow-sm">
          <h2 className="text-lg font-semibold text-slate-950">New order</h2>
          <form onSubmit={handleSubmit} className="mt-4 space-y-4">
            <Field label="Route">
              <select
                value={route}
                onChange={(e) => setRoute(e.target.value)}
                className="h-14 w-full rounded-lg border border-slate-300 bg-white px-4 text-lg text-slate-950 outline-none focus:border-emerald-600 focus:ring-2 focus:ring-emerald-100"
              >
                {ROUTES.map((r) => (
                  <option key={r} value={r}>
                    Route {r}
                  </option>
                ))}
              </select>
            </Field>

            <Field label="Your name (optional)">
              <input
                value={driverName}
                onChange={(e) => setDriverName(e.target.value)}
                type="text"
                autoCapitalize="words"
                placeholder="e.g. Sam"
                className="h-14 w-full rounded-lg border border-slate-300 px-4 text-lg text-slate-950 outline-none focus:border-emerald-600 focus:ring-2 focus:ring-emerald-100"
              />
            </Field>

            <Field label="Product name">
              <input
                value={productName}
                onChange={(e) => setProductName(e.target.value)}
                type="text"
                autoCapitalize="words"
                placeholder="e.g. Tire shine, 5-gal"
                className="h-14 w-full rounded-lg border border-slate-300 px-4 text-lg text-slate-950 outline-none focus:border-emerald-600 focus:ring-2 focus:ring-emerald-100"
              />
            </Field>

            <Field label="Customer name">
              <input
                value={customerName}
                onChange={(e) => setCustomerName(e.target.value)}
                type="text"
                autoCapitalize="words"
                placeholder="e.g. Downtown Auto Auction"
                className="h-14 w-full rounded-lg border border-slate-300 px-4 text-lg text-slate-950 outline-none focus:border-emerald-600 focus:ring-2 focus:ring-emerald-100"
              />
            </Field>

            <Field label="Date needed">
              <input
                value={dateNeeded}
                onChange={(e) => setDateNeeded(e.target.value)}
                type="date"
                min={today}
                className="h-14 w-full rounded-lg border border-slate-300 px-4 text-lg text-slate-950 outline-none focus:border-emerald-600 focus:ring-2 focus:ring-emerald-100"
              />
            </Field>

            {error && (
              <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={submitting}
              className="h-14 w-full rounded-lg bg-emerald-700 text-lg font-semibold text-white transition hover:bg-emerald-800 disabled:opacity-60"
            >
              {submitting ? "Submitting…" : "Submit order"}
            </button>
          </form>
        </section>

        {/* Orders for this route */}
        <section className="rounded-xl bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-slate-950">
              Orders on Route {route}
            </h2>
            <span className="text-sm text-slate-500">
              {loadingOrders ? "Loading…" : `${orders.length} total`}
            </span>
          </div>

          <div className="mt-3 flex flex-wrap gap-2">
            <FilterChip active={filter === "all"} onClick={() => setFilter("all")}>
              All
            </FilterChip>
            {ORDER_STATUSES.map((status) => (
              <FilterChip
                key={status}
                active={filter === status}
                onClick={() => setFilter(status)}
              >
                {STATUS_META[status].label}
              </FilterChip>
            ))}
          </div>

          <ul className="mt-4 space-y-3">
            {filteredOrders.length === 0 ? (
              <li className="rounded-lg border border-dashed border-slate-300 px-4 py-8 text-center text-sm text-slate-500">
                {loadingOrders
                  ? "Loading orders…"
                  : orders.length === 0
                    ? "No orders on this route yet. Submit your first one above."
                    : "No orders match this filter."}
              </li>
            ) : (
              filteredOrders.map((order) => (
                <li
                  key={order.id}
                  className="rounded-lg border border-slate-200 p-4"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-base font-semibold text-slate-950">
                        {order.product_name}
                      </p>
                      <p className="truncate text-sm text-slate-600">
                        {order.customer_name}
                      </p>
                    </div>
                    <StatusBadge status={order.status} />
                  </div>
                  <dl className="mt-3 grid grid-cols-2 gap-y-1 text-sm text-slate-600">
                    <dt className="text-slate-400">Needed</dt>
                    <dd className="text-right font-medium text-slate-700">
                      {formatDate(order.date_needed)}
                    </dd>
                    <dt className="text-slate-400">Order week</dt>
                    <dd className="text-right font-medium text-slate-700">
                      {formatWeekLabel(order.order_week)}
                    </dd>
                    {order.driver_name && (
                      <>
                        <dt className="text-slate-400">Placed by</dt>
                        <dd className="text-right font-medium text-slate-700">
                          {order.driver_name}
                        </dd>
                      </>
                    )}
                  </dl>
                </li>
              ))
            )}
          </ul>
        </section>
      </div>
    </main>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="text-sm font-medium text-slate-700">{label}</span>
      <span className="mt-1.5 block">{children}</span>
    </label>
  );
}

function FilterChip({
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
      className={`rounded-full border px-3 py-1.5 text-sm font-medium transition ${
        active
          ? "border-emerald-600 bg-emerald-600 text-white"
          : "border-slate-300 bg-white text-slate-600 hover:bg-slate-50"
      }`}
    >
      {children}
    </button>
  );
}
