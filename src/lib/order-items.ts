import type { Database, OrderItem, OrderStatus } from "@/lib/database.types";
import { shiftDays, shiftWeeks } from "@/lib/order-week";
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
 * Ensure every item has a status. Pre-migration rows carry status only at the
 * order level, so missing item statuses fall back to the order's status.
 */
export function normalizeItems(order: Order): OrderItem[] {
  return (order.items ?? []).map((it) => ({
    ...it,
    status: it.status ?? order.status,
  }));
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

/** Effective delivery date for one item — out-of-stock shifts by the route's
 * unit (a week for cutoff routes, a day for no-cutoff routes). */
export function itemDeliveryDate(order: Order, item: OrderItem): string | null {
  const base = getBaseDelivery(order);
  if (base === null) return null;
  if (item.status !== "out_of_stock") return base;
  return itemShiftUnit(order.route_number) === "day"
    ? shiftDays(base, 1)
    : shiftWeeks(base, 1);
}

/**
 * Effective order-week (Monday) for one item. Only week-shift (cutoff) routes
 * move to the following week when out of stock; day-shift routes (4, 6, 14)
 * stay in their original week — the move is a single day, tracked on the
 * delivery date, not a jump to the next week's view.
 */
export function itemOrderWeek(order: Order, item: OrderItem): string {
  if (
    item.status === "out_of_stock" &&
    itemShiftUnit(order.route_number) === "week"
  ) {
    return shiftWeeks(order.order_week, 1);
  }
  return order.order_week;
}

/**
 * Short label for an out-of-stock item's move, e.g. "next day" / "next week",
 * or null when the item hasn't moved. Used for the "moved" indicator on both
 * the driver and office views.
 */
export function itemMoveLabel(order: Order, item: OrderItem): string | null {
  if (item.status !== "out_of_stock" || getBaseDelivery(order) === null) {
    return null;
  }
  return itemShiftUnit(order.route_number) === "day" ? "next day" : "next week";
}

/**
 * How an item relates to a particular week's driver view:
 *  - normal:    in-stock/open item delivering that week
 *  - day_move:  out-of-stock on a no-cutoff route (4/6/14) — stays in its week,
 *               delivery pushed one day
 *  - moved_out: out-of-stock week-shift item in its ORIGINAL week — leaving for
 *               the next week (shown with a slash)
 *  - moved_in:  the same item in the FOLLOWING week — arrived from last week
 */
export type ItemWeekRole = "normal" | "day_move" | "moved_out" | "moved_in";

/** One of an order's items, with its role relative to a given week. `index`
 * is its position in the order's items array (for stable React keys). */
export type ItemInWeek = { item: OrderItem; index: number; role: ItemWeekRole };

/**
 * The items of an order that appear in a given week's driver view, each tagged
 * with its role. A week-shift out-of-stock item appears in TWO weeks — its
 * origin week (moved_out) and the following week (moved_in); everything else
 * appears only in its own week.
 */
export function itemsInWeek(order: Order, week: string): ItemInWeek[] {
  const result: ItemInWeek[] = [];
  normalizeItems(order).forEach((item, index) => {
    // Terminal items (fulfilled/cancelled) are resolved — show them once, in
    // their settled week, with no "moving" split.
    if (isTerminal(item)) {
      if (itemOrderWeek(order, item) === week) {
        result.push({ item, index, role: "normal" });
      }
      return;
    }
    const outOfStock = item.status === "out_of_stock";
    if (outOfStock && itemShiftUnit(order.route_number) === "week") {
      const origin = order.order_week;
      const dest = shiftWeeks(order.order_week, 1);
      if (week === origin) result.push({ item, index, role: "moved_out" });
      else if (week === dest) result.push({ item, index, role: "moved_in" });
      return;
    }
    if (itemOrderWeek(order, item) !== week) return;
    result.push({ item, index, role: outOfStock ? "day_move" : "normal" });
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
