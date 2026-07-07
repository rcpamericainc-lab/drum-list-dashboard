/**
 * Routes and their per-route cutoff rules.
 *
 * Weekdays are 0=Sunday .. 6=Saturday. Cutoff times are in Eastern time.
 * A route with no `cutoff`/`delivery` has no cutoff: orders always land in the
 * current week and never roll forward.
 *
 * This is the single place to edit routes and their schedules.
 */

export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6;

export type RouteConfig = {
  number: string;
  /** Delivery weekday (0=Sun..6=Sat). Omit for no scheduled delivery. */
  delivery?: Weekday;
  /** Cutoff weekday + time (Eastern). Omit for no cutoff. */
  cutoff?: { weekday: Weekday; hour: number; minute: number };
};

export const ROUTES: RouteConfig[] = [
  { number: "4" }, // no cutoff
  { number: "6" }, // no cutoff
  { number: "14" }, // no cutoff
  { number: "15", delivery: 4, cutoff: { weekday: 3, hour: 12, minute: 0 } }, // Thu delivery, Wed 12pm
  { number: "16", delivery: 3, cutoff: { weekday: 2, hour: 12, minute: 0 } }, // Wed delivery, Tue 12pm
  { number: "20", delivery: 1, cutoff: { weekday: 5, hour: 12, minute: 0 } }, // Mon delivery, Fri 12pm
  { number: "22", delivery: 1, cutoff: { weekday: 5, hour: 12, minute: 0 } }, // Mon delivery, Fri 12pm
  { number: "23", delivery: 2, cutoff: { weekday: 1, hour: 12, minute: 0 } }, // Tue delivery, Mon 12pm
];

export const ROUTE_NUMBERS = ROUTES.map((r) => r.number);

export function getRoute(number: string): RouteConfig | undefined {
  return ROUTES.find((r) => r.number === number);
}

const WEEKDAY_NAMES = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

function formatClock(hour: number, minute: number): string {
  const ampm = hour < 12 ? "AM" : "PM";
  const h12 = hour % 12 === 0 ? 12 : hour % 12;
  return `${h12}:${String(minute).padStart(2, "0")} ${ampm}`;
}

/** Human summary of a route's schedule, e.g. "Delivers Thursday · cutoff Wednesday 12:00 PM". */
export function describeRoute(route: RouteConfig): string {
  if (!route.cutoff || route.delivery === undefined) {
    return "No cutoff — orders go to the current week";
  }
  const delivery = WEEKDAY_NAMES[route.delivery];
  const cutoffDay = WEEKDAY_NAMES[route.cutoff.weekday];
  const cutoffTime = formatClock(route.cutoff.hour, route.cutoff.minute);
  return `Delivers ${delivery} · cutoff ${cutoffDay} ${cutoffTime}`;
}
