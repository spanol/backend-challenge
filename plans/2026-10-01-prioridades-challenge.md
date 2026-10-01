# Prioridades de continuidade do challenge — 2026-10-01

## Estado de retomada

- Handoff aceito para `jungle-gaming/backend-challenge`.
- Antes desta nota, HEAD era `55ce075e02e0d3f97608dec58c5c83683499d058`, a árvore de trabalho estava limpa e `main` estava um commit à frente de `origin/main`. Após criar este plano, ele é o único arquivo não rastreado.
- A prova completa mais recente registrada é Docker/Linux: 82 testes, zero falhas/skips e 656 assertions. Esta retomada não executou testes.
- `CHALLENGE.md` permanece intacto; SHA-256 verificado: `47795FCE2FC38CAE5F1B91368EBAF80B7A2ED1FE147F36704B665FAF0613812E`.
- Demo Decolagem preservada no stash `52059667d49394573864fb684423993ae53698b6` (`stash@{0}` nesta conferência). Não aplicar durante o trabalho do challenge.

## Ordem recomendada

### 1. Fechar a consistência da interpretação financeira — concluído

O §7 de `CHALLENGE.md` proíbe repetir reversão da mesma referência pelo mesmo tipo. `FIN-08` em `spec.md` mantém essa regra, enquanto `INT-03` e `ADR-08` adotam uma única reversão direta total, inclusive entre `REFUND` e `ROLLBACK`. O §7 também permite documentar interpretações adicionais.

Implementado: `FIN-08` agora alinha com `INT-03`/`ADR-08`; a especificação explica por que a regra mais estrita evita crédito duplicado e que `ROLLBACK` de um `REFUND` continua permitido. AC-21 cobre a tentativa entre tipos. Nenhum código financeiro ou migration foi alterado.

Verificado: §7 permaneceu intacto; `FIN-08`, `INT-03`, `ADR-08`, rastreabilidade e AC-21 descrevem a mesma política. Integração confirma a rejeição, ausência de movimento no saldo/ledger e evento de rejeição persistido.

### 2. Alinhar a resposta de criação de wallet ao exemplo HTTP — concluído

`POST /wallets` atualmente responde `walletId`; o exemplo do §9 de `CHALLENGE.md` responde `id`. O enunciado não comprova que um avaliador aceite a diferença.

Implementado: o adaptador HTTP responde com `id` e continua usando `walletId` internamente e nos comandos subsequentes. README, asserção HTTP e rastreabilidade foram atualizados.

Verificado: integração confirmou a resposta `id` e que a resposta de criação não contém `walletId`.

### 3. Completar a evidência de entrega

O workflow do GitHub Actions está configurado, mas não há execução remota registrada. A branch local está um commit à frente do remoto.

Após a publicação autorizada do commit, conferir a execução do workflow. Registrar o resultado e, se necessário, a evidência de build em checkout limpo. Não publicar como parte desta priorização.

## Fora desta fila

O handoff mais recente registra como fechadas as lacunas anteriores de unidade, reconciliação, atomicidade, eventos e shutdown no gate completo. Reavaliar apenas se nova evidência contrariar esses resultados. Frontend/demo continua separado do challenge e permanece no stash até instrução futura.

Validação desta execução: `bun run check` passou (typecheck, lint e formato); `bun run test:integration` passou com 25 testes, zero falhas/skips e limpeza completa do banco/filas de teste. `verify:full` e concorrência não foram repetidos.
