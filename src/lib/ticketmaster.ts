export type EventItem = {
  id: string;
  name: string;
  localDate: string;
  localTime?: string;
  venue: string;
  venueKey: string;
  url: string;
  firstSeenAt?: string;
  publicVisibilityStartDateTime?: string;
};

export const VENUE_KEYWORDS = {
  ruoff: "Ruoff Music Center",
  everwise: "Everwise Amphitheater at White River State Park"
} as const;

// TODO: Replace these with the real Ticketmaster venue IDs once discovered.
export const VENUE_IDS = {
  ruoff: "KovZpvEk7A",
  everwise: "KovZpZAEAAJA",
  oldnational: "KovZpZAEAkvA",
  vogue: "KovZpZAEktEA",
  hifi: "Z7r9jZaAMC",
  rocktheruins: "external-rocktheruins",
  gainbridge: "KovZpZA6keIA",
  lucasoil: "KovZpZAdEJEA",
  fishers: "KovZ917AmVB"
} as const;

export const VENUE_LABELS: Record<keyof typeof VENUE_IDS, string> = {
  ruoff: "Ruoff Music Center",
  everwise: "Everwise Amphitheater",
  oldnational: "Old National Centre",
  vogue: "The Vogue",
  hifi: "HI-FI",
  rocktheruins: "Rock the Ruins",
  gainbridge: "Gainbridge Fieldhouse",
  lucasoil: "Lucas Oil Stadium",
  fishers: "Fishers Event Center"
};


const TICKETMASTER_BASE_URL = "https://app.ticketmaster.com/discovery/v2";
const REVALIDATE_SECONDS = 900;

function getApiKey() {
  return process.env.TICKETMASTER_API_KEY;
}

function isPassLikeListing(name: string) {
  return /\b(?:\d+|one|two|three|four|five)[-\s]?day\s+ticket\b/i.test(name) ||
    /\b(?:multi|single)[-\s]?day\s+pass\b/i.test(name) ||
    /\b(?:festival|season)\s+pass\b/i.test(name) ||
    /\bvalid\s+(?:both|all)\s+days\b/i.test(name) ||
    /\bcannot\s+split\b/i.test(name);
}

async function fetchJson<T>(url: string, attempt = 0): Promise<T> {
  const response = await fetch(url, {
    next: { revalidate: REVALIDATE_SECONDS }
  });

  if (!response.ok) {
    const text = await response.text();
    if (response.status === 429 && attempt < 3) {
      const retryAfter = Number(response.headers.get("retry-after"));
      const waitMs = Number.isFinite(retryAfter)
        ? retryAfter * 1000
        : 500 * Math.pow(2, attempt);
      await new Promise((resolve) => setTimeout(resolve, waitMs));
      return fetchJson<T>(url, attempt + 1);
    }
    throw new Error(`Ticketmaster request failed: ${response.status} ${text}`);
  }

  return response.json() as Promise<T>;
}

export async function lookupVenueId(keyword: string) {
  const apiKey = getApiKey();
  if (!apiKey) {
    throw new Error("Missing TICKETMASTER_API_KEY in environment.");
  }

  const url = new URL(`${TICKETMASTER_BASE_URL}/venues.json`);
  url.searchParams.set("apikey", apiKey);
  url.searchParams.set("keyword", keyword);
  url.searchParams.set("size", "5");

  const data = await fetchJson<{
    _embedded?: { venues?: Array<{ id: string; name: string }> };
  }>(url.toString());

  const venue = data._embedded?.venues?.[0];
  return venue ? { id: venue.id, name: venue.name } : null;
}

export async function fetchEventsForVenue(venueKey: string, venueId: string): Promise<EventItem[]> {
  const apiKey = getApiKey();
  if (!apiKey) {
    console.warn(`Skipping Ticketmaster venue ${venueKey}: missing TICKETMASTER_API_KEY.`);
    return [];
  }

  const url = new URL(`${TICKETMASTER_BASE_URL}/events.json`);
  url.searchParams.set("apikey", apiKey);
  url.searchParams.set("venueId", venueId);
  url.searchParams.set("size", "200");
  url.searchParams.set("sort", "date,asc");

  const data = await fetchJson<{
    _embedded?: {
      events?: Array<{
        id: string;
        name: string;
        url: string;
        dates?: { start?: { localDate?: string; localTime?: string } };
        sales?: { public?: { startDateTime?: string } };
        classifications?: Array<{
          segment?: { name?: string };
        }>;
        _embedded?: { venues?: Array<{ name: string }> };
      }>;
    };
  }>(url.toString());

  const events = data._embedded?.events ?? [];

  const mappedEvents: Array<EventItem | null> = events.map((event) => {
      if (isPassLikeListing(event.name)) return null;

      const segmentName = event.classifications?.[0]?.segment?.name;
      const isWeirdAl = /weird\s+al|yankovic/i.test(event.name);
      if (segmentName !== "Music" && !isWeirdAl) return null;

      const localDate = event.dates?.start?.localDate;
      const venueName = event._embedded?.venues?.[0]?.name;
      if (!localDate || !venueName) return null;
      if (venueKey === "vogue" && /vogue theatre/i.test(venueName)) return null;

      const item: EventItem = {
        id: event.id,
        name: event.name,
        localDate,
        venue: venueName,
        venueKey,
        url: event.url
      };

      const localTime = event.dates?.start?.localTime;
      const publicVisibilityStartDateTime = event.sales?.public?.startDateTime;
      if (localTime) item.localTime = localTime;
      if (publicVisibilityStartDateTime) {
        item.publicVisibilityStartDateTime = publicVisibilityStartDateTime;
      }

      return item;
    });

  return mappedEvents.filter((event): event is EventItem => event !== null);
}

export function sortEventsAscending(events: EventItem[]) {
  return [...events].sort((a, b) => {
    const dateA = new Date(`${a.localDate}T${a.localTime ?? "00:00:00"}`);
    const dateB = new Date(`${b.localDate}T${b.localTime ?? "00:00:00"}`);
    return dateA.getTime() - dateB.getTime();
  });
}
