export type OrderStatus = "open" | "in_stock" | "out_of_stock";

/**
 * Fulfillment outcome for an item, on a separate axis from stock `status`.
 * Absent/null means "pending" (not yet delivered). `fulfilled` is set by the
 * driver when the item reaches the customer; `cancelled` is set by the office
 * (a soft retire — there is no hard delete).
 */
export type FulfillmentStatus = "fulfilled" | "cancelled";

/**
 * A single product line within an order.
 *  - status: stock availability (office-owned) — drives the delivery shift.
 *  - fulfillment/quantity_fulfilled/note: fulfillment axis. quantity_fulfilled
 *    is how many actually went to the customer once fulfilled (the rest are
 *    returning to the warehouse); note is optional driver context.
 */
export type OrderItem = {
  product_name: string;
  quantity: number;
  status: OrderStatus;
  fulfillment?: FulfillmentStatus | null;
  quantity_fulfilled?: number | null;
  note?: string | null;
};

export type Database = {
  public: {
    Tables: {
      orders: {
        Row: {
          id: string;
          client_id: string;
          route_number: string;
          driver_name: string | null;
          items: OrderItem[];
          customer_name: string;
          customer_address: string | null;
          date_needed: string;
          status: OrderStatus;
          order_week: string;
          delivery_date: string | null;
          invoice_number: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          client_id?: string;
          route_number: string;
          driver_name?: string | null;
          items: OrderItem[];
          customer_name: string;
          customer_address?: string | null;
          date_needed: string;
          status?: OrderStatus;
          order_week: string;
          delivery_date?: string | null;
          invoice_number?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          client_id?: string;
          route_number?: string;
          driver_name?: string | null;
          items?: OrderItem[];
          customer_name?: string;
          customer_address?: string | null;
          date_needed?: string;
          status?: OrderStatus;
          order_week?: string;
          delivery_date?: string | null;
          invoice_number?: string | null;
          created_at?: string;
        };
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: {
      order_stock_status: OrderStatus;
    };
    CompositeTypes: Record<string, never>;
  };
};
