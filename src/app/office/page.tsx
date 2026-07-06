import { redirect } from "next/navigation";

import { signOut } from "@/app/login/actions";
import { createClient } from "@/lib/supabase/server";

export default async function OfficePage() {
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

  if (profile?.role !== "office") {
    redirect("/driver");
  }

  return (
    <main className="min-h-screen bg-slate-100 px-6 py-8">
      <div className="mx-auto flex w-full max-w-6xl items-center justify-between">
        <div>
          <p className="text-sm font-medium uppercase tracking-wide text-emerald-700">
            Office
          </p>
          <h1 className="text-3xl font-semibold text-slate-950">Dashboard</h1>
        </div>
        <form action={signOut}>
          <button className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700">
            Sign out
          </button>
        </form>
      </div>
      <section className="mx-auto mt-6 w-full max-w-6xl rounded-lg bg-white p-5 shadow-sm">
        <p className="text-slate-700">
          Office order management will be built in step 3.
        </p>
      </section>
    </main>
  );
}
