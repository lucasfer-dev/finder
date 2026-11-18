import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";
import { HomePage } from "./App.js";

describe("HomePage", () => {
  it("apresenta a identidade e o estado de consulta da fonte oficial", () => {
    const queryClient = new QueryClient();
    const html = renderToStaticMarkup(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <HomePage />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    expect(html).toContain("Radar de Editais");
    expect(html).toContain("SEPEC");
    expect(html).toContain("Oportunidades abertas");
    expect(html).toContain("Painel de oportunidades");
    expect(html).toContain("Consultando oportunidades persistidas");
    expect(html).not.toContain("Edital fictício");
  });
});
