# Persistência e sincronização

## Configuração

1. Crie/seleciona o projeto Supabase da aplicação e aplique `migrations/202611180001_persisted_opportunities.sql` pelo SQL Editor ou Supabase CLI.
2. Em Cloudflare Pages → Settings → Variables and Secrets, configure `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` e `TRANSFEREGOV_SYNC_TOKEN` como secrets. A service role key deve ficar somente no runtime das Functions; não use prefixo `VITE_`.
3. Gere um token longo aleatório para `TRANSFEREGOV_SYNC_TOKEN`. Não o coloque no frontend, em commits ou em URLs.
4. A primeira busca da interface lê a tabela persistida. A sincronização é iniciada por `POST /api/transferegov/sync` com `Authorization: Bearer <token>`.

```sh
curl -X POST "$RADAR_URL/api/transferegov/sync" \
  -H "Authorization: Bearer $TRANSFEREGOV_SYNC_TOKEN"
```

Cada chamada consulta no máximo quatro páginas e salva o cursor. Repita a chamada até `status` retornar `complete`; respostas `partial` preservam o progresso e permitem continuar da próxima página/grupo sem refazer páginas concluídas. A rota não é chamada pelo navegador. Programe a repetição em um agendador com secrets (por exemplo, workflow agendado do GitHub Actions) somente depois de configurar esses secrets.

## Dados e segurança

- `opportunities` armazena a versão atual normalizada com chave composta por fonte e identificador da oportunidade.
- `opportunity_history` registra cada observação feita pela sincronização.
- `source_sync_state` preserva cursor, cobertura, status, última execução e falhas.
- RLS está habilitado e não há políticas/grants de leitura pública. As Pages Functions usam a service role no servidor e oferecem somente endpoints de consulta com campos limitados.
- O filtro SEPEC/Prefeitura ou Instituto Vielas seleciona a natureza jurídica declarada pela fonte para orientar a triagem. Não significa elegibilidade confirmada.
- Resultados cujo prazo já venceu são excluídos da busca pela data atual de Brasília, mesmo que permaneçam no banco. Dados não observados há mais de 24 horas são marcados como desatualizados.

O projeto Supabase e os secrets precisam ser fornecidos/configurados pelo mantenedor; este repositório não contém credenciais nem provisiona um projeto remoto.
