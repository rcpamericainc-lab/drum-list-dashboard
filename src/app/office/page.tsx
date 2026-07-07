import Link from "next/link";
import Image from "next/image";

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
    <main className="min-h-screen bg-[#F5F5F5] px-6 py-8 text-[#1A1A1A]">
      <div className="mx-auto flex w-full max-w-7xl items-center justify-between gap-4">
        <div className="min-w-0">
          <Image
            src="/rcp-america-wordmark.png"
            alt="RCP America"
            width={1831}
            height={555}
            className="h-auto w-48"
            preload
          />
          <p className="mt-3 text-xs font-semibold uppercase text-[#009ACE]">
            Office
          </p>
          <h1 className="mt-1 text-5xl leading-none text-[#1A1A1A]">
            Order Management
          </h1>
        </div>
        <Link
          href="/"
          className="shrink-0 border border-[#009ACE] bg-white px-3 py-2 text-sm font-semibold uppercase text-[#1A1A1A] transition hover:bg-[#009ACE] hover:text-white"
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
