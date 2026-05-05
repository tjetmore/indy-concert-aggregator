import { createShareId, saveSharedList } from "@/lib/sharedLists";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { eventIds?: unknown };
    const eventIds = Array.isArray(body.eventIds)
      ? body.eventIds.filter((id): id is string => typeof id === "string" && id.length > 0)
      : [];

    if (eventIds.length === 0) {
      return new Response(JSON.stringify({ error: "No saved events to share" }), {
        status: 400,
        headers: { "content-type": "application/json" }
      });
    }

    const id = createShareId();
    await saveSharedList(id, Array.from(new Set(eventIds)));

    return new Response(JSON.stringify({ id }), {
      headers: { "content-type": "application/json" }
    });
  } catch (error) {
    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : "Unable to create shared list"
      }),
      {
        status: 500,
        headers: { "content-type": "application/json" }
      }
    );
  }
}
