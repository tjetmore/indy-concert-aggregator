import { load } from "cheerio";
import type { EventItem } from "@/lib/ticketmaster";

const VOGUE_CALENDAR_URL = "https://www.thevogue.com/calendar";
const REVALIDATE_SECONDS = 900;

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
    return new URL(href, VOGUE_CALENDAR_URL).toString();
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

function parsePublishedDateTime(text: string) {
  const match = text
    .trim()
    .match(/^([A-Za-z]+)\s+(\d{1,2}),\s+(\d{4})\s+(\d{1,2})(?::(\d{2}))?\s*(AM|PM)$/i);
  if (!match) return undefined;

  const month = MONTHS[match[1].toLowerCase()];
  const day = Number(match[2]);
  const year = Number(match[3]);
  let hour = Number(match[4]);
  const minute = Number(match[5] ?? "0");
  const period = match[6].toLowerCase();

  if (
    !month ||
    !Number.isFinite(day) ||
    !Number.isFinite(year) ||
    !Number.isFinite(hour) ||
    !Number.isFinite(minute)
  ) {
    return undefined;
  }

  if (period === "pm" && hour !== 12) hour += 12;
  if (period === "am" && hour === 12) hour = 0;

  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00`;
}

function parseTime(text: string) {
  const match = text.trim().toLowerCase().match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)$/);
  if (!match) return undefined;

  let hour = Number(match[1]);
  const minute = Number(match[2] ?? "0");
  const period = match[3];
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return undefined;
  if (period === "pm" && hour !== 12) hour += 12;
  if (period === "am" && hour === 12) hour = 0;

  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00`;
}

function parseEventsFromHtml(html: string) {
  const $ = load(html);
  const events: EventItem[] = [];

  $(".vogue-calendar .w-dyn-item").each((_, element) => {
    const card = $(element);
    const venue = card.find(".events-venue-pill").first().text().replace(/\s+/g, " ").trim();
    if (!/^The Vogue/i.test(venue)) return;

    const name = card.find(".events-name").first().text().replace(/\s+/g, " ").trim();
    const href = card.find("a.uui-blogsection10_title-link").first().attr("href");
    if (!name || !href) return;

    const dateTimeFields = card.find(".uui-text-size-medium").toArray().map((field) =>
      $(field).text().replace(/\s+/g, " ").trim()
    );
    const localDate = dateTimeFields.map(parseDate).find(Boolean);
    if (!localDate) return;

    const localTime = dateTimeFields.map(parseTime).find(Boolean);
    const publicVisibilityStartDateTime = parsePublishedDateTime(
      card.find(".published_at_hidden").first().text().replace(/\s+/g, " ").trim()
    );

    events.push({
      id: `vogue-${localDate}-${slugify(name)}`,
      name,
      localDate,
      localTime,
      venue,
      venueKey: "vogue",
      url: resolveUrl(href),
      publicVisibilityStartDateTime
    });
  });

  return events;
}

export async function fetchVogueEvents() {
  const response = await fetch(VOGUE_CALENDAR_URL, {
    next: { revalidate: REVALIDATE_SECONDS }
  });
  if (!response.ok) {
    throw new Error(`Vogue request failed: ${response.status}`);
  }

  return parseEventsFromHtml(await response.text());
}
