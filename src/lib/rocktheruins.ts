import { load } from "cheerio";
import type { EventItem } from "@/lib/ticketmaster";

const ROCK_THE_RUINS_URL = "https://www.rocktheruins.com/";
const REVALIDATE_SECONDS = 3600;

const MONTHS: Record<string, number> = {
  january: 1,
  february: 2,
  march: 3,
  april: 4,
  may: 5,
  june: 6,
  july: 7,
  august: 8,
  september: 9,
  october: 10,
  november: 11,
  december: 12
};

function resolveUrl(href: string) {
  try {
    return new URL(href, ROCK_THE_RUINS_URL).toString();
  } catch {
    return href;
  }
}

function slugify(text: string) {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function parseDate(text: string) {
  const match = text.trim().match(/^([A-Za-z]+)\s+(\d{1,2}),\s+(\d{4})$/);
  if (!match) return null;

  const month = MONTHS[match[1].toLowerCase()];
  const day = Number(match[2]);
  const year = Number(match[3]);
  if (!month || !Number.isFinite(day) || !Number.isFinite(year)) return null;

  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function parseLastPublished(html: string) {
  const match = html.match(/Last Published:\s*([^<]+?)-->/);
  if (!match) return undefined;

  const timestamp = Date.parse(match[1].trim());
  if (Number.isNaN(timestamp)) return undefined;

  return new Date(timestamp).toISOString();
}

function parseEventsFromHtml(html: string) {
  const $ = load(html);
  const events: EventItem[] = [];
  const publicVisibilityStartDateTime = parseLastPublished(html);

  $(".lineup-home").each((_, element) => {
    const card = $(element);
    const name = card.find(".text-block-58").first().text().replace(/\s+/g, " ").trim();
    const localDate = parseDate(
      card.find(".text-block-59").first().text().replace(/\s+/g, " ").trim()
    );
    const href = card.find("a").first().attr("href");
    if (!name || !localDate || !href) return;

    events.push({
      id: `rocktheruins-${localDate}-${slugify(name)}`,
      name,
      localDate,
      venue: "Rock the Ruins",
      venueKey: "rocktheruins",
      url: resolveUrl(href),
      publicVisibilityStartDateTime
    });
  });

  return events;
}

export async function fetchRockTheRuinsEvents() {
  const response = await fetch(ROCK_THE_RUINS_URL, {
    next: { revalidate: REVALIDATE_SECONDS }
  });
  if (!response.ok) {
    throw new Error(`Rock the Ruins request failed: ${response.status}`);
  }

  return parseEventsFromHtml(await response.text());
}
