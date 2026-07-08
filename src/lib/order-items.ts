import type { OrderItem } from "@/lib/database.types";

/** e.g. "2× Tire Shine" */
export function formatItem(item: OrderItem): string {
  return `${item.quantity}× ${item.product_name}`;
}

/** Join an order's items into one string, e.g. "2× Tire Shine, 1× Wax". */
export function summarizeItems(
  items: OrderItem[] | null | undefined,
  separator = ", ",
): string {
  return (items ?? []).map(formatItem).join(separator);
}
