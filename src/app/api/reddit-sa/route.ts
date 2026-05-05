import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

export const runtime = "nodejs";

const CACHE_DIR = join(process.cwd(), ".next", "cache", "reddit-sa");
const TTL_MS = 7 * 24 * 60 * 60 * 1000;
const USER_AGENT = "indy-concert-aggregator/1.0 (contact: you@example.com)";
const MUSIC_SUBREDDITS = new Set([
  "concerts",
  "livemusic",
  "festival",
  "festivals",
  "setlists",
  "concertphotography",
  "music",
  "listentothis",
  "musicnews",
  "letstalkmusic",
  "musicnerds",
  "popheads",
  "indieheads",
  "hiphopheads",
  "rap",
  "hiphop",
  "rnb",
  "hiphopheads",
  "rap",
  "hiphop",
  "popheads",
  "indieheads",
  "alternativerock",
  "metal",
  "metalcore",
  "deathmetal",
  "progmetal",
  "hardcore",
  "punk",
  "postrock",
  "electronicmusic",
  "edm",
  "house",
  "techno",
  "trance",
  "dubstep",
  "dnb",
  "jazz",
  "classicalmusic",
  "ambientmusic",
  "shoegaze",
  "folk",
  "country",
  "bluegrass",
  "rnb"
]);

const EXTRA_QUERIES = [
  "saw {artist} live",
  "{artist} tour review",
  "{artist} live review",
  "{artist} concert review",
  "{artist} live show",
  "{artist} setlist",
  "{artist} tour setlist",
  "{artist} opening act",
  "{artist} headliner",
  "how is {artist} live",
  "is {artist} good live"
];

type Thread = {
  title: string;
  subreddit?: string;
  url?: string;
  score?: number;
  createdUtc?: number;
  commentSnippets?: string[];
};

type ResponseShape = {
  artist: string;
  tourYearConsidered: string;
  tier: "S-tier" | "A-tier" | "B-tier" | "worse" | "unrated";
  confidence: "High" | "Medium" | "Low";
  consensusSummary: string[];
  evidenceQuality: string[];
  finalVerdict: string;
  evidenceCount: number;
  topThreads: Array<{ title: string; subreddit?: string; url?: string }>;
};

function normalizeKey(artist: string, context: string) {
  return `${artist} ${context}`.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-");
}

async function readCache(key: string) {
  try {
    const raw = await readFile(join(CACHE_DIR, `${key}.json`), "utf-8");
    const parsed = JSON.parse(raw) as { timestamp: number; data: ResponseShape };
    if (Date.now() - parsed.timestamp > TTL_MS) return null;
    if (!Array.isArray(parsed.data.consensusSummary) || !parsed.data.finalVerdict) {
      return null;
    }
    return parsed.data;
  } catch {
    return null;
  }
}

async function writeCache(key: string, data: ResponseShape) {
  await mkdir(CACHE_DIR, { recursive: true });
  const payload = JSON.stringify({ timestamp: Date.now(), data });
  await writeFile(join(CACHE_DIR, `${key}.json`), payload, "utf-8");
}

async function fetchReddit(query: string) {
  const url = `https://www.reddit.com/search.json?q=${encodeURIComponent(query)}&sort=relevance&limit=10`;
  const response = await fetch(url, {
    headers: {
      "user-agent": USER_AGENT,
      Accept: "application/json"
    },
    next: { revalidate: 60 * 60 }
  });
  if (!response.ok) return [];
  const data = (await response.json()) as {
    data?: { children?: Array<{ data?: any }> };
  };
  return (
    data.data?.children
      ?.map((child) => {
        const item = child.data;
        if (!item?.title) return null;
        return {
          title: item.title,
          subreddit: item.subreddit,
          url: item.url ?? (item.permalink ? `https://www.reddit.com${item.permalink}` : undefined),
          score: item.score,
          createdUtc: item.created_utc
        } as Thread;
      })
      .filter((item): item is Thread => Boolean(item)) ?? []
  );
}

async function fetchRedditInSubreddit(query: string, subreddit: string) {
  const url = `https://www.reddit.com/r/${subreddit}/search.json?q=${encodeURIComponent(query)}&restrict_sr=1&sort=relevance&limit=10`;
  const response = await fetch(url, {
    headers: {
      "user-agent": USER_AGENT,
      Accept: "application/json"
    },
    next: { revalidate: 60 * 60 }
  });
  if (!response.ok) return [];
  const data = (await response.json()) as {
    data?: { children?: Array<{ data?: any }> };
  };
  return (
    data.data?.children
      ?.map((child) => {
        const item = child.data;
        if (!item?.title) return null;
        return {
          title: item.title,
          subreddit: item.subreddit,
          url: item.url ?? (item.permalink ? `https://www.reddit.com${item.permalink}` : undefined),
          score: item.score,
          createdUtc: item.created_utc
        } as Thread;
      })
      .filter((item): item is Thread => Boolean(item)) ?? []
  );
}

function normalizeComment(text: string) {
  return text
    .replace(/\s+/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, "\"")
    .replace(/&#039;/g, "'")
    .trim();
}

async function fetchTopComments(url?: string) {
  if (!url || !url.includes("reddit.com")) return [];
  const commentsUrl = url.endsWith(".json") ? url : `${url}.json`;
  const response = await fetch(`${commentsUrl}?limit=5&sort=top`, {
    headers: {
      "user-agent": USER_AGENT,
      Accept: "application/json"
    },
    next: { revalidate: 60 * 60 }
  });
  if (!response.ok) return [];
  const data = (await response.json()) as Array<{ data?: { children?: Array<{ data?: any }> } }>;
  const comments = data?.[1]?.data?.children ?? [];
  return comments
    .map((child) => child?.data)
    .filter((comment) => comment?.body && !comment?.stickied)
    .slice(0, 3)
    .map((comment) => normalizeComment(comment.body).slice(0, 160));
}

function dedupeThreads(threads: Thread[]) {
  const seen = new Set<string>();
  const unique: Thread[] = [];
  threads.forEach((thread) => {
    const key = thread.url ?? `${thread.title}-${thread.subreddit ?? ""}`;
    if (seen.has(key)) return;
    seen.add(key);
    unique.push(thread);
  });
  return unique;
}

async function fetchEvidence(artist: string) {
  const queries = [
    `"${artist}" live show`,
    `"${artist}" concert review`,
    `"${artist}" tour live`,
    `"${artist}" setlist`,
    `"${artist}" live performance`,
    `"${artist}" "best show"`,
    `"${artist}" "blew me away" live`
  ];
  for (const q of EXTRA_QUERIES) {
    queries.push(q.replace("{artist}", `"${artist}"`));
  }
  const results: Thread[] = [];
  for (const query of queries) {
    results.push(...(await fetchReddit(query)));
  }
  const subredditQueries = [
    `"${artist}" live`,
    `"${artist}" tour review`,
    `"${artist}" concert review`,
    `saw "${artist}" live`,
    `how is "${artist}" live`
  ];
  for (const sub of MUSIC_SUBREDDITS) {
    for (const q of subredditQueries) {
      results.push(...(await fetchRedditInSubreddit(q, sub)));
    }
  }
  const filtered = results.filter(
    (thread) =>
      !/iglives/i.test(thread.subreddit ?? "") &&
      !/instagram live/i.test(thread.title)
  );
  const musicOnly = filtered.filter((thread) =>
    thread.subreddit ? MUSIC_SUBREDDITS.has(thread.subreddit.toLowerCase()) : false
  );
  const pool = musicOnly.length > 0 ? musicOnly : filtered;
  const unique = dedupeThreads(pool).slice(0, 30);
  for (const thread of unique) {
    thread.commentSnippets = (await fetchTopComments(thread.url)).slice(0, 4);
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  return unique;
}

function buildPrompt(artist: string, context: string, threads: Thread[]) {
  const lines = threads.map((t, i) => {
    const comments = t.commentSnippets?.length
      ? ` | top comments: ${t.commentSnippets.join(" || ")}`
      : "";
    return `${i + 1}. ${t.title} | r/${t.subreddit ?? "unknown"} | score:${t.score ?? 0} | ${t.url ?? ""}${comments}`;
  });
  return `You are researching whether seeing ${artist} live in ${context || "the current/relevant tour era"} would be considered S-tier, A-tier, B-tier, worse, or unrated by Reddit standards.

Use Reddit-first evidence, prioritizing:
1. Artist-specific subreddits
2. r/Music, r/Concerts, r/LiveMusic, r/festivals, r/indieheads, r/hiphopheads, r/popheads, r/metal, etc. as relevant
3. Threads asking "best live bands," "worst live shows," "worth seeing live," "concert reviews," "tour reviews," "setlist," "vocals live," "stage presence," "crowd energy," and "production"
4. Recent comments from the current tour, but also note if the artist has a long-term reputation that differs from the current tour

Search Reddit and summarize the consensus using this tier scale:

S-tier:
Reddit repeatedly describes them as one of the best live acts, must-see, transcendent, unforgettable, "worth traveling for," or consistently amazing even for casual fans. Strong evidence across multiple threads/subreddits.

A-tier:
Very strong live reputation. Fans and many non-fans say the show is great, polished, high-energy, emotionally powerful, or highly worth seeing. Some caveats may exist, but consensus is clearly positive.

B-tier:
Generally good or enjoyable live, especially for fans, but not commonly described as elite. Comments may say "solid," "fun," "worth it if you like them," or note inconsistency, limited production, weaker vocals, short sets, low energy, or dependence on nostalgia.

Worse:
Meaningfully mixed or negative Reddit consensus. Common complaints include poor vocals, low effort, bad sound, lateness, short sets, weak crowd engagement, overreliance on backing tracks, awkward pacing, or "not worth the price."

Unrated / insufficient evidence:
Not enough Reddit discussion, too niche, too few recent reports, or evidence is too conflicting to assign a confident tier.

For ${artist}, answer in this format:

Artist:
Tour/year considered:
Likely Reddit tier:
Confidence: High / Medium / Low

Consensus summary:
- What Reddit generally says
- What fans praise
- What people criticize
- Whether casual fans/non-fans would likely enjoy it
- Whether current tour reports differ from older reputation

Evidence quality:
- Number and type of relevant Reddit discussions found
- Whether evidence is recent
- Whether comments come mostly from superfans or broader music/concert communities

Final verdict:
Give a clear tier: S-tier, A-tier, B-tier, worse, or unrated.
Then explain in 2-4 sentences why.

Use ONLY the evidence below. Do not invent Reddit threads or quotes.

Evidence:
${lines.join("\n")}`;
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const artist = searchParams.get("artist")?.trim();
  const context = searchParams.get("context")?.trim() ?? "";
  if (!artist) {
    return new Response(JSON.stringify({ error: "Missing artist param" }), {
      status: 400,
      headers: { "content-type": "application/json" }
    });
  }

  console.log("[reddit-sa] artist=", artist);

  const key = normalizeKey(artist, context);
  const forceRefresh = searchParams.get("refresh") === "1";
  const cached = await readCache(key);
  if (cached && !forceRefresh) {
    console.log("[reddit-sa] cache hit", artist);
    return new Response(JSON.stringify(cached), {
      headers: { "content-type": "application/json" }
    });
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return new Response(JSON.stringify({ error: "Missing OPENAI_API_KEY" }), {
      status: 500,
      headers: { "content-type": "application/json" }
    });
  }

  const evidence = await fetchEvidence(artist);
  console.log("[reddit-sa] evidence", evidence.length);
  const prompt = buildPrompt(artist, context, evidence);

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "content-type": "application/json"
    },
    body: JSON.stringify({
      model: "gpt-4.1-mini",
      input: [
        {
          role: "system",
          content:
            "You are a careful concert-research assistant. Use ONLY the provided Reddit evidence. " +
            "Do not invent quotes, threads, or consensus. If evidence is thin or conflicting, mark the artist unrated. " +
            "Output valid JSON only."
        },
        { role: "user", content: prompt }
      ],
      text: {
        format: {
          type: "json_schema",
          name: "reddit_sa_tier",
          strict: true,
          schema: {
            type: "object",
            properties: {
              artist: { type: "string" },
              tourYearConsidered: { type: "string" },
              tier: { type: "string", enum: ["S-tier", "A-tier", "B-tier", "worse", "unrated"] },
              confidence: { type: "string", enum: ["High", "Medium", "Low"] },
              consensusSummary: { type: "array", items: { type: "string" }, minItems: 3, maxItems: 5 },
              evidenceQuality: { type: "array", items: { type: "string" }, minItems: 2, maxItems: 4 },
              finalVerdict: { type: "string" },
              evidenceCount: { type: "number" },
              topThreads: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    title: { type: "string" },
                    subreddit: { type: "string" },
                    url: { type: "string" }
                  },
                  required: ["title", "subreddit", "url"],
                  additionalProperties: false
                },
                minItems: 0,
                maxItems: 10
              }
            },
            required: [
              "artist",
              "tourYearConsidered",
              "tier",
              "confidence",
              "consensusSummary",
              "evidenceQuality",
              "finalVerdict",
              "evidenceCount",
              "topThreads"
            ],
            additionalProperties: false
          }
        }
      },
      temperature: 0.2,
      max_output_tokens: 1600
    })
  });

  if (!response.ok) {
    const text = await response.text();
    console.log("[reddit-sa] openai error", response.status, text.slice(0, 300));
    return new Response(JSON.stringify({ error: `OpenAI error: ${text}` }), {
      status: 500,
      headers: { "content-type": "application/json" }
    });
  }

  const data = (await response.json()) as {
    output_parsed?: ResponseShape | null;
    output_text?: string;
    output?: Array<{ content?: Array<{ text?: string; parsed?: ResponseShape }> }>;
  };
  let parsed =
    data.output_parsed ??
    data.output?.[0]?.content?.[0]?.parsed ??
    null;
  if (!parsed) {
    const text =
      (data as { output_text?: string }).output_text ??
      (data as { output?: Array<{ content?: Array<{ text?: string }> }> }).output?.[0]?.content?.[0]?.text ??
      "";
    if (text) {
      console.log("[reddit-sa] output_text length", text.length);
      console.log("[reddit-sa] output_text", text.slice(0, 800));
    }
    if (text) {
      try {
        parsed = JSON.parse(text) as ResponseShape;
      } catch {
        try {
          const normalized = text.replace(/[\r\n]+/g, "\\n");
          parsed = JSON.parse(normalized) as ResponseShape;
        } catch (error) {
          console.log("[reddit-sa] json_parse_failed", (error as Error).message);
          parsed = null;
        }
      }
    }
  }
  console.log("[reddit-sa] parsed tier", parsed?.tier);

  const safeThreads = evidence.map((t) => ({
    title: t.title,
    subreddit: t.subreddit,
    url: t.url
  }));

  const result: ResponseShape = {
    artist,
    tourYearConsidered: parsed?.tourYearConsidered ?? context,
    tier: parsed?.tier ?? "unrated",
    confidence: parsed?.confidence ?? "Low",
    consensusSummary: parsed?.consensusSummary ?? [
      "Insufficient Reddit evidence was found to assign a confident tier."
    ],
    evidenceQuality: parsed?.evidenceQuality ?? [
      `Found ${evidence.length} potentially relevant Reddit discussions.`,
      "Evidence was not strong enough for a confident tier."
    ],
    finalVerdict:
      parsed?.finalVerdict ??
      "Unrated. There was not enough reliable Reddit evidence to rate this live show confidently.",
    evidenceCount: parsed?.evidenceCount ?? evidence.length,
    topThreads: parsed?.topThreads?.length ? parsed.topThreads : safeThreads
  };

  await writeCache(key, result);

  return new Response(JSON.stringify(result), {
    headers: { "content-type": "application/json" }
  });
}
