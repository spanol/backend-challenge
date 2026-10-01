# Roteiro de revisão e apresentação

Comece pela garantia central: uma decisão financeira confirma saldo, transação, ledger e eventos juntos no PostgreSQL. HTTP, SQS e jobs compartilham a mesma regra; duplicação de entrega não duplica dinheiro.

## Revisão em três dias

| Dia | Conceitos                                                                     | Código e exercício                                                                                |
| --- | ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| 1   | Value object, aggregate, invariantes, factories, rehydrate, estados           | Ler Money/Wallet/Wager; explicar BET 80+80 sobre saldo 100 e LOSS sem versão extra                |
| 2   | Unit of Work, Identity Map, MVCC, FOR UPDATE, constraints, idempotência       | Ler portas/UOW/schema; executar testes financeiros e de três processos; explicar replay histórico |
| 3   | At-least-once, inbox, outbox, visibility, leases, DLQ, recuperação e métricas | Ler workers; executar crashes; revisar arquitetura, carga e limites; ensaiar a demonstração       |

Reserve a última sessão para explicar o código sem ler o documento. Se um conceito não estiver claro, reproduza o cenário correspondente e acompanhe uma chamada do controller até o commit.

## Demonstração de 12–15 minutos

1. **Contexto e limites (1 min):** stack, PostgreSQL como autoridade e domínio independente. Abrir o diagrama da arquitetura.
2. **Precisão (2 min):** mostrar parsing/BigInt e o teste do centavo em saldo alto. Explicar por que o adaptador decimal padrão do ORM precisava de comparação exata.
3. **Commit financeiro (3 min):** seguir `WageringService.process` e `MikroFinancialUnitOfWork.run`. Mostrar lock da wallet, ledger e resultado terminal, sem chamada SQS nessa transação.
4. **Concorrência e replay (3 min):** executar `bun run test:concurrency`. Mostrar três PIDs/sessões e os asserts de uma operação e reconciliação. Explicar que FIFO e memória do processo não garantem isso.
5. **Falhas (3 min):** mostrar os dois crashes, o token da outbox e a referência fora de ordem. Explicar o intervalo entre send e publishedAt e o recibo durável downstream.
6. **Operação e escolhas (2 min):** health, métricas, carga, permissões da role e custo do auditor SQL. Explicar auth opcional e a extensão para IdP externo.

Execute antes da apresentação:

```sh
docker compose --profile cluster up --build -d --wait
bun run seed
bun run demo
bun run test:all
```

## Perguntas que você deve conseguir responder

| Pergunta                                                              | Resposta que o código sustenta                                                                                                           |
| --------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Por que BigInt e não number?                                          | Para preservar centavos na aritmética e comparação, inclusive acima do limite de precisão; JSON/SQL continuam strings                    |
| Por que não só idempotência em memória?                               | Instâncias/restarts não compartilham essa memória; UNIQUE e snapshots duráveis sustentam replay                                          |
| Por que lock pessimista?                                              | Serializa a decisão da mesma wallet com saldo atual, sem impedir outras wallets                                                          |
| Para que a versão se já há lock?                                      | Expõe sequência dos movimentos/projeções e permite verificar a continuidade do ledger; não é contador de qualquer UPDATE                 |
| Como garante saldo e ledger juntos?                                   | Transação + constraint deferida: escrever apenas um lado falha no commit                                                                 |
| Por que inbox e chave de negócio?                                     | Inbox identifica entrega lógica; idempotency key identifica operação, inclusive entre HTTP e SQS                                         |
| Por que outbox?                                                       | O commit SQL e o envio SQS não são uma transação única; a outbox preserva responsabilidade de publicar após commit                       |
| Existe exatamente uma entrega?                                        | Não. Há efeito financeiro idempotente; downstream usa eventId e recibo durável                                                           |
| Por que ACK de uma referência ainda ausente?                          | A responsabilidade fica na agenda SQL; manter a FIFO presa poderia impedir o parent de chegar                                            |
| O que acontece se o publisher morrer?                                 | Lease expira; outro worker tenta. Após send pode haver duplicata com o mesmo eventId                                                     |
| Por que REFUND e ROLLBACK não podem estornar diretamente a mesma BET? | Dois créditos diretos devolveriam dinheiro duas vezes; a política adicional está explícita. Rollback de refund é outra referência válida |
| Por que uma reversão pode ser rejeitada por saldo?                    | Reverter um crédito exige debitar; o dinheiro pode ter sido gasto. O código usa failureCode distinto de BET sem fundos                   |
| Qual o trade-off principal?                                           | O auditor SQL reconstrói o ledger da wallet no commit; é verificável, mas o custo cresce com o histórico                                 |
| O que faria em produção?                                              | IdP/JWKS e IAM, gestão de secrets, alertas, backups, avaliação de índices/claims e testes operacionais em AWS; preservar os invariantes  |

## Navegação curta

[Money](../src/domain/money.ts) → [Wallet](../src/domain/wallet.ts) → [Wager](../src/domain/wager.ts) → [serviço](../src/application/wagering.ts) → [porta](../src/application/types/financial.ts) → [UOW](../src/infrastructure/persistence/unit-of-work.ts) → [schema](../src/infrastructure/persistence/schema.ts) → [workers](../src/infrastructure/messaging/workers.ts) → [harness](../tests/concurrency/distributed.test.ts).

Não prometa uma capacidade de produção a partir da carga local. Mostre os números com ambiente, metodologia, reconciliação e os limites registrados. Os 100 pontos são a rubrica; a evidência ajuda o avaliador a verificar a entrega.
