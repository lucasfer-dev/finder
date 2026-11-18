import { supabaseRequest, type SupabaseEnv } from "../_shared/supabase.js";

interface Context { request: Request; env?: SupabaseEnv; }
interface StoredOpportunity {
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
  first_seen_at: string;
  last_seen_at: string;
  updated_at: string;
}
interface StoredSyncState { status: string; coverage: Record<string, unknown>; last_succeeded_at: string | null; last_error: string | null; }

const PAGE_SIZE = 50;
const MAX_PAGE = 1000;

function cleanSearchTerm(value: string): string {
  return value.replace(/[(),%_*]/g, " ").replace(/\s+/g, " ").trim().slice(0, 100);
}

function brazilToday(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());
}

export async function handleOpportunitiesRequest(
  context: Context,
  fetchImpl: typeof fetch = fetch,
): Promise<Response> {
  if (context.request.method !== "GET") return Response.json({ error: "Método não permitido." }, { status: 405, headers: { Allow: "GET" } });
  try {
    const url = new URL(context.request.url);
    const page = Math.min(MAX_PAGE, Math.max(1, Number(url.searchParams.get("page") ?? 1) || 1));
    const start = (page - 1) * PAGE_SIZE;
    const params = new URLSearchParams({
      select: "source_id,opportunity_id,title,source_name,source_url,official_url,program_code,agency,executing_agency,legal_nature,proposal_start,deadline,deadline_state,deadline_status,public_call_state,eligibility_status,eligibility_criteria,first_seen_at,last_seen_at,updated_at",
      deadline_state: "eq.open",
      deadline: `gte.${brazilToday()}`,
      order: "deadline.asc",
      limit: String(PAGE_SIZE),
    });
    const query = cleanSearchTerm(url.searchParams.get("q") ?? "");
    const agency = cleanSearchTerm(url.searchParams.get("agency") ?? "");
    const institution = url.searchParams.get("institution");
    if (query) params.set("or", `(title.ilike.*${query}*,agency.ilike.*${query}*,eligibility_criteria.ilike.*${query}*)`);
    if (agency) params.set("agency", `ilike.*${agency}*`);
    if (institution === "sepec") params.set("legal_nature", "eq.Administração Pública Municipal");
    if (institution === "vielas") params.set("legal_nature", "eq.Organização da Sociedade Civil");
    const [{ data, response }, { data: states }] = await Promise.all([
      supabaseRequest<StoredOpportunity[]>(
      context.env ?? {}, `opportunities?${params}`, { headers: { Range: `${start}-${start + PAGE_SIZE - 1}`, Prefer: "count=exact" } }, fetchImpl,
      ),
      supabaseRequest<StoredSyncState[]>(context.env ?? {},
        "source_sync_state?source_id=eq.transferegov-discricionarias&select=status,coverage,last_succeeded_at,last_error&limit=1", {}, fetchImpl),
    ]);
    const range = response.headers.get("Content-Range");
    const total = range?.split("/")[1] && range.split("/")[1] !== "*" ? Number(range.split("/")[1]) : null;
    const now = Date.now();
    return Response.json({
      source: "Supabase · oportunidades persistidas",
      updatedAt: states[0]?.last_succeeded_at ?? data.reduce<string | null>((latest, item) => !latest || item.updated_at > latest ? item.updated_at : latest, null),
      syncStatus: states[0]?.status ?? "not_started",
      coverage: states[0]?.coverage ?? null,
      syncError: states[0]?.last_error ?? null,
      stale: states.length > 0 && ((states[0]?.last_succeeded_at
        ? now - new Date(states[0].last_succeeded_at).getTime() > 24 * 60 * 60 * 1000
        : true) || data.some((item) => now - new Date(item.last_seen_at).getTime() > 24 * 60 * 60 * 1000)),
      page,
      pageSize: PAGE_SIZE,
      total,
      opportunities: data.map((item) => ({
        id: item.opportunity_id,
        sourceId: item.source_id,
        title: item.title,
        sourceName: item.source_name,
        sourceUrl: item.source_url,
        officialUrl: item.official_url,
        programCode: item.program_code,
        agency: item.agency,
        executingAgency: item.executing_agency,
        naturezaJuridica: item.legal_nature,
        proposalStart: item.proposal_start,
        deadline: item.deadline,
        deadlineState: item.deadline_state,
        deadlineStatus: item.deadline_status,
        publicCallState: item.public_call_state,
        eligibilityStatus: item.eligibility_status,
        eligibilityCriteria: item.eligibility_criteria,
        discoveredAt: item.first_seen_at,
        updatedAt: item.updated_at,
      })),
    }, { headers: { "Cache-Control": "public, max-age=0, s-maxage=300", "X-Radar-Store": "supabase" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Falha ao consultar oportunidades persistidas.";
    const status = message.startsWith("Supabase não configurado") ? 503 : 502;
    return Response.json({ error: message }, { status, headers: { "Cache-Control": "no-store" } });
  }
}

export async function onRequest(context: Context): Promise<Response> {
  return handleOpportunitiesRequest(context);
}
