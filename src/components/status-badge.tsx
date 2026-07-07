import type { OrderStatus } from "@/lib/database.types";
import { STATUS_META } from "@/lib/order-status";

const FALLBACK_META = {
  label: "—",
  badge: "bg-[#F5F5F5] text-[#444444] border-[#888888]/40",
  dot: "bg-[#888888]",
};

export function StatusBadge({ status }: { status: OrderStatus }) {
  const meta = STATUS_META[status] ?? FALLBACK_META;
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold ${meta.badge}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${meta.dot}`} />
      {meta.label}
    </span>
  );
}
