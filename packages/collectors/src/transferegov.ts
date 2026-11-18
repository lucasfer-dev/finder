import type { Opportunity } from "@radar/core";

export const transferegovAdapter = {
  id: "transferegov-discricionarias",
  name: "Transferegov.br — Transferências Discricionárias e Legais",
  integrationType: "official_api" as const,
  capabilities: { historicalSearch: true, monitoring: false, confirmsOpenDeadline: true },
  knownRestrictions: [
    "A consulta cobre seis anos de disponibilização: o ano atual e os cinco anteriores.",
    "A API retorna programas; existência de chamamento, prazo e elegibilidade são estados independentes.",
    "A natureza jurídica publicada não confirma a elegibilidade da instituição.",
    "O registro nem sempre inclui URL de edital ou instrumento.",
  ],
};

export interface TransferegovProgram {
  id_programa: number;
  cod_programa: string | null;
  ano_programa: string | null;
  ano_disponibilizacao: string | null;
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

export type DeadlineState = "open" | "not_started" | "expired" | "unknown";
export type PublicCallState = "yes" | "no" | "unknown";

export interface TransferegovOpportunity extends Opportunity {
  id: string;
  programCode: string | null;
  agency: string | null;
  executingAgency: string | null;
  naturezaJuridica: string | null;
  eligibilityStatus: "not_assessed";
  eligibilityCriteria: string | null;
  proposalStart: string | null;
  deadlineState: DeadlineState;
  publicCallState: PublicCallState;
  sourceSituation: string | null;
  qualification: string | null;
  activeInSource: boolean;
}

export interface TransferegovCoverage {
  yearsInScope: number[];
  yearsComplete: number[];
  pagesRead: number;
  pagesAvailable: number;
  groupPageTotals?: Record<string, number>;
  exhaustive: boolean;
  partialReasons: string[];
}

export interface TransferegovSearchResult {
  opportunities: TransferegovOpportunity[];
  coverage: TransferegovCoverage;
}

const API_URL = "https://api-publica.transferegov.gestao.gov.br/discricionarias/todos-programas";
const TARGET_LEGAL_NATURES = new Set([
  "Organização da Sociedade Civil",
  "Administração Pública Municipal",
]);
export const HISTORICAL_LOOKBACK_YEARS = 5;
export const MAX_PAGES_PER_YEAR_AND_AUDIENCE = 3;
const PAGE_SIZE = 200;
const REQUEST_CONCURRENCY = 4;

export function buildOfficialApiUrl(programId: number): string {
  const url = new URL(API_URL);
  url.searchParams.set("id_programa", String(programId));
  url.searchParams.set("pagina", "1");
  url.searchParams.set("tamanho_da_pagina", String(PAGE_SIZE));
  return url.toString();
}

function hasVoluntaryProposal(program: TransferegovProgram): boolean {
  return (program.qualificacao_proposta ?? "").split(",").some((item) => item.trim() === "Proposta Voluntária");
}

export function classifyDeadline(program: TransferegovProgram, today: string): {
  state: DeadlineState;
  verification: "confirmed" | "unknown";
} {
  const start = program.dt_prog_ini_receb_prop;
  const end = program.dt_prog_fim_receb_prop;
  if (!start || !end || !/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end) || start > end) {
    return { state: "unknown", verification: "unknown" };
  }
  if (today < start) return { state: "not_started", verification: "confirmed" };
  if (today > end) return { state: "expired", verification: "confirmed" };
  return { state: "open", verification: "confirmed" };
}

export function normalizeTransferegovProgram(
  program: TransferegovProgram,
  today: string,
  discoveredAt: string,
): TransferegovOpportunity {
  const deadline = classifyDeadline(program, today);
  const publicCallState: PublicCallState = program.chamamento_projeto === "SIM"
    ? "yes"
    : program.chamamento_projeto === "NÃO" ? "no" : "unknown";
  const officialApiUrl = buildOfficialApiUrl(program.id_programa);
  return {
    id: `transferegov:${program.id_programa}:${program.cod_programa ?? "sem-codigo"}`,
    title: program.nome_programa,
    sourceName: "Transferegov.br",
    sourceUrl: "https://api-publica.transferegov.gestao.gov.br/discricionarias/docs",
    officialUrl: officialApiUrl,
    discoveredAt,
    deadline: deadline.verification === "confirmed" ? program.dt_prog_fim_receb_prop : null,
    deadlineStatus: deadline.verification,
    programCode: program.cod_programa,
    agency: program.desc_orgao_sup_programa,
    executingAgency: program.orgao_executor,
    naturezaJuridica: program.natureza_juridica_programa,
    eligibilityStatus: "not_assessed",
    eligibilityCriteria: program.criterios_de_selecao,
    proposalStart: deadline.verification === "confirmed" ? program.dt_prog_ini_receb_prop : null,
    deadlineState: deadline.state,
    publicCallState,
    sourceSituation: program.sit_programa,
    qualification: program.qualificacao_proposta,
    activeInSource: program.sit_programa === "DISPONIBILIZADO" && hasVoluntaryProposal(program) && deadline.state === "open",
  };
}

/** Keep closed and future-dated source rows for reconciliation; the UI still filters active rows. */
export function normalizeTransferegovObservedPrograms(
  programs: TransferegovProgram[], today: string, discoveredAt: string,
): TransferegovOpportunity[] {
  const unique = new Map<string, TransferegovOpportunity>();
  for (const program of programs) {
    if (!TARGET_LEGAL_NATURES.has(program.natureza_juridica_programa ?? "")) continue;
    if (program.uf_programa !== "RJ") continue;
    const record = normalizeTransferegovProgram(program, today, discoveredAt);
    unique.set(record.id, record);
  }
  return [...unique.values()];
}

export function normalizeOpenTransferegovPrograms(
  programs: TransferegovProgram[],
  today: string,
  discoveredAt: string,
): TransferegovOpportunity[] {
  const unique = new Map<string, TransferegovOpportunity>();
  for (const program of programs) {
    if (!TARGET_LEGAL_NATURES.has(program.natureza_juridica_programa ?? "")) continue;
    if (program.uf_programa !== "RJ" || program.sit_programa !== "DISPONIBILIZADO" || !hasVoluntaryProposal(program)) continue;
    const normalized = normalizeTransferegovProgram(program, today, discoveredAt);
    if (normalized.deadlineState !== "open") continue;
    unique.set(normalized.id, normalized);
  }
  return [...unique.values()].sort((a, b) => (a.deadline ?? "").localeCompare(b.deadline ?? ""));
}

async function fetchPage(url: URL, fetchImpl: typeof fetch): Promise<TransferegovPage> {
  let lastError: Error | undefined;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const response = await fetchImpl(url, {
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(20_000),
      });
      if (response.ok) return await response.json() as TransferegovPage;
      lastError = new Error(`Transferegov respondeu HTTP ${response.status}`);
      if (response.status < 500 && response.status !== 429) throw lastError;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error("Falha de rede no Transferegov.");
      if (/HTTP 4\d\d/.test(lastError.message) && !/HTTP 429/.test(lastError.message)) throw lastError;
    }
    if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 250 * 2 ** attempt));
  }
  throw lastError ?? new Error("Sem resposta do Transferegov.");
}

async function mapConcurrent<T, R>(items: T[], concurrency: number, callback: (item: T) => Promise<R>): Promise<R[]> {
  const output: R[] = [];
  for (let index = 0; index < items.length; index += concurrency) {
    const group = items.slice(index, index + concurrency);
    output.push(...await Promise.all(group.map(callback)));
  }
  return output;
}

export interface TransferegovScanCursor {
  baseYear: number;
  yearIndex: number;
  natureIndex: number;
  page: number;
  totalPages: number | null;
}

interface QueryGroup {
  year: number;
  legalNature: string;
}

interface PageOutcome {
  group: QueryGroup;
  page: number;
  result?: TransferegovPage;
  error?: string;
}

function makeQueryUrl(group: QueryGroup, page: number, baseUrl: string): URL {
  const url = new URL(baseUrl);
  url.search = new URLSearchParams({
    sit_programa: "DISPONIBILIZADO",
    ano_disponibilizacao: String(group.year),
    natureza_juridica_programa: group.legalNature,
    uf_programa: "RJ",
    pagina: String(page),
    tamanho_da_pagina: String(PAGE_SIZE),
  }).toString();
  return url;
}

/** Fetches a bounded slice of the historical scan and returns a resumable cursor. */
export async function fetchTransferegovSlice(options: {
  today: string;
  cursor?: TransferegovScanCursor | null;
  maxPages?: number;
  fetchImpl?: typeof fetch;
  baseUrl?: string;
}): Promise<{ result: TransferegovSearchResult; cursor: TransferegovScanCursor | null }> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const baseUrl = options.baseUrl ?? API_URL;
  const currentYear = Number(options.today.slice(0, 4));
  const initialCursor = options.cursor ?? { baseYear: currentYear, yearIndex: 0, natureIndex: 0, page: 1, totalPages: null };
  const baseYear = initialCursor.baseYear ?? currentYear;
  const yearsInScope = Array.from({ length: HISTORICAL_LOOKBACK_YEARS + 1 }, (_, index) => baseYear - index);
  const legalNatures = [...TARGET_LEGAL_NATURES];
  const groups = yearsInScope.flatMap((year) => legalNatures.map((legalNature) => ({ year, legalNature })));
  const maxPages = Math.max(1, options.maxPages ?? 4);
  let cursor: TransferegovScanCursor = initialCursor;
  const records: TransferegovProgram[] = [];
  let pagesRead = 0;
  let pagesAvailable = 0;
  const pageCountsByGroup = new Map<string, number>();

  while (cursor.yearIndex < yearsInScope.length && pagesRead < maxPages) {
    const group = groups[cursor.yearIndex * legalNatures.length + cursor.natureIndex];
    if (!group) break;
    const page = await fetchPage(makeQueryUrl(group, cursor.page, baseUrl), fetchImpl);
    records.push(...page.data);
    pagesRead += 1;
    const groupKey = `${group.year}:${group.legalNature}`;
    if (!pageCountsByGroup.has(groupKey)) {
      const available = cursor.totalPages ?? page.total_pages;
      pageCountsByGroup.set(groupKey, available);
      pagesAvailable += available;
    }
    const totalPages = cursor.totalPages ?? page.total_pages;
    if (cursor.page < totalPages) {
      cursor = { ...cursor, page: cursor.page + 1, totalPages };
    } else {
      const nextNatureIndex = cursor.natureIndex + 1;
      const nextYearIndex = nextNatureIndex >= legalNatures.length ? cursor.yearIndex + 1 : cursor.yearIndex;
      cursor = nextYearIndex >= yearsInScope.length
        ? { ...cursor, yearIndex: yearsInScope.length, natureIndex: 0, page: 1, totalPages: null }
        : { baseYear, yearIndex: nextYearIndex, natureIndex: nextNatureIndex % legalNatures.length, page: 1, totalPages: null };
    }
  }

  const complete = cursor.yearIndex >= yearsInScope.length;
  const partialReasons = complete ? [] : [`Sincronização retomável: próxima consulta em ${yearsInScope[cursor.yearIndex]} / ${legalNatures[cursor.natureIndex]}, página ${cursor.page}.`];
  return {
    result: {
      opportunities: normalizeTransferegovObservedPrograms(records, options.today, new Date().toISOString()),
      coverage: {
        yearsInScope,
        yearsComplete: complete ? yearsInScope : yearsInScope.slice(0, cursor.yearIndex),
        pagesRead,
        pagesAvailable,
        groupPageTotals: Object.fromEntries(pageCountsByGroup),
        exhaustive: complete,
        partialReasons,
      },
    },
    cursor: complete ? null : cursor,
  };
}

export async function fetchOpenTransferegovPrograms(options: {
  today: string;
  fetchImpl?: typeof fetch;
  baseUrl?: string;
  lookbackYears?: number;
  maxPagesPerQuery?: number;
}): Promise<TransferegovSearchResult> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const baseUrl = options.baseUrl ?? API_URL;
  const currentYear = Number(options.today.slice(0, 4));
  const lookbackYears = options.lookbackYears ?? HISTORICAL_LOOKBACK_YEARS;
  const yearsInScope = Array.from({ length: lookbackYears + 1 }, (_, index) => currentYear - index);
  const legalNatures = [...TARGET_LEGAL_NATURES];
  const groups = yearsInScope.flatMap((year) => legalNatures.map((legalNature) => ({ year, legalNature })));
  const pageLimit = options.maxPagesPerQuery ?? MAX_PAGES_PER_YEAR_AND_AUDIENCE;
  const failures: string[] = [];
  const records: TransferegovProgram[] = [];
  let pagesRead = 0;
  let pagesAvailable = 0;
  const completeGroupKeys = new Set<string>();
  const groupKey = (group: QueryGroup) => `${group.year}:${group.legalNature}`;

  const firstPages = await mapConcurrent(groups, REQUEST_CONCURRENCY, async (group): Promise<PageOutcome> => {
    try {
      return { group, page: 1, result: await fetchPage(makeQueryUrl(group, 1, baseUrl), fetchImpl) };
    } catch (error) {
      return { group, page: 1, error: error instanceof Error ? error.message : "Falha desconhecida" };
    }
  });

  const laterPages: Array<{ group: QueryGroup; page: number }> = [];
  for (const outcome of firstPages) {
    if (outcome.error || !outcome.result) {
      failures.push(`${outcome.group.year}/${outcome.group.legalNature}: ${outcome.error ?? "resposta vazia"}`);
      continue;
    }
    const pageCount = outcome.result.total_pages;
    pagesAvailable += pageCount;
    pagesRead += 1;
    records.push(...outcome.result.data);
    if (pageCount <= 0) {
      failures.push(`${outcome.group.year}/${outcome.group.legalNature}: total_pages inválido (${pageCount})`);
      continue;
    }
    if (pageCount > pageLimit) failures.push(`${outcome.group.year}/${outcome.group.legalNature}: cobertura limitada a ${pageLimit} de ${pageCount} páginas`);
    for (let page = 2; page <= Math.min(pageCount, pageLimit); page += 1) laterPages.push({ group: outcome.group, page });
    if (pageCount <= pageLimit) completeGroupKeys.add(groupKey(outcome.group));
  }

  const remaining = await mapConcurrent(laterPages, REQUEST_CONCURRENCY, async ({ group, page }): Promise<PageOutcome> => {
    try {
      return { group, page, result: await fetchPage(makeQueryUrl(group, page, baseUrl), fetchImpl) };
    } catch (error) {
      return { group, page, error: error instanceof Error ? error.message : "Falha desconhecida" };
    }
  });
  for (const outcome of remaining) {
    if (outcome.error || !outcome.result) {
      failures.push(`${outcome.group.year}/${outcome.group.legalNature}, página ${outcome.page}: ${outcome.error ?? "resposta vazia"}`);
      completeGroupKeys.delete(groupKey(outcome.group));
      continue;
    }
    pagesRead += 1;
    records.push(...outcome.result.data);
  }

  if (pagesRead === 0) throw new Error(failures[0] ?? "A API do Transferegov não retornou páginas.");
  const opportunities = normalizeOpenTransferegovPrograms(records, options.today, new Date().toISOString());
  const uniqueReasons = [...new Set(failures)];
  const yearsComplete = yearsInScope.filter((year) => legalNatures.every((legalNature) => completeGroupKeys.has(groupKey({ year, legalNature }))));
  return {
    opportunities,
    coverage: {
      yearsInScope,
      yearsComplete,
      pagesRead,
      pagesAvailable,
      exhaustive: yearsComplete.length === yearsInScope.length && uniqueReasons.length === 0,
      partialReasons: uniqueReasons,
    },
  };
}
