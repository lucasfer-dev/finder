# Persistência e sincronização

## Configuração

1. Crie/selecione um projeto Supabase **exclusivo do Radar** e aplique, na ordem, `migrations/202611180001_persisted_opportunities.sql` e `migrations/202611180002_sync_reconciliation.sql` pelo SQL Editor ou Supabase CLI. Não use bancos de outros projetos.
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
- `opportunity_history` registra descobertas e alterações reais, incluindo desativação por ausência em varredura completa e reativação. Repetições sem alterações não geram um novo snapshot.
- `source_sync_state` preserva cursor, cobertura por grupo, identificador de varredura, estado de execução, lease atômico e falhas. O banco valida o dono do lease antes de aplicar cada lote e mover o cursor.
- RLS está habilitado e não há políticas/grants de leitura pública. As Pages Functions usam a service role no servidor e oferecem somente endpoints de consulta com campos limitados.
- O filtro SEPEC/Prefeitura ou Instituto Vielas seleciona a natureza jurídica declarada pela fonte para orientar a triagem. Não significa elegibilidade confirmada.
- Resultados cujo prazo já venceu ou que foram desativados deixam de aparecer na busca. Registros ausentes em uma coleta **parcial** permanecem até a conclusão de uma varredura completa; resultados desatualizados são sinalizados.
- A disponibilidade do edital e sua elegibilidade continuam sujeitas à confirmação humana. A API não oferece garantia de que uma proposta será aceita.

## Validação no banco

Após aplicar ambas as migrações em um Supabase de desenvolvimento, execute `tests/sync_reconciliation.sql` com um usuário administrativo no SQL Editor. O teste usa transação e `ROLLBACK`, verificando exclusividade do lease, retomada do identificador da varredura, ausência em coleta parcial, desativação após varredura completa, reativação e ausência de histórico duplicado. Não execute o teste em produção.

**Limitação:** testes unitários e CI não executam esta migração no PostgreSQL. O fluxo de ponta a ponta só estará validado após aplicar o SQL e executar a suíte no banco de desenvolvimento.


## Sincronização agendada

Após publicar a Function e configurar `TRANSFEREGOV_SYNC_TOKEN` como secret nas Pages Functions, configure no GitHub → Settings → Secrets and variables → Actions:

- Variable `RADAR_BASE_URL`: URL base do site publicado, sem barra final.
- Secret `TRANSFEREGOV_SYNC_TOKEN`: o mesmo token configurado na Pages Function.

O workflow `.github/workflows/transferegov-sync.yml` executa diariamente às 09:23 de Brasília e também aceita execução manual. Ele processa no máximo 30 lotes (quatro páginas por lote), não inicia duas execuções simultâneas, respeita o lease do banco, tenta novamente falhas HTTP e deixa o cursor salvo caso a cobertura continue parcial. Até os dois valores serem configurados, o workflow termina com aviso e não chama a API.
