import EventList from "@/components/EventList";
import {
  fetchEventsForVenue,
  sortEventsAscending,
  VENUE_LABELS,
  VENUE_IDS
} from "@/lib/ticketmaster";
import { fetchHiFiEvents } from "@/lib/hifi";

export const revalidate = 900;

const DEV_DELAY_MS = 250;

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function filterUpcomingEvents(events: Array<any>) {
  const now = new Date();

  return events
    .filter(Boolean)
    .filter((event) => {
      const time = event.localTime ?? "23:59:59";
      const eventDate = new Date(`${event.localDate}T${time}`);
      return eventDate >= now;
    });
}

export default async function HomePage() {
  const venueEntries = Object.entries(VENUE_IDS);
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
  for (const [venueKey, venueId] of venueEntries) {
    const events = await fetchEventsForVenue(venueKey, venueId);
    eventsByVenue.push(events);
    if (process.env.NODE_ENV === "development") {
      await wait(DEV_DELAY_MS);
    }
  }

  const hifiEvents = await fetchHiFiEvents();
  const mergedEvents = [...eventsByVenue.flat(), ...hifiEvents];
  const events = sortEventsAscending(filterUpcomingEvents(mergedEvents));
  const venues = venueEntries.map(([venueKey]) => ({
    key: venueKey,
    label: VENUE_LABELS[venueKey as keyof typeof VENUE_LABELS] ?? venueKey
  }));

  return (
    <main className="min-h-screen bg-zinc-950 px-6 py-16">
      <div className="mx-auto max-w-5xl space-y-10">
        <header className="space-y-4">
          <p className="text-xs uppercase tracking-[0.4em] text-slate-400">
            Indiana Live Calendar
          </p>
          <h1 className="text-4xl font-semibold text-slate-900 md:text-5xl">
            Upcoming concerts across Indiana venues
          </h1>
          <p className="max-w-2xl text-base text-slate-600">
            Combined listings from Ticketmaster for multiple venues. Use the
            filters to narrow the list.
          </p>
        </header>

        <EventList events={events} venues={venues} />
        <p className="text-xs text-slate-500">
          HI-FI events sourced from hifiindy.com; ticket links may go to Tixr.
        </p>
      </div>
    </main>
  );
}
