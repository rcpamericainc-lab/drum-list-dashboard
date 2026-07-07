"use client";

import Image from "next/image";
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
  parseDateKey,
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

const DAY_MS = 86_400_000;

function makeId(): string {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function addMonths(date: Date, months: number): Date {
  return new Date(date.getFullYear(), date.getMonth() + months, date.getDate());
}

function mondayOnOrAfter(date: Date): Date {
  const day = date.getDay();
  const offset = day === 0 ? 1 : (8 - day) % 7;
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + offset);
}

function mondayOnOrBefore(date: Date): Date {
  const day = date.getDay();
  const offset = day === 0 ? -6 : 1 - day;
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + offset);
}

function weekOptionsAround(weekKey: string): string[] {
  const currentMonday = parseDateKey(weekKey);
  const start = mondayOnOrAfter(addMonths(currentMonday, -1));
  const end = mondayOnOrBefore(addMonths(currentMonday, 1));
  const weeks: string[] = [];

  for (
    let cursor = start;
    cursor <= end;
    cursor = new Date(cursor.getTime() + 7 * DAY_MS)
  ) {
    weeks.push(toDateKey(cursor));
  }

  return weeks;
}

function formatWeekOfOption(weekKey: string): string {
  const label = parseDateKey(weekKey).toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });
  return `Week of ${label}`;
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
  const currentWeek = useMemo(() => currentOrderWeek(), []);
  const weekOptions = useMemo(
    () => weekOptionsAround(currentWeek),
    [currentWeek],
  );
  const [weekFilter, setWeekFilter] = useState(currentWeek);

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

  const matchesWeek = (wk: string) => wk === weekFilter;

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
    <main className="min-h-screen bg-[#F5F5F5] px-4 py-5 text-[#1A1A1A]">
      <div className="mx-auto flex w-full max-w-2xl items-center justify-between gap-4">
        <div className="min-w-0">
          <Image
            src="/rcp-america-wordmark.png"
            alt="RCP America"
            width={1831}
            height={555}
            className="h-auto w-44"
            preload
          />
          <p className="mt-3 text-xs font-semibold uppercase text-[#009ACE]">
            Place an order
          </p>
          <h1 className="mt-1 text-4xl leading-none text-[#1A1A1A]">
            Route Intake
          </h1>
        </div>
        <Link
          href="/office"
          className="shrink-0 border border-[#009ACE] bg-white px-3 py-2 text-sm font-semibold uppercase text-[#1A1A1A] transition hover:bg-[#009ACE] hover:text-white"
        >
          Office view
        </Link>
      </div>

      <div className="mx-auto mt-5 w-full max-w-2xl space-y-6">
        {/* Connectivity / sync status */}
        {!online ? (
          <div className="border border-[#009ACE] bg-white p-3 text-sm font-medium text-[#1A1A1A]">
            You&apos;re offline.{" "}
            {queue.length > 0
              ? `${queue.length} order${queue.length === 1 ? "" : "s"} saved on this device will send automatically when you reconnect.`
              : "Orders will be saved on this device and sent when you reconnect."}
          </div>
        ) : queue.length > 0 ? (
          <div className="border border-[#009ACE]/30 bg-[#009ACE]/10 p-3 text-sm font-medium text-[#1A1A1A]">
            Sending {queue.length} saved order{queue.length === 1 ? "" : "s"}…
          </div>
        ) : null}

        {confirmation && (
          <div className="border-2 border-[#009ACE] bg-white p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-base font-semibold text-[#1A1A1A]">
                  Order saved ✓
                </p>
                <p className="mt-1 text-sm text-[#444444]">
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
                        <span className="mt-1 block text-[#006F96]">
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
                    <span className="mt-1 block text-[#006F96]">
                      You&apos;re offline — it&apos;ll send automatically when
                      you reconnect.
                    </span>
                  )}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setConfirmation(null)}
                className="shrink-0 px-2 py-1 text-sm font-semibold uppercase text-[#444444] hover:bg-[#F5F5F5]"
              >
                Dismiss
              </button>
            </div>
          </div>
        )}

        {/* Intake form */}
        <section className="border border-[#1A1A1A]/10 bg-white p-5 shadow-sm">
          <h2 className="text-3xl leading-none text-[#1A1A1A]">New Order</h2>
          <form onSubmit={handleSubmit} className="mt-4 space-y-4">
            <div>
              <Field label="Route">
                <select
                  value={route}
                  onChange={(e) => setRoute(e.target.value)}
                  className="h-14 w-full border border-[#888888]/50 bg-white px-4 text-lg text-[#1A1A1A] outline-none focus:border-[#009ACE] focus:ring-2 focus:ring-[#009ACE]/20"
                >
                  {ROUTE_NUMBERS.map((r) => (
                    <option key={r} value={r}>
                      Route {r}
                    </option>
                  ))}
                </select>
              </Field>
              {routeConfig && (
                <p className="mt-2 text-sm text-[#888888]">
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
                className="h-14 w-full border border-[#888888]/50 px-4 text-lg text-[#1A1A1A] outline-none focus:border-[#009ACE] focus:ring-2 focus:ring-[#009ACE]/20"
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
                className="h-14 w-full border border-[#888888]/50 px-4 text-lg text-[#1A1A1A] outline-none focus:border-[#009ACE] focus:ring-2 focus:ring-[#009ACE]/20"
              />
            </Field>

            <Field label="Customer name">
              <input
                value={customerName}
                onChange={(e) => setCustomerName(e.target.value)}
                type="text"
                autoCapitalize="words"
                placeholder="e.g. Downtown Auto Auction"
                className="h-14 w-full border border-[#888888]/50 px-4 text-lg text-[#1A1A1A] outline-none focus:border-[#009ACE] focus:ring-2 focus:ring-[#009ACE]/20"
              />
            </Field>

            <Field label="Date needed">
              <input
                value={dateNeeded}
                onChange={(e) => setDateNeeded(e.target.value)}
                type="date"
                min={today}
                className="h-14 w-full border border-[#888888]/50 px-4 text-lg text-[#1A1A1A] outline-none focus:border-[#009ACE] focus:ring-2 focus:ring-[#009ACE]/20"
              />
            </Field>

            {error && (
              <p className="border border-red-200 bg-red-50 px-3 py-2 text-sm font-medium text-red-700">
                {error}
              </p>
            )}

            <button
              type="submit"
              className="h-14 w-full bg-[#009ACE] text-lg font-semibold uppercase text-white transition hover:bg-[#0084B0] active:bg-[#006F96]"
            >
              Submit order
            </button>
          </form>
        </section>

        {/* Orders for this route */}
        <section className="border border-[#1A1A1A]/10 bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between">
            <h2 className="text-3xl leading-none text-[#1A1A1A]">
              Orders on Route {route}
            </h2>
            <span className="text-sm font-medium text-[#888888]">
              {loadingOrders
                ? "Loading…"
                : `${shownCount} order${shownCount === 1 ? "" : "s"}`}
            </span>
          </div>

          <div className="mt-3 space-y-2">
            <div className="max-w-sm">
              <Field label="Week Of">
                <select
                  value={weekFilter}
                  onChange={(e) => setWeekFilter(e.target.value)}
                  className="h-11 w-full border border-[#888888]/50 bg-white px-3 text-sm text-[#1A1A1A] outline-none focus:border-[#009ACE] focus:ring-2 focus:ring-[#009ACE]/20"
                >
                  {weekOptions.map((week) => (
                    <option key={week} value={week}>
                      {formatWeekOfOption(week)}
                    </option>
                  ))}
                </select>
              </Field>
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
                  className="border border-[#009ACE]/30 bg-[#009ACE]/10 p-4"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-base font-semibold text-[#1A1A1A]">
                        {q.payload.product_name}
                      </p>
                      <p className="truncate text-sm text-[#444444]">
                        {q.payload.customer_name}
                      </p>
                    </div>
                    <span className="inline-flex shrink-0 items-center gap-1.5 border border-[#009ACE] bg-white px-2.5 py-1 text-xs font-semibold text-[#1A1A1A]">
                      <span className="h-1.5 w-1.5 rounded-full bg-[#009ACE]" />
                      Waiting to send
                    </span>
                  </div>
                  <dl className="mt-3 grid grid-cols-2 gap-y-1 text-sm text-[#444444]">
                    <dt className="text-[#888888]">Needed</dt>
                    <dd className="text-right font-medium text-[#1A1A1A]">
                      {q.payload.date_needed
                        ? formatDate(q.payload.date_needed)
                        : "—"}
                    </dd>
                    <dt className="text-[#888888]">Delivery</dt>
                    <dd className="text-right font-medium text-[#1A1A1A]">
                      {q.payload.delivery_date
                        ? formatDate(q.payload.delivery_date)
                        : "No cutoff"}
                    </dd>
                  </dl>
                </li>
              ))}

            {filteredOrders.length === 0 && queuedForRoute.length === 0 ? (
              <li className="border border-dashed border-[#888888]/50 px-4 py-8 text-center text-sm text-[#888888]">
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
                  className="border border-[#888888]/25 p-4"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-base font-semibold text-[#1A1A1A]">
                        {order.product_name}
                      </p>
                      <p className="truncate text-sm text-[#444444]">
                        {order.customer_name}
                      </p>
                    </div>
                    <StatusBadge status={order.status} />
                  </div>
                  <dl className="mt-3 grid grid-cols-2 gap-y-1 text-sm text-[#444444]">
                    <dt className="text-[#888888]">Needed</dt>
                    <dd className="text-right font-medium text-[#1A1A1A]">
                      {formatDate(order.date_needed)}
                    </dd>
                    <dt className="text-[#888888]">Delivery</dt>
                    <dd className="text-right font-medium text-[#1A1A1A]">
                      {order.delivery_date
                        ? formatDate(order.delivery_date)
                        : "No cutoff"}
                    </dd>
                    <dt className="text-[#888888]">Order week</dt>
                    <dd className="text-right font-medium text-[#1A1A1A]">
                      {formatWeekLabel(order.order_week)}
                    </dd>
                    {order.driver_name && (
                      <>
                        <dt className="text-[#888888]">Placed by</dt>
                        <dd className="text-right font-medium text-[#1A1A1A]">
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
      <span className="text-sm font-medium text-[#444444]">{label}</span>
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
