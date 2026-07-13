import type { Database } from "@/lib/database.types";
import { itemDeliveryDate, itemOrderWeek, normalizeItems } from "@/lib/order-items";
import { STATUS_META } from "@/lib/order-status";

type Order = Database["public"]["Tables"]["orders"]["Row"];

const HEADERS = [
  "Route",
  "Placed by",
  "Product",
  "Quantity",
  "Availability",
  "Delivery date",
  "Order week",
  "Customer",
  "Customer address",
  "Date needed",
  "Invoice number",
  "Created at",
];

/** Quote a field if it contains a comma, quote, or newline; double internal quotes. */
function escapeField(value: string): string {
  return /[",\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/**
 * Serialize orders to CSV — one row per item, since stock status and delivery
 * are per item. An order's shared fields (customer, invoice, etc.) repeat on
 * each of its item rows. Raw ISO dates, CRLF line endings, and a UTF-8 BOM (﻿)
 * so Excel opens accented characters correctly.
 */
export function ordersToCsv(orders: Order[]): string {
  const rows: string[][] = [];
  for (const o of orders) {
    for (const it of normalizeItems(o)) {
      rows.push([
        o.route_number,
        o.driver_name ?? "",
        it.product_name,
        String(it.quantity),
        STATUS_META[it.status].label,
        itemDeliveryDate(o, it) ?? "",
        itemOrderWeek(o, it),
        o.customer_name,
        o.customer_address ?? "",
        o.date_needed,
        o.invoice_number ?? "",
        o.created_at,
      ]);
    }
  }
  const lines = [HEADERS, ...rows].map((row) => row.map(escapeField).join(","));
  return "﻿" + lines.join("\r\n");
}
