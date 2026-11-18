# Radar de Editais

Plataforma interna para centralizar oportunidades de financiamento relevantes para a Prefeitura de Queimados/SEPEC e o Instituto Vielas/Casa da Inovação Ziraldo.

## Estado

A primeira integração real consulta a API pública oficial do Transferegov, em `GET /discricionarias/todos-programas`. A interface mostra somente registros com situação `DISPONIBILIZADO`, qualificação contendo `Proposta Voluntária`, natureza jurídica de OSC ou Administração Pública Municipal, UF RJ e datas de recebimento que incluem o dia da consulta (fuso de Brasília). A consulta percorre o ano atual e os cinco anteriores, agrupados por ano de disponibilização e natureza jurídica.

O endpoint retorna programas e não garante que todos sejam editais. `chamamento_projeto` é preservado como estado independente (sim, não ou não informado); prazo (aberto, futuro, expirado ou desconhecido) e elegibilidade também ficam separados. A natureza jurídica e os critérios são apresentados como informações da fonte, nunca como confirmação de elegibilidade da SEPEC, Prefeitura ou Instituto Vielas.

O adaptador captura a data da consulta, órgão concedente e executor, código, natureza jurídica, critérios e início/fim da janela. O link oficial aponta para o registro da API; nem todo registro inclui um PDF ou página do instrumento. Há uma fixture compacta com registros extraídos sem alteração de uma resposta real, com proveniência e consulta registradas em `packages/collectors/src/fixtures/transferegov-programs-2026.json`.

## Requisitos

- Node.js 22.12 ou superior dentro da linha 22 (`.nvmrc`)
- pnpm 10.34.9

## Desenvolvimento

```bash
corepack enable
corepack prepare pnpm@10.34.9 --activate
pnpm install
pnpm dev
```

## Verificações

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

## Estrutura

- `apps/web`: interface Vite, React e Tailwind CSS.
- `packages/core`: tipos, schemas e regras compartilhadas, sem APIs exclusivas do Node.
- `packages/collectors`: contratos dos adaptadores de fontes e tarefas de coleta em Node.
- `supabase`: futura configuração, migrações e políticas do banco.

## API Transferegov

- Documentação oficial: <https://api-publica.transferegov.gestao.gov.br/discricionarias/docs>
- OpenAPI oficial: <https://api-publica.transferegov.gestao.gov.br/discricionarias/openapi.json>
- Consulta usada: `/discricionarias/todos-programas`, paginada pelos parâmetros `pagina` e `tamanho_da_pagina`.
- A OpenAPI aceita `id_programa` nesse endpoint. O link de cada cartão é explicitamente uma consulta técnica à API (`id_programa`, `pagina=1`, `tamanho_da_pagina=200`), pois o conjunto nem sempre oferece URL humana para o edital.
- A busca alcança seis anos-calendário (atual + cinco anteriores). Cada grupo ano/natureza lê até 3 páginas de 200 linhas; o payload informa páginas consultadas, páginas disponíveis, anos completos e motivos de cobertura parcial.
- A Function mantém snapshot fresco no cache da Cloudflare por até 6 horas quando exaustivo (5 minutos se parcial), preserva snapshot de contingência por 7 dias e serve stale com aviso se a API falhar. O Cache API é local ao ponto de presença; uma região sem cache pode executar uma busca fria.
- `pnpm dev` constrói a interface e executa `wrangler pages dev`, para que `/api/transferegov` rode no runtime Pages durante o desenvolvimento. `pnpm dev:vite` é apenas o servidor Vite e não executa a Function.

Não configure credenciais no código. Use variáveis de ambiente; o arquivo `.env.example` contém apenas nomes de variáveis.
