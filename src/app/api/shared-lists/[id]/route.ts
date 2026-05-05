import { loadSharedList } from "@/lib/sharedLists";

export const runtime = "nodejs";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
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
}
