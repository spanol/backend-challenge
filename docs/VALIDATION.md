# Validação executada

## Stress observado no Grafana — 01/10/2026

Experimento executado entre **08:45:31.201 e 08:55:48.199 UTC** (05:45:31–05:55:48 em America/Sao_Paulo), em uma stack Compose exclusiva `jungle-telemetry-stress-20261001`. Uma aplicação Bun 1.4.2/Linux, PostgreSQL 17.6 e LocalStack 4.9.2 reais, tracing ativo, Prometheus 3.15.0, Tempo 2.10.4 e Grafana 13.2.0. O gerador ficou em outro container; o cluster principal permaneceu ativo e ocioso no mesmo host Ryzen 7 5700X. A VM Docker reportou 16 CPUs lógicas e 19 GiB; não foram fixadas quotas de CPU/memória.

Antes da carga, a instrumentação recebeu CPU/RSS/heap/event loop, respostas HTTP por status, quantidade de eventos pendentes na outbox e profundidade da fila de entrada SQS. O dashboard mostra essas séries e as 20 anotações das fases. Prometheus coletou a cada cinco segundos; um monitor independente registrou **234 amostras** de readiness, métricas, SQL e SQS. `docker stats` também registrou os seis containers a cada cinco segundos aproximadamente. Os arquivos preservam o commit base `de7ae13`, o patch e hashes do código medido.

| Fase HTTP              | Clientes | Carteiras | Requisições | Erros |  req/s | p95 cliente | RSS pico amostrado |
| ---------------------- | -------: | --------: | ----------: | ----: | -----: | ----------: | -----------------: |
| Carteiras distribuídas |       12 |        64 |       2.500 |     0 | 135,24 |   149,69 ms |         264,37 MiB |
| Carteiras distribuídas |       48 |        64 |       2.500 |     0 | 118,99 |   853,68 ms |         281,06 MiB |
| Carteiras distribuídas |       96 |        64 |       2.500 |     0 |  99,16 | 1.318,81 ms |         311,54 MiB |
| Uma carteira disputada |       64 |         1 |         685 |     0 |  20,73 | 3.641,95 ms |         218,65 MiB |
| Replays idempotentes   |       96 |         8 |      10.000 |     0 | 388,31 |   388,41 ms |         299,88 MiB |

As **18.185 requisições medidas** responderam 200. Os replays geraram **zero novos lançamentos no ledger e zero eventos na outbox**. A rajada SQS enviou **1.100 entregas para 1.000 comandos únicos**, incluindo 100 duplicatas lógicas com deduplication IDs de transporte distintos: processamento e drenagem em **76,46 s**, aproximadamente **13,08 comandos únicos/s**. As 64 carteiras SQS reconciliaram; inbox terminou com 1.000 registros e o contador de duplicatas com 10.100 (HTTP + SQS).

### Consumo e comportamento observados

- CPU do processo: pico amostrado de **111,27% de um núcleo**, calculado com `rate(process_cpu_seconds_total[30s])`; não é percentual de utilização do host inteiro.
- RSS: baseline médio **142,35 MiB**, pico **311,54 MiB**, último valor **198,07 MiB**. Houve queda após a carga, mas a janela curta não comprova nem descarta vazamento de memória.
- Event loop: maior p99 entre scrapes **124,52 ms**. Os valores do heap são os expostos pela compatibilidade Node do Bun; RSS é a medida utilizada para consumo residente.
- Carteira única: até **11 sessões SQL esperando locks**, sem deadlock/serialization/lock timeout registrado. Espera por serialização não é contabilizada como conflito SQL.
- Outbox: pico de **4.986 eventos pendentes**, lag máximo de **108,76 s**. Após as reconciliações HTTP, levou **77,65 / 85,81 / 109,30 s** para drenar as fases 12/48/96. A API confirmou commits antes da publicação assíncrona, como previsto.
- Entrada SQS: pico aproximado de **1.051 mensagens visíveis**, final zero visíveis/em processamento, DLQ vazia. Outbox também terminou em zero; a fila de eventos publicados conserva mensagens porque não houve consumidor downstream nesta carga.
- Readiness retornou **200 em todas as 234 amostras**, e Prometheus registrou `up=1` durante toda a janela exportada. Nenhuma falha de entrega foi persistida.

`docker stats` observou CPU máxima de 153,01% na aplicação, 409,16% no PostgreSQL e 122,23% no LocalStack. Sua janela curta e o desconto de cache na memória diferem das séries Prometheus/RSS. Memória máxima Docker: aplicação 268,60 MiB, PostgreSQL 142,60 MiB, LocalStack 188,30 MiB, Prometheus 45,77 MiB, Tempo 104,30 MiB e Grafana 883,70 MiB. A coleta inclui o custo dos workers, instrumentação e navegação no Grafana.

Auditoria SQL final: **265 carteiras, zero saldos divergentes, 9.458 lançamentos no ledger, 9.458 diários contábeis, 18.916 linhas e zero diários desbalanceados**. Todas as carteiras reconciliaram também pela API contra o saldo esperado. Os 9.458 movimentos incluem 265 aberturas. Não houve achado de falha financeira ou operacional no driver.

A concorrência maior elevou latência sem aumentar throughput; a carteira única tornou a contenção explícita e a publicação da outbox acumulou backlog. Esses são limites observados para discussão de evolução, sem alteração de locks ou invariantes durante a medição. O experimento não determina capacidade máxima ou SLO de produção. A carga é fechada; cada fase dura até 30 segundos ou seu limite de requisições. Replays têm pausa de 50 ms por cliente e não são diretamente comparáveis a escritas. Carteiras novas por fase reduzem compartilhamento, mas a ordem acumula históricos e o experimento não constitui um benchmark independente. Picos menores que a coleta podem escapar; p95 cliente é exato nas amostras de requisições, p95 do Grafana é interpolado a partir dos buckets.

### Evidências e reprodução

Arquivos locais ignorados pelo Git: `test-results/grafana-stress-20261001/`. `index.html` e `REPORT.md` apresentam a coleta; `resources.png`, `messaging.png`, `containers.png` e `http-comparison.png` apresentam os gráficos. Dados brutos: `prometheus-series.json`, `server-samples.jsonl`, `docker-stats.jsonl`, latências/reconciliações por fase, traces HTTP/SQS retornados pelo Tempo, anotações/dashboard via API do Grafana e logs da aplicação. Capturas parciais reais do Grafana registram a primeira fase e a janela completa; capturas grandes falharam por timeout da ferramenta de browser. As figuras completas foram geradas a partir das séries exportadas e não são screenshots do Grafana.

O projeto mantém os volumes de Prometheus/Grafana da coleta. Dashboard local: `http://localhost:39303/d/distributed-wagering-overview/distributed-wagering-overview?from=1790844331201&to=1790844948199`. Prometheus em 39301, Tempo em 39302 e aplicação em 39300. O histórico no Prometheus obedece à retenção local; as exportações independem da stack ativa.

Procedimento executado no PowerShell, com os arquivos de configuração e driver preservados no pacote de evidências:

```powershell
docker compose --env-file test-results/grafana-stress-20261001/stack.env -p jungle-telemetry-stress-20261001 -f compose.yaml -f test-results/grafana-stress-20261001/override.yaml --profile observability up --build -d
python test-results/grafana-stress-20261001/collect-docker.py
docker compose --env-file test-results/grafana-stress-20261001/stack.env -p jungle-telemetry-stress-20261001 -f compose.yaml -f test-results/grafana-stress-20261001/override.yaml --profile test run --build --rm --no-deps -e STRESS_PROJECT=jungle-telemetry-stress-20261001 --volume "D:\code\jungle-gaming\backend-challenge\test-results\grafana-stress-20261001:/app/test-results/grafana-stress-20261001" test bun /app/test-results/grafana-stress-20261001/stress.ts
```

O coletor deve rodar em outro terminal e para quando recebe o arquivo `STOP`. Após a carga, `export.ps1` exportou APIs/logs e `analyze.py` gerou relatório/figuras, com Matplotlib 3.10.1 instalado apenas em `.tmp/telemetry-plot-deps`. O driver exige banco vazio e valida o projeto exclusivo antes de gravar: uma nova execução precisa de recursos novos e de ajuste explícito dessa identificação, sem limpar o banco principal nem sobrescrever esta coleta.

Após a medição, `docker compose --profile test run --build --rm --no-deps --volume "D:\code\jungle-gaming\backend-challenge\test-results\grafana-stress-20261001\verification:/app/test-results" test` executou `verify:full` entre **08:58:51.384 e 08:59:53.882 UTC**. Typecheck, ESLint sem warnings, Prettier e as suítes passaram: **103 testes, zero falhas, zero skips e 811 assertions** em 13 arquivos. As sete migrations passaram em `up → down → up`, exclusivamente no banco gerado `wagering_test_1790845152119_fcaf9d9b`. `resources-all.json` confirmou `cleanupComplete: true`, `failedResources: []`; relatórios JSON/JUnit estão em `verification/` no pacote. O gate foi executado fora da janela de carga para não contaminar a medição. `CHALLENGE.md` e a demo no stash permaneceram intactos.

## Opcionais e gate completo — 01/10/2026

Após implementar o diário contábil, OIDC com Keycloak/JWKS e tracing OTLP com dashboard, `verify:full` passou em Docker/Linux com Bun 1.4.2, PostgreSQL 17.6 e LocalStack 4.9.2. A execução final ocorreu de 08:27:43.104 a 08:28:38.267 UTC. Typecheck, ESLint sem warnings, Prettier e as suítes passaram: **103 testes, zero falhas, zero skips e 797 assertions** em 13 arquivos — 54 unitários, 40 de integração e nove de concorrência. As sete migrations passaram em `up → down → up`.

Comando executado no PowerShell:

```powershell
docker compose --profile test run --build --rm --no-deps --volume "D:\code\jungle-gaming\backend-challenge\test-results:/app/test-results" test
```

O runner usou `wagering_test_1790843282238_c095bb1d`, registrou `cleanupComplete: true` e `failedResources: []`. O JUnit confirmou 103/0/0 em 35,27 s; `verify-full.json` registrou sucesso em typecheck, lint, formatação e testes. O enunciado `CHALLENGE.md` permaneceu inalterado.

Smokes de opção executados em projetos Compose isolados: Keycloak emitiu token client-credentials aceito pela API (wallet 201, aposta 200, saldo 9.00); provider diferente retornou 403, health público 200 e `/metrics` sem token 401. No perfil de observabilidade, Tempo recebeu spans `wager.process` com `wager.transport=http` e `wager.transport=sqs`; a aposta SQS foi processada e deixou saldo 99.99. O alvo Prometheus retornou `up=1`; a API do Grafana retornou 200 para o dashboard `distributed-wagering-overview` e para as fontes Prometheus e Tempo.

O experimento de carga, no perfil isolado com outbox ativa, executou 300 BETs de 0.01 BRL em 12 carteiras, concorrência 12 e warmup 24. Bun 1.4.2/Linux no host Ryzen 7 5700X reportou 16 CPUs lógicas e 19 GiB visíveis ao contêiner. Resultado: **100.95 req/s**, p50 **102.27 ms**, p95 **202.00 ms**, p99 **244.56 ms**, zero erros e conflitos SQL, lag final da outbox **1.72 s** e reconciliação **12/12**. A harness foi ajustada para consumir `id`, campo devolvido pela API de abertura. Relatório local ignorado pelo Git: `test-results/load-optional-20261001.json`.

## Enum refactor e gate completo — snapshot anterior, 01/10/2026

Após centralizar status, kinds, direções financeiras, erros, eventos, mensagens e diagnósticos SQL em enums, `verify:full` passou em Docker/Linux com Bun 1.4.2, PostgreSQL 17.6 e LocalStack 4.9.2. Execução: **07:04:51.797–07:05:54.140 UTC**. Typecheck, ESLint sem warnings, Prettier, unidade, integração e concorrência passaram: **93 testes, zero falhas, zero skips e 745 assertions**. As seis migrations passaram em `up → down → up`.

Comandos executados no PowerShell:

```powershell
docker compose --profile test build test
docker compose --profile test run --rm --no-deps --volume "D:\code\jungle-gaming\backend-challenge\test-results\swarm-audit-2026-10-01-enums-final:/app/test-results" test
```

O runner isolado usou `wagering_test_1790838313377_8f32318b` e confirmou `cleanupComplete: true`, `failedResources: []`; `--no-deps` evitou executar `setup` no banco principal. Evidências: `test-results/swarm-audit-2026-10-01-enums-final/verify-full.json`, `all.junit.xml` e `resources-all.json`. O SHA-256 de `CHALLENGE.md` permaneceu `47795FCE2FC38CAE5F1B91368EBAF80B7A2ED1FE147F36704B665FAF0613812E`.

Registro contínuo, atualizado em 1º de outubro de 2026. Ambiente: Windows host, Bun 1.4.2 no container Linux, TypeScript 5.9.3, NestJS 12.1.2, MikroORM 6.6.0, Docker Linux/x86_64 29.5.3, Compose 5.1.4, PostgreSQL 17.6-alpine e LocalStack 4.9.2.

## Auditoria adversarial e gate completo — 01/10/2026

O gate completo após a extração dos mappers passou entre **06:17:57.118 e 06:18:48.454 UTC** (03:17:57–03:18:48 em America/Sao_Paulo). O workspace não tinha Bun no `PATH` do host; usei a imagem do projeto fixada em Bun 1.4.2, PostgreSQL 17.6-alpine e LocalStack 4.9.2 em Docker/Linux.

Comandos executados no PowerShell:

```powershell
docker compose --profile test build test
docker compose --profile test run --rm --no-deps --volume "D:\code\jungle-gaming\backend-challenge\test-results\swarm-audit-2026-10-01-mappers:/app/test-results" test
```

`verify:full` passou typecheck, ESLint sem warnings, Prettier e todas as suítes: **93 testes, zero falhas, zero skips e 745 assertions** em onze arquivos — 52 unitários, 32 de integração e nove de concorrência. O JUnit confirma 93/0/0; as suítes Bun levaram 33,77 s e o gate completo 51,34 s. As seis migrations passaram em `up → down → up`.

O runner usou `wagering_test_1790835495282_6823f951` e registrou `cleanupComplete: true`, `failedResources: []`. `--no-deps` evitou executar `setup` sobre o banco principal; o teste criou e limpou seu banco e filas próprios. Evidências: `test-results/swarm-audit-2026-10-01-mappers/verify-full.json`, `all.junit.xml` e `resources-all.json`.

A revisão paralela e a ampliação da suíte fecharam estas janelas:

- A mensagem recebida ao terminar um long poll depois do sinal de parada agora volta imediatamente à fila; um teste controlado prova que ela não inicia o caso de uso.
- O resultado terminal persiste `snapshotVersion` interno. O trigger SQL compara balance/status/currency e valida `LOSS` contra a versão histórica, sem exigir lançamento próprio; uma tentativa de resultado inconsistente por SQL é rejeitada.
- PostgreSQL prova `ROLLBACK` de BET e WIN, WIN pendente antes da BET, concorrência REFUND/ROLLBACK em processos distintos e cursor do ledger com escrita intercalada.
- Falha ao encaminhar à DLQ não dá ACK à mensagem original. Falha de `DeleteMessage` após commit redelivera pela inbox sem duplicar ledger/outbox.
- Mappers explícitos separam o resultado interno do público e centralizam a serialização de `WalletView`; testes confirmam que `snapshotVersion` não vaza pela projeção pública.

O SHA-256 de `CHALLENGE.md` permaneceu `47795FCE2FC38CAE5F1B91368EBAF80B7A2ED1FE147F36704B665FAF0613812E`. Nenhuma validação ou limpeza tocou recursos compartilhados.

## Registro anterior — prioridades 1 e 2, contrato de wallet e reversão entre tipos

Em 01/10/2026, no Windows com Bun 1.4.2, foi aplicado `bun run check`: typecheck, ESLint e Prettier passaram (exit code 0), de 05:12:21 a 05:12:39 UTC. O relatório está em `test-results/verify-static.json`.

`bun run test:integration` passou em 22,45 s: 25 testes, zero falhas, zero skips e 262 assertions em `financial.test.ts`, `http.test.ts` e `messaging.test.ts`. O runner verificou migrations `up → down → up` em banco isolado `wagering_test_1790831016681_c522e826`. PostgreSQL 17.6-alpine e LocalStack 4.9.2 foram usados pelo Compose. `test-results/resources-integration.json` confirma `cleanupComplete: true` e `failedResources: []`; o JUnit está em `test-results/integration.junit.xml`.

As provas desta atualização incluem AC-21: após um REFUND processado, um ROLLBACK direto à mesma BET é rejeitado com `REFERENCE_ALREADY_REVERSED`; saldo, versão e ledger não mudam e o evento de rejeição fica persistido. O teste HTTP confirma que `POST /wallets` retorna `id`, sem `walletId` na resposta, e usa esse valor como `walletId` nas chamadas seguintes.

Naquela etapa, nenhum serviço financeiro, schema ou migration foi alterado. A suíte de concorrência e `verify:full` ainda não tinham sido repetidos; a validação cobriu o gate estático e a suíte de integração afetada. A auditoria adversarial posterior e o gate final estão no início deste registro.

## Retomada do handoff — fechamento das provas

Em 30/09/2026, às **23:30:53–23:32:09 America/Sao_Paulo** (01/10/2026, 02:30:53–02:32:09 UTC), o gate completo passou em Docker/Linux com Bun 1.4.2 e PostgreSQL 17.6/LocalStack 4.9.2 reais. Foram **82 testes, zero falhas, zero skips e 656 assertions em dez arquivos**: 50 unitários, 24 de integração e oito de concorrência. Bun test levou 43,48 s e o gate completo 76,55 s. Typecheck, ESLint sem warnings e Prettier também passaram.

Comandos executados no PowerShell, com Bun disponível no PATH da sessão:

```powershell
bun run verify
bun run test:integration
docker compose --profile test build test
$linuxReports = Join-Path (Get-Location).Path 'test-results\handoff-linux'
New-Item -ItemType Directory -Force -Path $linuxReports | Out-Null
docker compose --profile test run --rm --no-deps --volume ($linuxReports + ':/app/test-results') test
```

O gate local `verify` passou com 50 testes unitários e 255 assertions; a integração Windows passou com 24 testes e 251 assertions em 22,77 s. A imagem foi construída com instalação congelada e scripts de dependências desativados, conforme o Dockerfile. O build usou este workspace com as alterações de teste; não representa um novo build de checkout limpo.

`--no-deps` evitou executar `setup` no banco principal. O runner Linux criou `wagering_test_1790821885230_c29db26e`, validou as cinco migrations em `up → down → up` e removeu seu banco e suas três filas. `test-results/handoff-linux/resources-all.json` registra `cleanupComplete: true` e `failedResources: []`. O runner Windows de integração usou `wagering_test_1790821809977_39951aeb`, também com limpeza completa. Nenhum rollback ou limpeza atingiu recursos principais.

As provas acrescentadas verificam:

- Efeitos de BET/WIN/LOSS/REFUND/ROLLBACK, inversões de BET/WIN/REFUND, versão, ledger, eventos e replay no use case; rejeição por moeda e cada campo de contexto/valor/status da referência; conflito real de payload sem substituir resultado/hash/efeitos.
- Reconciliação de todas as wallets criadas por cada suíte de infraestrutura em `afterEach`, com saldo reconstruído igual ao materializado e diferença zero, inclusive as 12 wallets dos publishers.
- Rollback pré-commit consultando wallet, transação, ledger, inbox e outbox diretamente; retry posterior confirma o conjunto. Eventos de LOSS e expiração consultados no SQL, sem WalletBalanceChanged/ledger para operações sem movimento.
- Crash após commit e antes do ACK: os dois eventos da operação estão duráveis e não publicados antes do primeiro send; outro processo publica os mesmos IDs. Redelivery não acrescenta eventos.
- SIGTERM POSIX real durante mensagem retida antes do commit: o lifecycle do NestJS aguarda a liberação, confirma e ACKa, encerra com código 143 e deixa a mensagem seguinte para outro runtime. Replay preserva um inbox e dois eventos, sem novo débito; ambas as wallets reconciliam. O teste passou em 5,16 s. Windows pula somente essa prova POSIX; o gate Linux executou todos os casos.
- HTTP 202, 422 e 503 para pendência, rejeição, FAILED terminal e falha técnica pré-commit. Readiness retorna 503 quando a conexão SQL está fechada ou uma fila consultada não existe, liveness continua 200 e readiness recupera. Isso não simula uma interrupção física dos containers.

Evidências preservadas em `test-results/handoff-integration-windows.log`, `test-results/handoff-docker-build.log`, `test-results/handoff-verify-linux.log`, `test-results/handoff-linux/verify-full.json`, `test-results/handoff-linux/all.junit.xml` e nos relatórios de recursos. O JUnit Linux foi lido como XML: 82 casos, nenhuma falha e nenhum skip. Logs e relatórios continuam ignorados pelo Git.

Naquele snapshot, o produto, as migrations e as interpretações financeiras não foram alterados. `CHALLENGE.md` mantém SHA-256 `47795FCE2FC38CAE5F1B91368EBAF80B7A2ED1FE147F36704B665FAF0613812E`. A diferença `id`/`walletId` e a escolha de reversão direta total estavam registradas como pontos de revisão; o estado atual está na [rastreabilidade](TRACEABILITY.md#provas-fechadas-e-pontos-de-revisão).

Após atualizar os documentos, `bun run check` passou novamente no Windows, de 02:34:43 a 02:35:15 UTC: typecheck, lint e formatação, exit code 0. Relatórios em `test-results/verify-static.json` e `test-results/handoff-final-static.log`. Esse check complementa o gate Linux; somente a documentação foi alterada depois daquele gate.

## Validação do conteúdo preparado para commit

Em 01/10/2026, de 2026-10-01T04:32:38.569Z a 2026-10-01T04:34:23.440Z, o conteúdo do índice foi exportado para `.tmp/challenge-commit/` e validado sem a demo jogável. O gate `verify:full` passou em Docker/Linux, Bun 1.4.2, PostgreSQL 17.6 e LocalStack 4.9.2: 82 testes, sem falhas ou skips. Typecheck, lint e formatação também passaram. O runner criou `wagering_test_1790829209901_ae314ec3` e confirmou limpeza completa.

Comandos: `git checkout-index --all --prefix=.tmp/challenge-commit/`, `docker compose --project-directory .tmp/challenge-commit -f .tmp/challenge-commit/compose.yaml --profile test build test` e `docker compose --project-directory .tmp/challenge-commit -f .tmp/challenge-commit/compose.yaml --profile test run --rm --no-deps --volume <pasta-de-relatórios>:/app/test-results test`. Relatórios em `test-results/challenge-commit-linux/`; log em `test-results/challenge-commit-verify-linux.log`. Após o gate, somente este registro foi acrescentado à documentação.

## Auditoria contra o challenge

Em 30/09/2026, às 21:57:54–21:59:34 em America/Sao_Paulo (01/10/2026, 00:57:54–00:59:34 UTC), `bun run verify:full` foi repetido sobre o código já commitado, no Windows/Bun 1.4.2 com PostgreSQL 17.6 e LocalStack 4.9.2 em Docker. O comando terminou com exit code 0: typecheck, lint sem warnings, formatação e todas as suítes aprovados.

Foram **54 testes, zero falhas e 215 assertions em nove arquivos**: 26 de unidade, 21 de integração e sete de concorrência. Bun test levou 54,31 s; o gate completo, 100,43 s. Os sete testes distribuídos combinam os oito cenários obrigatórios do enunciado.

Evidências: `test-results/verify-challenge-audit.log`, `test-results/verify-full.json`, `test-results/all.junit.xml` e `test-results/resources-all.json`. O JUnit confirmou 54 casos sem falhas. O runner usou `wagering_test_1790816317360_84d7639f`, verificou migrations em banco novo e registrou `cleanupComplete: true`, sem recursos cuja limpeza falhou. Banco e filas principais não foram usados para rollback ou limpeza.

A revisão das assertions identificou evidências parciais apesar do gate aprovado: unidade das cinco operações/idempotência, reconciliação final de todas as carteiras, consulta direta de inbox/outbox após rollback, eventos de LOSS/expiração, HTTP de falha e SIGTERM com mensagem controladamente em andamento. Essas lacunas deram origem à retomada registrada acima. Na auditoria, a documentação ainda não tinha commit; ela passou a integrar o commit de documentação. Nenhuma mudança de comportamento, migration ou harness foi feita naquela auditoria; somente o mapa, o estado da especificação e este registro foram atualizados após o gate.

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
