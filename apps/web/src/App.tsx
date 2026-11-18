import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Link, Route, Routes } from "react-router";
import { useQuery } from "@tanstack/react-query";
import type { TransferegovOpportunity } from "@radar/collectors/transferegov";

const queryClient = new QueryClient();

interface SearchResponse {
  updatedAt: string;
  opportunities: TransferegovOpportunity[];
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
      <section className="opportunities" aria-labelledby="opportunities-title">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Busca oficial · Transferegov.br</p>
            <h2 id="opportunities-title">Oportunidades abertas</h2>
          </div>
          <button className="refresh-button" type="button" onClick={() => void refetch()} disabled={isFetching}>
            {isFetching ? "Atualizando…" : "Atualizar busca"}
          </button>
        </div>
        {isPending && <p className="setup-note" role="status">Consultando programas com prazo aberto na fonte oficial…</p>}
        {error && <div className="error-note" role="alert"><span>{error.message}</span><button type="button" onClick={() => void refetch()}>Tentar novamente</button></div>}
        {data && <p className="update-note" role="status">Consulta realizada em {formatUpdate(data.updatedAt)} · os prazos são conferidos com as datas oficiais de recebimento.</p>}
        {data?.opportunities.length === 0 && <p className="empty-state">Nenhuma oportunidade aberta foi confirmada neste recorte da API. A busca cobre programas de 2026 para RJ destinados a OSCs e prefeituras.</p>}
        <div className="opportunity-list">
          {data?.opportunities.map((item) => (
            <article className="opportunity-card" key={item.id}>
              <div className="card-meta"><span>{item.recordType === "public_call" ? "Chamamento público" : "Programa de transferência"}</span><span>Prazo confirmado</span></div>
              <h3>{item.title}</h3>
              <p className="agency">{item.agency ?? "Órgão não informado"}{item.executingAgency ? ` · ${item.executingAgency}` : ""}</p>
              <dl className="opportunity-details">
                <div><dt>Público informado</dt><dd>{item.audience ?? "Não informado"}</dd></div>
                <div><dt>Recebimento de propostas</dt><dd>{formatDate(item.proposalStart)} até {formatDate(item.deadline)}</dd></div>
              </dl>
              {item.eligibilityCriteria && <p className="criteria">Critérios publicados: {item.eligibilityCriteria}</p>}
              <a className="official-link" href={item.officialUrl} target="_blank" rel="noreferrer">Conferir registro oficial <span aria-hidden="true">↗</span></a>
            </article>
          ))}
        </div>
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
