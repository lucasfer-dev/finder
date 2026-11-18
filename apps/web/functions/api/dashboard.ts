import { supabaseRequest, type SupabaseEnv } from "../_shared/supabase.js";

interface Context { request: Request; env?: SupabaseEnv; }
interface SyncState { status: string; coverage: Record<string, unknown>; last_succeeded_at: string | null; last_error: string | null; }

function brazilToday(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());
}

function addDays(date: string, days: number): string {
  const value = new Date(`${date}T00:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function parseCount(response: Response): number | null {
  const total = response.headers.get("Content-Range")?.split("/").at(-1);
  return total && total !== "*" ? Number(total) : null;
}

export async function handleDashboardRequest(context: Context, fetchImpl: typeof fetch = fetch): Promise<Response> {
  if (context.request.method !== "GET") return Response.json({ error: "Método não permitido." }, { status: 405, headers: { Allow: "GET" } });
  try {
    const today = brazilToday();
    const count = async (filters: Record<string, string>) => {
      const params = new URLSearchParams({ select: "opportunity_id", limit: "1", ...filters });
      const { response } = await supabaseRequest<unknown>(context.env ?? {}, `opportunities?${params}`, {
        method: "HEAD", headers: { Prefer: "count=exact" },
      }, fetchImpl);
      return parseCount(response);
    };
    const open = { is_active: "eq.true", deadline_state: "eq.open", deadline: `gte.${today}` };
    const dueBy = (upper: number, lower?: number) => ({
      is_active: "eq.true",
      deadline_state: "eq.open",
      and: `(${lower ? `deadline.gt.${addDays(today, lower)},` : `deadline.gte.${today},`}deadline.lte.${addDays(today, upper)})`,
    });
    const [{ data: states }, totalIdentified, openConfirmed, due3Days, due7Days, due15Days, due30Days, expired, newThisWeek] = await Promise.all([
      supabaseRequest<SyncState[]>(context.env ?? {},
        "source_sync_state?source_id=eq.transferegov-discricionarias&select=status,coverage,last_succeeded_at,last_error&limit=1", {}, fetchImpl),
      count({}),
      count(open),
      count(dueBy(3)),
      count(dueBy(7, 3)),
      count(dueBy(15, 7)),
      count(dueBy(30, 15)),
      count({ deadline_state: "eq.expired" }),
      count({ first_seen_at: `gte.${new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()}` }),
    ]);
    const sync = states[0];
    return Response.json({
      updatedAt: sync?.last_succeeded_at ?? null,
      stale: sync?.last_succeeded_at ? Date.now() - new Date(sync.last_succeeded_at).getTime() > 24 * 60 * 60 * 1000 : false,
      syncStatus: sync?.status ?? "not_started",
      coverage: sync?.coverage ?? null,
      syncError: sync?.last_error ?? null,
      counts: { totalIdentified, openConfirmed, due3Days, due7Days, due15Days, due30Days, expired, newThisWeek },
    }, { headers: { "Cache-Control": "public, max-age=0, s-maxage=60", "X-Radar-Store": "supabase" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Falha ao carregar o resumo do Radar.";
    const status = message.startsWith("Supabase não configurado") ? 503 : 502;
    return Response.json({ error: message }, { status, headers: { "Cache-Control": "no-store" } });
  }
}

export async function onRequest(context: Context): Promise<Response> {
  return handleDashboardRequest(context);
}
