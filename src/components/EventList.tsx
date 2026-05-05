"use client";

import { useEffect, useMemo, useState } from "react";
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
type DateRangeFilter = "all" | "weekend" | "30days";
type ViewMode = "all" | "saved";
const SAVED_EVENTS_STORAGE_KEY = "indyConcertSavedEvents";

function getEventDateTime(event: EventItem) {
  return new Date(`${event.localDate}T${event.localTime ?? "23:59:59"}`);
}

function getWeekendRange(now = new Date()) {
  const start = new Date(now);
  const day = start.getDay();
  const daysUntilFriday = (5 - day + 7) % 7;
  start.setDate(start.getDate() + daysUntilFriday);
  start.setHours(0, 0, 0, 0);

  const end = new Date(start);
  end.setDate(start.getDate() + 2);
  end.setHours(23, 59, 59, 999);

  return { start, end };
}

function matchesDateRange(event: EventItem, filter: DateRangeFilter) {
  if (filter === "all") return true;

  const eventDate = getEventDateTime(event);
  const now = new Date();

  if (filter === "30days") {
    const end = new Date(now);
    end.setDate(now.getDate() + 30);
    end.setHours(23, 59, 59, 999);
    return eventDate >= now && eventDate <= end;
  }

  const { start, end } = getWeekendRange(now);
  return eventDate >= start && eventDate <= end;
}

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
  const [onlyNewThisWeek, setOnlyNewThisWeek] = useState(false);
  const [dateRange, setDateRange] = useState<DateRangeFilter>("all");
  const [viewMode, setViewMode] = useState<ViewMode>("all");
  const [savedEventIds, setSavedEventIds] = useState<string[]>([]);
  const [sharedEventIds, setSharedEventIds] = useState<string[]>([]);
  const [shareStatus, setShareStatus] = useState("");

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(SAVED_EVENTS_STORAGE_KEY);
      if (raw) setSavedEventIds(JSON.parse(raw) as string[]);
    } catch {
      setSavedEventIds([]);
    }

    const params = new URLSearchParams(window.location.search);
    const sharedListId = params.get("list");
    if (sharedListId) {
      setShareStatus("Loading shared list...");
      fetch(`/api/shared-lists/${encodeURIComponent(sharedListId)}`)
        .then(async (response) => {
          const data = await response.json();
          if (!response.ok) throw new Error(data.error ?? "Unable to load shared list.");
          setSharedEventIds(Array.isArray(data.eventIds) ? data.eventIds : []);
          setViewMode("saved");
          setShareStatus("");
        })
        .catch((error) => {
          setShareStatus(error instanceof Error ? error.message : "Unable to load shared list.");
        });
      return;
    }

    const shared = params.get("saved");
    if (shared) {
      const ids = shared.split(",").filter(Boolean);
      setSharedEventIds(ids);
      setViewMode("saved");
    }
  }, []);

  function updateSavedEventIds(next: string[]) {
    setSavedEventIds(next);
    window.localStorage.setItem(SAVED_EVENTS_STORAGE_KEY, JSON.stringify(next));
  }

  function toggleSavedEvent(eventId: string) {
    updateSavedEventIds(
      savedEventIds.includes(eventId)
        ? savedEventIds.filter((id) => id !== eventId)
        : [...savedEventIds, eventId]
    );
  }

  function clearSavedEvents() {
    updateSavedEventIds([]);
    setSharedEventIds([]);
    setShareStatus("");
    if (viewMode === "saved") {
      setViewMode("all");
    }
  }

  async function copyShareLink() {
    if (savedEventIds.length === 0) {
      setShareStatus("Save at least one show first.");
      return;
    }

    try {
      setShareStatus("Creating share link...");
      const response = await fetch("/api/shared-lists", {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify({ eventIds: savedEventIds })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Unable to create share link.");

      const url = new URL(window.location.href);
      url.search = "";
      url.searchParams.set("list", data.id);
      await window.navigator.clipboard.writeText(url.toString());
      setShareStatus("Copied share link");
    } catch (error) {
      setShareStatus(error instanceof Error ? error.message : "Unable to create share link.");
    }
  }

  const filtered = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();

    return events.filter((event) => {
      const matchesFilter = filter === "All" || event.venueKey === filter;
      const activeSavedIds = sharedEventIds.length ? sharedEventIds : savedEventIds;
      const matchesSaved = viewMode === "all" || activeSavedIds.includes(event.id);
      const matchesQuery = normalizedQuery.length
        ? event.name.toLowerCase().includes(normalizedQuery)
        : true;
      const matchesDate = matchesDateRange(event, dateRange);

      if (onlyNewThisWeek) {
        const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
        const published = event.publicVisibilityStartDateTime
          ? Date.parse(event.publicVisibilityStartDateTime)
          : NaN;
        const firstSeen = event.firstSeenAt ? Date.parse(event.firstSeenAt) : NaN;
        const effectiveTime = Number.isFinite(published) ? published : firstSeen;
        if (!Number.isFinite(effectiveTime) || effectiveTime < cutoff) return false;
      }

      return matchesFilter && matchesSaved && matchesQuery && matchesDate;
    });
  }, [events, filter, query, onlyNewThisWeek, dateRange, viewMode, savedEventIds, sharedEventIds]);

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
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          className="filter-pill"
          data-active={viewMode === "all"}
          onClick={() => setViewMode("all")}
        >
          All shows
        </button>
        <button
          type="button"
          className="filter-pill"
          data-active={viewMode === "saved"}
          onClick={() => setViewMode("saved")}
        >
          {sharedEventIds.length ? "Shared saves" : `Saved shows (${savedEventIds.length})`}
        </button>
        <button
          type="button"
          className="filter-pill"
          data-active="false"
          onClick={() => void copyShareLink()}
        >
          Share saved shows
        </button>
        {savedEventIds.length > 0 ? (
          <button
            type="button"
            className="filter-pill"
            data-active="false"
            onClick={clearSavedEvents}
          >
            Clear saved
          </button>
        ) : null}
      </div>
      {shareStatus ? (
        <p className="text-sm text-slate-400">{shareStatus}</p>
      ) : null}
      {sharedEventIds.length ? (
        <div className="rounded-lg border border-cyan-300/25 bg-cyan-300/10 p-3 text-sm text-cyan-100">
          Viewing a shared saved-show list.
        </div>
      ) : null}

      <div className="rounded-lg border border-slate-800 bg-slate-950/45 p-4 shadow-2xl shadow-black/20">
        <div className="grid gap-4 lg:grid-cols-[1fr_1.5fr_auto_auto] lg:items-end">
          <div>
            <label className="control-label">
            Venue
          </label>
          <select
            className="control-field text-sm"
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

          <div>
            <label className="control-label">
            Search
          </label>
          <input
            className="control-field text-sm"
            placeholder="Search artist or event"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              className="filter-pill"
              data-active={dateRange === "all"}
              onClick={() => setDateRange("all")}
            >
              All dates
            </button>
            <button
              type="button"
              className="filter-pill"
              data-active={dateRange === "weekend"}
              onClick={() => setDateRange("weekend")}
            >
              This weekend
            </button>
            <button
              type="button"
              className="filter-pill"
              data-active={dateRange === "30days"}
              onClick={() => setDateRange("30days")}
            >
              Next 30 days
            </button>
          </div>

          <label className="flex min-h-[2.35rem] items-center gap-2 rounded-full border border-slate-800 bg-slate-900/60 px-3 text-sm font-medium text-slate-300">
            <input
              type="checkbox"
              checked={onlyNewThisWeek}
              onChange={(event) => setOnlyNewThisWeek(event.target.checked)}
              className="h-4 w-4 rounded border-slate-600 accent-amber-400"
            />
            Added last 7 days
          </label>
        </div>
      </div>
      <div className="flex items-center justify-between text-sm text-slate-400">
        <span>{filtered.length} of {events.length} events shown</span>
        {query || filter !== "All" || onlyNewThisWeek || dateRange !== "all" || viewMode !== "all" ? (
          <button
            type="button"
            className="font-semibold text-amber-300 transition hover:text-amber-200"
            onClick={() => {
              setFilter("All");
              setQuery("");
              setOnlyNewThisWeek(false);
              setDateRange("all");
              setViewMode("all");
            }}
          >
            Clear filters
          </button>
        ) : null}
      </div>

      <div className="space-y-8">
        {filtered.length === 0 ? (
          <div className="rounded-lg border border-dashed border-slate-700 bg-slate-950/45 p-10 text-center text-sm text-slate-400">
            {viewMode === "saved" ? "No saved shows match your filters." : "No matching events."}
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
                    className="flex w-full items-center justify-between rounded-lg border border-slate-800/80 bg-slate-950/35 px-3 py-2 text-left text-sm font-semibold uppercase tracking-[0.16em] text-slate-300 transition hover:border-slate-700 hover:text-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/60"
                  >
                    <span>{group.label}</span>
                    <span className="text-base text-slate-500" aria-hidden="true">
                      {isOpen ? "▾" : "▸"}
                    </span>
                  </button>
                </h2>
                {isOpen ? (
                <div className="grid gap-3">
                    {group.events.map((event) => {
                      const isSaved = savedEventIds.includes(event.id);
                      const isShared = sharedEventIds.includes(event.id);
                      return (
                      <div
                        key={event.id}
                        className={`rounded-lg border p-4 transition ${
                          isSaved
                            ? "border-cyan-300/40 bg-cyan-300/10 hover:border-cyan-200/70"
                            : "border-slate-800 bg-slate-950/55 hover:border-amber-300/55 hover:bg-slate-900/80"
                        }`}
                      >
                        <div className="grid gap-4 md:grid-cols-[8.5rem_1fr_auto] md:items-center">
                          <div className="rounded-md border border-slate-800 bg-slate-900/65 px-3 py-2">
                            <p className="text-xs font-bold uppercase tracking-[0.12em] text-cyan-200/85">
                              {formatDate(event.localDate)}
                            </p>
                            <p className="mt-1 text-sm font-semibold text-slate-300">
                              {formatTime(event.localDate, event.localTime)}
                            </p>
                          </div>
                          <div>
                            <h3 className="text-base font-semibold text-slate-50 md:text-lg">
                              {event.name}
                            </h3>
                            <div className="mt-2 flex flex-wrap items-center gap-2 text-xs font-medium text-slate-400">
                              <span>{event.venue}</span>
                              {isSaved ? (
                                <>
                                  <span aria-hidden="true">/</span>
                                  <span className="font-semibold text-cyan-200">Saved</span>
                                </>
                              ) : null}
                            </div>
                          </div>
                          <div className="flex flex-wrap gap-2 md:justify-end">
                            <button
                              type="button"
                              onClick={() => toggleSavedEvent(event.id)}
                              className={`rounded-full border px-3 py-2 text-sm font-semibold transition ${
                                isSaved
                                  ? "border-cyan-200 bg-cyan-300/15 text-cyan-100"
                                  : "border-slate-700 text-slate-300 hover:border-cyan-300/60 hover:text-cyan-100"
                              }`}
                            >
                              {isSaved ? "Saved" : isShared ? "Save to mine" : "Save"}
                            </button>
                            <a
                              href={event.url}
                              target="_blank"
                              rel="noreferrer"
                              className="rounded-full border border-amber-300/35 px-3 py-2 text-sm font-semibold text-amber-300 transition hover:border-amber-200 hover:text-amber-200"
                            >
                              View tickets
                            </a>
                          </div>
                        </div>
                    </div>
                      );
                    })}
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
