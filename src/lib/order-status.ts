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
    badge: "bg-[#009ACE]/10 text-[#006F96] border-[#009ACE]/25",
    dot: "bg-[#009ACE]",
  },
  confirmed: {
    label: "Confirmed",
    badge: "bg-[#009ACE] text-white border-[#009ACE]",
    dot: "bg-white",
  },
  fulfilled: {
    label: "Fulfilled",
    badge: "bg-[#1A1A1A] text-white border-[#1A1A1A]",
    dot: "bg-[#009ACE]",
  },
  cancelled: {
    label: "Cancelled",
    badge: "bg-[#F5F5F5] text-[#444444] border-[#888888]/40",
    dot: "bg-[#888888]",
  },
};
