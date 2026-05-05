import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { tmpdir } from "node:os";

const CACHE_DIR = join(tmpdir(), "indy-concert-shared-lists");
const KV_REST_API_URL = process.env.KV_REST_API_URL;
const KV_REST_API_TOKEN = process.env.KV_REST_API_TOKEN;
const TTL_SECONDS = 60 * 60 * 24 * 90;

export function createShareId() {
  return randomBytes(6).toString("base64url");
}

function canUseKv() {
  return Boolean(KV_REST_API_URL && KV_REST_API_TOKEN);
}

export async function saveSharedList(id: string, eventIds: string[]) {
  const payload = JSON.stringify({ eventIds, createdAt: new Date().toISOString() });

  if (canUseKv()) {
    const response = await fetch(`${KV_REST_API_URL}/set/shared-list:${id}/${encodeURIComponent(payload)}?EX=${TTL_SECONDS}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${KV_REST_API_TOKEN}`
      }
    });
    if (!response.ok) {
      throw new Error(`Shared list storage failed: ${response.status}`);
    }
    return;
  }

  await mkdir(CACHE_DIR, { recursive: true });
  await writeFile(join(CACHE_DIR, `${id}.json`), payload, "utf-8");
}

export async function loadSharedList(id: string) {
  if (canUseKv()) {
    const response = await fetch(`${KV_REST_API_URL}/get/shared-list:${id}`, {
      headers: {
        Authorization: `Bearer ${KV_REST_API_TOKEN}`
      },
      next: { revalidate: 0 }
    });
    if (!response.ok) return null;
    const data = (await response.json()) as { result?: string | null };
    if (!data.result) return null;
    return JSON.parse(data.result) as { eventIds: string[]; createdAt: string };
  }

  try {
    const raw = await readFile(join(CACHE_DIR, `${id}.json`), "utf-8");
    return JSON.parse(raw) as { eventIds: string[]; createdAt: string };
  } catch {
    return null;
  }
}
