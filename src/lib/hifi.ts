import { readFile } from "node:fs/promises";
import { load } from "cheerio";
import type { EventItem } from "@/lib/ticketmaster";

const HIFI_EVENTS_URL = "https://hifiindy.com/events/";
const REVALIDATE_SECONDS = 900;
const MAX_PAGES = 15;
let hasLoggedDebug = false;
const SNAPSHOT_PATH = "/tmp/hifi-events.html";
const USE_SNAPSHOT = process.env.HIFI_DEBUG_SNAPSHOT === "1";

const MONTHS: Record<string, number> = {
  jan: 0,
  january: 0,
  feb: 1,
  february: 1,
  mar: 2,
  march: 2,
  apr: 3,
  april: 3,
  may: 4,
  jun: 5,
  june: 5,
  jul: 6,
  july: 6,
  aug: 7,
  august: 7,
  sep: 8,
  sept: 8,
  september: 8,
  oct: 9,
  october: 9,
  nov: 10,
  november: 10,
  dec: 11,
  december: 11
};

function formatLocalDate(monthIndex: number, day: number) {
  const now = new Date();
  let year = now.getFullYear();
  const candidate = new Date(year, monthIndex, day);
  const today = new Date(year, now.getMonth(), now.getDate());
  if (candidate < new Date(today.getTime() - 24 * 60 * 60 * 1000)) {
    year += 1;
  }
  const date = new Date(year, monthIndex, day);
  const yyyy = String(date.getFullYear());
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function extractDateFromText(text: string) {
  const normalized = text.replace(/\s+/g, " ").trim();
  const match = normalized.match(/([A-Za-z]{3,9})\s+(\d{1,2})\s*\|/);
  if (!match) return null;
  const monthKey = match[1].toLowerCase();
  const monthIndex = MONTHS[monthKey];
  if (monthIndex === undefined) return null;
  const day = Number(match[2]);
  if (!Number.isFinite(day)) return null;
  return formatLocalDate(monthIndex, day);
}

function resolveUrl(href: string, baseUrl: string) {
  try {
    return new URL(href, baseUrl).toString();
  } catch {
    return href;
  }
}

function findUpcomingScope($: ReturnType<typeof load>) {
  const heading = $("h1")
    .filter((_, el) => $(el).text().trim().toUpperCase() === "UPCOMING EVENTS")
    .first();
  if (heading.length === 0) return $.root();
  const section = heading.closest(".elements, .block, .pb-area, #content");
  return section.length ? section : heading.parent();
}

function parseEventsFromHtml(html: string, baseUrl: string) {
  const $ = load(html);
  const scope = findUpcomingScope($);
  const events: EventItem[] = [];
  const cards = scope.find(".nevents .nevent").length
    ? scope.find(".nevents .nevent")
    : $(".nevents .nevent");

  cards.each((_, element) => {
    const card = $(element);
    const name = card.find("h3").first().text().trim();
    const href =
      card.find("a.nevent-title").attr("href") ??
      card.find("h3 a").attr("href");
    if (!name || !href) return;

    const dateText =
      card.find(".nevent-date-venue").first().text().trim() || card.text();
    const localDate = extractDateFromText(dateText);
    if (!localDate) return;

    events.push({
      id: `hifi-${localDate}-${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
      name,
      localDate,
      localTime: undefined,
      venue: "HI-FI",
      venueKey: "hifi",
      url: resolveUrl(href, baseUrl)
    });
  });

  return { events, cardCount: cards.length };
}

function normalizePageUrl(url: string) {
  try {
    const parsed = new URL(url);
    parsed.search = "";
    if (!parsed.pathname.endsWith("/")) {
      parsed.pathname = `${parsed.pathname}/`;
    }
    return parsed.toString();
  } catch {
    return url;
  }
}

function findNextPageUrl(
  $: ReturnType<typeof load>,
  baseUrl: string,
  pageIndex: number
) {
  const nextLink = $(".event-pagination a")
    .filter((_, el) => $(el).text().toLowerCase().includes("next page"))
    .first();
  const href = nextLink.attr("href");
  if (href) return normalizePageUrl(resolveUrl(href, baseUrl));

  if (pageIndex + 2 > MAX_PAGES) return null;
  return `${HIFI_EVENTS_URL}page/${pageIndex + 2}/`;
}

export async function fetchHiFiEvents() {
  const events: EventItem[] = [];
  const seenUrls = new Set<string>();
  let currentUrl = HIFI_EVENTS_URL;
  let page1CardCount = 0;
  let page1Sample: Array<Pick<EventItem, "name" | "localDate" | "url">> = [];
  let pagesScraped = 0;

  for (let page = 0; page < MAX_PAGES && currentUrl; page += 1) {
    let html: string;
    if (page === 0 && USE_SNAPSHOT) {
      html = await readFile(SNAPSHOT_PATH, "utf-8");
    } else {
      const response = await fetch(currentUrl, {
        next: { revalidate: REVALIDATE_SECONDS }
      });
      if (!response.ok) {
      throw new Error(`HI-FI request failed: ${response.status}`);
    }
    html = await response.text();
  }
    pagesScraped += 1;
    const { events: parsedEvents, cardCount } = parseEventsFromHtml(
      html,
      currentUrl
    );
    if (page === 0) {
      page1CardCount = cardCount;
      page1Sample = parsedEvents.slice(0, 3).map((event) => ({
        name: event.name,
        localDate: event.localDate,
        url: event.url
      }));
    }
    parsedEvents.forEach((event) => {
      if (seenUrls.has(event.url)) return;
      seenUrls.add(event.url);
      events.push(event);
    });

    const $ = load(html);
    const nextPage = findNextPageUrl($, currentUrl, page);
    if (!nextPage || nextPage === currentUrl) break;
    currentUrl = nextPage;
  }

  if (!hasLoggedDebug) {
    hasLoggedDebug = true;
    console.log(`[HI-FI] pages=${pagesScraped}`);
    console.log(
      `[HI-FI] page1=${HIFI_EVENTS_URL} cards=${page1CardCount} total=${events.length}`
    );
    if (page1Sample.length) {
      console.log("[HI-FI] sample", page1Sample);
    }
  }

  return events;
}
