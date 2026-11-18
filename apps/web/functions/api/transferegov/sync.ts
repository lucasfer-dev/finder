import {
  fetchTransferegovSlice,
  transferegovAdapter,
  type TransferegovOpportunity,
  type TransferegovScanCursor,
} from "@radar/collectors/transferegov";
import { getSupabaseConfig, supabaseRequest, type SupabaseEnv } from "../../_shared/supabase.js";

interface Context { request: Request; env?: SupabaseEnv & { TRANSFEREGOV_SYNC_TOKEN?: string; TRANSFEREGOV_API_URL?: string }; }
interface SyncStateRow { cursor: TransferegovScanCursor | null; status: string; coverage: { pagesRead?: number; pagesAvailable?: number; yearsComplete?: number[]; yearsInScope?: number[] } | null; last_started_at: string | null; }
interface DatabaseOpportunity {
  source_id: string;
  opportunity_id: string;
  title: string;
  source_name: string;
  source_url: string;
  official_url: string;
  program_code: string | null;
  agency: string | null;
  executing_agency: string | null;
  legal_nature: string | null;
  proposal_start: string | null;
  deadline: string | null;
  deadline_state: string;
  deadline_status: string;
  public_call_state: string;
  eligibility_status: string;
  eligibility_criteria: string | null;
  source_data: TransferegovOpportunity;
  last_seen_at: string;
  updated_at: string;
}

const PAGE_BUDGET_PER_RUN = 4;
const SOURCE_ID = transferegovAdapter.id;

function brazilToday(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());
}

function toDatabaseRow(item: TransferegovOpportunity, now: string): DatabaseOpportunity {
  return {
    source_id: SOURCE_ID,
    opportunity_id: item.id,
    title: item.title,
    source_name: item.sourceName,
    source_url: item.sourceUrl,
    official_url: item.officialUrl,
    program_code: item.programCode,
    agency: item.agency,
    executing_agency: item.executingAgency,
    legal_nature: item.naturezaJuridica,
    proposal_start: item.proposalStart,
    deadline: item.deadline,
    deadline_state: item.deadlineState,
    deadline_status: item.deadlineStatus,
    public_call_state: item.publicCallState,
    eligibility_status: item.eligibilityStatus,
    eligibility_criteria: item.eligibilityCriteria,
    source_data: item,
    last_seen_at: now,
    updated_at: now,
  };
}

async function saveState(env: SupabaseEnv, state: object, fetchImpl: typeof fetch): Promise<void> {
  await supabaseRequest(env, "source_sync_state?on_conflict=source_id", {
    method: "POST",
    headers: { "Content-Type": "application/json", Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify(state),
  }, fetchImpl);
}

export async function handleTransferegovSync(
  context: Context,
  fetchImpl: typeof fetch = fetch,
): Promise<Response> {
  const env = context.env ?? {};
  if (context.request.method !== "POST") return Response.json({ error: "Método não permitido." }, { status: 405, headers: { Allow: "POST" } });
  if (!env.TRANSFEREGOV_SYNC_TOKEN) return Response.json({ error: "Sincronização não configurada." }, { status: 503 });
  if (context.request.headers.get("Authorization") !== `Bearer ${env.TRANSFEREGOV_SYNC_TOKEN}`) {
    return Response.json({ error: "Não autorizado." }, { status: 401, headers: { "Cache-Control": "no-store" } });
  }

  try {
    getSupabaseConfig(env);
    const { data: rows } = await supabaseRequest<SyncStateRow[]>(env,
      `source_sync_state?source_id=eq.${encodeURIComponent(SOURCE_ID)}&select=cursor,status,coverage,last_started_at&limit=1`, {}, fetchImpl);
    const state = rows[0];
    if (state?.status === "running" && state.last_started_at && Date.now() - new Date(state.last_started_at).getTime() < 2 * 60 * 1000) {
      return Response.json({ error: "Já existe uma execução recente em andamento." }, { status: 409 });
    }

    const startedAt = new Date().toISOString();
    await saveState(env, { source_id: SOURCE_ID, status: "running", last_started_at: startedAt, last_error: null }, fetchImpl);
    const slice = await fetchTransferegovSlice({
      today: brazilToday(),
      cursor: state?.cursor ?? null,
      maxPages: PAGE_BUDGET_PER_RUN,
      baseUrl: env.TRANSFEREGOV_API_URL,
      fetchImpl,
    });
    const observedAt = new Date().toISOString();
    const rowsToUpsert = slice.result.opportunities.map((item) => toDatabaseRow(item, observedAt));
    if (rowsToUpsert.length) {
      await supabaseRequest(env, "opportunities?on_conflict=source_id,opportunity_id", {
        method: "POST",
        headers: { "Content-Type": "application/json", Prefer: "resolution=merge-duplicates,return=minimal" },
        body: JSON.stringify(rowsToUpsert),
      }, fetchImpl);
      await supabaseRequest(env, "opportunity_history", {
        method: "POST",
        headers: { "Content-Type": "application/json", Prefer: "return=minimal" },
        body: JSON.stringify(rowsToUpsert.map((row) => ({
          source_id: row.source_id,
          opportunity_id: row.opportunity_id,
          observed_at: observedAt,
          snapshot: row.source_data,
        }))),
      }, fetchImpl);
    }

    const pagesRead = (state?.coverage?.pagesRead ?? 0) + slice.result.coverage.pagesRead;
    const pagesAvailable = (state?.coverage?.pagesAvailable ?? 0) + slice.result.coverage.pagesAvailable;
    const yearsComplete = [...new Set([...(state?.coverage?.yearsComplete ?? []), ...slice.result.coverage.yearsComplete])].sort((a, b) => b - a);
    const status = slice.cursor ? "partial" : "complete";
    const coverage = { ...slice.result.coverage, yearsComplete, pagesRead, pagesAvailable, exhaustive: !slice.cursor };
    await saveState(env, {
      source_id: SOURCE_ID,
      status,
      cursor: slice.cursor,
      coverage,
      last_succeeded_at: observedAt,
      last_error: null,
      updated_at: observedAt,
    }, fetchImpl);
    return Response.json({ sourceId: SOURCE_ID, status, cursor: slice.cursor, coverage, upserted: rowsToUpsert.length, updatedAt: observedAt }, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Falha desconhecida durante a sincronização.";
    try {
      await saveState(env, { source_id: SOURCE_ID, status: "failed", last_error: message, updated_at: new Date().toISOString() }, fetchImpl);
    } catch { /* Preserve the source failure when Supabase is unreachable. */ }
    return Response.json({ error: message, sourceId: SOURCE_ID }, { status: 502, headers: { "Cache-Control": "no-store" } });
  }
}

export async function onRequest(context: Context): Promise<Response> {
  return handleTransferegovSync(context);
}
