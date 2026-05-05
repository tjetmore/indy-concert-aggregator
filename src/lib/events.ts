import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fetchHiFiEvents } from "@/lib/hifi";
import { fetchRockTheRuinsEvents } from "@/lib/rocktheruins";
import {
  fetchEventsForVenue,
  sortEventsAscending,
  VENUE_IDS,
  type EventItem
} from "@/lib/ticketmaster";
import { fetchVogueEvents } from "@/lib/vogue";

const DEV_DELAY_MS = 250;
const SNAPSHOT_PATH = join(process.cwd(), ".next", "cache", "events-snapshot.json");
const SNAPSHOT_MAX_AGE_DAYS = 120;
const EXTERNAL_VENUE_KEYS = new Set(["vogue", "rocktheruins"]);

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

  return events.filter((event) => {
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

export function getVenueEntries() {
  return Object.entries(VENUE_IDS);
}

export function getHasMissingVenueId() {
  return getVenueEntries().some(([, venueId]) => !venueId);
}

export async function getConcertEvents() {
  const ticketmasterVenueEntries = getVenueEntries().filter(
    ([venueKey]) => !EXTERNAL_VENUE_KEYS.has(venueKey)
  );

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
  ].filter((event): event is EventItem => Boolean(event));

  const mergedEvents = dedupeEvents(rawEvents);
  const eventsWithFirstSeen = await annotateFirstSeen(mergedEvents);
  return sortEventsAscending(filterUpcomingEvents(eventsWithFirstSeen));
}
