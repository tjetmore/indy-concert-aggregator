import { loadSharedList } from "@/lib/sharedLists";

export const runtime = "nodejs";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    const list = await loadSharedList(id);

    if (!list) {
      return new Response(JSON.stringify({ error: "Shared list not found" }), {
        status: 404,
        headers: { "content-type": "application/json" }
      });
    }

    return new Response(JSON.stringify(list), {
      headers: { "content-type": "application/json" }
    });
  } catch (error) {
    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : "Unable to load shared list"
      }),
      {
        status: 500,
        headers: { "content-type": "application/json" }
      }
    );
  }
}
