export type OrderStatus = "open" | "in_stock" | "out_of_stock";

/** A single product line within an order, with its own stock status. */
export type OrderItem = {
  product_name: string;
  quantity: number;
  status: OrderStatus;
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
