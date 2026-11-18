import { fetchOpenTransferegovPrograms } from "@radar/collectors/transferegov";

interface PagesContext {
  request: Request;
}

export async function onRequestGet({ request }: PagesContext): Promise<Response> {
  void request;
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());
  try {
    const opportunities = await fetchOpenTransferegovPrograms({ today });
    return Response.json({
      source: "Transferegov.br",
      integration: "official_api",
      updatedAt: new Date().toISOString(),
      opportunities,
      restrictions: [
        "Elegibilidade indicada pela natureza jurídica e pelos critérios publicados; confirme as regras no documento oficial.",
        "A fonte nem sempre disponibiliza link direto para o edital.",
      ],
    }, { headers: { "Cache-Control": "public, max-age=300, s-maxage=300" } });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Falha ao consultar Transferegov." }, { status: 502 });
  }
}
