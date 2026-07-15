"use client";

import Image from "next/image";
import { useEffect, useMemo, useState } from "react";

import { ItemStatusBadge } from "@/components/item-status-badge";
import type {
  Database,
  OrderItem,
  OrderStatus,
} from "@/lib/database.types";
import { createClient } from "@/lib/supabase/browser";
import { ORDER_STATUSES, STATUS_META } from "@/lib/order-status";
import {
  getBaseDelivery,
  isCancelled,
  isFulfilled,
  itemDeliveryDate,
  itemsInWeek,
  returningQty,
  summarizeItems,
  type ItemWeekRole,
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

  // Persist a driver's delivery report (fulfillment fields only). Stock status
  // is office-owned and untouched here. Optimistic update with rollback;
  // returns an error message on failure or null on success.
  async function saveFulfillment(
    order: Order,
    nextItems: OrderItem[],
  ): Promise<string | null> {
    const previous = orders;
    setOrders((prev) =>
      prev.map((o) => (o.id === order.id ? { ...o, items: nextItems } : o)),
    );

    let errMessage: string | null = null;
    try {
      const res = await supabase
        .from("orders")
        .update({ items: nextItems })
        .eq("id", order.id);
      if (res.error) errMessage = res.error.message;
    } catch (e) {
      errMessage = e instanceof Error ? e.message : String(e);
    }

    if (errMessage) {
      setOrders(previous); // rollback
      console.error("Fulfillment save failed:", errMessage);
    }
    return errMessage;
  }

  // An order shows for the selected week if it has any item in that week's view.
  // A week-shift out-of-stock item appears in both its origin and next week, so
  // an order can show in two weeks. The status filter matches if any item shown
  // for this week has that status.
  const shownOrders = orders.filter((o) => {
    const weekItems = itemsInWeek(o, weekFilter);
    if (weekItems.length === 0) return false;
    if (filter !== "all" && !weekItems.some((wi) => wi.item.status === filter)) {
      return false;
    }
    return true;
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
              <p className="mt-1 text-sm text-[#888888]">
                Set how many of each product the customer needs. The office and
                warehouse use these counts to pull and load stock, and on the
                route the driver confirms how many were delivered — anything
                short is tracked as returning to the warehouse.
              </p>
              <div className="mt-1.5 space-y-3">
                {items.map((it, i) => (
                  <div
                    key={i}
                    className="border border-[#888888]/30 bg-[#FAFAFA] p-3"
                  >
                    <div className="flex items-center gap-2">
                      <input
                        value={it.product_name}
                        onChange={(e) =>
                          updateItem(i, { product_name: e.target.value })
                        }
                        type="text"
                        autoCapitalize="words"
                        enterKeyHint="next"
                        placeholder="e.g. Tire shine, 5-gal"
                        className="h-14 min-w-0 flex-1 border border-[#888888]/50 bg-white px-4 text-lg text-[#1A1A1A] outline-none focus:border-[#009ACE] focus:ring-2 focus:ring-[#009ACE]/20"
                      />
                      {items.length > 1 && (
                        <button
                          type="button"
                          onClick={() => removeItem(i)}
                          aria-label={`Remove product ${i + 1}`}
                          className="flex h-14 w-12 shrink-0 items-center justify-center border border-[#888888]/50 bg-white text-2xl leading-none text-[#888888] transition hover:border-red-300 hover:bg-red-50 hover:text-red-600"
                        >
                          <span aria-hidden>×</span>
                        </button>
                      )}
                    </div>
                    <label className="mt-2 flex items-center gap-2 text-sm font-medium text-[#444444]">
                      Qty
                      <input
                        value={it.quantity}
                        onChange={(e) =>
                          updateItem(i, { quantity: Number(e.target.value) })
                        }
                        type="number"
                        min={1}
                        inputMode="numeric"
                        aria-label={`Quantity for product ${i + 1}`}
                        className="h-11 w-24 border border-[#888888]/50 bg-white px-3 text-base text-[#1A1A1A] outline-none focus:border-[#009ACE] focus:ring-2 focus:ring-[#009ACE]/20"
                      />
                    </label>
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
                <DriverOrderCard
                  key={order.id}
                  order={order}
                  weekFilter={weekFilter}
                  onSaveFulfillment={saveFulfillment}
                />
              ))
            )}
          </ul>
        </section>
      </div>
    </main>
  );
}

const ROLE_CAPTION: Record<Exclude<ItemWeekRole, "normal">, string> = {
  day_move: "Moved to next day",
  moved_out: "Moving to next week",
  moved_in: "Moved up from last week",
};

/** One editable row in the delivery-report sheet. */
type DeliveryLine = {
  index: number;
  delivered: boolean;
  qty: number;
  note: string;
};

/**
 * One order in the driver's route list. Read-only item rows plus a "Mark
 * delivered" action that opens a focused sheet: per deliverable item, a
 * Delivered toggle, quantity delivered (the rest is flagged as returning), and
 * an optional note. Drivers report fulfillment only — stock and cancel are
 * office-owned. Items leaving for next week (moved_out) and cancelled items
 * aren't deliverable here.
 */
function DriverOrderCard({
  order,
  weekFilter,
  onSaveFulfillment,
}: {
  order: Order;
  weekFilter: string;
  onSaveFulfillment: (
    order: Order,
    nextItems: OrderItem[],
  ) => Promise<string | null>;
}) {
  const weekItems = itemsInWeek(order, weekFilter);
  const deliverable = weekItems.filter(
    (wi) => wi.role !== "moved_out" && !isCancelled(wi.item),
  );

  const [editing, setEditing] = useState(false);
  const [lines, setLines] = useState<DeliveryLine[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function openSheet() {
    setLines(
      deliverable.map(({ item, index }) => ({
        index,
        delivered: true,
        qty: item.quantity_fulfilled ?? item.quantity,
        note: item.note ?? "",
      })),
    );
    setError(null);
    setEditing(true);
  }

  function updateLine(index: number, patch: Partial<DeliveryLine>) {
    setLines((prev) =>
      prev.map((l) => (l.index === index ? { ...l, ...patch } : l)),
    );
  }

  async function handleSave() {
    const byIndex = new Map(lines.map((l) => [l.index, l]));
    const nextItems: OrderItem[] = order.items.map((it, i) => {
      const l = byIndex.get(i);
      if (!l) return it;
      const note = l.note.trim() || null;
      if (!l.delivered) {
        return { ...it, fulfillment: null, quantity_fulfilled: null, note };
      }
      const qty = Math.max(0, Math.min(it.quantity, Math.floor(l.qty) || 0));
      return { ...it, fulfillment: "fulfilled", quantity_fulfilled: qty, note };
    });

    setSaving(true);
    const err = await onSaveFulfillment(order, nextItems);
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

  const anyFulfilled = deliverable.some((wi) => isFulfilled(wi.item));

  return (
    <li className="border border-[#888888]/25 p-4">
      <ul className="space-y-1.5">
        {weekItems.map(({ item, index, role }) => (
          <OrderItemRow
            key={`${index}:${role}`}
            order={order}
            item={item}
            role={role}
          />
        ))}
      </ul>

      <div className="mt-3 border-t border-[#888888]/15 pt-2">
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

      {deliverable.length > 0 && !editing && (
        <button
          type="button"
          onClick={openSheet}
          className="mt-3 h-11 w-full border border-[#009ACE] text-sm font-semibold uppercase text-[#009ACE] transition hover:bg-[#009ACE] hover:text-white"
        >
          {anyFulfilled ? "Update delivery" : "Mark delivered"}
        </button>
      )}

      {editing && (
        <div className="mt-3 border-2 border-[#009ACE] p-3">
          <p className="text-sm font-semibold uppercase text-[#009ACE]">
            Delivery report
          </p>
          <div className="mt-2 space-y-3">
            {lines.map((l) => {
              const item = order.items[l.index];
              const back = l.delivered
                ? Math.max(0, item.quantity - (Math.floor(l.qty) || 0))
                : 0;
              return (
                <div
                  key={l.index}
                  className="border border-[#888888]/30 bg-[#FAFAFA] p-3"
                >
                  <div className="flex items-start justify-between gap-2">
                    <span className="min-w-0 flex-1 break-words text-sm font-semibold text-[#1A1A1A]">
                      {item.product_name}
                      <span className="font-normal text-[#888888]">
                        {" "}
                        · {item.quantity} ordered
                      </span>
                    </span>
                    <label className="flex shrink-0 items-center gap-1.5 text-sm font-medium text-[#444444]">
                      <input
                        type="checkbox"
                        checked={l.delivered}
                        onChange={(e) =>
                          updateLine(l.index, { delivered: e.target.checked })
                        }
                        className="h-5 w-5 accent-[#009ACE]"
                      />
                      Delivered
                    </label>
                  </div>
                  {l.delivered && (
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <label className="flex items-center gap-2 text-sm text-[#444444]">
                        Qty delivered
                        <input
                          type="number"
                          min={0}
                          max={item.quantity}
                          inputMode="numeric"
                          value={l.qty}
                          onChange={(e) =>
                            updateLine(l.index, { qty: Number(e.target.value) })
                          }
                          className="h-10 w-20 border border-[#888888]/50 bg-white px-2 text-base text-[#1A1A1A] outline-none focus:border-[#009ACE] focus:ring-2 focus:ring-[#009ACE]/20"
                        />
                        of {item.quantity}
                      </label>
                      {back > 0 && (
                        <span className="text-xs font-semibold text-[#B00020]">
                          {back} returning
                        </span>
                      )}
                    </div>
                  )}
                  <input
                    type="text"
                    value={l.note}
                    onChange={(e) =>
                      updateLine(l.index, { note: e.target.value })
                    }
                    placeholder="Note (optional)"
                    className="mt-2 h-11 w-full border border-[#888888]/50 bg-white px-3 text-sm text-[#1A1A1A] outline-none focus:border-[#009ACE] focus:ring-2 focus:ring-[#009ACE]/20"
                  />
                </div>
              );
            })}
          </div>
          {error && (
            <p className="mt-2 border border-red-200 bg-red-50 px-3 py-2 text-sm font-medium text-red-700">
              {error}
            </p>
          )}
          <div className="mt-3 flex gap-3">
            <button
              type="button"
              onClick={handleSave}
              disabled={saving}
              className="h-11 flex-1 bg-[#009ACE] text-sm font-semibold uppercase text-white transition hover:bg-[#0084B0] active:bg-[#006F96] disabled:cursor-not-allowed disabled:opacity-60"
            >
              {saving ? "Saving…" : "Save"}
            </button>
            <button
              type="button"
              onClick={() => {
                setEditing(false);
                setError(null);
              }}
              disabled={saving}
              className="h-11 flex-1 border border-[#888888]/50 text-sm font-semibold uppercase text-[#444444] transition hover:bg-[#F5F5F5] disabled:opacity-60"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </li>
  );
}

/**
 * One product line in the driver's order list, framed for the week being
 * viewed. A "normal" line shows its delivery date; a moved line shows the
 * original date struck through, the new date, and a caption naming the move
 * (out to next week, in from last week, or a next-day push for 4/6/14).
 */
function OrderItemRow({
  order,
  item,
  role,
}: {
  order: Order;
  item: OrderItem;
  role: ItemWeekRole;
}) {
  const base = getBaseDelivery(order);
  const delivery = itemDeliveryDate(order, item);
  const returning = returningQty(item);

  return (
    <li className="flex items-start justify-between gap-3">
      <span className="min-w-0 flex-1 break-words text-base font-semibold text-[#1A1A1A]">
        {item.product_name}
        {item.quantity > 1 && (
          <span className="text-[#888888]"> ×{item.quantity}</span>
        )}
        {isFulfilled(item) && returning > 0 && (
          <span className="mt-0.5 block text-xs font-semibold text-[#B00020]">
            {returning} returning to warehouse
          </span>
        )}
        {item.note && (
          <span className="mt-0.5 block break-words text-xs italic text-[#888888]">
            “{item.note}”
          </span>
        )}
      </span>
      <span className="flex shrink-0 flex-col items-end gap-1">
        <ItemStatusBadge item={item} />
        {role !== "normal" && base && delivery ? (
          <span className="flex flex-col items-end">
            <span className="text-xs">
              <span className="text-[#888888] line-through decoration-[#009ACE] decoration-2">
                {formatDate(base)}
              </span>{" "}
              <span className="font-semibold text-[#009ACE]">
                {formatDate(delivery)}
              </span>
            </span>
            <span className="text-[10px] font-semibold uppercase tracking-wide text-[#009ACE]">
              {ROLE_CAPTION[role]}
            </span>
          </span>
        ) : (
          delivery && (
            <span className="text-xs text-[#888888]">
              {formatDate(delivery)}
            </span>
          )
        )}
      </span>
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
