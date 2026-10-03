# Roteiro de revisão e apresentação

Comece pela garantia central: uma decisão financeira confirma saldo, transação, ledger e eventos juntos no PostgreSQL. HTTP, SQS e jobs compartilham a mesma regra; duplicação de entrega não duplica dinheiro.

## Revisão em três dias

| Dia | Conceitos                                                                     | Código e exercício                                                                                |
| --- | ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| 1   | Value object, aggregate, invariantes, factories, rehydrate, estados           | Ler Money/Wallet/Wager; explicar BET 80+80 sobre saldo 100 e LOSS sem versão extra                |
| 2   | Unit of Work, Identity Map, MVCC, FOR UPDATE, constraints, idempotência       | Ler portas/UOW/schema; executar testes financeiros e de três processos; explicar replay histórico |
| 3   | At-least-once, inbox, outbox, visibility, leases, DLQ, recuperação e métricas | Ler workers; executar crashes; revisar arquitetura, carga e limites; ensaiar a demonstração       |

Reserve a última sessão para explicar o código sem ler o documento. Se um conceito não estiver claro, reproduza o cenário correspondente e acompanhe uma chamada do controller até o commit.

## Demonstração ao vivo: Decolagem e Grafana

Prepare duas janelas lado a lado: [Decolagem](https://jungle.subiu.dev) e o dashboard `http://localhost:39333/d/distributed-wagering-overview`. O Grafana do servidor exige o túnel `ssh -N -L 39333:127.0.0.1:39323 subiu` e login local; ele não é uma página pública. Antes da call, confirme `/health/ready`, abra a demo pública e selecione no Grafana uma janela recente com atualização automática. Abra também [as evidências](../evidence/README.md) em outra aba, como registro das cargas anteriores.

1. **Fluxo financeiro (3 min):** crie uma sessão e agende uma aposta; ela entra automaticamente na rodada seguinte. Faça um desfecho (WIN ou REFUND), mostre saldo, ledger e reconciliação na própria demo. Repita uma operação para mostrar o resultado histórico sem novo movimento.
2. **Observabilidade (2 min):** no Grafana, mostre a operação recebida, o status HTTP e a latência. Filtre os logs pelo identificador da operação e abra o trace correspondente. Explique que o dashboard consulta Prometheus, Loki e Tempo.
3. **Concorrência (3 min):** execute a disputa da mesa compartilhada: 24 apostas de 80.00 sobre 100.00. Mostre uma aceitação, as rejeições por saldo e a reconciliação. No Grafana, aponte a variação de operações e rejeições na mesma janela.
4. **Carga no ambiente de produção simulado (2 min):** abra [a galeria de carga](../evidence/README.md). Os ensaios somaram 98.600 operações HTTP nos dois hosts e chegaram a 256 clientes simultâneos; mostre latência, recursos, reconciliação e drenagem da outbox. A rajada SQS de 1.000 comandos é uma medição diferente.

Se a call pedir detalhes de implementação, siga a navegação curta abaixo. A interface da demo é pública; o middleware BasicAuth continua protegendo a API financeira no proxy. O OIDC/JWKS com Keycloak é o mecanismo opcional de identidade do provedor, exercitado em E2E. As capturas e os relatórios permitem mostrar os cenários históricos sem repetir carga pesada no servidor compartilhado durante a conversa.

## Revisão técnica de 12–15 minutos

1. **Contexto e limites (1 min):** stack, PostgreSQL como autoridade e domínio independente. Abrir o diagrama da arquitetura.
2. **Precisão (2 min):** mostrar parsing/BigInt e o teste do centavo em saldo alto. Explicar por que o adaptador decimal padrão do ORM precisava de comparação exata.
3. **Commit financeiro (3 min):** seguir `WageringService.process` e `MikroFinancialUnitOfWork.run`. Mostrar lock da wallet, ledger e resultado terminal, sem chamada SQS nessa transação.
4. **Concorrência e replay (3 min):** executar `bun run test:concurrency`. Mostrar três PIDs/sessões e os asserts de uma operação e reconciliação. Explicar que FIFO e memória do processo não garantem isso.
5. **Falhas (3 min):** mostrar os dois crashes, o token da outbox e a referência fora de ordem. Explicar o intervalo entre send e publishedAt e o recibo durável downstream.
6. **Operação e escolhas (2 min):** health, métricas, carga, permissões da role e custo do auditor SQL. Explicar auth opcional e a extensão para IdP externo.

Para reproduzir localmente o serviço e o CLI demo, fora da janela da call:

```sh
docker compose --profile app up --build -d --wait
docker compose exec app bun run seed
docker compose exec app bun run demo
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
| O que faltaria para uma operação comercial?                           | OIDC/JWKS já foi integrado e testado. Evoluir IAM, gestão de segredos, alertas, backups e operação em AWS, preservando os invariantes    |

## Navegação curta

[Money](../src/domain/money.ts) → [Wallet](../src/domain/wallet.ts) → [Wager](../src/domain/wager.ts) → [serviço](../src/application/wagering.ts) → [porta](../src/application/types/financial.ts) → [UOW](../src/infrastructure/persistence/unit-of-work.ts) → [schema](../src/infrastructure/persistence/schema.ts) → [workers](../src/infrastructure/messaging/workers.ts) → [harness](../tests/concurrency/distributed.test.ts).

O deploy no subiu foi feito para simular a operação em produção: serviços persistentes, recursos limitados, HTTPS, fila, banco e observabilidade no mesmo servidor que hospeda outras aplicações. Mostre o comportamento medido ali e no host local, com ambiente, metodologia, reconciliação e limites registrados. Os 100 pontos são a rubrica; as evidências ajudam o avaliador a verificar a entrega.
