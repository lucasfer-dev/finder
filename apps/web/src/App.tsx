import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { TransferegovCoverage, TransferegovOpportunity } from "@radar/collectors/transferegov";

const queryClient = new QueryClient();

interface SearchResponse {
  updatedAt: string;
  opportunities: TransferegovOpportunity[];
  coverage: TransferegovCoverage;
  cacheStatus: "fresh" | "stale";
  warning?: string;
  error?: string;
}

async function getOpportunities(): Promise<SearchResponse> {
  const response = await fetch("/api/transferegov");
  const data = await response.json() as SearchResponse;
  if (!response.ok) throw new Error(data.error ?? "Não foi possível consultar o Transferegov.");
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
  const { data, error, isPending, refetch, isFetching } = useQuery({
    queryKey: ["transferegov-opportunities"],
    queryFn: getOpportunities,
    retry: 1,
    staleTime: 5 * 60 * 1000,
  });

  const [search, setSearch] = useState("");
  const [profile, setProfile] = useState("all");
  const [view, setView] = useState("all");
  const [saved, setSaved] = useState<string[]>(() => {
    try { const value: unknown = JSON.parse(localStorage.getItem("radar-saved") ?? "[]"); return Array.isArray(value) ? value.filter((id): id is string => typeof id === "string") : []; } catch { return []; }
  });
  const normalize = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  const items = data?.opportunities ?? [];
  const municipal = (item: TransferegovOpportunity) => normalize(item.naturezaJuridica ?? "").includes("municipal");
  const osc = (item: TransferegovOpportunity) => /organizacao|osc/.test(normalize(item.naturezaJuridica ?? ""));
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  const urgent = (item: TransferegovOpportunity) => { const days = (Date.parse(item.deadline ?? "") - Date.parse(today)) / 86400000; return days >= 0 && days <= 15; };
  const filtered = items.filter(item => (profile === "all" || (profile === "municipal" ? municipal(item) : osc(item))) && (view === "all" || (view === "saved" ? saved.includes(String(item.id)) : urgent(item))) && normalize([item.title, item.agency, item.eligibilityCriteria].join(" ")).includes(normalize(search.trim()))).sort((a,b) => (a.deadline ?? "9999").localeCompare(b.deadline ?? "9999"));
  function toggleSaved(id: string) {
    const next = saved.includes(id) ? saved.filter(value => value !== id) : [...saved, id];
    setSaved(next);
    try { localStorage.setItem("radar-saved", JSON.stringify(next)); } catch { /* current session remains usable */ }
  }
  return (
    <div className="workspace">
      <aside className="sidebar">
        <a className="brand" href="/"><span className="brand-mark" aria-hidden="true">◎</span><span>radar<small>INTELIGÊNCIA DE EDITAIS</small></span></a>
        <p className="workspace-label">ESPAÇO DE TRABALHO</p>
        <nav aria-label="Navegação principal">
          <button className={view === "all" ? "active" : ""} onClick={() => setView("all")}>▦　Explorar oportunidades</button>
          <button className={view === "saved" ? "active" : ""} onClick={() => setView("saved")}>☆　Salvos</button>
          <button className={view === "urgent" ? "active" : ""} onClick={() => setView("urgent")}>◷　Próximos prazos</button>
        </nav>
        <div className="sidebar-footer"><strong>Casa da Inovação</strong><small>SEPEC · Queimados</small></div>
      </aside>
    <main className="page-shell">
      <header className="topbar"><span>Workspace / Oportunidades</span><span className="source-label">● Transferegov</span></header>
      <section className="welcome" aria-labelledby="welcome-title">
        <p className="eyebrow">CASA DA INOVAÇÃO · SEPEC</p>
        <h1 id="welcome-title">Radar de oportunidades</h1>
        <p className="intro">Encontre financiamento para projetos que transformam Queimados.</p>
      </section>
      <section className="metrics" aria-label="Indicadores da consulta">
        {[
          { label: "Oportunidades abertas", value: items.length },
          { label: "Vencem em até 15 dias", value: items.filter(urgent).length },
          { label: "Administração municipal", value: items.filter(municipal).length },
          { label: "Organizações sociais", value: items.filter(osc).length },
        ].map(metric => <div className="metric" key={metric.label}><span>{metric.label}</span><strong>{data ? metric.value : "—"}</strong><small>Na consulta disponível</small></div>)}
      </section>
      <section className="opportunities" aria-labelledby="opportunities-title">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Busca oficial · Transferegov.br</p>
            <h2 id="opportunities-title">{view === "saved" ? "Oportunidades salvas" : view === "urgent" ? "Próximos prazos" : "Explorar oportunidades"}</h2>
          </div>
          <button className="refresh-button" type="button" onClick={() => void refetch()} disabled={isFetching}>
            {isFetching ? "Atualizando…" : "Atualizar busca"}
          </button>
        </div>
        <div className="filters">
          <input aria-label="Pesquisar oportunidades" placeholder="Pesquisar por título, órgão ou critérios..." value={search} onChange={event => setSearch(event.target.value)} />
          <select aria-label="Perfil institucional" value={profile} onChange={event => setProfile(event.target.value)}><option value="all">Todos os perfis</option><option value="municipal">Prefeitura / SEPEC</option><option value="osc">Organizações sociais / Vielas</option></select>
        </div>
        {data && <p className="result-count">{filtered.length} de {items.length} oportunidades · natureza jurídica não confirma elegibilidade</p>}
        {isPending && <p className="setup-note" role="status">Consultando programas com prazo aberto na fonte oficial…</p>}
        {error && <div className="error-note" role="alert"><span>{error.message}</span><button type="button" onClick={() => void refetch()}>Tentar novamente</button></div>}
        {data && <p className="update-note" role="status">Dados consultados em {formatUpdate(data.updatedAt)}{data.cacheStatus === "stale" ? " · exibindo última consulta disponível" : ""} · cobertura: {data.coverage.yearsInScope[0]}–{data.coverage.yearsInScope.at(-1)}.</p>}
        {data?.warning && <p className="warning-note" role="status">{data.warning}</p>}
        {data && !data.coverage.exhaustive && <div className="warning-note" role="status">Busca histórica parcial. Foram lidas {data.coverage.pagesRead} de {data.coverage.pagesAvailable} páginas conhecidas; alguns programas podem não aparecer.{data.coverage.partialReasons.length > 0 && <details><summary>Detalhes da cobertura</summary><ul>{data.coverage.partialReasons.map((reason) => <li key={reason}>{reason}</li>)}</ul></details>}</div>}
        {data?.opportunities.length === 0 && <p className="empty-state">Nenhuma oportunidade com prazo confirmado foi encontrada nos dados consultados. A busca cobre o ano atual e os cinco anos anteriores para RJ.</p>}
        {data && items.length > 0 && filtered.length === 0 && <p className="empty-state">Nenhuma oportunidade corresponde aos filtros selecionados.</p>}
        <div className="opportunity-list">
          {filtered.map((item) => (
            <article className="opportunity-card" key={item.id}>
              <div className="card-meta"><span>{item.publicCallState === "yes" ? "Chamamento público indicado" : item.publicCallState === "no" ? "Sem chamamento indicado" : "Chamamento não informado"}</span><span>Prazo confirmado · aberto</span></div>
              <div className="card-title"><h3>{item.title}</h3><button className="save-button" aria-label={saved.includes(String(item.id)) ? "Remover dos salvos" : "Salvar oportunidade"} aria-pressed={saved.includes(String(item.id))} onClick={() => toggleSaved(String(item.id))}>{saved.includes(String(item.id)) ? "★" : "☆"}</button></div>
              <p className="agency">{item.agency ?? "Órgão não informado"}{item.executingAgency ? ` · ${item.executingAgency}` : ""}</p>
              <dl className="opportunity-details">
                <div><dt>Natureza jurídica na fonte</dt><dd>{item.naturezaJuridica ?? "Não informada"}</dd></div>
                <div><dt>Recebimento de propostas</dt><dd>{formatDate(item.proposalStart)} até {formatDate(item.deadline)}</dd></div>
                <div><dt>Elegibilidade da instituição</dt><dd>Não verificada — consulte os critérios e o documento oficial.</dd></div>
              </dl>
              {item.eligibilityCriteria && <p className="criteria">Critérios publicados: {item.eligibilityCriteria}</p>}
              <a className="official-link" href={item.officialUrl} target="_blank" rel="noreferrer">Abrir consulta técnica na API oficial <span aria-hidden="true">↗</span></a>
            </article>
          ))}
        </div>
        <p className="source-caveat">A natureza jurídica e os critérios são indicações da fonte, não uma confirmação de elegibilidade da Prefeitura ou do Instituto Vielas. Verifique o documento e a situação no registro oficial antes de iniciar uma proposta.</p>
      </section>
      <footer>Radar de Editais · Casa da Inovação Ziraldo</footer>
    </main>
    </div>
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
