import {
  fetchOpenTransferegovPrograms,
  type TransferegovSearchResult,
} from "@radar/collectors/transferegov";

interface EdgeCache {
  match(request: Request | string): Promise<Response | null | undefined>;
  put(request: Request | string, response: Response): Promise<void>;
}

interface PagesContext {
  request: Request;
  env?: { TRANSFEREGOV_API_URL?: string };
  cache?: EdgeCache;
}

interface CacheRuntime {
  default?: EdgeCache;
}

const CACHE_VERSION = "v2";
const FRESH_TTL_SECONDS = 6 * 60 * 60;
const STALE_TTL_SECONDS = 7 * 24 * 60 * 60;

function getRuntimeCache(): EdgeCache | undefined {
  return (globalThis as typeof globalThis & { caches?: CacheRuntime }).caches?.default;
}

function withCacheHeader(response: Response, status: "hit" | "miss" | "stale"): Response {
  const headers = new Headers(response.headers);
  headers.set("X-Radar-Cache", status);
  return new Response(response.body, { status: response.status, headers });
}

function brazilToday(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());
}

export async function handleTransferegovRequest(
  { request, env, cache: injectedCache }: PagesContext,
  load: (options: { today: string; baseUrl?: string }) => Promise<TransferegovSearchResult> = fetchOpenTransferegovPrograms,
): Promise<Response> {
  const cache = injectedCache ?? getRuntimeCache();
  const requestUrl = new URL(request.url);
  const cacheKey = `${requestUrl.origin}/__radar-cache/transferegov/${CACHE_VERSION}`;
  const staleKey = `${cacheKey}/stale`;
  let cached: Response | null | undefined;
  let stale: Response | null | undefined;
  try { cached = await cache?.match(cacheKey); } catch { cached = undefined; }
  if (cached) return withCacheHeader(cached, "hit");
  try { stale = await cache?.match(staleKey); } catch { stale = undefined; }

  try {
    const result = await load({ today: brazilToday(), baseUrl: env?.TRANSFEREGOV_API_URL });
    const updatedAt = new Date().toISOString();
    const body = {
      source: "Transferegov.br",
      integration: "official_api",
      updatedAt,
      cacheStatus: "fresh",
      ...result,
      restrictions: [
        "A natureza jurídica e os critérios não comprovam a elegibilidade da instituição; confira as regras e documentos da oportunidade.",
        "O endpoint retorna programas; a existência de chamamento é mostrada em campo separado.",
        "O link para a origem é uma consulta técnica à API oficial por id_programa, não necessariamente o edital.",
      ],
    };
    const ttl = result.coverage.exhaustive ? FRESH_TTL_SECONDS : 5 * 60;
    const response = Response.json(body, {
      headers: { "Cache-Control": `public, max-age=0, s-maxage=${ttl}` },
    });
    if (cache) {
      try {
        await cache.put(cacheKey, new Response(response.clone().body, {
          status: response.status,
          headers: { "Content-Type": "application/json", "Cache-Control": `public, max-age=${ttl}` },
        }));
        await cache.put(staleKey, new Response(response.clone().body, {
          status: response.status,
          headers: { "Content-Type": "application/json", "Cache-Control": `public, max-age=${STALE_TTL_SECONDS}` },
        }));
      } catch { /* cache indisponível não deve descartar uma consulta que deu certo */ }
    }
    return withCacheHeader(response, "miss");
  } catch (error) {
    const message = error instanceof Error ? error.message : "Falha ao consultar Transferegov.";
    if (stale) {
      const staleData = await stale.json() as Record<string, unknown>;
      return Response.json({ ...staleData, cacheStatus: "stale", warning: `Consulta atual falhou: ${message}` }, {
        headers: { "Cache-Control": "no-store", "X-Radar-Cache": "stale" },
      });
    }
    return Response.json({ error: message, source: "Transferegov.br" }, {
      status: 502,
      headers: { "Cache-Control": "no-store", "X-Radar-Cache": "miss" },
    });
  }
}

export async function onRequestGet(context: PagesContext): Promise<Response> {
  return handleTransferegovRequest(context);
}
