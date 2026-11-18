export interface SupabaseEnv {
  SUPABASE_URL?: string;
  SUPABASE_SERVICE_ROLE_KEY?: string;
}

export function getSupabaseConfig(env: SupabaseEnv): { baseUrl: string; serviceKey: string } {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error("Supabase não configurado. Defina SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY no ambiente das Pages Functions.");
  }
  return { baseUrl: env.SUPABASE_URL.replace(/\/$/, ""), serviceKey: env.SUPABASE_SERVICE_ROLE_KEY };
}

export async function supabaseRequest<T>(
  env: SupabaseEnv,
  path: string,
  init: RequestInit = {},
  fetchImpl: typeof fetch = fetch,
): Promise<{ data: T; response: Response }> {
  const { baseUrl, serviceKey } = getSupabaseConfig(env);
  const headers = new Headers(init.headers);
  headers.set("apikey", serviceKey);
  headers.set("Authorization", `Bearer ${serviceKey}`);
  headers.set("Accept", "application/json");
  const response = await fetchImpl(`${baseUrl}/rest/v1/${path}`, { ...init, headers });
  if (!response.ok) {
    const detail = (await response.text()).slice(0, 500);
    throw new Error(`Supabase respondeu HTTP ${response.status}: ${detail}`);
  }
  const text = await response.text();
  return { data: (text ? JSON.parse(text) : null) as T, response };
}
