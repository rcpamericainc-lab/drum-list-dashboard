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
