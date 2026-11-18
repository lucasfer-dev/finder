import { describe, expect, it } from "vitest";
import type { SourceAdapter } from "./source-adapter.js";

describe("contrato de adaptador", () => {
  it("expõe capacidade de confirmar prazo separada da busca histórica", () => {
    const source: SourceAdapter = {
      id: "transferegov",
      name: "Transferegov",
      integrationType: "official_api",
      capabilities: {
        historicalSearch: true,
        monitoring: true,
        confirmsOpenDeadline: false,
      },
      knownRestrictions: ["Confirmar os campos de prazo na documentação da API antes de integrar."],
    };

    expect(source.capabilities.historicalSearch).toBe(true);
    expect(source.capabilities.confirmsOpenDeadline).toBe(false);
  });
});
