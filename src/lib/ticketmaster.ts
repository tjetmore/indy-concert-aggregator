export type EventItem = {
  id: string;
  name: string;
  localDate: string;
  localTime?: string;
  venue: string;
  venueKey: string;
  url: string;
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
  gainbridge: "KovZpZA6keIA"
} as const;

export const VENUE_LABELS: Record<keyof typeof VENUE_IDS, string> = {
  ruoff: "Ruoff Music Center",
  everwise: "Everwise Amphitheater",
  oldnational: "Old National Centre",
  vogue: "The Vogue",
  hifi: "HI-FI",
  gainbridge: "Gainbridge Fieldhouse"
};


const TICKETMASTER_BASE_URL = "https://app.ticketmaster.com/discovery/v2";
const REVALIDATE_SECONDS = 900;

function getApiKey() {
  const apiKey = process.env.TICKETMASTER_API_KEY;
  if (!apiKey) {
    throw new Error("Missing TICKETMASTER_API_KEY in environment.");
  }
  return apiKey;
}

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url, {
    next: { revalidate: REVALIDATE_SECONDS }
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Ticketmaster request failed: ${response.status} ${text}`);
  }

  return response.json() as Promise<T>;
}

export async function lookupVenueId(keyword: string) {
  const apiKey = getApiKey();
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

export async function fetchEventsForVenue(venueKey: string, venueId: string) {
  const apiKey = getApiKey();
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
        classifications?: Array<{
          segment?: { name?: string };
        }>;
        _embedded?: { venues?: Array<{ name: string }> };
      }>;
    };
  }>(url.toString());

  const events = data._embedded?.events ?? [];

  return events
    .map((event) => {
      const segmentName = event.classifications?.[0]?.segment?.name;
      const isAllowedSegment =
        segmentName === "Music" || segmentName === "Arts & Theatre";
      if (!isAllowedSegment) return null;

      const localDate = event.dates?.start?.localDate;
      const venueName = event._embedded?.venues?.[0]?.name;
      if (!localDate || !venueName) return null;

      return {
        id: event.id,
        name: event.name,
        localDate,
        localTime: event.dates?.start?.localTime,
        venue: venueName,
        venueKey,
        url: event.url
      } satisfies EventItem;
    })
    .filter(Boolean);
}

export function sortEventsAscending(events: EventItem[]) {
  return [...events].sort((a, b) => {
    const dateA = new Date(`${a.localDate}T${a.localTime ?? "00:00:00"}`);
    const dateB = new Date(`${b.localDate}T${b.localTime ?? "00:00:00"}`);
    return dateA.getTime() - dateB.getTime();
  });
}
