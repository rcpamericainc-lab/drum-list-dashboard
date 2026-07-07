"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { StatusBadge } from "@/components/status-badge";
import type { Database, OrderStatus } from "@/lib/database.types";
import { createClient } from "@/lib/supabase/browser";
import { ORDER_STATUSES, STATUS_META } from "@/lib/order-status";
import {
  computeOrderTiming,
  currentOrderWeek,
  formatDate,
  formatWeekLabel,
  toDateKey,
} from "@/lib/order-week";
import { ROUTE_NUMBERS, describeRoute, getRoute } from "@/lib/routes";

type Order = Database["public"]["Tables"]["orders"]["Row"];
type OrderInsert = Database["public"]["Tables"]["orders"]["Insert"];

type QueuedOrder = {
  clientId: string;
  createdAt: string;
  payload: OrderInsert; // includes client_id
};

const ROUTE_KEY = "fleetview.route";
const NAME_KEY = "fleetview.driverName";
const QUEUE_KEY = "fleetview.queue.v1";

const byDateNeeded = (a: Order, b: Order) =>
  a.date_needed.localeCompare(b.date_needed);

function makeId(): string {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

type Confirmation = {
  productName: string;
  weekKey: string;
  deliveryDate: string | null;
  hasCutoff: boolean;
  rolledOver: boolean;
  offline: boolean;
};

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
  const [weekFilter, setWeekFilter] = useState<
    "all" | "past" | "current" | "upcoming"
  >("all");
  const currentWeek = useMemo(() => currentOrderWeek(), []);

  const [queue, setQueue] = useState<QueuedOrder[]>([]);
  const [online, setOnline] = useState(true);

  const [error, setError] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);

  // Refs so interval/event handlers see current values without re-subscribing.
  const queueRef = useRef<QueuedOrder[]>([]);
  const routeRef = useRef(route);
  const flushingRef = useRef(false);
  useEffect(() => {
    routeRef.current = route;
  }, [route]);

  // Restore route + name.
  useEffect(() => {
    const savedRoute = localStorage.getItem(ROUTE_KEY);
    const savedName = localStorage.getItem(NAME_KEY);
    setRoute(
      savedRoute && ROUTE_NUMBERS.includes(savedRoute)
        ? savedRoute
        : (ROUTE_NUMBERS[0] ?? ""),
    );
    if (savedName) setDriverName(savedName);
  }, []);

  useEffect(() => {
    if (route) localStorage.setItem(ROUTE_KEY, route);
  }, [route]);
  useEffect(() => {
    localStorage.setItem(NAME_KEY, driverName);
  }, [driverName]);

  // Load the offline queue once.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(QUEUE_KEY);
      if (raw) setQueue(JSON.parse(raw) as QueuedOrder[]);
    } catch {
      // ignore corrupt queue
    }
  }, []);

  // Persist queue + mirror to ref.
  useEffect(() => {
    queueRef.current = queue;
    localStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
  }, [queue]);

  // Send queued orders. Idempotent via upsert on client_id, so a retry after a
  // dropped response never duplicates. Stops on the first failure (assume the
  // connection dropped) and leaves the rest queued.
  const flushQueue = useCallback(async () => {
    if (flushingRef.current || !navigator.onLine) return;
    flushingRef.current = true;
    try {
      for (const item of queueRef.current) {
        const { data, error: syncError } = await supabase
          .from("orders")
          .upsert(item.payload, { onConflict: "client_id" })
          .select()
          .single();
        if (syncError || !data) break;
        setQueue((prev) => prev.filter((q) => q.clientId !== item.clientId));
        if (data.route_number === routeRef.current) {
          setOrders((prev) =>
            [...prev.filter((o) => o.id !== data.id), data].sort(byDateNeeded),
          );
        }
      }
    } finally {
      flushingRef.current = false;
    }
  }, [supabase]);

  // Track connectivity; flush on reconnect and on an interval.
  useEffect(() => {
    setOnline(navigator.onLine);
    const goOnline = () => {
      setOnline(true);
      void flushQueue();
    };
    const goOffline = () => setOnline(false);
    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    const interval = setInterval(() => {
      if (navigator.onLine) void flushQueue();
    }, 15000);
    return () => {
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
      clearInterval(interval);
    };
  }, [flushQueue]);

  // Whenever there's something queued and we're online, try to send it (covers
  // both fresh submits and leftovers loaded from a previous session).
  useEffect(() => {
    if (queue.length > 0 && online) void flushQueue();
  }, [queue, online, flushQueue]);

  // Load DB orders for the selected route.
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

  const routeConfig = route ? getRoute(route) : undefined;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!route || !productName.trim() || !customerName.trim() || !dateNeeded) {
      setError("Please fill in route, product, customer, and date needed.");
      return;
    }
    if (!routeConfig) {
      setError("Unknown route selected.");
      return;
    }

    // Freeze the cutoff/delivery timing at submit time.
    const timing = computeOrderTiming(new Date(), routeConfig);
    const payload: OrderInsert = {
      client_id: makeId(),
      route_number: route,
      driver_name: driverName.trim() || null,
      product_name: productName.trim(),
      customer_name: customerName.trim(),
      date_needed: dateNeeded,
      order_week: timing.orderWeek,
      delivery_date: timing.deliveryDate,
    };

    setQueue((prev) => [
      ...prev,
      {
        clientId: payload.client_id as string,
        createdAt: new Date().toISOString(),
        payload,
      },
    ]);

    setConfirmation({
      productName: payload.product_name,
      weekKey: timing.orderWeek,
      deliveryDate: timing.deliveryDate,
      hasCutoff: timing.hasCutoff,
      rolledOver: timing.rolledOver,
      offline: !navigator.onLine,
    });

    // The queue effect above sends it. Just clear the form.
    setProductName("");
    setCustomerName("");
    setDateNeeded("");
  }

  const matchesWeek = (wk: string) =>
    weekFilter === "all"
      ? true
      : weekFilter === "current"
        ? wk === currentWeek
        : weekFilter === "past"
          ? wk < currentWeek
          : wk > currentWeek;

  const queuedForRoute = queue.filter(
    (q) =>
      q.payload.route_number === route &&
      matchesWeek(q.payload.order_week as string),
  );
  const showQueued = filter === "all" || filter === "pending";
  const filteredOrders = orders.filter(
    (o) =>
      (filter === "all" || o.status === filter) && matchesWeek(o.order_week),
  );
  const shownCount =
    filteredOrders.length + (showQueued ? queuedForRoute.length : 0);

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
        {/* Connectivity / sync status */}
        {!online ? (
          <div className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800">
            You&apos;re offline.{" "}
            {queue.length > 0
              ? `${queue.length} order${queue.length === 1 ? "" : "s"} saved on this device will send automatically when you reconnect.`
              : "Orders will be saved on this device and sent when you reconnect."}
          </div>
        ) : queue.length > 0 ? (
          <div className="rounded-xl border border-blue-200 bg-blue-50 p-3 text-sm text-blue-800">
            Sending {queue.length} saved order{queue.length === 1 ? "" : "s"}…
          </div>
        ) : null}

        {confirmation && (
          <div className="rounded-xl border-2 border-emerald-300 bg-emerald-50 p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-base font-semibold text-emerald-900">
                  Order saved ✓
                </p>
                <p className="mt-1 text-sm text-emerald-800">
                  {confirmation.hasCutoff && confirmation.deliveryDate ? (
                    <>
                      <span className="font-medium">
                        {confirmation.productName}
                      </span>{" "}
                      is scheduled for delivery{" "}
                      <span className="font-semibold">
                        {formatDate(confirmation.deliveryDate)}
                      </span>
                      .
                      {confirmation.rolledOver && (
                        <span className="mt-1 block text-emerald-700">
                          This was after the cutoff, so it rolled to the next
                          delivery.
                        </span>
                      )}
                    </>
                  ) : (
                    <>
                      <span className="font-medium">
                        {confirmation.productName}
                      </span>{" "}
                      was added to the{" "}
                      <span className="font-semibold">
                        {formatWeekLabel(confirmation.weekKey)}
                      </span>{" "}
                      (this route has no cutoff).
                    </>
                  )}
                  {confirmation.offline && (
                    <span className="mt-1 block text-emerald-700">
                      You&apos;re offline — it&apos;ll send automatically when
                      you reconnect.
                    </span>
                  )}
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
            <div>
              <Field label="Route">
                <select
                  value={route}
                  onChange={(e) => setRoute(e.target.value)}
                  className="h-14 w-full rounded-lg border border-slate-300 bg-white px-4 text-lg text-slate-950 outline-none focus:border-emerald-600 focus:ring-2 focus:ring-emerald-100"
                >
                  {ROUTE_NUMBERS.map((r) => (
                    <option key={r} value={r}>
                      Route {r}
                    </option>
                  ))}
                </select>
              </Field>
              {routeConfig && (
                <p className="mt-2 text-sm text-slate-500">
                  {describeRoute(routeConfig)}
                </p>
              )}
            </div>

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
                enterKeyHint="next"
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
              className="h-14 w-full rounded-lg bg-emerald-700 text-lg font-semibold text-white transition hover:bg-emerald-800 active:bg-emerald-900"
            >
              Submit order
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
              {loadingOrders
                ? "Loading…"
                : `${shownCount} order${shownCount === 1 ? "" : "s"}`}
            </span>
          </div>

          <div className="mt-3 space-y-2">
            <div className="flex flex-wrap gap-2">
              <FilterChip
                active={weekFilter === "all"}
                onClick={() => setWeekFilter("all")}
              >
                All weeks
              </FilterChip>
              <FilterChip
                active={weekFilter === "past"}
                onClick={() => setWeekFilter("past")}
              >
                Past
              </FilterChip>
              <FilterChip
                active={weekFilter === "current"}
                onClick={() => setWeekFilter("current")}
              >
                This week
              </FilterChip>
              <FilterChip
                active={weekFilter === "upcoming"}
                onClick={() => setWeekFilter("upcoming")}
              >
                Upcoming
              </FilterChip>
            </div>
            <div className="flex flex-wrap gap-2">
              <FilterChip
                active={filter === "all"}
                onClick={() => setFilter("all")}
              >
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
          </div>

          <ul className="mt-4 space-y-3">
            {/* Not-yet-sent (queued) orders for this route */}
            {showQueued &&
              queuedForRoute.map((q) => (
                <li
                  key={q.clientId}
                  className="rounded-lg border border-amber-200 bg-amber-50/50 p-4"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-base font-semibold text-slate-950">
                        {q.payload.product_name}
                      </p>
                      <p className="truncate text-sm text-slate-600">
                        {q.payload.customer_name}
                      </p>
                    </div>
                    <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-amber-300 bg-amber-100 px-2.5 py-1 text-xs font-semibold text-amber-800">
                      <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
                      Waiting to send
                    </span>
                  </div>
                  <dl className="mt-3 grid grid-cols-2 gap-y-1 text-sm text-slate-600">
                    <dt className="text-slate-400">Needed</dt>
                    <dd className="text-right font-medium text-slate-700">
                      {q.payload.date_needed
                        ? formatDate(q.payload.date_needed)
                        : "—"}
                    </dd>
                    <dt className="text-slate-400">Delivery</dt>
                    <dd className="text-right font-medium text-slate-700">
                      {q.payload.delivery_date
                        ? formatDate(q.payload.delivery_date)
                        : "No cutoff"}
                    </dd>
                  </dl>
                </li>
              ))}

            {filteredOrders.length === 0 && queuedForRoute.length === 0 ? (
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
                    <dt className="text-slate-400">Delivery</dt>
                    <dd className="text-right font-medium text-slate-700">
                      {order.delivery_date
                        ? formatDate(order.delivery_date)
                        : "No cutoff"}
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
