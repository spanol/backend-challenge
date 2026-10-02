# API HTTP e mensageria

Consulte o [README](../README.md) para iniciar a aplicação. Os exemplos usam a API local sem autenticação; para Keycloak, veja os [perfis de execução](RUNNING.md#autenticação-e-observabilidade).

## Rotas HTTP

| Método | Rota                                                                  | Resultado                                                             |
| ------ | --------------------------------------------------------------------- | --------------------------------------------------------------------- |
| POST   | `/wallets`                                                            | Abertura; saldo positivo gera OPENING e ledger, versão 1              |
| GET    | `/wallets/:walletId`                                                  | Saldo e versão                                                        |
| GET    | `/wallets/:walletId/ledger?limit=50&cursor=...`                       | Ordem crescente de versão; cursor opaco; limite 1–100                 |
| POST   | `/wagering/transactions`                                              | Processamento pelo header obrigatório `Idempotency-Key`               |
| GET    | `/wagering/transactions/:transactionId`                               | Estado durável e resultado histórico quando terminal                  |
| GET    | `/wagering/transactions/:transactionId/accounting-journal`            | Partidas dobradas imutáveis; lista vazia para operações sem ledger    |
| GET    | `/providers/:providerId/wagering/transactions/:externalTransactionId` | Consulta pelo namespace do provedor                                   |
| POST   | `/wallets/:walletId/reconciliation`                                   | Saldo armazenado, soma do ledger e diferença; sem correção automática |
| GET    | `/health/live`                                                        | Processo vivo; público                                                |
| GET    | `/health/ready`                                                       | PostgreSQL e as três filas disponíveis; público                       |
| GET    | `/metrics`                                                            | Métricas Prometheus                                                   |

Abrir uma carteira:

```json
{
  "playerId": "11111111-1111-4111-8111-111111111111",
  "initialBalance": { "amount": "100.00", "currency": "BRL" }
}
```

A resposta `201` da abertura identifica a wallet pelo campo `id`; use esse valor como `walletId` ao submeter uma aposta com `Idempotency-Key: provider-bet-001`:

```json
{
  "providerId": "demo-provider",
  "externalTransactionId": "bet-001",
  "playerId": "11111111-1111-4111-8111-111111111111",
  "walletId": "UUID-DEVOLVIDO-NA-ABERTURA",
  "roundId": "round-001",
  "gameId": "game-001",
  "kind": "BET",
  "money": { "amount": "25.00", "currency": "BRL" }
}
```

Use `WIN`, `LOSS`, `REFUND` ou `ROLLBACK` no mesmo contrato. REFUND/ROLLBACK exigem `referenceExternalTransactionId`; WIN aceita referência opcional a BET. Reversões são integrais. A política permite uma única reversão direta por referência, inclusive entre REFUND e ROLLBACK. ROLLBACK de REFUND continua permitido.

Amounts precisam ser strings com exatamente duas casas. `25`, `"25"`, `"25.0"`, `"25.001"`, `"1e2"` e negativos são inválidos. BET/WIN/REFUND/ROLLBACK exigem valor positivo; LOSS admite `"0.00"`. Abertura aceita zero. Moedas são ISO-4217; há uma carteira por jogador/moeda.

Respostas: 201 abertura; 200 processamento/replay; 202 referência pendente; 400 contrato inválido; 404 recurso inexistente; 409 conflito; 422 rejeição financeira auditável; 503 indisponibilidade/FAILED. `X-Correlation-Id` é propagado ou gerado. Chave no corpo HTTP é recusada; no SQS vem em `data.idempotencyKey`.

## SQS e recuperação

Filas: `wager-transactions.fifo`, `wager-transactions-dlq.fifo` e `wager-events.fifo`. Exemplo de entrada:

```json
{
  "messageId": "33333333-3333-4333-8333-333333333333",
  "type": "WagerTransactionRequested",
  "occurredAt": "2026-09-30T12:00:00.000Z",
  "data": {
    "providerId": "demo-provider",
    "externalTransactionId": "bet-001",
    "idempotencyKey": "provider-bet-001",
    "playerId": "11111111-1111-4111-8111-111111111111",
    "walletId": "UUID-DEVOLVIDO-NA-ABERTURA",
    "roundId": "round-001",
    "gameId": "game-001",
    "kind": "BET",
    "money": { "amount": "25.00", "currency": "BRL" }
  }
}
```

Envie com `MessageGroupId=walletId` e `MessageDeduplicationId=messageId`. Inbox verifica o ID lógico do corpo; o receipt handle do SQS é usado exclusivamente para visibilidade/ACK.

Rejeições de negócio são confirmadas e recebem ACK. Falhas transitórias ficam sem ACK, com redrive após cinco recebimentos. Falhas permanentes são auditadas e enviadas à DLQ antes de excluir a origem. O auditor da DLQ persiste diagnóstico quando o banco volta e **mantém as mensagens na DLQ** para inspeção/redrive deliberado.

Referências pendentes têm TTL de 15 minutos, no máximo 20 reprocessamentos e backoff de 1–60 segundos. Inbox é confirmada mesmo na pendência, liberando a FIFO para o parent chegar. Outbox usa lease de 30 segundos, token e retry persistente. SIGTERM interrompe aquisições, aguarda até 25 segundos e devolve mensagens em voo; o Compose concede 35 segundos.
