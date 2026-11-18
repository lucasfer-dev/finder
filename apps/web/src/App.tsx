import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Link, Route, Routes } from "react-router";
import { useQuery } from "@tanstack/react-query";
import type { TransferegovCoverage, TransferegovOpportunity } from "@radar/collectors/transferegov";
import { useState } from "react";

const queryClient = new QueryClient();

interface SearchResponse {
  updatedAt: string | null;
  opportunities: Array<TransferegovOpportunity & { updatedAt: string }>;
  coverage: TransferegovCoverage | null;
  stale: boolean;
  syncStatus: "not_started" | "running" | "partial" | "complete" | "failed";
  syncError?: string | null;
  total: number | null;
  page: number;
  pageSize: number;
  error?: string;
}

interface DashboardResponse {
  updatedAt: string | null;
  stale: boolean;
  syncStatus: string;
  coverage: TransferegovCoverage | null;
  syncError: string | null;
  counts: {
    totalIdentified: number | null;
    openConfirmed: number | null;
    due3Days: number | null;
    due7Days: number | null;
    due15Days: number | null;
    due30Days: number | null;
    expired: number | null;
    newThisWeek: number | null;
  };
}

async function getOpportunities(filters: { query: string; agency: string; institution: string; deadlineWithin: string; page: number }): Promise<SearchResponse> {
  const params = new URLSearchParams({ page: String(filters.page) });
  if (filters.query.trim()) params.set("q", filters.query.trim());
  if (filters.agency.trim()) params.set("agency", filters.agency.trim());
  if (filters.institution !== "all") params.set("institution", filters.institution);
  if (filters.deadlineWithin !== "all") params.set("deadlineWithin", filters.deadlineWithin);
  const response = await fetch(`/api/opportunities?${params}`);
  const data = await response.json() as SearchResponse;
  if (!response.ok) throw new Error(data.error ?? "Não foi possível consultar o Transferegov.");
  return data;
}

async function getDashboard(): Promise<DashboardResponse> {
  const response = await fetch("/api/dashboard");
  const data = await response.json() as DashboardResponse & { error?: string };
  if (!response.ok) throw new Error(data.error ?? "Não foi possível carregar o resumo do Radar.");
  return data;
}

function formatDate(date: string | null): string {
  if (!date) return "Prazo não informado";
  return new Intl.DateTimeFormat("pt-BR", { dateStyle: "long", timeZone: "UTC" }).format(new Date(`${date}T00:00:00Z`));
}

function formatUpdate(date: string): string {
  return new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(new Date(date));
}

export function HomePage() {
  const [query, setQuery] = useState("");
  const [agency, setAgency] = useState("");
  const [draftQuery, setDraftQuery] = useState("");
  const [draftAgency, setDraftAgency] = useState("");
  const [institution, setInstitution] = useState("all");
  const [deadlineWithin, setDeadlineWithin] = useState("all");
  const [page, setPage] = useState(1);
  const dashboard = useQuery({ queryKey: ["dashboard-summary"], queryFn: getDashboard, staleTime: 60_000, retry: 1 });
  const { data, error, isPending, refetch, isFetching } = useQuery({
    queryKey: ["persisted-opportunities", query, agency, institution, deadlineWithin, page],
    queryFn: () => getOpportunities({ query, agency, institution, deadlineWithin, page }),
    retry: 1,
    staleTime: 5 * 60 * 1000,
  });

  return (
    <main className="page-shell">
      <header className="topbar">
        <a className="brand" href="/" aria-label="Radar de Editais, início">
          <span className="brand-mark" aria-hidden="true">R</span>
          <span>Radar de Editais</span>
        </a>
        <nav aria-label="Navegação principal">
          <Link to="/">Início</Link>
        </nav>
      </header>
      <section className="welcome" aria-labelledby="welcome-title">
        <p className="eyebrow">SEPEC · Queimados, RJ</p>
        <h1 id="welcome-title">Oportunidades que não podem passar despercebidas.</h1>
        <p className="intro">
          Um lugar para encontrar editais, acompanhar prazos e organizar oportunidades
          para a Prefeitura e o Instituto Vielas.
        </p>
      </section>
      <section className="dashboard" aria-labelledby="dashboard-title">
        <div className="dashboard-heading"><div><p className="eyebrow">Visão geral · dados persistidos</p><h2 id="dashboard-title">Painel de oportunidades</h2></div>
          {dashboard.data?.updatedAt && <span className="dashboard-updated">Atualizado {formatUpdate(dashboard.data.updatedAt)}{dashboard.data.stale ? " · desatualizado" : ""}</span>}
        </div>
        {dashboard.error && <p className="warning-note" role="alert">{dashboard.error.message}</p>}
        <div className="metric-grid">
          <article className="metric-card"><span>Total identificadas</span><strong>{dashboard.data?.counts.totalIdentified ?? "—"}</strong></article>
          <article className="metric-card metric-card-open"><span>Abertas confirmadas</span><strong>{dashboard.data?.counts.openConfirmed ?? "—"}</strong></article>
          <article className="metric-card"><span>Novas nos últimos 7 dias</span><strong>{dashboard.data?.counts.newThisWeek ?? "—"}</strong></article>
          <article className="metric-card metric-card-danger"><span>Prazo encerrado</span><strong>{dashboard.data?.counts.expired ?? "—"}</strong></article>
        </div>
        <div className="deadline-alerts" aria-label="Oportunidades próximas do prazo">
          <p>Prazo confirmado termina em:</p>
          <span className="alert-critical">até 3 dias <b>{dashboard.data?.counts.due3Days ?? "—"}</b></span>
          <span className="alert-high">4–7 dias <b>{dashboard.data?.counts.due7Days ?? "—"}</b></span>
          <span className="alert-medium">8–15 dias <b>{dashboard.data?.counts.due15Days ?? "—"}</b></span>
          <span className="alert-low">16–30 dias <b>{dashboard.data?.counts.due30Days ?? "—"}</b></span>
        </div>
        {dashboard.data && <p className="source-status">Fonte Transferegov · sincronização: <strong>{dashboard.data.syncStatus}</strong>{dashboard.data.coverage && !dashboard.data.coverage.exhaustive ? " · cobertura histórica parcial" : ""}</p>}
      </section>
      <section className="opportunities" aria-labelledby="opportunities-title">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Base persistida · Transferegov.br</p>
            <h2 id="opportunities-title">Oportunidades abertas</h2>
          </div>
          <button className="refresh-button" type="button" onClick={() => void refetch()} disabled={isFetching}>
            {isFetching ? "Atualizando…" : "Atualizar busca"}
          </button>
        </div>
        <form className="search-filters" onSubmit={(event) => { event.preventDefault(); setQuery(draftQuery); setAgency(draftAgency); setPage(1); }}>
          <label>Palavra-chave<input value={draftQuery} onChange={(event) => setDraftQuery(event.target.value)} placeholder="Tema, projeto ou público" /></label>
          <label>Órgão concedente<input value={draftAgency} onChange={(event) => setDraftAgency(event.target.value)} placeholder="Nome do órgão" /></label>
          <label>Perfil de análise<select value={institution} onChange={(event) => { setInstitution(event.target.value); setPage(1); }}><option value="all">Todos</option><option value="sepec">Prefeitura / SEPEC</option><option value="vielas">Instituto Vielas</option></select></label>
          <label>Prazo restante<select value={deadlineWithin} onChange={(event) => { setDeadlineWithin(event.target.value); setPage(1); }}><option value="all">Qualquer prazo aberto</option><option value="3">Até 3 dias</option><option value="7">Até 7 dias</option><option value="15">Até 15 dias</option><option value="30">Até 30 dias</option></select></label>
          <button className="refresh-button" type="submit">Buscar</button>
        </form>
        {isPending && <p className="setup-note" role="status">Consultando oportunidades persistidas…</p>}
        {error && <div className="error-note" role="alert"><span>{error.message}</span><button type="button" onClick={() => void refetch()}>Tentar novamente</button></div>}
        {data && <p className="update-note" role="status">{data.updatedAt ? `Última sincronização: ${formatUpdate(data.updatedAt)}` : "Nenhuma sincronização foi executada ainda."}{data.stale ? " · dados com mais de 24 horas; confira a fonte oficial" : ""} · estado da coleta: {data.syncStatus}.</p>}
        {data?.syncStatus === "not_started" && <div className="warning-note" role="status">A base ainda não recebeu a coleta inicial. Configure e execute a sincronização do Transferegov conforme o README.</div>}
        {data?.syncError && <p className="warning-note" role="alert">Última falha de sincronização: {data.syncError}</p>}
        {data?.coverage && !data.coverage.exhaustive && <div className="warning-note" role="status">Coleta histórica em andamento. A cobertura é parcial; a sincronização pode ser retomada sem reiniciar as páginas já percorridas.</div>}
        {data?.opportunities.length === 0 && data.syncStatus !== "not_started" && <p className="empty-state">Nenhuma oportunidade com prazo confirmado foi encontrada nos dados sincronizados para estes filtros.</p>}
        <div className="opportunity-list">
          {data?.opportunities.map((item) => (
            <article className="opportunity-card" key={item.id}>
              <div className="card-meta"><span>{item.publicCallState === "yes" ? "Chamamento público indicado" : item.publicCallState === "no" ? "Sem chamamento indicado" : "Chamamento não informado"}</span><span>Prazo confirmado · aberto</span></div>
              <h3>{item.title}</h3>
              <p className="agency">{item.agency ?? "Órgão não informado"}{item.executingAgency ? ` · ${item.executingAgency}` : ""}</p>
              <dl className="opportunity-details">
                <div><dt>Natureza jurídica na fonte</dt><dd>{item.naturezaJuridica ?? "Não informada"}</dd></div>
                <div><dt>Recebimento de propostas</dt><dd>{formatDate(item.proposalStart)} até {formatDate(item.deadline)}</dd></div>
                <div><dt>Elegibilidade da instituição</dt><dd>Não verificada — consulte os critérios e o documento oficial.</dd></div>
              </dl>
              {item.eligibilityCriteria && <p className="criteria">Critérios publicados: {item.eligibilityCriteria}</p>}
              <p className="profile-note">Perfil de análise: {institution === "sepec" ? "Prefeitura / SEPEC" : institution === "vielas" ? "Instituto Vielas" : "todas as instituições"}. Isso não confirma elegibilidade.</p>
              <p className="source-freshness">Registro revisto em {formatUpdate(item.updatedAt)}.</p>
              <a className="official-link" href={item.officialUrl} target="_blank" rel="noreferrer">Abrir consulta técnica na API oficial <span aria-hidden="true">↗</span></a>
            </article>
          ))}
        </div>
        {data && data.total !== null && <div className="pagination"><span>{data.total} oportunidade(s) nesta busca</span><button type="button" disabled={page <= 1 || isFetching} onClick={() => setPage((current) => Math.max(1, current - 1))}>Anterior</button><span>Página {page}</span><button type="button" disabled={data.opportunities.length < data.pageSize || isFetching} onClick={() => setPage((current) => current + 1)}>Próxima</button></div>}
        <p className="source-caveat">A natureza jurídica e os critérios são indicações da fonte, não uma confirmação de elegibilidade da Prefeitura ou do Instituto Vielas. Verifique o documento e a situação no registro oficial antes de iniciar uma proposta.</p>
      </section>
      <footer>Radar de Editais · Casa da Inovação Ziraldo</footer>
    </main>
  );
}

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="*" element={<HomePage />} />
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  );
}
