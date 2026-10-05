# Carga distribuída com três réplicas

O ensaio usa três containers de API independentes, cada um com pool PostgreSQL próprio e workers SQS, outbox e referências. Eles compartilham um banco e três filas criados por `scripts/test-suite.ts distributed-load`. A stack Compose tem PostgreSQL/LocalStack e volumes próprios, sem ingresso público ou ligação ao banco da demo. O runner valida migrations `up → down → up` no banco gerado, e registra a limpeza antes de a stack ser removida.

## Metodologia

| Fase                | Comandos únicos | Clientes HTTP | Carteiras | Verificação                                                                                                                         |
| ------------------- | --------------: | ------------: | --------: | ----------------------------------------------------------------------------------------------------------------------------------- |
| Aquecimento         |              24 |             6 |         3 | Fora da vazão medida das fases pesadas                                                                                              |
| HTTP distribuído    |          10.000 |           256 |       128 | BET 0.01, requisições repartidas pelas três APIs                                                                                    |
| Carteira disputada  |           3.000 |            48 |         1 | BET 1.00 sobre saldo 100.00: 100 aceitos, 2.900 recusados                                                                           |
| Duplicatas HTTP/SQS |           1.000 |            64 |        64 | Cada comando passa por duas APIs e duas entregas SQS; mesmo messageId lógico e deduplication IDs de transporte distintos            |
| Perda de réplica    |           5.000 |           128 |        64 | SIGKILL real de replica-1 com carga em andamento; restart programado após cinco segundos e retry pela mesma identidade em outra API |

Os clientes usam loop fechado. Uma resposta terminal encerra o comando; apenas a fase de perda de réplica permite até três tentativas HTTP, preservando o payload e a chave. Requisições de replay posteriores conferem o transactionId, o status e o saldo histórico em outra réplica. A carteira disputada produz HTTP 422 esperado; falhas lógicas e outros status falham o ensaio. Erros de transporte causados pelo SIGKILL são registrados separadamente de falhas finais.

O gerador abre uma conexão HTTP por chamada (`keepalive: false`, conforme a [documentação do Bun](https://bun.sh/docs/runtime/networking/fetch)). O custo de conexão integra a latência e a vazão medidas. Não há retries nas fases sem queda planejada. No primeiro preflight, duas conexões foram encerradas sem registros das respectivas chaves nas APIs; isso motivou desativar o pool do cliente, sem atribuir a causa conclusivamente ao servidor ou ao Bun. Essa execução não aprovada permanece em `test-results/distributed-load-20261001/smoke/`. A coleta de traces também foi corrigida para usar o formato logfmt exigido pelo filtro de tags do Tempo.

Os percentis de cada fase medem o comando lógico: na fase cruzada incluem duas chamadas HTTP, e na perda de réplica incluem eventuais retries. `distributed-attempts.json` permite calcular a latência de cada tentativa separadamente. A duração de carga da fase cruzada termina após respostas HTTP e envio ao SQS; a drenagem subsequente fecha consumidores, inbox e outbox. Os planos de comandos são preservados com SHA-256; chaves, carteiras e valores de todas as BETs são conferidos diretamente no SQL.

Cada API tem 0,25 CPU/384 MiB; PostgreSQL 0,75 CPU/512 MiB; LocalStack 0,5 CPU/512 MiB; gerador 0,5 CPU/768 MiB. Prometheus, Tempo e Grafana têm limites próprios no Compose. O total de CPU reservado para as três APIs é 0,75, igual ao teto da API dos ensaios anteriores. A memória total das APIs, quantidade de pools, histórico, topologia e instrumentação diferem; as medições não constituem comparação causal de escalabilidade.

O entrypoint exclusivo da harness, `scripts/distributed-replica.ts`, usa a composição financeira normal e um hook já existente para contar callbacks de aceitação do publisher pelo SQS. `load_outbox_accepted_total` conta aceites de envio, antes do ACK SQL; pode incluir reenvios. A auditoria SQL é a autoridade para a quantidade de eventos publicados. Nenhum código financeiro recebe um failpoint.

O entrypoint conta também as chamadas financeiras ainda em execução em `load_wager_inflight`, com decremento no `finally` da chamada original. O perfil de jogo exige zero nas três réplicas antes de fechar a drenagem e auditar, incluindo processamento que continuou após timeout ou desconexão do cliente.

## Evidências

`distributed-load.json` registra fases, vazão, percentis, distribuição de chamadas, saldos esperados e auditorias. `distributed-attempts.json` conserva cada tentativa HTTP; `distributed-samples.json` contém CPU, RSS, event loop, outbox e atividade SQS/publisher por réplica e geração do processo. Gauges do banco/fila compartilhados usam máximo, sem somar três observações do mesmo backlog. Contadores que reiniciam após o crash são identificados pela geração.

`topology.json` registra identidades dos containers, PIDs no host, IPs e quotas. O relatório registra sessões SQL em três endereços distintos. `distributed-crash.json` marca o SIGKILL e os PIDs antes/depois; `resources-distributed-load.json` confirma a limpeza do banco/filas. Logs, séries Prometheus, traces Tempo, dashboard Grafana e amostras de Docker/host são exportados antes da remoção da stack. Não há consumidor de negócio downstream neste ensaio; o fechamento verifica inbox, saldo, ledger, contabilidade, ACKs SQL de publicação e drenagem das filas de entrada/outbox.

## Execução

### População persistente, jogo e sobrecarga

Os profiles `game-smoke` e `game-scale` mantêm carteiras independentes entre quatro fases. `game-scale` cria **38.000 jogadores por padrão** (`--peers` altera a população): rampa de 30 sessões/s por 60 s, sustentação de 60 sessões/s por 180 s, rajada com toda a população chegando junta e recuperação de 30 sessões/s por 90 s. Cada sessão envia BET 0.01 e, após 200–500 ms, WIN 0.02 (40%, referenciando a BET) ou LOSS (60%, na mesma rodada). BET e desfecho usam réplicas diferentes. A distribuição de resultados é determinística para reproduzir o ensaio; não representa a aleatoriedade do jogo.

A chegada segue o relógio, mesmo com respostas lentas. Há até 512 sessões em voo e uma fila no gerador de até a população configurada por `--peers`; intenções esperando mais de 20 s expiram e são contadas. O número de peers/intensões oferecidos não equivale ao número de conexões simultâneas. Todas as chegadas da rajada são oferecidas; o relatório distingue as iniciadas, expiradas e descartadas por limite da fila. A engine exercida é a financeira real, com três processos, PostgreSQL e SQS compartilhados; o coordenador visual `DemoTable` e WebSockets não fazem parte desse perfil.

Uma réplica recebe SIGKILL no meio da sustentação e volta depois de cinco segundos. Não há retry HTTP: respostas ausentes permanecem como falhas de transporte e suas identidades são conferidas no SQL ao final. A auditoria calcula saldos/versões a partir dos comandos submetidos e seus estados duráveis, compara ledger e partidas dobradas e exige drenagem da outbox e das filas. Uma BET confirmada sem desfecho é contabilizada como sessão incompleta. `passed` indica execução e auditoria concluídas; `capacityMet` de cada fase exige todas as sessões completas, ausência de erros e p95 de até 2 s desde a chegada planejada. A queda programada também aparece nessas contagens.

```sh
docker build -t jungle-challenge:distributed-game-20261003 .
python scripts/distributed-load-stack.py --project jungle-distributed-game-smoke-20261003 --image jungle-challenge:distributed-game-20261003 --output test-results/game-load-20261003/smoke --profile game-smoke
python3 scripts/distributed-load-stack.py --project jungle-distributed-game-subiu-20261003 --image jungle-challenge:distributed-game-20261003 --output test-results/game-load-20261003/subiu --profile game-scale --guard-subiu
```

`--peers`, `--concurrency`, `--stage-seconds` (6–600), `--max-wait-ms` e `--connection-reuse true|false` permitem repetir com um parâmetro alterado. A duração configurada vale para a sustentação; rampa usa um terço e recuperação metade. `game-smoke` usa 96 jogadores, 24 sessões em voo e sustentação de 6 s. As quotas dos serviços são as mesmas da bateria anterior, incluindo 0,25 CPU por API; elas não são aumentadas entre fases. O gerador também tem 0,5 CPU, e seu atraso de agendamento é registrado para identificar limitação do próprio cliente. O Subiu executa uma stack exclusiva com essas quotas, sem usar o banco ou as filas da sessão pública.

`distributed-game.json` registra as fases e auditoria; `game-attempts.json` preserva tentativas sem resposta; `game-commands.json` e `game-plan.sha256` preservam as identidades enviadas; `game-population.json` identifica as carteiras; `arrivals-game-*.json` guarda as chegadas planejadas. As estatísticas incluem atraso do relógio do gerador, espera na fila, p50/p95/p99 de sessões completas, descartes e distribuição entre réplicas. Percentis de sessões completas devem ser lidos junto das sessões incompletas; não estimam a latência das intenções expiradas. Telemetria, quotas, queda e limpeza continuam nos artifacts comuns da stack.

```sh
docker build -t jungle-challenge:distributed-load-20261001-v2 .
python scripts/distributed-load-stack.py --project jungle-distributed-local-20261001 --image jungle-challenge:distributed-load-20261001-v2 --output test-results/distributed-load-20261001/local --profile heavy
```

No Linux use `python3`; `--guard-subiu` acrescenta sondas das aplicações do home server. O monitor compara as identidades, saúde, OOM e restart count dos containers preexistentes. Três amostras seguidas com falhas ou menos de 1,5 GiB de RAM disponível interrompem somente a stack do teste. O profile `smoke` reduz o volume para validar o setup antes da bateria completa. Use projeto e diretório novos por execução; a harness recusa reaproveitar um diretório de resultados.

Enquanto a stack está ativa, o dashboard fica em `http://localhost:39473/d/distributed-load`, com `admin` / `distributed-test-only`; esta credencial pertence somente à stack descartável, sem acesso público. Prometheus usa 39471 e Tempo 39472. A limpeza conserva os relatórios e remove containers/volumes exclusivos do projeto.

## Resultados

### Otimização da publicação — 03/10/2026

Três versões foram executadas no Subiu com 38.000 carteiras, três APIs de 0,25 CPU/384 MiB, PostgreSQL de 0,75 CPU/512 MiB, LocalStack de 0,5 CPU/512 MiB e a mesma harness/chegadas. A segunda agrupa ACKs SQL; a terceira também usa `next_attempt_at,id` para adquirir pelo índice existente. Cada bateria oferece 53.300 sessões, incluindo a rajada de toda a população, com limite explícito de 512 sessões em voo e expiração no gerador em 20 s. Não mede 38.000 sockets simultâneos.

| Métrica                                                          | Baseline | ACK agrupado | ACK e busca indexada |
| ---------------------------------------------------------------- | -------: | -----------: | -------------------: |
| Sessões completas na sustentação / 10.800 oferecidas             |    6.249 |        7.070 |                6.380 |
| Sessões/s na sustentação, incluindo conclusão após a janela      |    30,48 |        33,21 |                30,02 |
| p95 de sessões completas na sustentação                          |  18,68 s |      26,99 s |              28,68 s |
| Intenções expiradas no gerador durante sustentação               |        0 |           88 |                  443 |
| Pico de eventos pendentes                                        |   20.645 |       21.505 |               13.899 |
| Pico de lag da outbox                                            | 152,58 s |     153,94 s |              86,97 s |
| Drenagem final                                                   |  41,30 s |      23,31 s |               2,30 s |
| CPU média amostrada do PostgreSQL na recuperação, por CPU lógica |   75,58% |       75,07% |               51,48% |

A terceira versão reduz o trabalho da outbox e melhora a recuperação, com auditoria financeira íntegra das 38.000 carteiras. A capacidade sustentada de apostas não teve ganho relevante e o p95 piorou; o pico da população inteira continua sem atendimento. Os resultados são três execuções sequenciais únicas num host compartilhado. Detalhes das fases, descartes, comandos, gates, hashes, crash e preservação dos serviços estão em [VALIDATION](VALIDATION.md#perfil-de-jogo-distribuído-e-sobrecarga--03102026). Artefatos em `test-results/game-load-20261003/`; `comparison-summary.json` e os JSONs por versão permitem reproduzir os cálculos.

### População ampliada para 60.000 peers — 03/10/2026

Uma rodada adicional no Subiu usou a imagem indexada e as mesmas quotas de três réplicas. Foram criadas 60.000 carteiras; a carga manteve o limite de 512 sessões em voo, espera de 20 s e sustentação de 180 s. O processo levou 20 min 38 s, incluindo a população do banco. `--peers 60000` representa a população cadastrada e a rajada de intenções, não 60.000 sockets simultâneos.

| Fase                                           | Oferecidas | Completas | Expiradas no gerador | Erros de transporte | p95 de sessões completas | Capacidade |
| ---------------------------------------------- | ---------: | --------: | -------------------: | ------------------: | -----------------------: | :--------: |
| Rampa, 30 sessões/s                            |      1.800 |     1.800 |                    0 |                   0 |                   1,40 s |  Atingida  |
| Sustentação, 60 sessões/s, com queda planejada |     10.800 |     6.286 |                    0 |               4.514 |                  19,50 s |    Não     |
| Rajada de toda a população                     |     60.000 |       464 |               58.608 |                 928 |                  24,72 s |    Não     |
| Recuperação, 30 sessões/s                      |      2.700 |     2.700 |                    0 |                   0 |                   0,89 s |  Atingida  |

Na sustentação, a vazão observada foi 30,58 sessões/s, próxima do baseline de 38.000 peers (30,48 sessões/s), mas o p95 piorou de 18,68 s para 19,50 s. A rajada iniciou 1.392 intenções; as demais expiraram no gerador após 20 s. O fluxo se recuperou: todas as 2.700 sessões da fase seguinte completaram. A primeira resposta 200 da réplica reiniciada veio 6,87 s após o start.

A outbox atingiu 11.861 eventos e 75,38 s de lag, com drenagem final em 1,23 s. O host manteve ao menos 3.278 MiB disponíveis; a guarda não encontrou ocorrências nem acionou interrupção. A auditoria reconciliou as 60.000 carteiras: saldo/ledger íntegros, zero registros financeiros inconsistentes, desbalanceados, pendentes ou não terminais. A execução/auditoria passaram, embora sustentação e rajada não tenham atingido capacidade. Detalhes, comando, estados financeiros ambíguos por timeout, crash e limpeza estão em [VALIDATION](VALIDATION.md#população-ampliada-para-60-mil-peers--03102026); análise e telemetria em `test-results/game-load-20261003/subiu-60k-v1/`.

### Bateria ampliada anterior — 01/10/2026

As duas baterias passaram em 01/10/2026, horário de São Paulo: **19.000 comandos únicos pesados por host**, além de 24 de aquecimento, **zero falhas finais**, zero status HTTP inesperados e todas as 260 carteiras reconciliadas por ambiente. A fase distribuída usa 128 jogadores/carteiras distintos e 256 clientes; a fase cruzada usa 1.000 comandos em 64 carteiras, sem equivalência a 1.000 jogadores simultâneos.

| Ambiente | Fase                | Comandos/s | p95 lógico (s) | Drenagem (s) | Erros de transporte |
| -------- | ------------------- | ---------: | -------------: | -----------: | ------------------: |
| Local    | HTTP distribuído    |      26,89 |         17,300 |       118,93 |                   0 |
| Subiu    | HTTP distribuído    |      60,24 |          8,779 |        37,11 |                   0 |
| Local    | Carteira disputada  |      26,01 |          3,149 |         8,43 |                   0 |
| Subiu    | Carteira disputada  |      54,44 |          1,408 |         3,14 |                   0 |
| Local    | Duplicatas HTTP/SQS |      23,44 |          4,468 |        63,02 |                   0 |
| Subiu    | Duplicatas HTTP/SQS |      47,09 |          2,099 |        31,89 |                   0 |
| Local    | Perda de réplica    |      22,57 |         15,916 |        48,84 |                 177 |
| Subiu    | Perda de réplica    |      48,91 |          4,200 |        18,53 |                 227 |

Em cada host, a carteira disputada aceitou 100 BETs e rejeitou 2.900 por saldo insuficiente, terminando em 0.00 BRL. Cada uma das 1.000 identidades cruzadas recebeu duas chamadas HTTP e duas entregas SQS: **2.000 processamentos SQS, 1.000 inboxes e um único efeito por comando**. Distribuição SQS entre réplicas: local **689 / 676 / 635**; subiu **690 / 648 / 662**. Todas as réplicas também publicaram eventos durante essa fase. Foram conferidos 408 replays históricos adicionais por host.

O SIGKILL local aconteceu às **00:13:11.390 UTC de 02/10**, PID 31917; o comando de start foi registrado 6,61 s depois, com PID 8253. No subiu, aconteceu às **00:05:55.158 UTC**, PID 1971775; start 5,86 s depois, com PID 2001012. Esses intervalos medem até o comando de start, sem assumir readiness instantânea. As **177 e 227 chaves** que perderam a resposta tiveram uma resposta HTTP 200 posterior pela mesma identidade, sem falhas lógicas ou novos efeitos financeiros.

### Auditoria e recursos

| Auditoria SQL final                               |  Local |  Subiu |
| ------------------------------------------------- | -----: | -----: |
| Carteiras reconciliadas                           |    260 |    260 |
| Transações, incluindo abertura e aquecimento      | 19.284 | 19.284 |
| Ledger e diários, cada tabela                     | 16.384 | 16.384 |
| Inboxes                                           |  1.000 |  1.000 |
| Eventos com ACK SQL de publicação                 | 35.668 | 35.668 |
| Carteiras inconsistentes / diários desbalanceados |  0 / 0 |  0 / 0 |
| Transações não terminais / entregas falhas        |  0 / 0 |  0 / 0 |
| Eventos pendentes                                 |      0 |      0 |

RSS máximo por réplica: local **225,26 / 224,50 / 221,74 MiB**; subiu **234,48 / 232,63 / 229,85 MiB**, sob o limite de 384 MiB por API. A outbox chegou a **19.044 eventos / 357,14 s de lag** no local e **18.018 / 149,44 s** no subiu; voltou a zero em todas as fases. O event loop p99 amostrado atingiu 769,65 ms no local e 400,03 ms no subiu. Os picos dependem da amostragem; CPU usa deltas de uma CPU lógica e janelas curtas podem ultrapassar os 25% da quota. Não foi definido SLO de latência para este ensaio.

Local: Windows 11 Pro, Ryzen 7 5700X, 16 CPUs lógicas, 39,93 GiB de RAM; Docker Desktop/WSL2 com 19,49 GiB disponíveis à VM Docker. Subiu: Linux 7.0.0-28, i5-4570, quatro CPUs lógicas e 11,10 GiB de RAM. As duas stacks usaram a mesma imagem e quotas. A janela completa, incluindo setup, auditoria, exportação e limpeza, foi **00:00:00–00:18:09 UTC** no local e **00:00:05–00:08:15 UTC** no subiu. A diferença observada inclui virtualização, recursos compartilhados e atividades dos hosts; não isola o efeito do hardware nem estabelece capacidade máxima.

O monitor registrou **196 amostras locais e 87 no subiu**, sem ocorrências. No subiu, RAM disponível mínima **3.969,54 MiB**; subway, betaki, superbet e aurabet retornaram HTTP 200 em todas as sondas. A comparação após a limpeza confirmou os **27 containers locais e 38 do subiu** com mesmas identidades, saúde e restart counts, sem OOM. Banco, filas, containers e volumes exclusivos das duas baterias foram removidos, com confirmação nos relatórios de recursos e de stack.

### Artefatos e reprodução visual

A galeria `test-results/distributed-load-20261001/index.html` reúne tabela de resultados, gráficos derivados dos JSONs, auditorias, recuperação de chaves e links para os dados originais. Não é uma captura do Grafana. `local/` e `server/` conservam séries Prometheus, dashboard Grafana, traces completos de cada réplica, logs e relatórios. `analysis.json` registra a análise consolidada; `artifact-manifest.json`, os SHA-256. Os scripts de gráficos/exportação acompanham os artefatos ignorados pelo Git.

Para abrir a galeria preservada, sem iniciar carga:

```sh
python -m http.server 39481 --bind 127.0.0.1 --directory test-results/distributed-load-20261001
```

Abra `http://127.0.0.1:39481/`. A imagem executada foi `jungle-challenge:distributed-load-20261001-v2`, ID `sha256:e71952196ec799eefce08f25ec47e273c2514e3eb21eb75f185104e319a3072f`; tar transferido com SHA-256 `8cdd33ab969d7d26d70526755e89c8662c40a70d653527f485eef418a0575a51`, igual nos dois hosts. `source-manifest-v2.json` registra hashes extraídos da imagem; a documentação de resultados é posterior à execução.

O gate completo dessa imagem passou de **23:56:53 a 23:59:02 UTC de 01/10**: **137 testes / 1.425 assertions**, zero falhas e skips, com migrations reversíveis e limpeza confirmada. Relatórios em `gate-2/`. O segundo preflight passou, incluindo queda real e exportação Tempo; o primeiro diagnóstico permanece em `smoke/` com as duas falhas de conexão e a falha de exportação registradas.

Após as baterias, a guarda do orquestrador foi reforçada para recusar também containers parados, volumes e redes preexistentes do projeto. Três recursos vazios exclusivos foram criados para conferir a recusa e sua preservação antes da limpeza deliberada, sem iniciar outra carga; resultados em `isolation-guard.json`. O gate completo foi repetido sobre os scripts e documentos atuais montados somente para leitura na imagem, com os mesmos **137 testes / 1.425 assertions**, zero falhas/skips e limpeza completa; relatórios em `gate-3/`.

O ensaio usa PostgreSQL real e SQS em LocalStack, entrada direta nas três APIs, três conjuntos de workers e banco/fila compartilhados. Seu escopo não inclui balanceador público, partição de rede, failover do banco ou consumidor de negócio downstream. Os testes específicos do gate continuam responsáveis por crashes em pontos exatos de commit/ACK, referências fora de ordem e efeito downstream idempotente.
