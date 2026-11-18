import { describe, expect, it, vi } from "vitest";
import { handleTransferegovSync } from "./sync.js";

const env = {
  SUPABASE_URL: "https://db.example",
  SUPABASE_SERVICE_ROLE_KEY: "service-role-only-on-server",
  TRANSFEREGOV_SYNC_TOKEN: "sync-secret",
};
const endpoint = "https://radar.test/api/transferegov/sync";
function request() {
  return new Request(endpoint, { method: "POST", headers: { Authorization: "Bearer sync-secret" } });
}
function sourcePage() {
  return { data: [], total_pages: 1, total_items: 0, page_number: 1, page_size: 200 };
}

describe("POST /api/transferegov/sync", () => {
  it("exige token antes de consultar o banco ou a origem", async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    const response = await handleTransferegovSync({ request: new Request(endpoint, { method: "POST" }) }, fetchImpl);
    expect(response.status).toBe(503);
    expect(fetchImpl).not.toHaveBeenCalled();
    const unauthorized = await handleTransferegovSync({ request: new Request(endpoint, { method: "POST" }), env }, fetchImpl);
    expect(unauthorized.status).toBe(401);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("retoma o cursor, confirma a transação e mantém o identificador de varredura", async () => {
    let savedCursor: object | null = null;
    let coverage: object = {};
    const sourceUrls: URL[] = [];
    const rpcCalls: string[] = [];
    const fetchImpl = vi.fn<typeof fetch>().mockImplementation(async (input, init) => {
      const url = new URL(String(input));
      if (url.hostname === "db.example") {
        const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
        rpcCalls.push(url.pathname);
        if (url.pathname.endsWith("/acquire_source_sync")) {
          return Response.json({ scanId: "scan-1", cursor: savedCursor, coverage });
        }
        if (url.pathname.endsWith("/commit_source_sync_batch")) {
          savedCursor = body.p_cursor as object | null;
          coverage = body.p_coverage as object;
          expect(body.p_lease_owner).toBeTruthy();
          expect(body.p_rows).toEqual([]);
          return Response.json({ changed: 0, deactivated: 0, scanId: "scan-1" });
        }
        throw Error("RPC unexpected");
      }
      sourceUrls.push(url);
      return Response.json(sourcePage());
    });
    const first = await handleTransferegovSync({ request: request(), env }, fetchImpl);
    const firstBody = await first.json() as { status: string; cursor: { yearIndex: number }; coverage: { pagesRead: number } };
    const second = await handleTransferegovSync({ request: request(), env }, fetchImpl);
    const secondBody = await second.json() as { status: string; coverage: { pagesRead: number } };
    expect(first.status).toBe(200);
    expect(firstBody.status).toBe("partial");
    expect(firstBody.cursor.yearIndex).toBe(2);
    expect(second.status).toBe(200);
    expect(secondBody.coverage.pagesRead).toBe(8);
    expect(sourceUrls).toHaveLength(8);
    expect(rpcCalls.filter((path) => path.endsWith("/commit_source_sync_batch"))).toHaveLength(2);
  });

  it("recusa execução quando o banco informa lease ocupado", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(Response.json(null));
    const response = await handleTransferegovSync({ request: request(), env }, fetchImpl);
    expect(response.status).toBe(409);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("preserva cursor e libera lease após falha da fonte", async () => {
    const requests: string[] = [];
    const fetchImpl = vi.fn<typeof fetch>().mockImplementation(async (input) => {
      const url = new URL(String(input));
      requests.push(url.pathname);
      if (url.pathname.endsWith("/acquire_source_sync")) {
        return Response.json({ scanId: "scan-1", cursor: null, coverage: {} });
      }
      if (url.pathname.endsWith("/fail_source_sync")) return Response.json(true);
      return new Response("bad", { status: 400 });
    });
    const response = await handleTransferegovSync({ request: request(), env }, fetchImpl);
    expect(response.status).toBe(502);
    expect(requests).toContain("/rest/v1/rpc/fail_source_sync");
    expect(requests).not.toContain("/rest/v1/rpc/commit_source_sync_batch");
  });
});
