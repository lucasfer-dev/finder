# Radar de Editais

Plataforma interna para centralizar oportunidades de financiamento relevantes para a Prefeitura de Queimados/SEPEC e o Instituto Vielas/Casa da Inovação Ziraldo.

## Estado

Fundação do monorepo. A primeira integração com uma fonte oficial será escolhida após a investigação técnica; este esqueleto ainda não busca nem apresenta editais reais.

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

Não configure credenciais no código. Use variáveis de ambiente; o arquivo `.env.example` contém apenas nomes de variáveis.
