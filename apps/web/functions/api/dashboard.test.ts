import { describe, expect, it, vi } from "vitest";
import { handleDashboardRequest } from "./dashboard.js";

describe("GET /api/dashboard", () => {
  it("resume oportunidades e separa faixas de prazo confirmado", async () => {
    const urls: URL[] = [];
    const fetchImpl = vi.fn<typeof fetch>().mockImplementation(async (input, init) => {
      const url = new URL(String(input));
      urls.push(url);
      if (url.pathname.endsWith("/source_sync_state")) {
        return Response.json([{ status: "complete", coverage: { exhaustive: true }, last_succeeded_at: "2026-11-18T12:00:00.000Z", last_error: null }]);
      }
      expect(init?.method).toBe("HEAD");
      return new Response(null, { status: 200, headers: { "Content-Range": "0-0/5" } });
    });
    const response = await handleDashboardRequest({
      request: new Request("https://radar.test/api/dashboard"),
      env: { SUPABASE_URL: "https://db.example", SUPABASE_SERVICE_ROLE_KEY: "server-key" },
    }, fetchImpl);
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body).toMatchObject({ syncStatus: "complete", counts: { totalIdentified: 5, openConfirmed: 5, due3Days: 5, due7Days: 5, due15Days: 5, due30Days: 5, expired: 5, newThisWeek: 5 } });
    const bands = urls.filter((url) => url.pathname.endsWith("/opportunities") && url.searchParams.has("and")).map((url) => url.searchParams.get("and"));
    expect(bands).toHaveLength(4);
    expect(new Set(bands).size).toBe(4);
    expect(urls.filter((url) => url.searchParams.get("is_active") === "eq.true")
      .every((url) => url.searchParams.get("deadline_state") === "eq.open")).toBe(true);
  });

  it("não apresenta contagens fictícias sem configuração do banco", async () => {
    const response = await handleDashboardRequest({ request: new Request("https://radar.test/api/dashboard") });
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ error: expect.stringContaining("Supabase não configurado") });
  });
});
