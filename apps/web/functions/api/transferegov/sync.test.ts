import { describe, expect, it, vi } from "vitest";
import { handleTransferegovSync } from "./sync.js";

describe("POST /api/transferegov/sync", () => {
  it("exige token no servidor", async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    const response = await handleTransferegovSync({ request: new Request("https://radar.test/api/transferegov/sync", { method: "POST" }) }, fetchImpl);
    expect(response.status).toBe(503);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("salva um lote limitado e continua do cursor salvo na próxima chamada", async () => {
    let syncState: Record<string, unknown> | null = null;
    const sourceUrls: URL[] = [];
    const fetchImpl = vi.fn<typeof fetch>().mockImplementation(async (input, init) => {
      const url = new URL(String(input));
      if (url.hostname === "db.example") {
        if (url.pathname.endsWith("/source_sync_state") && init?.method === "POST") {
          const body = JSON.parse(String(init.body)) as Record<string, unknown>;
          syncState = { ...syncState, ...body };
          return new Response(null, { status: 204 });
        }
        if (url.pathname.endsWith("/source_sync_state")) return Response.json(syncState ? [syncState] : []);
        return new Response(null, { status: 204 });
      }
      sourceUrls.push(url);
      return Response.json({ data: [], total_pages: 1, total_items: 0, page_number: 1, page_size: 200 });
    });
    const env = {
      SUPABASE_URL: "https://db.example",
      SUPABASE_SERVICE_ROLE_KEY: "service-role-only-on-server",
      TRANSFEREGOV_SYNC_TOKEN: "sync-secret",
    };
    const invoke = () => handleTransferegovSync({
      request: new Request("https://radar.test/api/transferegov/sync", { method: "POST", headers: { Authorization: "Bearer sync-secret" } }),
      env,
    }, fetchImpl);

    const first = await invoke();
    const firstBody = await first.json() as { status: string; cursor: { yearIndex: number }; coverage: { pagesRead: number } };
    const second = await invoke();
    const secondBody = await second.json() as { status: string; cursor: { yearIndex: number }; coverage: { pagesRead: number } };

    expect(first.status).toBe(200);
    expect(firstBody.status).toBe("partial");
    expect(firstBody.cursor.yearIndex).toBe(2);
    expect(secondBody.coverage.pagesRead).toBe(8);
    expect(sourceUrls).toHaveLength(8);
    expect(sourceUrls.slice(0, 4).map((url) => url.searchParams.get("ano_disponibilizacao"))).toEqual(["2026", "2026", "2025", "2025"]);
    expect(sourceUrls.slice(4, 8).map((url) => url.searchParams.get("ano_disponibilizacao"))).toEqual(["2024", "2024", "2023", "2023"]);
  });
});
