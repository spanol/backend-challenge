# Revisão final do challenge — 01/10/2026

A conferência do enunciado, da implementação e das evidências não identificou requisito obrigatório pendente nem falha eliminatória nos cenários executados. O gate completo e o E2E complementar com Keycloak real passaram: **152 testes, 1.489 assertions, zero falhas e zero skips**. A conclusão se aplica ao escopo e aos cenários documentados; não é uma previsão da nota dos avaliadores.

## Execução final

Código-base: commit `12adc9f`. Imagem Docker/Linux `jungle-challenge:final-audit-20261001-12adc9f`, ID `sha256:a01dd66ed969d325cd6bd3a2e62d4f3ad4f32f1ba58bc5f19c23d1fdc12e47e8`. Bun 1.4.2, PostgreSQL 17.6, LocalStack 4.9.2 e Keycloak 26.6.4, em stack exclusiva `jungle-final-audit-20261001`, sem portas publicadas.

| Verificação                           | Resultado                                    |
| ------------------------------------- | -------------------------------------------- |
| TypeScript estrito, ESLint e Prettier | Passaram                                     |
| Unidade                               | 75 testes / 344 assertions                   |
| Integração PostgreSQL/SQS             | 51 testes / 588 assertions                   |
| Concorrência entre processos          | 11 testes / 486 assertions                   |
| Keycloak real                         | 15 testes / 71 assertions                    |
| Oito migrations                       | `up → down → up` nos bancos exclusivos       |
| Limpeza dos bancos e filas de teste   | Confirmada pelos três relatórios de recursos |
| Health público do subiu               | `status: ok`, PostgreSQL e SQS disponíveis   |

`verify:full` executou de **20:30:46.654 a 20:35:29.483 UTC**. O E2E Keycloak terminou em seguida, com 15 testes passando em 9,31 segundos de suíte. O health público foi coletado às 20:34:20.962 UTC. A infraestrutura descartável foi removida depois da conclusão dos testes.

Comandos executados a partir da raiz do projeto, com `JUNGLE_IMAGE=jungle-challenge:final-audit-20261001-12adc9f` e diretórios de relatórios montados em `/app/test-results`:

```sh
docker compose -f compose.idp.yaml -p jungle-final-audit-20261001 --profile idp run --build --rm --name jungle-final-audit-full -v D:/code/jungle-gaming/backend-challenge/test-results/final-audit-20261001/full:/app/test-results idp-test bun run verify:full
docker compose -f compose.idp.yaml -p jungle-final-audit-20261001 --profile idp run --rm --no-deps --name jungle-final-audit-idp -v D:/code/jungle-gaming/backend-challenge/test-results/final-audit-20261001/idp:/app/test-results idp-test
docker compose -f compose.idp.yaml -p jungle-final-audit-20261001 --profile idp down -v
```

O último comando remove exclusivamente a stack descartável criada para esta revisão. Para outra execução, escolha um nome de projeto próprio e ajuste os caminhos conforme [DEVELOPMENT](DEVELOPMENT.md) e [IDP-E2E](IDP-E2E.md).

## Conferência do enunciado

| Seção                          | Resultado e evidência                                                                                                                                                                              |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| §1 e §3 — correção distribuída | Saldo, transação, ledger, inbox e outbox confirmam juntos; duplicação, referência fora de ordem e recuperação exercitadas nas suítes reais.                                                        |
| §2 — autenticação opcional     | OIDC/JWKS com Keycloak real; issuer, audience, assinatura, expiração e provedor validados. Health público; sem cadastro artesanal de senhas.                                                       |
| §4 — stack                     | Bun, TypeScript estrito, NestJS, MikroORM, PostgreSQL, SQS/LocalStack e Compose; oito migrations reversíveis.                                                                                      |
| §5 — restrições invioláveis    | Dinheiro BigInt/strings; idempotência SQL; garantia independente de FIFO; publicação após commit; ledger imutável; lock por carteira; múltiplos processos e constraints no banco.                  |
| §6 — modelagem e schema        | Factories, construtores encapsulados, reidratação, Money imutável, estados terminais e eventos em classes. Unicidade, saldo não negativo, histórico e resultado terminal protegidos no PostgreSQL. |
| §7 — operações                 | BET/WIN/LOSS/REFUND/ROLLBACK, contexto da referência, reversão integral, insuficiência de saldo, replay histórico, pendência com backoff/TTL e códigos de falha estáveis.                          |
| §8 — concorrência              | Cinquenta duplicatas em três processos/sessões; disputa 100/80/80; carteira independente progride enquanto outra está travada; cenários adicionais de quatro e seis processos.                     |
| §9 — HTTP                      | Abertura com `id`, consultas internas/externas, ledger com cursor estável, submissão, reconciliação e health. Códigos 201/200/202/400/404/409/422/503 distinguidos e exercitados.                  |
| §10 — SQS                      | Mesmo caso de uso do HTTP, inbox persistente, ACK após commit, retry/redrive limitado, DLQ auditável e SIGTERM real com mensagem em andamento.                                                     |
| §11 — outbox                   | Dois publishers em processos distintos; claims com lease/token; falha antes/depois do envio, confirmação parcial de lote e deduplicação downstream. Eventos sobrevivem ao restart.                 |
| §12 — observabilidade          | Logs JSON com IDs aplicáveis, sem payload financeiro completo; métricas exigidas e health separados. Evidências anteriores preservam consultas e capturas de Prometheus/Loki/Tempo no Grafana.     |
| §13 — testes                   | Unidade, integração em containers reais e concorrência com PIDs/sessões independentes; crashes reais, SIGTERM e reconciliação ao final dos cenários. Zero skips no gate Linux.                     |
| §14 — avaliação e diferenciais | Todas as áreas da rubrica possuem rastreabilidade. Partidas dobradas, OIDC, OpenTelemetry, dashboard e carga foram implementados e exercitados. Não há meta de RPS no enunciado.                   |

A correspondência detalhada dos requisitos e dos critérios AC-01 a AC-31 permanece em [TRACEABILITY](TRACEABILITY.md). A revisão também conferiu 108 links locais nos documentos principais e preservou hashes de 119 arquivos de implementação, scripts, testes e demo.

## Decisões e limites da entrega

- INT-03 permite uma única reversão direta por referência, inclusive entre REFUND e ROLLBACK. É uma restrição adicional documentada em relação à unicidade mínima por tipo do enunciado; ROLLBACK de REFUND continua permitido. A justificativa e os testes estão na especificação e na arquitetura.
- Chave de idempotência global, tratamento de valor zero, WIN com referência opcional e replay de pendências são escolhas explícitas em INT-01 a INT-07.
- Retry de entrada SQS usa a espera de visibilidade e redrive após cinco recebimentos; referências pendentes e publicações de outbox têm backoff exponencial. ACK e efeitos financeiros permanecem persistentes.
- A carga anterior soma 98.600 operações HTTP medidas nos dois hosts, com até 256 clientes simultâneos. A rajada de 1.000 comandos SQS não equivale a 1.000 jogadores simultâneos. Vazão, latência, backlog e drenagem estão em [LOAD-EVIDENCE](LOAD-EVIDENCE.md).
- O auditor SQL tem custo proporcional ao histórico da carteira. A carga mostrou aumento de espera e atraso de publicação; a entrega não promete capacidade máxima ou SLO de produção.
- A prova do IDP é o perfil OIDC e o E2E isolado. A interface pública da demo não exige login; BasicAuth continua no router público da API financeira.
- GitHub Actions está configurado; sua execução remota não foi realizada nem é requisito do enunciado. A revisão final executou Docker/Linux localmente e reutilizou as evidências anteriores do subiu, de carga e de telemetria.

## Artefatos e ajustes

Resultados completos em `test-results/final-audit-20261001/`: `full/verify-full.json`, JUnit das suítes, relatórios de limpeza, `idp/idp.junit.xml`, `public-health.json` e `source-review.json`. Esses arquivos são ignorados pelo Git, conforme o contrato do projeto.

Foram corrigidos registros desatualizados de contagem de testes, número de migrations e situação da demo. A demo está integrada e implantada; `stash@{0}` permanece como backup. O código financeiro não precisou de alteração nesta revisão.

`CHALLENGE.md` permanece byte a byte intacto, SHA-256 `47795fce2fc38cae5f1b91368ebaf80b7a2ed1fe147f36704b665faf0613812e`.
