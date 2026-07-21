/**
 * Per-route order-timing logic.
 *
 * Given a submission moment and a route's cutoff rule, computes:
 *  - deliveryDate: the delivery date the order will make ('YYYY-MM-DD', or null
 *    for no-cutoff routes / routes with no scheduled delivery)
 *  - orderWeek: the Monday of the assigned week ('YYYY-MM-DD'), used for
 *    week-grouping, filtering, and CSV export
 *  - rolledOver: true if the submission missed this delivery's cutoff and was
 *    pushed to the next one
 *
 * All comparisons happen in Eastern civil time, so a device in another timezone
 * cannot misclassify an order near a noon cutoff. DST transitions can shift a
 * cutoff by an hour in the transition week only; irrelevant for noon cutoffs.
 */

import type { RouteConfig } from "@/lib/routes";

const TZ = "America/New_York";
const DAY_MS = 86_400_000;

export type OrderTiming = {
  orderWeek: string;
  deliveryDate: string | null;
  rolledOver: boolean;
  hasCutoff: boolean;
};

type CivilParts = {
  year: number;
  month: number; // 1-12
  day: number;
  hour: number;
  minute: number;
  weekday: number; // 0=Sun..6=Sat
};

const WEEKDAY_INDEX: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

/** Wall-clock components of `date` in Eastern time. */
function easternParts(date: Date): CivilParts {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: TZ,
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    hour12: false,
    weekday: "short",
  }).formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  let hour = Number(get("hour"));
  if (hour === 24) hour = 0; // some engines emit "24" at midnight with hour12:false
  return {
    year: Number(get("year")),
    month: Number(get("month")),
    day: Number(get("day")),
    hour,
    minute: Number(get("minute")),
    weekday: WEEKDAY_INDEX[get("weekday")] ?? 0,
  };
}

/**
 * A stable comparison frame: we treat Eastern wall-clock components as if they
 * were UTC. Both "now" and the cutoff go through the same frame, so ordering is
 * correct regardless of the real UTC offset.
 */
function civilMs(
  year: number,
  month: number,
  day: number,
  hour = 0,
  minute = 0,
): number {
  return Date.UTC(year, month - 1, day, hour, minute);
}

function dateKeyFromMs(ms: number): string {
  const d = new Date(ms);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Monday (as 'YYYY-MM-DD') of the week containing the given civil-ms date. */
function mondayKeyFromMs(ms: number): string {
  const weekday = new Date(ms).getUTCDay(); // 0=Sun..6=Sat
  const shift = weekday === 0 ? -6 : 1 - weekday;
  return dateKeyFromMs(ms + shift * DAY_MS);
}

/**
 * Compute the delivery date + order week for a submission on a given route.
 */
export function computeOrderTiming(now: Date, route: RouteConfig): OrderTiming {
  const e = easternParts(now);

  // No cutoff (or no scheduled delivery): current week, never rolls forward.
  if (!route.cutoff || route.delivery === undefined) {
    const todayMs = civilMs(e.year, e.month, e.day);
    return {
      orderWeek: mondayKeyFromMs(todayMs),
      deliveryDate: null,
      rolledOver: false,
      hasCutoff: false,
    };
  }

  const todayMs = civilMs(e.year, e.month, e.day);
  const nowMs = civilMs(e.year, e.month, e.day, e.hour, e.minute);

  // Next delivery weekday on or after today.
  const daysUntilDelivery = (route.delivery - e.weekday + 7) % 7;
  let deliveryMs = todayMs + daysUntilDelivery * DAY_MS;

  // Cutoff for a given delivery: the cutoff weekday in the days just before it.
  const cutoffMsFor = (delMs: number): number => {
    const delWeekday = new Date(delMs).getUTCDay();
    let back = (delWeekday - route.cutoff!.weekday + 7) % 7;
    if (back === 0) back = 7; // cutoff is strictly before delivery day
    const c = new Date(delMs - back * DAY_MS);
    return civilMs(
      c.getUTCFullYear(),
      c.getUTCMonth() + 1,
      c.getUTCDate(),
      route.cutoff!.hour,
      route.cutoff!.minute,
    );
  };

  let rolledOver = false;
  if (nowMs > cutoffMsFor(deliveryMs)) {
    deliveryMs += 7 * DAY_MS;
    rolledOver = true;
  }

  return {
    orderWeek: mondayKeyFromMs(deliveryMs),
    deliveryDate: dateKeyFromMs(deliveryMs),
    rolledOver,
    hasCutoff: true,
  };
}

/** Monday (as 'YYYY-MM-DD') of the current Eastern week. */
export function currentOrderWeek(now: Date = new Date()): string {
  const e = easternParts(now);
  return mondayKeyFromMs(civilMs(e.year, e.month, e.day));
}

/** Parse a 'YYYY-MM-DD' key into a local Date (avoids the UTC-parsing pitfall). */
export function parseDateKey(key: string): Date {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, m - 1, d);
}

/** Format a Date as a 'YYYY-MM-DD' key in local time. */
export function toDateKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** Shift a 'YYYY-MM-DD' key by a whole number of weeks. */
export function shiftWeeks(key: string, weeks: number): string {
  const d = parseDateKey(key);
  d.setDate(d.getDate() + weeks * 7);
  return toDateKey(d);
}

/** Shift a 'YYYY-MM-DD' key by a whole number of days. */
export function shiftDays(key: string, days: number): string {
  const d = parseDateKey(key);
  d.setDate(d.getDate() + days);
  return toDateKey(d);
}

/** Monday (as 'YYYY-MM-DD') of the week containing the given date key. */
export function weekOf(key: string): string {
  const d = parseDateKey(key);
  const day = d.getDay(); // 0=Sun..6=Sat
  const shift = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + shift);
  return toDateKey(d);
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

/** Human label for a plain date key, e.g. "Thu, Jul 9, 2026". */
export function formatDate(dateKey: string): string {
  return parseDateKey(dateKey).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}
