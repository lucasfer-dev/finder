import { describe, expect, it, vi } from "vitest";
import { handleOpportunitiesRequest } from "./opportunities.js";

describe("GET /api/opportunities", () => {
  it("aplica filtros seguros e retorna só os registros persistidos com prazo de hoje ou futuro", async () => {
    const urls: URL[] = [];
    const fetchImpl = vi.fn<typeof fetch>().mockImplementation(async (input) => {
      urls.push(new URL(String(input)));
      if (urls.length === 1) {
        return new Response(JSON.stringify([{
          source_id: "transferegov-discricionarias",
          opportunity_id: "transferegov:1:0001",
          title: "Programa de inovação",
          source_name: "Transferegov.br",
          source_url: "https://api-publica.transferegov.gestao.gov.br/discricionarias/docs",
          official_url: "https://api-publica.transferegov.gestao.gov.br/discricionarias/todos-programas?id_programa=1",
          program_code: "0001",
          agency: "Ministério da Ciência",
          executing_agency: null,
          legal_nature: "Organização da Sociedade Civil",
          proposal_start: "2026-11-01",
          deadline: "2026-12-01",
          deadline_state: "open",
          deadline_status: "confirmed",
          public_call_state: "yes",
          eligibility_status: "not_assessed",
          eligibility_criteria: null,
          first_seen_at: "2026-11-18T12:00:00.000Z",
          last_seen_at: "2026-11-18T12:00:00.000Z",
          updated_at: "2026-11-18T12:00:00.000Z",
        }]), { status: 200, headers: { "Content-Range": "0-49/1" } });
      }
      return new Response(JSON.stringify([{ status: "complete", coverage: { exhaustive: true }, last_succeeded_at: "2026-11-18T12:00:00.000Z", last_error: null }]), { status: 200 });
    });
    const response = await handleOpportunitiesRequest({
      request: new Request("https://radar.test/api/opportunities?q=inovação&agency=Ciência&institution=vielas"),
      env: { SUPABASE_URL: "https://db.example", SUPABASE_SERVICE_ROLE_KEY: "server-secret" },
    }, fetchImpl);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ syncStatus: "complete", total: 1, opportunities: [{ title: "Programa de inovação", eligibilityStatus: "not_assessed" }] });
    expect(urls[0]?.searchParams.get("legal_nature")).toBe("eq.Organização da Sociedade Civil");
    expect(urls[0]?.searchParams.get("agency")).toBe("ilike.*Ciência*");
    expect(urls[0]?.searchParams.get("or")).toContain("inovação");
    expect(urls[0]?.searchParams.get("deadline_state")).toBe("eq.open");
    expect(new Headers(fetchImpl.mock.calls[0]?.[1]?.headers).get("apikey")).toBe("server-secret");
  });

  it("não revela dados quando o Supabase não está configurado", async () => {
    const response = await handleOpportunitiesRequest({ request: new Request("https://radar.test/api/opportunities") });
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ error: expect.stringContaining("Supabase não configurado") });
  });
});
