import type { Database } from "@/lib/database.types";
import { STATUS_META } from "@/lib/order-status";

type Order = Database["public"]["Tables"]["orders"]["Row"];

const HEADERS = [
  "Route",
  "Placed by",
  "Product",
  "Customer",
  "Date needed",
  "Delivery date",
  "Order week",
  "Invoice number",
  "Availability",
  "Created at",
];

/** Quote a field if it contains a comma, quote, or newline; double internal quotes. */
function escapeField(value: string): string {
  return /[",\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/**
 * Serialize orders to a CSV string. Uses raw ISO dates for spreadsheet-friendly
 * parsing, CRLF line endings (CSV convention), and a UTF-8 BOM (﻿) so Excel
 * opens accented characters correctly.
 */
export function ordersToCsv(orders: Order[]): string {
  const rows = orders.map((o) => [
    o.route_number,
    o.driver_name ?? "",
    o.product_name,
    o.customer_name,
    o.date_needed,
    o.delivery_date ?? "",
    o.order_week,
    o.invoice_number ?? "",
    STATUS_META[o.status].label,
    o.created_at,
  ]);
  const lines = [HEADERS, ...rows].map((row) => row.map(escapeField).join(","));
  return "﻿" + lines.join("\r\n");
}
