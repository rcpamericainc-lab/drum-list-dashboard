import type { OrderStatus } from "@/lib/database.types";

/**
 * Stock/availability state the office sets on each order:
 *  - open: default when an order comes in; awaiting an office decision
 *  - in_stock: proceeds on its original delivery date
 *  - out_of_stock: moved to the following week's delivery date
 * No-cutoff routes (4, 6, 14) are set to in_stock automatically at intake.
 */
export const ORDER_STATUSES: OrderStatus[] = [
  "open",
  "in_stock",
  "out_of_stock",
];

type StatusMeta = {
  label: string;
  /** Tailwind classes for a color-coded badge (bg + text + border). */
  badge: string;
  /** Tailwind classes for a small status dot. */
  dot: string;
};

export const STATUS_META: Record<OrderStatus, StatusMeta> = {
  open: {
    label: "Open",
    badge: "bg-[#F5F5F5] text-[#444444] border-[#888888]/40",
    dot: "bg-[#888888]",
  },
  in_stock: {
    label: "In-Stock",
    badge: "bg-[#009ACE] text-white border-[#009ACE]",
    dot: "bg-white",
  },
  out_of_stock: {
    label: "Out-of-Stock",
    badge: "bg-[#1A1A1A] text-white border-[#1A1A1A]",
    dot: "bg-[#009ACE]",
  },
};
