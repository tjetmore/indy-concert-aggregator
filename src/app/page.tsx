import EventList from "@/components/EventList";
import {
  fetchEventsForVenue,
  sortEventsAscending,
  VENUE_LABELS,
  VENUE_IDS,
  type EventItem
} from "@/lib/ticketmaster";
import { fetchHiFiEvents } from "@/lib/hifi";
import { fetchRockTheRuinsEvents } from "@/lib/rocktheruins";
import { fetchVogueEvents } from "@/lib/vogue";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

export const revalidate = 900;

const DEV_DELAY_MS = 250;
const SNAPSHOT_PATH = join(process.cwd(), ".next", "cache", "events-snapshot.json");
const SNAPSHOT_MAX_AGE_DAYS = 120;

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function loadSnapshot() {
  try {
    const raw = await readFile(SNAPSHOT_PATH, "utf-8");
    return JSON.parse(raw) as Record<string, string>;
  } catch {
    return {};
  }
}

async function saveSnapshot(snapshot: Record<string, string>) {
  await mkdir(join(process.cwd(), ".next", "cache"), { recursive: true });
  await writeFile(SNAPSHOT_PATH, JSON.stringify(snapshot), "utf-8");
}

function pruneSnapshot(snapshot: Record<string, string>, now: Date) {
  const cutoff = now.getTime() - SNAPSHOT_MAX_AGE_DAYS * 24 * 60 * 60 * 1000;
  const pruned: Record<string, string> = {};
  Object.entries(snapshot).forEach(([id, iso]) => {
    const time = Date.parse(iso);
    if (!Number.isNaN(time) && time >= cutoff) {
      pruned[id] = iso;
    }
  });
  return pruned;
}

async function annotateFirstSeen(events: EventItem[]) {
  const now = new Date();
  const snapshot = pruneSnapshot(await loadSnapshot(), now);
  const updatedSnapshot = { ...snapshot };

  const annotated = events.map((event) => {
    const firstSeenAt = updatedSnapshot[event.id] ?? now.toISOString();
    updatedSnapshot[event.id] = firstSeenAt;
    return { ...event, firstSeenAt };
  });

  await saveSnapshot(updatedSnapshot);
  return annotated;
}

function filterUpcomingEvents(events: EventItem[]): EventItem[] {
  const now = new Date();

  return events
    .filter((event) => {
      const time = event.localTime ?? "23:59:59";
      const eventDate = new Date(`${event.localDate}T${time}`);
      return eventDate >= now;
    });
}

function normalizeForDedupe(text: string) {
  return text
    .toLowerCase()
    .replace(/\([^)]*(?:21|over)[^)]*\)/g, "")
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function dedupeEvents(events: EventItem[]) {
  const seen = new Set<string>();
  const deduped: EventItem[] = [];

  events.forEach((event) => {
    const key = [
      event.venueKey,
      event.localDate,
      normalizeForDedupe(event.name)
    ].join("|");
    if (seen.has(key)) return;
    seen.add(key);
    deduped.push(event);
  });

  return deduped;
}

export default async function HomePage() {
  const venueEntries = Object.entries(VENUE_IDS);
  const ticketmasterVenueEntries = venueEntries.filter(
    ([venueKey]) => !["vogue", "rocktheruins"].includes(venueKey)
  );
  const hasMissingVenueId = venueEntries.some(([, venueId]) => !venueId);

  if (hasMissingVenueId) {
    return (
      <main className="min-h-screen bg-zinc-950 px-6 py-16">
        <div className="mx-auto max-w-3xl space-y-4 rounded-3xl border border-slate-200 bg-white p-8 shadow-sm">
          <h1 className="text-2xl font-semibold text-slate-900">
            Venue IDs Needed
          </h1>
          <p className="text-sm text-slate-600">
            Run the venue lookup script with your Ticketmaster API key, then
            update the constants in
            <span className="font-medium text-slate-900"> src/lib/ticketmaster.ts</span>.
          </p>
          <div className="rounded-2xl bg-slate-50 p-4 text-xs text-slate-600">
            <code>npm run find:venues</code>
          </div>
        </div>
      </main>
    );
  }

  const eventsByVenue: Awaited<ReturnType<typeof fetchEventsForVenue>>[] = [];
  for (const [venueKey, venueId] of ticketmasterVenueEntries) {
    const events = await fetchEventsForVenue(venueKey, venueId);
    eventsByVenue.push(events);
    if (process.env.NODE_ENV === "development") {
      await wait(DEV_DELAY_MS);
    }
  }

  const hifiEvents = await fetchHiFiEvents();
  const vogueEvents = await fetchVogueEvents();
  const rockTheRuinsEvents = await fetchRockTheRuinsEvents();
  const rawEvents = [
    ...hifiEvents,
    ...vogueEvents,
    ...rockTheRuinsEvents,
    ...eventsByVenue.flat()
  ].filter(
    (event): event is EventItem => Boolean(event)
  );
  const mergedEvents = dedupeEvents(rawEvents);
  const eventsWithFirstSeen = await annotateFirstSeen(mergedEvents);
  const events = sortEventsAscending(filterUpcomingEvents(eventsWithFirstSeen));
  const venues = venueEntries.map(([venueKey]) => ({
    key: venueKey,
    label: VENUE_LABELS[venueKey as keyof typeof VENUE_LABELS] ?? venueKey
  }));
  const sourceCount = venues.length + 3;

  return (
    <main className="min-h-screen px-4 py-6 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-6xl space-y-6">
        <header className="border-b border-slate-800/90 pb-6">
          <div className="flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
            <div className="max-w-3xl">
              <p className="text-xs font-bold uppercase tracking-[0.24em] text-cyan-200/80">
                Indiana Live Calendar
              </p>
              <h1 className="mt-3 text-3xl font-semibold tracking-normal text-slate-50 md:text-5xl">
                Upcoming Indianapolis concerts in one list
              </h1>
              <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-300 md:text-base">
                Browse upcoming shows from local venue calendars, filter by
                place, and quickly find the next night worth going out.
              </p>
            </div>
            <div className="grid grid-cols-2 gap-3 text-right sm:flex">
              <div className="rounded-lg border border-slate-800 bg-slate-950/55 px-4 py-3">
                <p className="text-2xl font-semibold text-slate-50">{events.length}</p>
                <p className="text-xs font-medium uppercase tracking-[0.12em] text-slate-400">
                  Upcoming
                </p>
              </div>
              <div className="rounded-lg border border-slate-800 bg-slate-950/55 px-4 py-3">
                <p className="text-2xl font-semibold text-slate-50">{sourceCount}</p>
                <p className="text-xs font-medium uppercase tracking-[0.12em] text-slate-400">
                  Sources
                </p>
              </div>
            </div>
          </div>
        </header>

        <EventList events={events} venues={venues} />
        <p className="border-t border-slate-800/90 pt-5 text-xs text-slate-500">
          HI-FI events sourced from hifiindy.com. Vogue events sourced from
          thevogue.com. Rock the Ruins events sourced from rocktheruins.com.
          Ticket links may go to each venue's ticketing partner.
        </p>
      </div>
    </main>
  );
}
