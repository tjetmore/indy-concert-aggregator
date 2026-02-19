"use client";

import { useMemo, useState } from "react";
import type { EventItem } from "@/lib/ticketmaster";

function formatDate(localDate: string) {
  const date = new Date(`${localDate}T00:00:00`);
  return new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric"
  }).format(date);
}

function formatTime(localDate: string, localTime?: string) {
  if (!localTime) return "TBA";
  const date = new Date(`${localDate}T${localTime}`);
  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit"
  }).format(date);
}

function groupEventsByMonth(events: EventItem[]) {
  const formatter = new Intl.DateTimeFormat("en-US", {
    month: "long",
    year: "numeric"
  });
  const groups: Array<{ key: string; label: string; events: EventItem[] }> = [];
  const indexByKey = new Map<string, number>();

  events.forEach((event) => {
    const date = new Date(`${event.localDate}T00:00:00`);
    const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
    const existingIndex = indexByKey.get(key);

    if (existingIndex === undefined) {
      indexByKey.set(key, groups.length);
      groups.push({
        key,
        label: formatter.format(date),
        events: [event]
      });
      return;
    }

    groups[existingIndex].events.push(event);
  });

  return groups;
}

type VenueOption = { key: string; label: string };

export default function EventList({
  events,
  venues
}: {
  events: EventItem[];
  venues: VenueOption[];
}) {
  const [filter, setFilter] = useState("All");
  const [query, setQuery] = useState("");
  const [collapsedByMonth, setCollapsedByMonth] = useState<Record<string, boolean>>({});

  const filtered = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();

    return events.filter((event) => {
      const matchesFilter =
        filter === "All" ||
        event.venueKey === filter;

      const matchesQuery = normalizedQuery.length
        ? event.name.toLowerCase().includes(normalizedQuery)
        : true;

      return matchesFilter && matchesQuery;
    });
  }, [events, filter, query]);

  const grouped = useMemo(() => groupEventsByMonth(filtered), [filtered]);
  const filterOptions = useMemo(
    () => [{ key: "All", label: "All" }, ...venues],
    [venues]
  );

  const toggleMonth = (key: string) => {
    setCollapsedByMonth((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div className="w-full md:max-w-xs">
          <label className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">
            Venue
          </label>
          <select
            className="mt-2 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700 shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/60"
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
          >
            {filterOptions.map((item) => (
              <option key={item.key} value={item.key}>
                {item.label === "All" ? "All Venues" : item.label}
              </option>
            ))}
          </select>
        </div>

        <div className="w-full md:max-w-xs">
          <input
            className="input-shell"
            placeholder="Search artist or event"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
      </div>

      <div className="space-y-8">
        {filtered.length === 0 ? (
          <div className="rounded-3xl border border-dashed border-slate-200 bg-white p-10 text-center text-sm text-slate-500">
            No matching events.
          </div>
        ) : (
          grouped.map((group) => {
            const isOpen = !collapsedByMonth[group.key];
            return (
            <section key={group.key} className="space-y-4">
              <h2>
                <button
                  type="button"
                  aria-expanded={isOpen}
                  onClick={() => toggleMonth(group.key)}
                  className="flex w-full items-center justify-between rounded-2xl border border-transparent px-2 py-1 text-left text-sm font-semibold uppercase tracking-[0.3em] text-slate-500 transition hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/60"
                >
                  <span>{group.label}</span>
                  <span className="text-base text-slate-400" aria-hidden="true">
                    {isOpen ? "▾" : "▸"}
                  </span>
                </button>
              </h2>
              {isOpen ? (
                <div className="grid gap-4">
                  {group.events.map((event) => (
                    <a
                      key={event.id}
                      href={event.url}
                      target="_blank"
                      rel="noreferrer"
                      className="group rounded-3xl border border-slate-200 bg-white p-6 shadow-sm transition hover:-translate-y-1 hover:border-slate-300 hover:shadow-md"
                    >
                      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                        <div>
                          <p className="text-xs uppercase tracking-[0.2em] text-slate-400">
                            {formatDate(event.localDate)}
                          </p>
                          <h3 className="mt-2 text-lg font-semibold text-slate-900">
                            {event.name}
                          </h3>
                          <p className="mt-1 text-sm text-slate-500">
                            {event.venue}
                          </p>
                        </div>
                        <div className="text-sm font-medium text-slate-600">
                          {formatTime(event.localDate, event.localTime)}
                        </div>
                      </div>
                      <div className="mt-4 text-sm font-medium text-amber-700 group-hover:text-amber-800">
                        View on Ticketmaster
                      </div>
                    </a>
                  ))}
                </div>
              ) : null}
            </section>
          );
          })
        )}
      </div>
    </div>
  );
}
