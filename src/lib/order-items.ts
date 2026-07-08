import type { OrderItem } from "@/lib/database.types";

/** Join an order's product names, e.g. "Tire Shine, Wax". */
export function summarizeItems(
  items: OrderItem[] | null | undefined,
  separator = ", ",
): string {
  return (items ?? []).map((it) => it.product_name).join(separator);
}
