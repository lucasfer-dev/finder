import { describe, expect, it, vi } from "vitest";
import { handleTransferegovRequest } from "./transferegov.js";
import type { TransferegovSearchResult } from "@radar/collectors/transferegov";

class MemoryCache {
  entries = new Map<string, Response>();

  async match(key: Request | string): Promise<Response | undefined> {
    const entry = this.entries.get(String(key));
    return entry?.clone();
  }

  async put(key: Request | string, response: Response): Promise<void> {
    this.entries.set(String(key), response.clone());
  }
}

const result: TransferegovSearchResult = {
  opportunities: [],
  coverage: {
    yearsInScope: [2026, 2025],
    yearsComplete: [2026, 2025],
    pagesRead: 4,
    pagesAvailable: 4,
    exhaustive: true,
    partialReasons: [],
  },
};

function request(): Request {
  return new Request("https://radar.test/api/transferegov");
}

describe("Cloudflare Pages Function /api/transferegov", () => {
  it("retorna resultado real do loader e serve a próxima chamada do cache", async () => {
    const cache = new MemoryCache();
    const load = vi.fn().mockResolvedValue(result);
    const first = await handleTransferegovRequest({ request: request(), cache }, load);
    const second = await handleTransferegovRequest({ request: request(), cache }, load);

    expect(first.status).toBe(200);
    expect(first.headers.get("X-Radar-Cache")).toBe("miss");
    expect(second.status).toBe(200);
    expect(second.headers.get("X-Radar-Cache")).toBe("hit");
    expect(load).toHaveBeenCalledTimes(1);
    expect(await second.json()).toMatchObject({ source: "Transferegov.br", coverage: { exhaustive: true } });
  });

  it("preserva a resposta parcial com advertência de cobertura", async () => {
    const partialResult = {
      ...result,
      coverage: { ...result.coverage, exhaustive: false, partialReasons: ["2025/OSC: cobertura limitada"] },
    };
    const response = await handleTransferegovRequest({ request: request(), cache: new MemoryCache() }, async () => partialResult);
    const body = await response.json() as { coverage: { exhaustive: boolean; partialReasons: string[] } };
    expect(response.status).toBe(200);
    expect(body.coverage.exhaustive).toBe(false);
    expect(body.coverage.partialReasons).toEqual(["2025/OSC: cobertura limitada"]);
    expect(response.headers.get("Cache-Control")).toContain("s-maxage=300");
  });

  it("responde 502 quando a API falha sem cache anterior", async () => {
    const response = await handleTransferegovRequest(
      { request: request(), cache: new MemoryCache() },
      async () => { throw new Error("Transferegov respondeu HTTP 400"); },
    );
    expect(response.status).toBe(502);
    expect(await response.json()).toMatchObject({ error: "Transferegov respondeu HTTP 400" });
  });

  it("serve o último snapshot marcado como desatualizado se a renovação falhar", async () => {
    const cache = new MemoryCache();
    const staleKey = "https://radar.test/__radar-cache/transferegov/v2/stale";
    await cache.put(staleKey, Response.json({ source: "Transferegov.br", updatedAt: "2026-11-18T10:00:00.000Z" }));
    const response = await handleTransferegovRequest(
      { request: request(), cache },
      async () => { throw new Error("origem indisponível"); },
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("X-Radar-Cache")).toBe("stale");
    expect(await response.json()).toMatchObject({ cacheStatus: "stale", warning: "Consulta atual falhou: origem indisponível" });
  });
});
