import type { Opportunity } from "@radar/core";

export const transferegovAdapter = {
  id: "transferegov-discricionarias",
  name: "Transferegov.br — Transferências Discricionárias e Legais",
  integrationType: "official_api" as const,
  capabilities: { historicalSearch: true, monitoring: false, confirmsOpenDeadline: true },
  knownRestrictions: [
    "Programa disponibilizado não significa edital aberto; a situação é calculada pelas datas de recebimento.",
    "A API não fornece, nesse endpoint, um campo estruturado de público-alvo; natureza jurídica e critérios são informativos.",
    "Nem todo programa possui chamamento público ou link direto para o edital.",
  ],
};

export interface TransferegovProgram {
  id_programa: number;
  cod_programa: string | null;
  ano_programa: string | null;
  nome_programa: string;
  desc_orgao_sup_programa: string | null;
  orgao_executor: string | null;
  sit_programa: string | null;
  data_disponibilizacao: string | null;
  dt_prog_ini_receb_prop: string | null;
  dt_prog_fim_receb_prop: string | null;
  natureza_juridica_programa: string | null;
  uf_programa: string | null;
  chamamento_projeto: string | null;
  qualificacao_proposta: string | null;
  criterios_de_selecao: string | null;
  descricao: string | null;
}

export interface TransferegovPage {
  data: TransferegovProgram[];
  total_pages: number;
  total_items: number;
  page_number: number;
  page_size: number;
}

export interface TransferegovOpportunity extends Opportunity {
  id: string;
  programCode: string | null;
  agency: string | null;
  executingAgency: string | null;
  audience: string | null;
  eligibilityCriteria: string | null;
  proposalStart: string | null;
  status: "open";
  recordType: "program" | "public_call";
}

const API_URL = "https://api-publica.transferegov.gestao.gov.br/discricionarias/todos-programas";
const TARGET_AUDIENCES = new Set([
  "Organização da Sociedade Civil",
  "Administração Pública Municipal",
]);

export function isOpenTransferegovProgram(program: TransferegovProgram, today: string): boolean {
  return program.sit_programa === "DISPONIBILIZADO"
    && (program.qualificacao_proposta ?? "").split(",").some((item) => item.trim() === "Proposta Voluntária")
    && Boolean(program.dt_prog_ini_receb_prop && program.dt_prog_fim_receb_prop)
    && program.dt_prog_ini_receb_prop! <= today
    && program.dt_prog_fim_receb_prop! >= today;
}

export function normalizeTransferegovProgram(
  program: TransferegovProgram,
  discoveredAt: string,
): TransferegovOpportunity {
  const sourceUrl = `${API_URL}?id_programa=${encodeURIComponent(String(program.id_programa))}`;
  return {
    id: `transferegov:${program.id_programa}:${program.cod_programa ?? "sem-codigo"}`,
    title: program.nome_programa,
    sourceName: "Transferegov.br",
    sourceUrl,
    officialUrl: sourceUrl,
    discoveredAt,
    deadline: program.dt_prog_fim_receb_prop,
    deadlineStatus: "confirmed",
    programCode: program.cod_programa,
    agency: program.desc_orgao_sup_programa,
    executingAgency: program.orgao_executor,
    audience: program.natureza_juridica_programa,
    eligibilityCriteria: program.criterios_de_selecao,
    proposalStart: program.dt_prog_ini_receb_prop,
    status: "open",
    recordType: program.chamamento_projeto === "SIM" ? "public_call" : "program",
  };
}

export function normalizeOpenTransferegovPrograms(
  programs: TransferegovProgram[],
  today: string,
  discoveredAt: string,
): TransferegovOpportunity[] {
  const unique = new Map<string, TransferegovOpportunity>();
  for (const program of programs) {
    if (!TARGET_AUDIENCES.has(program.natureza_juridica_programa ?? "")) continue;
    if (program.uf_programa !== "RJ" || !isOpenTransferegovProgram(program, today)) continue;
    const opportunity = normalizeTransferegovProgram(program, discoveredAt);
    unique.set(opportunity.id, opportunity);
  }
  return [...unique.values()].sort((a, b) => (a.deadline ?? "").localeCompare(b.deadline ?? ""));
}

export async function fetchOpenTransferegovPrograms(options: {
  today: string;
  fetchImpl?: typeof fetch;
  maxPages?: number;
}): Promise<TransferegovOpportunity[]> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const year = options.today.slice(0, 4);
  const audiences = [...TARGET_AUDIENCES];
  const records: TransferegovProgram[] = [];
  for (const audience of audiences) {
    let page = 1;
    let totalPages = 1;
    while (page <= totalPages && page <= (options.maxPages ?? 20)) {
      const url = new URL(API_URL);
      url.search = new URLSearchParams({
        sit_programa: "DISPONIBILIZADO",
        ano_disponibilizacao: year,
        natureza_juridica_programa: audience,
        uf_programa: "RJ",
        pagina: String(page),
        tamanho_da_pagina: "100",
      }).toString();
      let response: Response | undefined;
      for (let attempt = 0; attempt < 3; attempt += 1) {
        try {
          response = await fetchImpl(url, {
            headers: { Accept: "application/json" },
            signal: AbortSignal.timeout(20_000),
          });
          if (response.ok || response.status < 500 && response.status !== 429) break;
        } catch (error) {
          if (attempt === 2) throw error;
        }
        if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 250 * 2 ** attempt));
      }
      if (!response) throw new Error("Sem resposta do Transferegov.");
      if (!response.ok) throw new Error(`Transferegov respondeu HTTP ${response.status}`);
      const result = await response.json() as TransferegovPage;
      if (result.total_pages > (options.maxPages ?? 20)) {
        throw new Error(`Consulta excedeu o limite de páginas seguro (${result.total_pages}).`);
      }
      records.push(...result.data);
      totalPages = result.total_pages;
      page += 1;
    }
  }
  return normalizeOpenTransferegovPrograms(records, options.today, new Date().toISOString());
}
