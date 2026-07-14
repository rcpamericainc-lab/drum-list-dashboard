"use client";

import Image from "next/image";
import { useEffect, useMemo, useState } from "react";

import { StatusBadge } from "@/components/status-badge";
import type { Database, OrderItem, OrderStatus } from "@/lib/database.types";
import { createClient } from "@/lib/supabase/browser";
import { ORDER_STATUSES, STATUS_META } from "@/lib/order-status";
import {
  isNoCutoffRoute,
  itemDeliveryDate,
  itemOrderWeek,
  normalizeItems,
  rollupStatus,
  summarizeItems,
} from "@/lib/order-items";
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

const ROUTE_KEY = "fleetview.route";
const NAME_KEY = "fleetview.driverName";

const byDateNeeded = (a: Order, b: Order) =>
  a.date_needed.localeCompare(b.date_needed);

const DAY_MS = 86_400_000;

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
  products: string;
  weekKey: string;
  deliveryDate: string | null;
  hasCutoff: boolean;
  rolledOver: boolean;
};

/** A product line being entered on the intake form. */
type LineItem = { product_name: string; quantity: number };

export default function OrderingPage() {
  const supabase = useMemo(() => createClient(), []);
  const today = toDateKey(new Date());

  const [route, setRoute] = useState<string>("");
  const [driverName, setDriverName] = useState("");
  const [items, setItems] = useState<LineItem[]>([
    { product_name: "", quantity: 1 },
  ]);
  const [customerName, setCustomerName] = useState("");
  const [customerAddress, setCustomerAddress] = useState("");
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

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);

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

  function updateItem(index: number, patch: Partial<LineItem>) {
    setItems((prev) =>
      prev.map((it, i) => (i === index ? { ...it, ...patch } : it)),
    );
  }
  function addItem() {
    setItems((prev) => [...prev, { product_name: "", quantity: 1 }]);
  }
  function removeItem(index: number) {
    setItems((prev) =>
      prev.length > 1 ? prev.filter((_, i) => i !== index) : prev,
    );
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    // Normalize: trim names, clamp quantities to >= 1, drop blank-name rows.
    const cleanedItems = items
      .map((it) => ({
        product_name: it.product_name.trim(),
        quantity: Math.max(1, Math.floor(it.quantity) || 1),
      }))
      .filter((it) => it.product_name !== "");

    if (!route || cleanedItems.length === 0 || !customerName.trim() || !dateNeeded) {
      setError(
        "Please fill in route, at least one product, customer, and date needed.",
      );
      return;
    }
    if (!routeConfig) {
      setError("Unknown route selected.");
      return;
    }

    // Freeze the cutoff/delivery timing at submit time.
    const timing = computeOrderTiming(new Date(), routeConfig);
    // No-cutoff routes (no delivery cutoff) are auto in-stock; the rest start
    // "open" and wait for the office to set availability per item.
    const itemStatus: OrderStatus = timing.hasCutoff ? "open" : "in_stock";
    const payload: OrderInsert = {
      route_number: route,
      driver_name: driverName.trim() || null,
      items: cleanedItems.map((it) => ({ ...it, status: itemStatus })),
      customer_name: customerName.trim(),
      customer_address: customerAddress.trim() || null,
      date_needed: dateNeeded,
      order_week: timing.orderWeek,
      delivery_date: timing.deliveryDate,
      status: itemStatus,
    };

    setSubmitting(true);
    let data: Order | null = null;
    let errMessage: string | null = null;
    try {
      const res = await supabase
        .from("orders")
        .insert(payload)
        .select()
        .single();
      data = res.data;
      if (res.error) errMessage = res.error.message;
    } catch (e) {
      // A hard network failure rejects rather than returning { error }.
      errMessage = e instanceof Error ? e.message : String(e);
    }
    setSubmitting(false);

    if (!data || errMessage) {
      // Surface the real reason instead of always blaming the connection —
      // a rejected insert (e.g. a stale cached app hitting the current schema)
      // has full signal but still fails.
      console.error("Order submit failed:", errMessage, payload);
      const looksOffline =
        !navigator.onLine || /failed to fetch|network/i.test(errMessage ?? "");
      setError(
        looksOffline
          ? "Couldn't send the order — you appear to be offline. Try again once you have signal."
          : `Couldn't send the order (${errMessage ?? "unexpected error"}). Please refresh the page; if it keeps happening, screenshot this and send it to the office.`,
      );
      return;
    }

    if (data.route_number === route) {
      setOrders((prev) =>
        [...prev.filter((o) => o.id !== data.id), data].sort(byDateNeeded),
      );
    }

    setConfirmation({
      products: summarizeItems(data.items),
      weekKey: timing.orderWeek,
      deliveryDate: timing.deliveryDate,
      hasCutoff: timing.hasCutoff,
      rolledOver: timing.rolledOver,
    });

    setItems([{ product_name: "", quantity: 1 }]);
    setCustomerName("");
    setCustomerAddress("");
    setDateNeeded("");
  }

  // Persist a driver edit to an existing order. Stock status is office-owned, so
  // it is never changed here: existing items keep their status, and the order's
  // rollup is recomputed only to stay consistent with any lines added/removed.
  // Optimistic update with rollback, mirroring the office dashboard. Returns an
  // error message on failure, or null on success.
  async function saveOrderEdits(
    order: Order,
    patch: {
      items: OrderItem[];
      customer_name: string;
      customer_address: string | null;
      date_needed: string;
      driver_name: string | null;
    },
  ): Promise<string | null> {
    const nextStatus = rollupStatus(patch.items);
    const previous = orders;
    setOrders((prev) =>
      prev
        .map((o) =>
          o.id === order.id ? { ...o, ...patch, status: nextStatus } : o,
        )
        .sort(byDateNeeded),
    );

    let errMessage: string | null = null;
    try {
      const res = await supabase
        .from("orders")
        .update({ ...patch, status: nextStatus })
        .eq("id", order.id);
      if (res.error) errMessage = res.error.message;
    } catch (e) {
      errMessage = e instanceof Error ? e.message : String(e);
    }

    if (errMessage) {
      setOrders(previous); // rollback
      console.error("Order edit failed:", errMessage, patch);
    }
    return errMessage;
  }

  // An order shows for the selected week if any of its items lands in that week
  // (out-of-stock items are a week later than in-stock ones). The status filter
  // matches if any item has that status.
  const shownOrders = orders.filter((o) => {
    const items = normalizeItems(o);
    if (filter !== "all" && !items.some((it) => it.status === filter)) {
      return false;
    }
    return items.some((it) => itemOrderWeek(o, it) === weekFilter);
  });
  const shownCount = shownOrders.length;

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
      </div>

      <div className="mx-auto mt-5 w-full max-w-2xl space-y-6">
        {confirmation && (
          <div className="border-2 border-[#009ACE] bg-white p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-base font-semibold text-[#1A1A1A]">
                  Order submitted ✓
                </p>
                <p className="mt-1 text-sm text-[#444444]">
                  {confirmation.hasCutoff && confirmation.deliveryDate ? (
                    <>
                      <span className="font-medium">
                        {confirmation.products}
                      </span>{" "}
                      {confirmation.products.includes(",") ? "are" : "is"}{" "}
                      scheduled for delivery{" "}
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
                        {confirmation.products}
                      </span>{" "}
                      was added to the{" "}
                      <span className="font-semibold">
                        {formatWeekLabel(confirmation.weekKey)}
                      </span>{" "}
                      (this route has no cutoff).
                    </>
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

            <div>
              <span className="text-sm font-medium text-[#444444]">
                Products
              </span>
              <div className="mt-1.5 space-y-3">
                {items.map((it, i) => (
                  <div
                    key={i}
                    className="border border-[#888888]/30 bg-[#FAFAFA] p-3"
                  >
                    <input
                      value={it.product_name}
                      onChange={(e) =>
                        updateItem(i, { product_name: e.target.value })
                      }
                      type="text"
                      autoCapitalize="words"
                      enterKeyHint="next"
                      placeholder="e.g. Tire shine, 5-gal"
                      className="h-14 w-full border border-[#888888]/50 bg-white px-4 text-lg text-[#1A1A1A] outline-none focus:border-[#009ACE] focus:ring-2 focus:ring-[#009ACE]/20"
                    />
                    {items.length > 1 && (
                      <div className="mt-2 flex justify-end">
                        <button
                          type="button"
                          onClick={() => removeItem(i)}
                          className="h-10 px-3 text-sm font-semibold uppercase text-[#888888] hover:bg-[#F5F5F5]"
                        >
                          Remove
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
              <button
                type="button"
                onClick={addItem}
                className="mt-2 text-sm font-semibold uppercase text-[#009ACE] hover:underline"
              >
                + Add another product
              </button>
            </div>

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

            <Field label="Customer address (optional)">
              <input
                value={customerAddress}
                onChange={(e) => setCustomerAddress(e.target.value)}
                type="text"
                autoCapitalize="words"
                placeholder="e.g. 1200 W 5th Ave, Columbus, OH 43212"
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
              disabled={submitting}
              className="h-14 w-full bg-[#009ACE] text-lg font-semibold uppercase text-white transition hover:bg-[#0084B0] active:bg-[#006F96] disabled:cursor-not-allowed disabled:opacity-60"
            >
              {submitting ? "Submitting…" : "Submit order"}
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
            {shownOrders.length === 0 ? (
              <li className="border border-dashed border-[#888888]/50 px-4 py-8 text-center text-sm text-[#888888]">
                {loadingOrders
                  ? "Loading orders…"
                  : orders.length === 0
                    ? "No orders on this route yet. Submit your first one above."
                    : "No orders match this filter."}
              </li>
            ) : (
              shownOrders.map((order) => (
                <OrderCard key={order.id} order={order} onSave={saveOrderEdits} />
              ))
            )}
          </ul>
        </section>
      </div>
    </main>
  );
}

type EditPatch = {
  items: OrderItem[];
  customer_name: string;
  customer_address: string | null;
  date_needed: string;
  driver_name: string | null;
};

/** A product line while editing; `status` is carried from the existing item
 * (office-owned) and is absent on newly added lines. */
type EditLine = { product_name: string; quantity: number; status?: OrderStatus };

/**
 * One order in the route list. Read-only by default with an Edit button; in edit
 * mode the driver can change products, quantities, customer, address, date, and
 * their name. Stock status stays office-only — existing lines show it read-only,
 * and it is never editable here.
 */
function OrderCard({
  order,
  onSave,
}: {
  order: Order;
  onSave: (order: Order, patch: EditPatch) => Promise<string | null>;
}) {
  const items = normalizeItems(order);
  const [editing, setEditing] = useState(false);
  const [lines, setLines] = useState<EditLine[]>([]);
  const [customerName, setCustomerName] = useState("");
  const [customerAddress, setCustomerAddress] = useState("");
  const [dateNeeded, setDateNeeded] = useState("");
  const [driverName, setDriverName] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function startEdit() {
    setLines(
      items.map((it) => ({
        product_name: it.product_name,
        quantity: it.quantity,
        status: it.status,
      })),
    );
    setCustomerName(order.customer_name);
    setCustomerAddress(order.customer_address ?? "");
    setDateNeeded(order.date_needed);
    setDriverName(order.driver_name ?? "");
    setError(null);
    setEditing(true);
  }

  function updateLine(index: number, patch: Partial<EditLine>) {
    setLines((prev) =>
      prev.map((l, i) => (i === index ? { ...l, ...patch } : l)),
    );
  }
  function addLine() {
    setLines((prev) => [...prev, { product_name: "", quantity: 1 }]);
  }
  function removeLine(index: number) {
    setLines((prev) =>
      prev.length > 1 ? prev.filter((_, i) => i !== index) : prev,
    );
  }

  async function handleSave() {
    const cleaned = lines
      .map((l) => ({
        product_name: l.product_name.trim(),
        quantity: Math.max(1, Math.floor(l.quantity) || 1),
        status: l.status,
      }))
      .filter((l) => l.product_name !== "");

    if (cleaned.length === 0 || !customerName.trim() || !dateNeeded) {
      setError("Keep at least one product, a customer name, and a date needed.");
      return;
    }

    // New lines (no carried status) follow intake's rule for this route:
    // no-cutoff routes are auto in-stock; others wait as "open".
    const defaultStatus: OrderStatus = isNoCutoffRoute(order.route_number)
      ? "in_stock"
      : "open";
    const nextItems: OrderItem[] = cleaned.map((l) => ({
      product_name: l.product_name,
      quantity: l.quantity,
      status: l.status ?? defaultStatus,
    }));

    setSaving(true);
    const err = await onSave(order, {
      items: nextItems,
      customer_name: customerName.trim(),
      customer_address: customerAddress.trim() || null,
      date_needed: dateNeeded,
      driver_name: driverName.trim() || null,
    });
    setSaving(false);

    if (err) {
      const looksOffline =
        !navigator.onLine || /failed to fetch|network/i.test(err);
      setError(
        looksOffline
          ? "Couldn't save — you appear to be offline. Try again once you have signal."
          : `Couldn't save (${err}). Please try again.`,
      );
      return;
    }
    setEditing(false);
  }

  if (!editing) {
    return (
      <li className="border border-[#888888]/25 p-4">
        <ul className="space-y-1.5">
          {items.map((it, i) => {
            const delivery = itemDeliveryDate(order, it);
            return (
              <li key={i} className="flex items-start justify-between gap-3">
                <span className="min-w-0 flex-1 break-words text-base font-semibold text-[#1A1A1A]">
                  {it.product_name}
                  {it.quantity > 1 && (
                    <span className="text-[#888888]"> ×{it.quantity}</span>
                  )}
                </span>
                <span className="flex shrink-0 flex-col items-end gap-1">
                  <StatusBadge status={it.status} />
                  {delivery && (
                    <span className="text-xs text-[#888888]">
                      {formatDate(delivery)}
                    </span>
                  )}
                </span>
              </li>
            );
          })}
        </ul>
        <div className="mt-3 flex items-start justify-between gap-3 border-t border-[#888888]/15 pt-2">
          <div className="min-w-0">
            <p className="text-sm font-medium text-[#1A1A1A]">
              {order.customer_name}
            </p>
            {order.customer_address && (
              <p className="text-xs text-[#888888]">{order.customer_address}</p>
            )}
            <p className="mt-1 text-xs text-[#888888]">
              Needed {formatDate(order.date_needed)}
              {order.driver_name ? ` · by ${order.driver_name}` : ""}
            </p>
          </div>
          <button
            type="button"
            onClick={startEdit}
            className="shrink-0 border border-[#009ACE] px-3 py-1.5 text-sm font-semibold uppercase text-[#009ACE] transition hover:bg-[#009ACE] hover:text-white"
          >
            Edit
          </button>
        </div>
      </li>
    );
  }

  return (
    <li className="border-2 border-[#009ACE] bg-white p-4">
      <p className="text-sm font-semibold uppercase text-[#009ACE]">
        Editing order
      </p>
      <div className="mt-3 space-y-4">
        <div>
          <span className="text-sm font-medium text-[#444444]">Products</span>
          <div className="mt-1.5 space-y-3">
            {lines.map((l, i) => (
              <div
                key={i}
                className="border border-[#888888]/30 bg-[#FAFAFA] p-3"
              >
                <input
                  value={l.product_name}
                  onChange={(e) =>
                    updateLine(i, { product_name: e.target.value })
                  }
                  type="text"
                  autoCapitalize="words"
                  placeholder="e.g. Tire shine, 5-gal"
                  className="h-14 w-full border border-[#888888]/50 bg-white px-4 text-lg text-[#1A1A1A] outline-none focus:border-[#009ACE] focus:ring-2 focus:ring-[#009ACE]/20"
                />
                <div className="mt-2 flex items-center justify-between gap-2">
                  <label className="flex items-center gap-2 text-sm text-[#444444]">
                    Qty
                    <input
                      value={l.quantity}
                      onChange={(e) =>
                        updateLine(i, { quantity: Number(e.target.value) })
                      }
                      type="number"
                      min={1}
                      inputMode="numeric"
                      className="h-10 w-20 border border-[#888888]/50 bg-white px-2 text-base text-[#1A1A1A] outline-none focus:border-[#009ACE] focus:ring-2 focus:ring-[#009ACE]/20"
                    />
                  </label>
                  <span className="flex items-center gap-2">
                    {l.status && <StatusBadge status={l.status} />}
                    {lines.length > 1 && (
                      <button
                        type="button"
                        onClick={() => removeLine(i)}
                        className="h-10 px-3 text-sm font-semibold uppercase text-[#888888] hover:bg-[#F5F5F5]"
                      >
                        Remove
                      </button>
                    )}
                  </span>
                </div>
              </div>
            ))}
          </div>
          <button
            type="button"
            onClick={addLine}
            className="mt-2 text-sm font-semibold uppercase text-[#009ACE] hover:underline"
          >
            + Add another product
          </button>
        </div>

        <Field label="Customer name">
          <input
            value={customerName}
            onChange={(e) => setCustomerName(e.target.value)}
            type="text"
            autoCapitalize="words"
            className="h-14 w-full border border-[#888888]/50 px-4 text-lg text-[#1A1A1A] outline-none focus:border-[#009ACE] focus:ring-2 focus:ring-[#009ACE]/20"
          />
        </Field>

        <Field label="Customer address (optional)">
          <input
            value={customerAddress}
            onChange={(e) => setCustomerAddress(e.target.value)}
            type="text"
            autoCapitalize="words"
            className="h-14 w-full border border-[#888888]/50 px-4 text-lg text-[#1A1A1A] outline-none focus:border-[#009ACE] focus:ring-2 focus:ring-[#009ACE]/20"
          />
        </Field>

        <Field label="Date needed">
          <input
            value={dateNeeded}
            onChange={(e) => setDateNeeded(e.target.value)}
            type="date"
            className="h-14 w-full border border-[#888888]/50 px-4 text-lg text-[#1A1A1A] outline-none focus:border-[#009ACE] focus:ring-2 focus:ring-[#009ACE]/20"
          />
        </Field>

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

        {error && (
          <p className="border border-red-200 bg-red-50 px-3 py-2 text-sm font-medium text-red-700">
            {error}
          </p>
        )}

        <div className="flex gap-3">
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="h-12 flex-1 bg-[#009ACE] text-base font-semibold uppercase text-white transition hover:bg-[#0084B0] active:bg-[#006F96] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {saving ? "Saving…" : "Save changes"}
          </button>
          <button
            type="button"
            onClick={() => {
              setEditing(false);
              setError(null);
            }}
            disabled={saving}
            className="h-12 flex-1 border border-[#888888]/50 text-base font-semibold uppercase text-[#444444] transition hover:bg-[#F5F5F5] disabled:opacity-60"
          >
            Cancel
          </button>
        </div>
      </div>
    </li>
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
