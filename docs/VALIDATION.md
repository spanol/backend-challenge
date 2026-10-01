# Validação executada

Registro de 30 de setembro de 2026. Ambiente: Windows host, Bun 1.4.2, TypeScript 5.9.3, NestJS 12.1.2, MikroORM 6.6.0, Docker Linux/x86_64 29.5.3, Compose 5.1.4, PostgreSQL 17.6-alpine e LocalStack 4.9.2.

## Auditoria contra o challenge

Em 30/09/2026, às 21:57:54–21:59:34 em America/Sao_Paulo (01/10/2026, 00:57:54–00:59:34 UTC), `bun run verify:full` foi repetido sobre o código já commitado, no Windows/Bun 1.4.2 com PostgreSQL 17.6 e LocalStack 4.9.2 em Docker. O comando terminou com exit code 0: typecheck, lint sem warnings, formatação e todas as suítes aprovados.

Foram **54 testes, zero falhas e 215 assertions em nove arquivos**: 26 de unidade, 21 de integração e sete de concorrência. Bun test levou 54,31 s; o gate completo, 100,43 s. Os sete testes distribuídos combinam os oito cenários obrigatórios do enunciado.

Evidências: `test-results/verify-challenge-audit.log`, `test-results/verify-full.json`, `test-results/all.junit.xml` e `test-results/resources-all.json`. O JUnit confirmou 54 casos sem falhas. O runner usou `wagering_test_1790816317360_84d7639f`, verificou migrations em banco novo e registrou `cleanupComplete: true`, sem recursos cuja limpeza falhou. Banco e filas principais não foram usados para rollback ou limpeza.

A revisão das assertions identificou evidências parciais apesar do gate aprovado: unidade das cinco operações/idempotência, reconciliação final de todas as carteiras, consulta direta de inbox/outbox após rollback, eventos de LOSS/expiração, HTTP de falha e SIGTERM com mensagem controladamente em andamento. O [mapa de requisitos](TRACEABILITY.md) detalha essas lacunas. Na auditoria, a documentação ainda não tinha commit; ela integra agora o commit de documentação, com o mapa atualizado para fechar somente essa pendência. Nenhuma mudança de comportamento, migration ou harness foi feita nesta auditoria; somente o mapa, o estado da especificação e este registro foram atualizados após o gate.

Os três documentos atualizados foram formatados com `bun run --bun prettier --write docs/TRACEABILITY.md docs/VALIDATION.md specs/001-distributed-wagering/spec.md`, com exit code 0. O enunciado permaneceu com SHA-256 `47795FCE2FC38CAE5F1B91368EBAF80B7A2ED1FE147F36704B665FAF0613812E`.

## Execuções anteriores

**Após a padronização do espaçamento: 54 testes passaram no Windows com PostgreSQL/SQS em Docker, zero falhas e 215 assertions em nove arquivos.** O gate completo aprovou typecheck estrito, ESLint sem warnings, Prettier e todas as suítes. As execuções anteriores também estão registradas abaixo.

| Execução                                                   | Comando                                               | Resultado                        |
| ---------------------------------------------------------- | ----------------------------------------------------- | -------------------------------- |
| Windows, espaçamento padronizado, PostgreSQL/SQS em Docker | `bun run verify:full`                                 | 54 testes, zero falhas, 45,67 s  |
| Windows, contratos extraídos, PostgreSQL/SQS em Docker     | `bun run verify:full`                                 | 54 testes, zero falhas, 64,10 s  |
| Windows, antes da extração                                 | `bun run verify:full`                                 | 54 testes, zero falhas, 140,25 s |
| Docker/Linux, antes da extração                            | `docker compose --profile test run --build --rm test` | 54 testes, zero falhas, 64,13 s  |

Os tempos da tabela medem o Bun test. O gate completo após a padronização do espaçamento, incluindo checks, criação/migrations e limpeza, levou 91,59 s, de 23:42:52 a 23:44:24 UTC. Após a extração de tipos, levou 134,99 s, de 23:06:40 a 23:08:55 UTC. A execução Windows anterior levou 265,11 s. O gate Docker/Linux não foi repetido após a extração.

Foram comprovados três processos/sessões distintos e sobrepostos, 50 duplicatas, disputa de saldo, wallets independentes, refunds concorrentes, snapshots sob escrita, crashes de consumidor/publisher e referência recuperada por novo processo.

A suíte também validou migrations `up → down → up` em banco exclusivo, SQL direto contra as proteções, precisão de um centavo em saldo alto, HTTP/SQS, redrive após cinco tentativas, DLQ auditada e efeito downstream idempotente em SQL. A execução após a padronização do espaçamento está em `test-results/verify-code-spacing.log`, e a extração está em `test-results/verify-contract-refactor.log`; as anteriores estão em `test-results/verify-windows.log` e `test-results/verify-docker.log` (ignorados pelo Git).

As cinco migrations foram exercitadas. A última fixa o `search_path` dos triggers: o teste cria uma tabela temporária `wallets` com a role da aplicação, tenta alterar apenas o saldo real e comprova rejeição no commit e reconciliação preservada.

## Extração de tipos e contratos

Os contratos foram agrupados em 18 arquivos `types/` nas respectivas camadas; `wagerKinds` e o token `RUNTIME` foram extraídos para `constants/`. Imports de aplicação, infraestrutura, scripts e testes foram atualizados, assim como os links da documentação. O resultado financeiro persistido reutiliza `StoredResult` e a direção do ledger reutiliza `LedgerDirection`.

Uma comparação da estrutura JavaScript emitida dos 44 arquivos existentes, ignorando imports e descontando a movimentação das duas constantes, não encontrou mudanças de lógica. Os 18 arquivos de contratos não geram lógica em runtime e as constantes preservam suas definições. O relatório está em `test-results/contract-refactor.json`. Essa revisão complementa o gate completo executado sobre o código reorganizado.

`verify-full.json` registrou sucesso em todas as etapas, e `resources-all.json` confirmou `cleanupComplete: true` e nenhuma falha na limpeza. Os recursos exclusivos desta execução foram removidos.

## Espaçamento do código

Foram revisados 64 arquivos TypeScript e ajustados 45. Uma linha em branco separa funções, classes, métodos, getters e etapas de preparação, validação, execução e retorno. Campos e propriedades relacionadas permanecem juntos. O padrão está registrado em [DEVELOPMENT](DEVELOPMENT.md#regras-de-código).

A comparação dos arquivos anteriores com os finais confirmou alterações somente de whitespace e a mesma estrutura sintática em todos os 64 arquivos, incluindo tipos e literais de strings, templates SQL e expressões regulares. Os relatórios estão em `test-results/code-spacing.json` e `test-results/code-spacing-check.json`.

`bun run verify:full` aprovou todas as etapas. O JUnit confirmou 54 casos e nenhuma falha; a harness confirmou limpeza completa do banco e das filas exclusivos desta execução.

## Gate de qualidade e harnesses

ESLint 10.11.0 e typescript-eslint 8.71.0 executaram análise com tipos, regras de dependência entre camadas e verificações assíncronas. Três exemplos deliberadamente inválidos, analisados sem mudar arquivos de produto, foram bloqueados: framework no domínio, infraestrutura na aplicação e promise abandonada.

Cinco novos testes comprovaram identificação obrigatória dos recursos, rejeição de banco/prefixo compartilhado e término real de um processo filho antes da barreira IPC. O JUnit do Windows foi lido como XML e confirmou 54 casos e zero falhas. `resources-all.json` confirmou limpeza completa, sem recursos pendentes; `verify-full.json` registrou sucesso de todas as etapas.

A primeira execução Windows da nova harness expôs timeout de lock quando a fixture atrasava todos os replays em 200 ms. A espera foi limitada ao primeiro commit de cada processo, preservando as assertions; as cinquenta duplicatas passaram em 7,89 s na execução final. Os retries dos testes permaneceram desabilitados e o timeout de lock de produção permaneceu em cinco segundos.

O workflow GitHub Actions foi configurado com versões fixadas por SHA, Bun fixado, infraestrutura real e coleta de evidências. Sua execução no GitHub ainda não ocorreu; o mesmo comando foi aprovado localmente nos dois ambientes. Detalhes dos comandos e configurações estão em [DEVELOPMENT](DEVELOPMENT.md).

## Operação Docker — execução anterior à extração

Cluster com três aplicações, PostgreSQL e LocalStack saudáveis. Porta 3000 estava ocupada por outro serviço; o `.env` local configura **3100–3102**, sem encerrar esse serviço. Defaults para uma instalação nova permanecem 3000–3002.

O cluster final foi reconstruído após as cinco migrations. As três aplicações receberam apenas `DATABASE_URL` da role restrita, `PORT` e `SQS_ENDPOINT`; nenhuma recebeu `DATABASE_ADMIN_URL`.

Após a carga final, uma consulta SQL sobre todas as carteiras encontrou **zero divergências** entre saldo e soma assinada do ledger. A outbox tinha **zero eventos não publicados**; os três triggers estavam com `search_path=pg_catalog, public, pg_temp`.

`bun run seed` e `bun run demo` passaram. O demo confirmou replay HTTP, envio de duplicata SQS, LOSS sem movimento e reconciliação de 75.00 BRL com dois lançamentos (abertura + BET).

SIGTERM foi exercitado por `docker compose --profile cluster restart app-3`: `shutdown_draining` às 20:47:14.881 UTC, `shutdown_completed` às 20:47:16.522 UTC, aproximadamente **1,64 s**. Após o novo boot, readiness retornou 200. Os failpoints da suíte cobrem separadamente crashes com trabalho financeiro confirmado e publicação em andamento.

## Experimento de carga local

Execução da implementação financeira em 30/09/2026 às 21:22:49 UTC, antes da configuração das harnesses de qualidade: Windows, Ryzen 7 5700X, 16 CPUs lógicas, 40 GiB de RAM; três instâncias Docker ativas. Entrada HTTP na porta 3100, com outbox/publishers assíncronos ativos. A latência medida termina na resposta HTTP.

Metodologia: 12 carteiras novas, saldo inicial 10000.00 BRL, 24 operações de warmup fora da medição, 300 BETs de 0.01 BRL e concorrência 12. Todas as carteiras foram reconciliadas ao fim.

| Métrica                   |    Resultado |
| ------------------------- | -----------: |
| Tempo medido              |      4,957 s |
| Throughput                |  60,52 req/s |
| p50                       |    182,15 ms |
| p95                       |    333,98 ms |
| p99                       |    367,40 ms |
| Erros                     | 0 / 300 (0%) |
| Conflitos SQL registrados |            0 |
| Lag observado da outbox   |       1,21 s |
| Carteiras reconciliadas   |      12 / 12 |

O lag é a amostra Prometheus capturada ao fim, não o máximo durante a execução. Conflitos contam deadlock/serialization/lock timeout, não toda espera por lock. O experimento não mede a capacidade máxima do cluster nem substitui testes em AWS; a constraint de auditoria cresce com o histórico. O JSON detalhado fica em `test-results/load.json`.

## Escopo da evidência

PostgreSQL e SQS são reais no ambiente local (SQS em LocalStack). Falhas são injetadas nos limites de commit/publicação; os dois testes de crash encerram de fato processos do sistema operacional. Unidade do diagnóstico injeta um snapshot legado inconsistente na consulta, sem violar as proteções do banco principal.

Recursos das suítes usam prefixos exclusivos e são removidos ao término. Reversão e limpeza foram executadas somente em bancos novos e descartáveis, preservando os dados existentes.

Nenhum resultado local constitui uma previsão de nota ou capacidade de produção em AWS.
