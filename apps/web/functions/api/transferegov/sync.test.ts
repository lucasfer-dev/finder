import { describe, expect, it, vi } from "vitest";
import { handleTransferegovSync } from "./sync.js";

type ScanCursor = { baseYear: number; yearIndex: number; natureIndex: number; page: number; totalPages: number | null };
interface ScanState {
  cursor: ScanCursor | null;
  scanId: string | null;
  coverage: { pagesRead: number; pagesAvailable: number; yearsComplete: number[] };
  status: "idle" | "running" | "partial" | "complete" | "failed";
  claimed: boolean;
}
const ENV = {
  SUPABASE_URL: "https://db.example",
  SUPABASE_SERVICE_ROLE_KEY: "server-secret",
  TRANSFEREGOV_SYNC_TOKEN: "sync-secret",
};
const call = (fetchImpl: typeof fetch) => handleTransferegovSync({
  request: new Request("https://radar.test/api/transferegov/sync", {
    method: "POST", headers: { Authorization: "Bearer sync-secret" },
  }),
  env: ENV,
}, fetchImpl);

function createDbMock(options: {
  totalPages?: number;
  failOneSource?: boolean;
  records?: unknown[];
} = {}) {
  const state: ScanState = {
    cursor: null, scanId: null, coverage: { pagesRead: 0, pagesAvailable: 0, yearsComplete: [] },
    status: "idle", claimed: false,
  };
  const commits: Array<{ p_complete: boolean; p_rows: Array<{ deadline_state: string; source_data: { sourceAvailable: boolean } }>; p_coverage: ScanState["coverage"] }> = [];
  const sourceUrls: URL[] = [];
  let failOneSource = options.failOneSource ?? false;
  const fetchImpl = vi.fn<typeof fetch>().mockImplementation(async (input, init) => {
    const url = new URL(String(input));
    if (url.hostname === "db.example") {
      const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
      if (url.pathname.endsWith("/rpc/acquire_source_sync")) {
        if (state.claimed) return Response.json(null);
        state.claimed = true;
        if (state.status === "complete" || state.status === "idle") {
          state.cursor = null;
          state.coverage = { pagesRead: 0, pagesAvailable: 0, yearsComplete: [] };
          state.scanId = "00000000-0000-4000-8000-000000000001";
        }
        state.status = "running";
        return Response.json({ scanId: state.scanId, cursor: state.cursor, coverage: state.coverage });
      }
      if (url.pathname.endsWith("/rpc/commit_source_sync_batch")) {
        const commit = body as unknown as typeof commits[number] & { p_cursor: ScanCursor | null };
        commits.push(commit);
        state.cursor = commit.p_cursor;
        state.coverage = commit.p_coverage;
        state.status = commit.p_complete ? "complete" : "partial";
        state.claimed = false;
        return Response.json({ changed: commit.p_rows.length, deactivated: commit.p_complete ? 1 : 0 });
      }
      if (url.pathname.endsWith("/rpc/fail_source_sync")) {
        state.status = "failed";
        state.claimed = false;
        return Response.json(true);
      }
      throw new Error("Unexpected RPC " + url.pathname);
    }
    sourceUrls.push(url);
    if (failOneSource) {
      failOneSource = false;
      return new Response("invalid", { status: 400 });
    }
    return Response.json({
      data: options.records ?? [],
      total_pages: options.totalPages ?? 1,
      total_items: 0,
      page_number: Number(url.searchParams.get("pagina")),
      page_size: 200,
    });
  });
  return { fetchImpl, state, commits, sourceUrls };
}

describe("POST /api/transferegov/sync", () => {
  it("exige configuração do token no servidor", async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    const response = await handleTransferegovSync({
      request: new Request("https://radar.test/api/transferegov/sync", { method: "POST" }),
    }, fetchImpl);
    expect(response.status).toBe(503);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("nega execução simultânea quando o banco não concede o lease", async () => {
    const db = createDbMock();
    db.state.claimed = true;
    const response = await call(db.fetchImpl);
    expect(response.status).toBe(409);
    expect(db.sourceUrls).toHaveLength(0);
  });

  it("retoma quatro páginas por chamada e conclui a cobertura cumulativa", async () => {
    const db = createDbMock();
    const first = await call(db.fetchImpl);
    const second = await call(db.fetchImpl);
    const third = await call(db.fetchImpl);
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(third.status).toBe(200);
    expect(db.sourceUrls).toHaveLength(12);
    expect(db.commits).toHaveLength(3);
    expect(db.commits.map((c) => c.p_complete)).toEqual([false, false, true]);
    expect(db.commits.map((c) => c.p_coverage.pagesRead)).toEqual([4, 8, 12]);
    expect(db.commits.map((c) => c.p_coverage.pagesAvailable)).toEqual([4, 8, 12]);
    expect(db.state.status).toBe("complete");
    expect(db.sourceUrls.slice(0, 4).map((url) => url.searchParams.get("ano_disponibilizacao")))
      .toEqual(["2026", "2026", "2025", "2025"]);
  });

  it("não grava resultados nem avança cursor após falha e pode retomar", async () => {
    const db = createDbMock({ failOneSource: true });
    const failed = await call(db.fetchImpl);
    expect(failed.status).toBe(502);
    expect(db.commits).toHaveLength(0);
    expect(db.state.status).toBe("failed");
    const recovered = await call(db.fetchImpl);
    expect(recovered.status).toBe(200);
    expect(db.commits).toHaveLength(1);
    expect(db.sourceUrls[0]?.searchParams.get("ano_disponibilizacao")).toBe("2026");
    expect(db.sourceUrls[1]?.searchParams.get("ano_disponibilizacao")).toBe("2026");
  });

  it("envia alterações de prazo expirado para reconciliação em vez de descartá-las", async () => {
    const program = {
      id_programa: 1, cod_programa: "0001", ano_programa: "2026", ano_disponibilizacao: "2026",
      nome_programa: "Programa retificado", desc_orgao_sup_programa: "Órgão",
      orgao_executor: null, sit_programa: "DISPONIBILIZADO",
      data_disponibilizacao: "2026-01-01",
      dt_prog_ini_receb_prop: "2026-01-01", dt_prog_fim_receb_prop: "2026-11-13",
      natureza_juridica_programa: "Organização da Sociedade Civil", uf_programa: "RJ",
      chamamento_projeto: "SIM", qualificacao_proposta: "Proposta Voluntária",
      criterios_de_selecao: "", descricao: "",
    };
    const db = createDbMock({ records: [program] });
    const response = await call(db.fetchImpl);
    expect(response.status).toBe(200);
    expect(db.commits[0]?.p_rows).toEqual(expect.arrayContaining([
      expect.objectContaining({ deadline_state: "expired", source_data: expect.objectContaining({ sourceAvailable: true }) }),
    ]));
    expect(db.commits[0]?.p_complete).toBe(false);
  });

  it("só solicita retirada de registros ausentes quando a varredura termina", async () => {
    const db = createDbMock({ records: [] });
    await call(db.fetchImpl);
    expect(db.commits[0]?.p_complete).toBe(false);
    await call(db.fetchImpl);
    await call(db.fetchImpl);
    expect(db.commits[2]?.p_complete).toBe(true);
  });
});
