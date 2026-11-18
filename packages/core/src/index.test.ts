import { describe, expect, it } from "vitest";
import { OpportunitySchema } from "./index.js";

const validOpportunity = {
  title: "Chamada pública de exemplo",
  sourceName: "Fonte oficial",
  sourceUrl: "https://example.gov.br/chamadas",
  officialUrl: "https://example.gov.br/edital.pdf",
  discoveredAt: "2026-11-18T12:00:00-03:00",
  deadline: null,
  deadlineStatus: "unknown",
} as const;

describe("OpportunitySchema", () => {
  it("aceita oportunidade com prazo desconhecido sem inventar uma data", () => {
    expect(OpportunitySchema.safeParse(validOpportunity).success).toBe(true);
  });

  it("rejeita URLs que não são HTTP(S)", () => {
    expect(
      OpportunitySchema.safeParse({ ...validOpportunity, officialUrl: "javascript:alert(1)" }).success,
    ).toBe(false);
  });
});
