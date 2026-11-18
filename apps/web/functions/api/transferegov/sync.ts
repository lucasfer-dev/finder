import {
  fetchTransferegovSlice,
  transferegovAdapter,
  type TransferegovOpportunity,
  type TransferegovScanCursor,
} from "@radar/collectors/transferegov";
import { getSupabaseConfig, supabaseRequest, type SupabaseEnv } from "../../_shared/supabase.js";

interface Context { request: Request; env?: SupabaseEnv & { TRANSFEREGOV_SYNC_TOKEN?: string; TRANSFEREGOV_API_URL?: string }; }
interface SyncLease {
  scanId: string;
  cursor: TransferegovScanCursor | null;
  coverage: { pagesRead?: number; pagesAvailable?: number; groupsCompleted?: string[]; yearsInScope?: number[] };
}
interface SyncCommit { changed: number; deactivated: number; scanId: string; }
const PAGE_BUDGET_PER_RUN = 4;
const SOURCE_ID = transferegovAdapter.id;
const LEASE_SECONDS = 600;

function brazilToday(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());
}

function toDatabaseRow(item: TransferegovOpportunity) {
  const isActive = item.activeInSource;
  return {
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
    is_active: isActive,
    inactive_reason: isActive ? null
      : item.deadlineState !== "open" ? "deadline_" + item.deadlineState
      : item.sourceSituation !== "DISPONIBILIZADO" ? "source_unavailable"
      : "not_voluntary",
  };
}

async function rpc<T>(env: SupabaseEnv, name: string, args: object, fetchImpl: typeof fetch): Promise<T> {
  const { data } = await supabaseRequest<T>(env, "rpc/" + name, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify(args),
  }, fetchImpl);
  return data;
}

export async function handleTransferegovSync(
  context: Context, fetchImpl: typeof fetch = fetch,
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
  const leaseOwner = crypto.randomUUID();
  let leaseAcquired = false;
  try {
    getSupabaseConfig(env);
    // The PostgreSQL function locks the state row, preventing concurrent cursor advances.
    const lease = await rpc<SyncLease | null>(env, "acquire_source_sync", {
      p_source_id: SOURCE_ID, p_lease_owner: leaseOwner, p_lease_seconds: LEASE_SECONDS,
    }, fetchImpl);
    if (!lease) {
      return Response.json({ error: "Já existe sincronização em andamento." }, {
        status: 409, headers: { "Cache-Control": "no-store" },
      });
    }
    leaseAcquired = true;
    const slice = await fetchTransferegovSlice({
      today: brazilToday(),
      cursor: lease.cursor,
      maxPages: PAGE_BUDGET_PER_RUN,
      baseUrl: env.TRANSFEREGOV_API_URL,
      fetchImpl,
    });
    const previous = lease.coverage ?? {};
    // pagesAvailable is an estimate until the entire scan completes; avoid presenting
    // it as the exact total of all groups in scope.
    const coverage = {
      ...slice.result.coverage,
      pagesRead: (previous.pagesRead ?? 0) + slice.result.coverage.pagesRead,
      pagesAvailable: (previous.pagesAvailable ?? 0) + slice.result.coverage.pagesAvailable,
      exhaustive: slice.cursor === null,
      scanId: lease.scanId,
    };
    const rows = slice.result.opportunities.map(toDatabaseRow);
    // Single database transaction: check lease ownership, upsert rows,
    // log only changes, reconcile missing rows only on completed scans,
    // and advance cursor atomically.
    const outcome = await rpc<SyncCommit>(env, "commit_source_sync_batch", {
      p_source_id: SOURCE_ID,
      p_lease_owner: leaseOwner,
      p_rows: rows,
      p_cursor: slice.cursor,
      p_coverage: coverage,
      p_complete: slice.cursor === null,
    }, fetchImpl);
    leaseAcquired = false;
    return Response.json({
      sourceId: SOURCE_ID, status: slice.cursor === null ? "complete" : "partial",
      cursor: slice.cursor, coverage, upserted: rows.length,
      changes: outcome.changed, deactivated: outcome.deactivated,
      updatedAt: new Date().toISOString(),
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Falha desconhecida durante a sincronização.";
    if (leaseAcquired) {
      try {
        await rpc(env, "fail_source_sync", {
          p_source_id: SOURCE_ID, p_lease_owner: leaseOwner, p_error: message,
        }, fetchImpl);
      } catch { /* Preserve original error; the lease also expires automatically. */ }
    }
    return Response.json({ error: message, sourceId: SOURCE_ID }, {
      status: 502, headers: { "Cache-Control": "no-store" },
    });
  }
}

export async function onRequest(context: Context): Promise<Response> {
  return handleTransferegovSync(context);
}
