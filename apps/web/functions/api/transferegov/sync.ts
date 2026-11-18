import {
  fetchTransferegovSlice,
  transferegovAdapter,
  type TransferegovOpportunity,
  type TransferegovScanCursor,
} from "@radar/collectors/transferegov";
import { getSupabaseConfig, supabaseRequest, type SupabaseEnv } from "../../_shared/supabase.js";

interface Context {
  request: Request;
  env?: SupabaseEnv & { TRANSFEREGOV_SYNC_TOKEN?: string; TRANSFEREGOV_API_URL?: string };
}
interface SyncClaim {
  scanId: string;
  cursor: TransferegovScanCursor | null;
  coverage: { pagesRead?: number; pagesAvailable?: number; yearsComplete?: number[] } | null;
}
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
}

const PAGE_BUDGET_PER_RUN = 4;
const SOURCE_ID = transferegovAdapter.id;

function brazilToday(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());
}

function toDatabaseRow(item: TransferegovOpportunity): DatabaseOpportunity {
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
  };
}

export async function handleTransferegovSync(
  context: Context,
  fetchImpl: typeof fetch = fetch,
): Promise<Response> {
  const env = context.env ?? {};
  if (context.request.method !== "POST") {
    return Response.json({ error: "Método não permitido." }, { status: 405, headers: { Allow: "POST" } });
  }
  if (!env.TRANSFEREGOV_SYNC_TOKEN) {
    return Response.json({ error: "Sincronização não configurada." }, { status: 503 });
  }
  if (context.request.headers.get("Authorization") !== `Bearer ${env.TRANSFEREGOV_SYNC_TOKEN}`) {
    return Response.json({ error: "Não autorizado." }, { status: 401, headers: { "Cache-Control": "no-store" } });
  }
  const leaseId = crypto.randomUUID();
  let claimed = false;
  try {
    getSupabaseConfig(env);
    // PostgreSQL conditionally updates one state row: competing callers cannot both own the scan.
    const { data: claim } = await supabaseRequest<SyncClaim | null>(env, "rpc/radar_claim_sync", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ p_source_id: SOURCE_ID, p_lease_id: leaseId }),
    }, fetchImpl);
    if (!claim) return Response.json({ error: "Já existe uma execução em andamento." }, {
      status: 409, headers: { "Cache-Control": "no-store" },
    });
    claimed = true;
    const slice = await fetchTransferegovSlice({
      today: brazilToday(),
      cursor: claim.cursor,
      maxPages: PAGE_BUDGET_PER_RUN,
      baseUrl: env.TRANSFEREGOV_API_URL,
      fetchImpl,
    });
    const previous = claim.coverage ?? {};
    const previousComplete = previous.yearsComplete ?? [];
    const yearsComplete = [...new Set([...previousComplete, ...slice.result.coverage.yearsComplete])].sort((a, b) => b - a);
    const coverage = {
      ...slice.result.coverage,
      yearsComplete,
      pagesRead: (previous.pagesRead ?? 0) + slice.result.coverage.pagesRead,
      pagesAvailable: (previous.pagesAvailable ?? 0) + slice.result.coverage.pagesAvailable,
      exhaustive: slice.cursor === null,
    };
    // All changes (including expired dates), audit rows, cursor and final withdrawal
    // are committed by one PostgreSQL transaction under the same lease.
    const { data: committed } = await supabaseRequest<{ changed: number; withdrawn: number }>(
      env, "rpc/radar_commit_sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          p_source_id: SOURCE_ID,
          p_lease_id: leaseId,
          p_scan_id: claim.scanId,
          p_rows: slice.result.opportunities.map(toDatabaseRow),
          p_cursor: slice.cursor,
          p_coverage: coverage,
          p_complete: slice.cursor === null,
        }),
      }, fetchImpl,
    );
    return Response.json({
      sourceId: SOURCE_ID,
      status: slice.cursor ? "partial" : "complete",
      cursor: slice.cursor,
      coverage,
      observed: slice.result.opportunities.length,
      changed: committed.changed,
      withdrawn: committed.withdrawn,
      updatedAt: new Date().toISOString(),
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Falha desconhecida durante a sincronização.";
    if (claimed) {
      try {
        await supabaseRequest(env, "rpc/radar_fail_sync", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ p_source_id: SOURCE_ID, p_lease_id: leaseId, p_message: message }),
        }, fetchImpl);
      } catch { /* A lease expires automatically if the database is unavailable. */ }
    }
    return Response.json({ error: "Não foi possível concluir a sincronização.", sourceId: SOURCE_ID }, {
      status: 502, headers: { "Cache-Control": "no-store" },
    });
  }
}

export async function onRequest(context: Context): Promise<Response> {
  return handleTransferegovSync(context);
}
