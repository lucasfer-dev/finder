import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import {
  buildOfficialApiUrl,
  classifyDeadline,
  fetchOpenTransferegovPrograms,
  fetchTransferegovSlice,
  normalizeOpenTransferegovPrograms,
  normalizeTransferegovObservedPrograms,
  normalizeTransferegovProgram,
  type TransferegovPage,
  type TransferegovProgram,
} from "./transferegov.js";

const fixture = JSON.parse(readFileSync(fileURLToPath(new URL("./fixtures/transferegov-programs-2026.json", import.meta.url)), "utf8")) as TransferegovPage;
const openProgram = fixture.data.find((item) => item.id_programa === 56385)!;
const expiredProgram = fixture.data.find((item) => item.id_programa === 56851)!;
const today = "2026-11-18";
const fetchedAt = "2026-11-18T12:00:00.000Z";

function page(data: TransferegovProgram[], totalPages = 1): TransferegovPage {
  return { data, total_pages: totalPages, total_items: data.length, page_number: 1, page_size: 200 };
}

describe("adaptador Transferegov", () => {
  it("encontra um programa publicado no ano anterior quando o prazo ainda está aberto", () => {
    // Cenário temporal: aplica a regra a um registro oficial da fixture com ano de disponibilização anterior.
    // A alteração é exclusiva deste teste; não é uma oportunidade apresentada no produto.
    const priorYearScenario = { ...openProgram, ano_disponibilizacao: "2025" };
    const normalized = normalizeTransferegovProgram(priorYearScenario, today, fetchedAt);
    expect(normalized.deadlineState).toBe("open");
    expect(normalized.deadlineStatus).toBe("confirmed");
    expect(priorYearScenario.ano_disponibilizacao).toBe("2025");
  });

  it("classifica prazo expirado e não o inclui entre as oportunidades abertas", () => {
    expect(classifyDeadline(expiredProgram, today)).toEqual({ state: "expired", verification: "confirmed" });
    expect(normalizeOpenTransferegovPrograms([expiredProgram], today, fetchedAt)).toEqual([]);
  });

  it("marca como desconhecido um prazo que não tem as duas datas confirmadas", () => {
    const missingDates = { ...openProgram, dt_prog_fim_receb_prop: null };
    expect(classifyDeadline(missingDates, today)).toEqual({ state: "unknown", verification: "unknown" });
    const normalized = normalizeTransferegovProgram(missingDates, today, fetchedAt);
    expect(normalized.deadline).toBeNull();
    expect(normalized.deadlineStatus).toBe("unknown");
    expect(normalized.deadlineState).toBe("unknown");
  });

  it("mantém chamamento, natureza jurídica e elegibilidade como atributos distintos", () => {
    const result = normalizeTransferegovProgram(openProgram, today, fetchedAt);
    expect(result.publicCallState).toBe("no");
    expect(result.naturezaJuridica).toBe("Organização da Sociedade Civil");
    expect(result.eligibilityStatus).toBe("not_assessed");
    const unknownCall = normalizeTransferegovProgram({ ...openProgram, chamamento_projeto: null }, today, fetchedAt);
    expect(unknownCall.publicCallState).toBe("unknown");
  });

  it("restringe os resultados à natureza jurídica alvo sem declarar elegibilidade", () => {
    const otherAudience = { ...openProgram, natureza_juridica_programa: "Administração Pública Estadual" };
    expect(normalizeOpenTransferegovPrograms([otherAudience], today, fetchedAt)).toEqual([]);
    const accepted = normalizeOpenTransferegovPrograms([openProgram], today, fetchedAt);
    expect(accepted[0]?.eligibilityStatus).toBe("not_assessed");
  });

  it("persiste registros expirados e retificados para desativação, sem expô-los como abertos", () => {
    const withdrawn = { ...openProgram, sit_programa: "CANCELADO" };
    const shortened = { ...openProgram, id_programa: 9876, dt_prog_fim_receb_prop: "2026-11-13" };
    const observed = normalizeTransferegovObservedPrograms([withdrawn, shortened], today, fetchedAt);
    expect(observed).toHaveLength(2);
    expect(observed.every((item) => !item.activeInSource)).toBe(true);
    expect(observed.find((item) => item.id.includes("9876"))?.deadlineState).toBe("expired");
    expect(normalizeOpenTransferegovPrograms([withdrawn, shortened], today, fetchedAt)).toHaveLength(0);
  });

  it("marca reabertura após retificação como fonte ativa, mantendo elegibilidade não verificada", () => {
    const reopened = { ...expiredProgram, dt_prog_fim_receb_prop: "2026-12-31" };
    const [item] = normalizeTransferegovObservedPrograms([reopened], today, fetchedAt);
    expect(item.activeInSource).toBe(true);
    expect(item.eligibilityStatus).toBe("not_assessed");
  });

  it("monta uma consulta técnica válida pelo id aceito na OpenAPI", () => {
    const url = new URL(buildOfficialApiUrl(56385));
    expect(url.origin).toBe("https://api-publica.transferegov.gestao.gov.br");
    expect(url.pathname).toBe("/discricionarias/todos-programas");
    expect(url.searchParams.get("id_programa")).toBe("56385");
    expect(url.searchParams.get("pagina")).toBe("1");
    expect(url.searchParams.get("tamanho_da_pagina")).toBe("200");
  });

  it("consulta o ano atual e os cinco anos anteriores, com paginação por grupos", async () => {
    const mockFetch = vi.fn<typeof fetch>().mockImplementation(async (input) => {
      const url = new URL(String(input));
      const priorYearScenario = { ...openProgram, ano_disponibilizacao: "2025" };
      return new Response(JSON.stringify(page(url.searchParams.get("ano_disponibilizacao") === "2025" ? [priorYearScenario] : [])), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });
    const result = await fetchOpenTransferegovPrograms({ today, fetchImpl: mockFetch, maxPagesPerQuery: 1 });
    const years = new Set(mockFetch.mock.calls.map(([input]) => new URL(String(input)).searchParams.get("ano_disponibilizacao")));
    expect(years).toEqual(new Set(["2026", "2025", "2024", "2023", "2022", "2021"]));
    expect(result.opportunities).toHaveLength(1);
    expect(result.opportunities[0]?.deadlineState).toBe("open");
    expect(result.coverage.yearsInScope).toEqual([2026, 2025, 2024, 2023, 2022, 2021]);
  });

  it("preserva resultados recebidos e sinaliza cobertura parcial quando há mais páginas que o limite", async () => {
    const mockFetch = vi.fn<typeof fetch>().mockImplementation(async (input) => {
      const url = new URL(String(input));
      const data = url.searchParams.get("ano_disponibilizacao") === "2026" && url.searchParams.get("natureza_juridica_programa") === openProgram.natureza_juridica_programa
        ? [openProgram]
        : [];
      return new Response(JSON.stringify(page(data, 4)), { status: 200, headers: { "Content-Type": "application/json" } });
    });
    const result = await fetchOpenTransferegovPrograms({ today, fetchImpl: mockFetch, lookbackYears: 0, maxPagesPerQuery: 1 });
    expect(result.opportunities).toHaveLength(1);
    expect(result.coverage.exhaustive).toBe(false);
    expect(result.coverage.pagesRead).toBe(2);
    expect(result.coverage.pagesAvailable).toBe(8);
    expect(result.coverage.partialReasons.some((reason) => reason.includes("cobertura limitada"))).toBe(true);
  });

  it("retoma a sincronização histórica do cursor sem reconsultar grupos concluídos", async () => {
    const visited: URL[] = [];
    const mockFetch = vi.fn<typeof fetch>().mockImplementation(async (input) => {
      const url = new URL(String(input));
      visited.push(url);
      return new Response(JSON.stringify(page([], 1)), { status: 200, headers: { "Content-Type": "application/json" } });
    });
    const first = await fetchTransferegovSlice({ today, maxPages: 1, fetchImpl: mockFetch });
    const second = await fetchTransferegovSlice({ today: "2027-01-03", cursor: first.cursor, maxPages: 1, fetchImpl: mockFetch });
    const third = await fetchTransferegovSlice({ today: "2027-01-03", cursor: second.cursor, maxPages: 1, fetchImpl: mockFetch });
    expect(first.cursor).toMatchObject({ yearIndex: 0, natureIndex: 1, page: 1 });
    expect(second.cursor).toMatchObject({ yearIndex: 1, natureIndex: 0, page: 1 });
    expect(visited[0]?.searchParams.get("ano_disponibilizacao")).toBe("2026");
    expect(visited[1]?.searchParams.get("ano_disponibilizacao")).toBe("2026");
    expect(visited[2]?.searchParams.get("ano_disponibilizacao")).toBe("2025");
    expect(third.result.coverage.yearsComplete).toEqual([2026]);
    expect(first.cursor?.baseYear).toBe(2026);
  });

  it("tenta novamente falhas temporárias e conclui a consulta", async () => {
    let calls = 0;
    const mockFetch = vi.fn<typeof fetch>().mockImplementation(async () => {
      calls += 1;
      if (calls === 1) return new Response("indisponível", { status: 503 });
      return new Response(JSON.stringify(page([])), { status: 200, headers: { "Content-Type": "application/json" } });
    });
    const result = await fetchOpenTransferegovPrograms({ today, fetchImpl: mockFetch, lookbackYears: 0, maxPagesPerQuery: 1 });
    expect(result.coverage.exhaustive).toBe(true);
    expect(mockFetch).toHaveBeenCalledTimes(3);
  });

  it("não repete erros permanentes e falha se nenhuma página puder ser lida", async () => {
    const mockFetch = vi.fn<typeof fetch>().mockResolvedValue(new Response("requisição inválida", { status: 400 }));
    await expect(fetchOpenTransferegovPrograms({ today, fetchImpl: mockFetch, lookbackYears: 0, maxPagesPerQuery: 1 })).rejects.toThrow("HTTP 400");
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });
});
