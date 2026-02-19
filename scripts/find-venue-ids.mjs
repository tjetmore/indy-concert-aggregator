const BASE_URL = "https://app.ticketmaster.com/discovery/v2/venues.json";
const API_KEY = process.env.TICKETMASTER_API_KEY;

if (!API_KEY) {
  console.error("Missing TICKETMASTER_API_KEY in environment.");
  process.exit(1);
}

const DEFAULT_KEYWORDS = [
  "Ruoff Music Center",
  "Everwise Amphitheater at White River State Park"
];

const searchKeyword = process.argv.slice(2).join(" ").trim();

async function lookup(keyword) {
  const url = new URL(BASE_URL);
  url.searchParams.set("apikey", API_KEY);
  url.searchParams.set("keyword", keyword);
  url.searchParams.set("size", "3");

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Request failed: ${response.status}`);
  }

  const data = await response.json();
  const venue = data?._embedded?.venues?.[0];
  if (!venue) {
    return { keyword, id: null, name: null };
  }

  return { keyword, id: venue.id, name: venue.name };
}

async function searchVenues(keyword) {
  const url = new URL(BASE_URL);
  url.searchParams.set("apikey", API_KEY);
  url.searchParams.set("keyword", keyword);
  url.searchParams.set("size", "10");

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Request failed: ${response.status}`);
  }

  const data = await response.json();
  const venues = data?._embedded?.venues ?? [];

  if (venues.length === 0) {
    console.log(`No venues found for "${keyword}".`);
    return;
  }

  venues.forEach((venue) => {
    const city = venue?.city?.name ?? "Unknown city";
    const state = venue?.state?.stateCode ?? venue?.state?.name ?? "Unknown state";
    console.log(`${venue.id} | ${venue.name} | ${city}, ${state}`);
  });
}

(async () => {
  if (searchKeyword) {
    try {
      await searchVenues(searchKeyword);
    } catch (error) {
      console.error(`${searchKeyword}: ERROR`, error.message);
    }
    return;
  }

  for (const keyword of DEFAULT_KEYWORDS) {
    try {
      const result = await lookup(keyword);
      console.log(`${result.keyword}: ${result.id ?? "NOT FOUND"}`);
      if (result.name) {
        console.log(`  Name: ${result.name}`);
      }
    } catch (error) {
      console.error(`${keyword}: ERROR`, error.message);
    }
  }
})();
