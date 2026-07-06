/**
 * Order-week helpers.
 *
 * An "order week" is keyed by the Monday of that week, as a 'YYYY-MM-DD' string,
 * which is exactly what the `orders.order_week` (date) column stores.
 *
 * NOTE (build order): the cutoff-aware computation lives in step 4. For now,
 * `computeOrderWeek` is a PLACEHOLDER that always returns the current week's
 * Monday and ignores the cutoff rule. Step 4 will replace the placeholder with
 * a pure function of (submittedAt, cutoffRule) anchored to the business timezone.
 */

/** Monday (at local 00:00) of the week containing `date`. Week starts Monday. */
export function mondayOf(date: Date): Date {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const day = d.getDay(); // 0=Sun .. 6=Sat
  const shiftToMonday = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + shiftToMonday);
  return d;
}

/** Format a Date as a 'YYYY-MM-DD' key in local time (no UTC shift). */
export function toDateKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** Parse a 'YYYY-MM-DD' key into a local Date (avoids the UTC-parsing pitfall). */
export function parseDateKey(key: string): Date {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, m - 1, d);
}

/**
 * PLACEHOLDER — step 4 replaces this with cutoff-aware logic.
 * Returns the current week's Monday as a 'YYYY-MM-DD' key.
 */
export function computeOrderWeek(submittedAt: Date = new Date()): string {
  return toDateKey(mondayOf(submittedAt));
}

/** Human label for an order-week key, e.g. "Week of Mon, Jul 6, 2026". */
export function formatWeekLabel(weekKey: string): string {
  const label = parseDateKey(weekKey).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
  return `Week of ${label}`;
}

/** Human label for a plain date key, e.g. "Tue, Jul 7, 2026". */
export function formatDate(dateKey: string): string {
  return parseDateKey(dateKey).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}
