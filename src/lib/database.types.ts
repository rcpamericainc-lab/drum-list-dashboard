export type OrderStatus = "open" | "in_stock" | "out_of_stock";

export type Database = {
  public: {
    Tables: {
      orders: {
        Row: {
          id: string;
          client_id: string;
          route_number: string;
          driver_name: string | null;
          product_name: string;
          customer_name: string;
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
          product_name: string;
          customer_name: string;
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
          product_name?: string;
          customer_name?: string;
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
