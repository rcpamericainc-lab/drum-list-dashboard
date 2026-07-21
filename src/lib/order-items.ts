import type { Database, OrderItem, OrderStatus } from "@/lib/database.types";
import { shiftDays, shiftWeeks, weekOf } from "@/lib/order-week";
import { getRoute } from "@/lib/routes";

type Order = Database["public"]["Tables"]["orders"]["Row"];

/** Join an order's product names, e.g. "Tire Shine, Wax". */
export function summarizeItems(
  items: OrderItem[] | null | undefined,
  separator = ", ",
): string {
  return (items ?? []).map((it) => it.product_name).join(separator);
}

/** A route with no delivery cutoff (4, 6, 14) is auto in-stock and locked. */
export function isNoCutoffRoute(routeNumber: string): boolean {
  return !getRoute(routeNumber)?.cutoff;
}

/**
 * The order's base delivery date. No-cutoff routes (4, 6, 14) have no computed
 * delivery_date, so they fall back to the requested date_needed.
 */
export function getBaseDelivery(order: Order): string | null {
  if (isNoCutoffRoute(order.route_number) && order.delivery_date === null) {
    return order.date_needed;
  }
  return order.delivery_date;
}

/**
 * Normalize items to the current model:
 *  - Pre-item-status rows carry status only at the order level, so a missing
 *    item status falls back to the order's status.
 *  - The old model stored a resting "out_of_stock" that meant "moved one unit
 *    forward." The new model reopens after each move and counts moves in
 *    `bumps`, and never rests on out_of_stock. So a legacy resting out_of_stock
 *    is converted to open + one extra bump. This lazily migrates old rows on
 *    read; they persist in the new shape the next time the order is saved.
 */
export function normalizeItems(order: Order): OrderItem[] {
  return (order.items ?? []).map((it) => {
    const status = it.status ?? order.status;
    if (status === "out_of_stock") {
      return { ...it, status: "open" as const, bumps: (it.bumps ?? 0) + 1 };
    }
    return { ...it, status };
  });
}

/**
 * How far an out-of-stock item moves. The cutoff routes deliver on a weekly
 * schedule, so out-of-stock rolls to the next week. The no-cutoff routes
 * (4, 6, 14) deliver daily, so out-of-stock rolls to the next day instead.
 */
export function itemShiftUnit(routeNumber: string): "week" | "day" {
  return isNoCutoffRoute(routeNumber) ? "day" : "week";
}

/** An item the office has cancelled (soft-retired). */
export function isCancelled(item: OrderItem): boolean {
  return item.fulfillment === "cancelled";
}

/** An item the driver has marked delivered. */
export function isFulfilled(item: OrderItem): boolean {
  return item.fulfillment === "fulfilled";
}

/** Fulfilled or cancelled — a terminal state that ends the item's lifecycle. */
export function isTerminal(item: OrderItem): boolean {
  return item.fulfillment === "fulfilled" || item.fulfillment === "cancelled";
}

/**
 * How many units of a fulfilled item are returning to the warehouse — the gap
 * between what was ordered and what actually went to the customer. 0 for items
 * that aren't fulfilled or were delivered in full.
 */
export function returningQty(item: OrderItem): number {
  if (item.fulfillment !== "fulfilled" || item.quantity_fulfilled == null) {
    return 0;
  }
  return Math.max(0, item.quantity - item.quantity_fulfilled);
}

/** How many times the office has pushed this item forward (never negative). */
export function itemBumps(item: OrderItem): number {
  return Math.max(0, Math.floor(item.bumps ?? 0));
}

/** An item that has been pushed forward at least once. */
export function isMoved(item: OrderItem): boolean {
  return itemBumps(item) > 0;
}

/**
 * Current scheduled delivery date for one item — the original shifted forward
 * by `bumps` of the route's unit (a day for 4/6/14, a week for the rest).
 */
export function itemDeliveryDate(order: Order, item: OrderItem): string | null {
  const base = getBaseDelivery(order);
  if (base === null) return null;
  const bumps = itemBumps(item);
  if (bumps === 0) return base;
  return itemShiftUnit(order.route_number) === "day"
    ? shiftDays(base, bumps)
    : shiftWeeks(base, bumps);
}

/**
 * Current scheduled order-week (Monday).
 *
 * Week-unit (cutoff) routes bucket by the stored order_week (the Monday of the
 * computed delivery week), advancing one week per bump.
 *
 * Day-unit (no-cutoff) routes 4/6/14 store order_week as the *intake* week,
 * which can differ from the requested delivery week — so they bucket by the
 * week of the actual scheduled delivery date (date_needed, plus any day bumps)
 * instead. This keeps an order needed the week of the 20th in that week's view
 * even if it was placed the week of the 13th.
 */
export function itemOrderWeek(order: Order, item: OrderItem): string {
  if (itemShiftUnit(order.route_number) === "week") {
    const bumps = itemBumps(item);
    return bumps > 0 ? shiftWeeks(order.order_week, bumps) : order.order_week;
  }
  const delivery = itemDeliveryDate(order, item);
  return delivery ? weekOf(delivery) : order.order_week;
}

/**
 * Every week an item shows up in. A pushed week-unit item appears in TWO — its
 * original week and its current scheduled week; everything else appears in one.
 */
export function itemWeeks(order: Order, item: OrderItem): string[] {
  const current = itemOrderWeek(order, item);
  if (
    !isTerminal(item) &&
    isMoved(item) &&
    itemShiftUnit(order.route_number) === "week" &&
    current !== order.order_week
  ) {
    return [order.order_week, current];
  }
  return [current];
}

/**
 * How an item relates to a particular week's driver view:
 *  - normal:    on its scheduled date, delivering that week
 *  - day_move:  pushed on a no-cutoff route (4/6/14) — stays in its week, the
 *               delivery date is a later day
 *  - moved_out: a pushed week-unit item in its ORIGINAL week — it has moved on
 *               to a later week (shown with a slash)
 *  - moved_in:  the same item in its CURRENT scheduled week — arrived from an
 *               earlier week
 */
export type ItemWeekRole = "normal" | "day_move" | "moved_out" | "moved_in";

/** One of an order's items, with its role relative to a given week. `index`
 * is its position in the order's items array (for stable React keys). */
export type ItemInWeek = { item: OrderItem; index: number; role: ItemWeekRole };

/**
 * The items of an order that appear in a given week's driver view, each tagged
 * with its role.
 */
export function itemsInWeek(order: Order, week: string): ItemInWeek[] {
  const result: ItemInWeek[] = [];
  normalizeItems(order).forEach((item, index) => {
    // Terminal items (fulfilled/cancelled) are resolved — show them once, in
    // their settled week, with no move split.
    if (isTerminal(item)) {
      if (itemOrderWeek(order, item) === week) {
        result.push({ item, index, role: "normal" });
      }
      return;
    }
    const moved = isMoved(item);
    if (moved && itemShiftUnit(order.route_number) === "week") {
      const origin = order.order_week;
      const current = itemOrderWeek(order, item);
      if (week === origin) result.push({ item, index, role: "moved_out" });
      else if (week === current) result.push({ item, index, role: "moved_in" });
      return;
    }
    if (itemOrderWeek(order, item) !== week) return;
    result.push({ item, index, role: moved ? "day_move" : "normal" });
  });
  return result;
}

/**
 * Order-level rollup, used for the availability filter and the legacy status
 * column: any open item -> open; all one value -> that value; a mix of in/out
 * (no open) -> out_of_stock (not fully ready).
 */
export function rollupStatus(items: OrderItem[]): OrderStatus {
  if (items.length === 0) return "open";
  if (items.some((i) => i.status === "open")) return "open";
  if (items.every((i) => i.status === "in_stock")) return "in_stock";
  if (items.every((i) => i.status === "out_of_stock")) return "out_of_stock";
  return "out_of_stock";
}
