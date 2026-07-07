export type OrderStatus = "pending" | "confirmed" | "fulfilled" | "cancelled";

export type Database = {
  public: {
    Tables: {
      cutoff_rules: {
        Row: {
          id: string;
          name: string;
          cutoff_day: number;
          cutoff_time: string;
          timezone: string;
          active: boolean;
          created_at: string;
        };
        Insert: {
          id?: string;
          name?: string;
          cutoff_day: number;
          cutoff_time: string;
          timezone?: string;
          active?: boolean;
          created_at?: string;
        };
        Update: {
          id?: string;
          name?: string;
          cutoff_day?: number;
          cutoff_time?: string;
          timezone?: string;
          active?: boolean;
          created_at?: string;
        };
        Relationships: [];
      };
      orders: {
        Row: {
          id: string;
          route_number: string;
          driver_name: string | null;
          product_name: string;
          customer_name: string;
          date_needed: string;
          status: OrderStatus;
          order_week: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          route_number: string;
          driver_name?: string | null;
          product_name: string;
          customer_name: string;
          date_needed: string;
          status?: OrderStatus;
          order_week: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          route_number?: string;
          driver_name?: string | null;
          product_name?: string;
          customer_name?: string;
          date_needed?: string;
          status?: OrderStatus;
          order_week?: string;
          created_at?: string;
        };
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: {
      order_status: OrderStatus;
    };
    CompositeTypes: Record<string, never>;
  };
};
