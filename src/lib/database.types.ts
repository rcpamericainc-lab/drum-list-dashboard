export type AppRole = "driver" | "office";

export type OrderStatus = "pending" | "confirmed" | "fulfilled" | "cancelled";

export type Database = {
  public: {
    Tables: {
      user_profiles: {
        Row: {
          id: string;
          auth_user_id: string;
          role: AppRole;
          created_at: string;
        };
        Insert: {
          id?: string;
          auth_user_id: string;
          role: AppRole;
          created_at?: string;
        };
        Update: {
          id?: string;
          auth_user_id?: string;
          role?: AppRole;
          created_at?: string;
        };
        Relationships: [];
      };
      drivers: {
        Row: {
          id: string;
          name: string;
          auth_user_id: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          name: string;
          auth_user_id: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          name?: string;
          auth_user_id?: string;
          created_at?: string;
        };
        Relationships: [];
      };
      driver_trucks: {
        Row: {
          id: string;
          driver_id: string;
          truck_number: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          driver_id: string;
          truck_number: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          driver_id?: string;
          truck_number?: string;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "driver_trucks_driver_id_fkey";
            columns: ["driver_id"];
            isOneToOne: false;
            referencedRelation: "drivers";
            referencedColumns: ["id"];
          },
        ];
      };
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
          truck_number: string;
          product_name: string;
          customer_name: string;
          date_needed: string;
          status: OrderStatus;
          driver_id: string;
          created_at: string;
          order_week: string;
        };
        Insert: {
          id?: string;
          truck_number: string;
          product_name: string;
          customer_name: string;
          date_needed: string;
          status?: OrderStatus;
          driver_id: string;
          created_at?: string;
          order_week: string;
        };
        Update: {
          id?: string;
          truck_number?: string;
          product_name?: string;
          customer_name?: string;
          date_needed?: string;
          status?: OrderStatus;
          driver_id?: string;
          created_at?: string;
          order_week?: string;
        };
        Relationships: [
          {
            foreignKeyName: "orders_driver_id_fkey";
            columns: ["driver_id"];
            isOneToOne: false;
            referencedRelation: "drivers";
            referencedColumns: ["id"];
          },
        ];
      };
    };
    Views: Record<string, never>;
    Functions: {
      current_app_role: {
        Args: Record<string, never>;
        Returns: AppRole;
      };
      current_driver_id: {
        Args: Record<string, never>;
        Returns: string;
      };
    };
    Enums: {
      app_role: AppRole;
      order_status: OrderStatus;
    };
    CompositeTypes: Record<string, never>;
  };
};
