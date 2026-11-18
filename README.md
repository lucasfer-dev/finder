# Radar de Editais

Plataforma interna para centralizar oportunidades de financiamento relevantes para a Prefeitura de Queimados/SEPEC e o Instituto Vielas/Casa da Inovação Ziraldo.

## Estado

A primeira integração real consulta a API pública oficial do Transferegov, em `GET /discricionarias/todos-programas`. A interface mostra somente registros com situação `DISPONIBILIZADO`, qualificação contendo `Proposta Voluntária`, natureza jurídica de OSC ou Administração Pública Municipal, UF RJ e datas de recebimento que incluem o dia da consulta (fuso de Brasília).

O endpoint retorna programas e não garante que todos sejam editais. `chamamento_projeto` é preservado como classificação; um registro sem chamamento aparece como programa. O endpoint não tem campo estruturado de público-alvo para este uso: a natureza jurídica e os critérios são apresentados como informações da fonte, e a organização precisa validar a elegibilidade no registro/documento oficial.

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
- A interface chama `/api/transferegov`; a Function consulta o serviço para evitar depender de CORS no navegador e mantém cache público de 5 minutos.
- A busca desta etapa cobre o ano de disponibilização atual e oportunidades de RJ dirigidas à natureza jurídica municipal ou OSC. A API também permite busca histórica por ano; a interface ainda não oferece esse filtro.

Não configure credenciais no código. Use variáveis de ambiente; o arquivo `.env.example` contém apenas nomes de variáveis.
