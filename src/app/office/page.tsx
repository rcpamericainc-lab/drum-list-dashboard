import Link from "next/link";

import { createClient } from "@/lib/supabase/server";

import { OfficeDashboard, type OfficeOrder } from "./office-dashboard";

export default async function OfficePage() {
  const supabase = await createClient();

  const { data: orders } = await supabase
    .from("orders")
    .select("*")
    .order("order_week", { ascending: false })
    .order("date_needed", { ascending: true })
    .returns<OfficeOrder[]>();

  return (
    <main className="min-h-screen bg-slate-100 px-6 py-8">
      <div className="mx-auto flex w-full max-w-7xl items-center justify-between">
        <div>
          <p className="text-sm font-medium uppercase tracking-wide text-emerald-700">
            Office
          </p>
          <h1 className="text-3xl font-semibold text-slate-950">
            Order management
          </h1>
        </div>
        <Link
          href="/"
          className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700"
        >
          ← Order form
        </Link>
      </div>

      <div className="mx-auto mt-6 w-full max-w-7xl">
        <OfficeDashboard initialOrders={orders ?? []} />
      </div>
    </main>
  );
}
