import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fetchHiFiEvents } from "@/lib/hifi";
import { fetchRockTheRuinsEvents } from "@/lib/rocktheruins";
import {
  fetchEventsForVenue,
  sortEventsAscending,
  VENUE_IDS,
  VENUE_LABELS,
  type EventItem
} from "@/lib/ticketmaster";
import { fetchVogueEvents } from "@/lib/vogue";

const DEV_DELAY_MS = 250;
const SNAPSHOT_PATH = join(process.cwd(), ".next", "cache", "events-snapshot.json");
const SNAPSHOT_KV_KEY = "events-snapshot";
const SNAPSHOT_MAX_AGE_DAYS = 120;
const EXTERNAL_VENUE_KEYS = new Set(["vogue", "rocktheruins"]);
const KV_REST_API_URL = process.env.KV_REST_API_URL;
const KV_REST_API_TOKEN = process.env.KV_REST_API_TOKEN;

export type SourceHealth = {
  key: string;
  label: string;
  status: "ok" | "failed";
  eventCount: number;
  error?: string;
};

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function canUseKv() {
  return Boolean(KV_REST_API_URL && KV_REST_API_TOKEN);
}

async function loadSnapshotFromFile() {
  try {
    const raw = await readFile(SNAPSHOT_PATH, "utf-8");
    return JSON.parse(raw) as Record<string, string>;
  } catch {
    return {};
  }
}

async function saveSnapshotToFile(snapshot: Record<string, string>) {
  await mkdir(join(process.cwd(), ".next", "cache"), { recursive: true });
  await writeFile(SNAPSHOT_PATH, JSON.stringify(snapshot), "utf-8");
}

async function loadSnapshot() {
  if (canUseKv()) {
    try {
      const response = await fetch(`${KV_REST_API_URL}/get/${SNAPSHOT_KV_KEY}`, {
        headers: {
          Authorization: `Bearer ${KV_REST_API_TOKEN}`
        },
        cache: "no-store"
      });
      if (response.ok) {
        const data = (await response.json()) as { result?: string | null };
        if (data.result) {
          return JSON.parse(data.result) as Record<string, string>;
        }
      }
    } catch (error) {
      console.error("[events] Failed to load first-seen snapshot from KV", error);
    }
  }

  return loadSnapshotFromFile();
}

async function saveSnapshot(snapshot: Record<string, string>) {
  if (canUseKv()) {
    try {
      const payload = encodeURIComponent(JSON.stringify(snapshot));
      const response = await fetch(`${KV_REST_API_URL}/set/${SNAPSHOT_KV_KEY}/${payload}`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${KV_REST_API_TOKEN}`
        },
        cache: "no-store"
      });
      if (!response.ok) {
        throw new Error(`KV snapshot save failed: ${response.status}`);
      }
      return;
    } catch (error) {
      console.error("[events] Failed to save first-seen snapshot to KV", error);
    }
  }

  try {
    await saveSnapshotToFile(snapshot);
  } catch (error) {
    console.error("[events] Failed to save first-seen snapshot to file", error);
  }
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

async function fetchSource(
  key: string,
  label: string,
  fetchEvents: () => Promise<EventItem[]>
) {
  try {
    const events = await fetchEvents();
    return {
      events,
      health: {
        key,
        label,
        status: "ok",
        eventCount: events.length
      } satisfies SourceHealth
    };
  } catch (error) {
    console.error(`[events] ${label} failed`, error);
    return {
      events: [],
      health: {
        key,
        label,
        status: "failed",
        eventCount: 0,
        error: error instanceof Error ? error.message : "Unknown source error"
      } satisfies SourceHealth
    };
  }
}

export async function getConcertData() {
  const ticketmasterVenueEntries = getVenueEntries().filter(
    ([venueKey]) => !EXTERNAL_VENUE_KEYS.has(venueKey)
  );

  const sourceResults: Array<{ events: EventItem[]; health: SourceHealth }> = [];

  for (const [venueKey, venueId] of ticketmasterVenueEntries) {
    const result = await fetchSource(
      `ticketmaster-${venueKey}`,
      VENUE_LABELS[venueKey as keyof typeof VENUE_LABELS] ?? `Ticketmaster ${venueKey}`,
      () => fetchEventsForVenue(venueKey, venueId)
    );
    sourceResults.push(result);
    if (process.env.NODE_ENV === "development") {
      await wait(DEV_DELAY_MS);
    }
  }

  sourceResults.push(
    await fetchSource("hifi-calendar", "HI-FI calendar", fetchHiFiEvents),
    await fetchSource("vogue-calendar", "The Vogue calendar", fetchVogueEvents),
    await fetchSource("rocktheruins-calendar", "Rock the Ruins calendar", fetchRockTheRuinsEvents)
  );

  const rawEvents = sourceResults
    .flatMap((result) => result.events)
    .filter((event): event is EventItem => Boolean(event));

  const mergedEvents = dedupeEvents(rawEvents);
  const eventsWithFirstSeen = await annotateFirstSeen(mergedEvents);
  return {
    events: sortEventsAscending(filterUpcomingEvents(eventsWithFirstSeen)),
    sourceHealth: sourceResults.map((result) => result.health)
  };
}

export async function getConcertEvents() {
  const { events } = await getConcertData();
  return events;
}
