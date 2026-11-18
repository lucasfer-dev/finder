import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Link, Route, Routes } from "react-router";

const queryClient = new QueryClient();

export function HomePage() {
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
        <p className="setup-note" role="status">
          A base está sendo preparada. A busca de fontes oficiais será conectada na próxima etapa.
        </p>
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
