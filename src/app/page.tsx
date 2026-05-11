import EventList from "@/components/EventList";
import { VENUE_LABELS, VENUE_MARKETS } from "@/lib/ticketmaster";
import {
  getConcertData,
  getHasMissingVenueId,
  getVenueEntries
} from "@/lib/events";

export const revalidate = 3600;

function formatLastUpdated(date: Date) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "America/Indiana/Indianapolis",
    timeZoneName: "short"
  }).format(date);
}

export default async function HomePage() {
  const venueEntries = getVenueEntries();
  const hasMissingVenueId = getHasMissingVenueId();

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

  const { events, sourceHealth } = await getConcertData();
  const venues = venueEntries.map(([venueKey]) => ({
    key: venueKey,
    label: VENUE_LABELS[venueKey as keyof typeof VENUE_LABELS] ?? venueKey,
    market: VENUE_MARKETS[venueKey as keyof typeof VENUE_MARKETS] ?? "indianapolis"
  }));
  const sourceCount = sourceHealth.length;
  const failedSources = sourceHealth.filter((source) => source.status === "failed");
  const lastUpdated = formatLastUpdated(new Date());

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
                Upcoming concerts in Indy and nearby music cities
              </h1>
              <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-300 md:text-base">
                Browse upcoming shows from local venue calendars, filter by
                place, and quickly find the next night worth going out.
              </p>
              <p className="mt-3 text-xs font-medium uppercase tracking-[0.12em] text-slate-500">
                Last updated {lastUpdated}
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

        {failedSources.length > 0 ? (
          <section className="rounded-lg border border-amber-300/35 bg-amber-300/10 p-4 text-sm text-amber-100">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <h2 className="font-semibold text-amber-50">
                  Some venue sources may be stale
                </h2>
                <p className="mt-1 text-amber-100/80">
                  {failedSources.map((source) => source.label).join(", ")} failed during
                  the latest refresh, so some shows may be missing.
                </p>
              </div>
              <span className="shrink-0 rounded-full border border-amber-200/35 px-3 py-1 text-xs font-semibold uppercase tracking-[0.12em] text-amber-100">
                {failedSources.length} source{failedSources.length === 1 ? "" : "s"} down
              </span>
            </div>
          </section>
        ) : null}

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
