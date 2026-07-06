import type { OrderStatus } from "@/lib/database.types";

/** Canonical status order, used for filter chips and office status cycling. */
export const ORDER_STATUSES: OrderStatus[] = [
  "pending",
  "confirmed",
  "fulfilled",
  "cancelled",
];

type StatusMeta = {
  label: string;
  /** Tailwind classes for a color-coded badge (bg + text + border). */
  badge: string;
  /** Tailwind classes for a small status dot. */
  dot: string;
};

export const STATUS_META: Record<OrderStatus, StatusMeta> = {
  pending: {
    label: "Pending",
    badge: "bg-amber-100 text-amber-800 border-amber-200",
    dot: "bg-amber-500",
  },
  confirmed: {
    label: "Confirmed",
    badge: "bg-blue-100 text-blue-800 border-blue-200",
    dot: "bg-blue-500",
  },
  fulfilled: {
    label: "Fulfilled",
    badge: "bg-emerald-100 text-emerald-800 border-emerald-200",
    dot: "bg-emerald-500",
  },
  cancelled: {
    label: "Cancelled",
    badge: "bg-slate-200 text-slate-600 border-slate-300",
    dot: "bg-slate-400",
  },
};
