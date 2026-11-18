import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import {
  fetchOpenTransferegovPrograms,
  isOpenTransferegovProgram,
  normalizeOpenTransferegovPrograms,
  type TransferegovPage,
} from "./transferegov.js";

const fixture = JSON.parse(readFileSync(fileURLToPath(new URL("./fixtures/transferegov-programs-2026.json", import.meta.url)), "utf8")) as TransferegovPage;

describe("adaptador Transferegov", () => {
  it("normaliza apenas registros oficiais abertos no recorte da consulta", () => {
    const results = normalizeOpenTransferegovPrograms(fixture.data, "2026-11-18", "2026-11-18T12:00:00.000Z");
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      id: "transferegov:56385:2629120260003",
      title: "Ações da Diretoria de Articulação e Inovação em Educação Aberta (DIEA) da Capes - PROEB e Inovação Tecnológica",
      agency: "MINISTERIO DA EDUCACAO",
      audience: "Organização da Sociedade Civil",
      proposalStart: "2026-03-10",
      deadline: "2026-12-31",
      deadlineStatus: "confirmed",
      recordType: "program",
    });
    expect(results[0]?.officialUrl).toContain("api-publica.transferegov.gestao.gov.br");
  });

  it("não chama disponibilizado ou data antiga de inscrição aberta", () => {
    const expired = fixture.data.find((item) => item.id_programa === 56851)!;
    expect(isOpenTransferegovProgram(expired, "2026-11-18")).toBe(false);
    expect(isOpenTransferegovProgram({ ...expired, dt_prog_fim_receb_prop: null }, "2026-10-20")).toBe(false);
    expect(isOpenTransferegovProgram({ ...expired, qualificacao_proposta: "Proposta de Emenda Parlamentar" }, "2026-10-20")).toBe(false);
  });

  it("consulta os parâmetros oficiais paginados e devolve oportunidades normalizadas", async () => {
    const mockFetch = vi.fn<typeof fetch>().mockImplementation(async () => new Response(JSON.stringify({
      ...fixture,
      data: [fixture.data[1]],
      total_pages: 1,
    }), { status: 200, headers: { "Content-Type": "application/json" } }));
    const results = await fetchOpenTransferegovPrograms({ today: "2026-11-18", fetchImpl: mockFetch });
    expect(mockFetch).toHaveBeenCalledTimes(2);
    const firstUrl = new URL(String(mockFetch.mock.calls[0]?.[0]));
    expect(firstUrl.pathname).toBe("/discricionarias/todos-programas");
    expect(firstUrl.searchParams.get("sit_programa")).toBe("DISPONIBILIZADO");
    expect(firstUrl.searchParams.get("natureza_juridica_programa")).toBe("Organização da Sociedade Civil");
    expect(firstUrl.searchParams.get("uf_programa")).toBe("RJ");
    expect(results).toHaveLength(1);
  });
});
