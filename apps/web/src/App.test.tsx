import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";
import { HomePage } from "./App.js";

describe("HomePage", () => {
  it("apresenta a identidade e o estado real da fundação", () => {
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <HomePage />
      </MemoryRouter>,
    );

    expect(html).toContain("Radar de Editais");
    expect(html).toContain("SEPEC");
    expect(html).toContain("busca de fontes oficiais será conectada na próxima etapa");
  });
});
