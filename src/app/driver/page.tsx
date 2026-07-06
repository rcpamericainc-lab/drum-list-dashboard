import { redirect } from "next/navigation";

import { signOut } from "@/app/login/actions";
import { createClient } from "@/lib/supabase/server";

import { DriverDashboard } from "./driver-dashboard";

export default async function DriverPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data: profile } = await supabase
    .from("user_profiles")
    .select("role")
    .eq("auth_user_id", user.id)
    .single();

  if (profile?.role === "office") {
    redirect("/office");
  }

  const { data: driver } = await supabase
    .from("drivers")
    .select("id, name")
    .eq("auth_user_id", user.id)
    .single();

  return (
    <main className="min-h-screen bg-slate-100 px-4 py-5">
      <div className="mx-auto flex w-full max-w-2xl items-center justify-between">
        <div>
          <p className="text-sm font-medium uppercase tracking-wide text-emerald-700">
            Driver
          </p>
          <h1 className="text-2xl font-semibold text-slate-950">
            {driver?.name ?? "Dashboard"}
          </h1>
        </div>
        <form action={signOut}>
          <button className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700">
            Sign out
          </button>
        </form>
      </div>

      {!driver ? (
        <section className="mx-auto mt-6 w-full max-w-2xl rounded-lg bg-white p-5 shadow-sm">
          <p className="text-slate-700">
            Your account isn&apos;t linked to a driver profile yet. Please ask
            the office to finish setting up your account (name + assigned
            trucks) before placing orders.
          </p>
        </section>
      ) : (
        <DriverContent driverId={driver.id} />
      )}
    </main>
  );
}

async function DriverContent({ driverId }: { driverId: string }) {
  const supabase = await createClient();

  const [{ data: trucks }, { data: orders }] = await Promise.all([
    supabase
      .from("driver_trucks")
      .select("truck_number")
      .eq("driver_id", driverId)
      .order("truck_number"),
    supabase
      .from("orders")
      .select("*")
      .eq("driver_id", driverId)
      .order("date_needed", { ascending: true }),
  ]);

  return (
    <DriverDashboard
      driverId={driverId}
      trucks={(trucks ?? []).map((t) => t.truck_number)}
      initialOrders={orders ?? []}
    />
  );
}
