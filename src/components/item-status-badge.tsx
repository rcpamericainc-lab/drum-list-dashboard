import type { OrderItem } from "@/lib/database.types";
import { FULFILLMENT_META, STATUS_META } from "@/lib/order-status";

const FALLBACK_META = {
  label: "—",
  badge: "bg-[#F5F5F5] text-[#444444] border-[#888888]/40",
  dot: "bg-[#888888]",
};

/**
 * The combined lifecycle badge for an item. Fulfillment wins over stock:
 * Cancelled › Fulfilled › the stock state (Open / In-Stock / Out-of-Stock).
 * Returning/partial counts are shown separately, not in the pill.
 */
export function ItemStatusBadge({ item }: { item: OrderItem }) {
  const meta =
    item.fulfillment != null
      ? (FULFILLMENT_META[item.fulfillment] ?? FALLBACK_META)
      : (STATUS_META[item.status] ?? FALLBACK_META);
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold ${meta.badge}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${meta.dot}`} />
      {meta.label}
    </span>
  );
}
