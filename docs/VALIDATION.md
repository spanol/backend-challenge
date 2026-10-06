# Validação executada

## Operação de jogo com janela de entrada — 06/10/2026

A imagem `jungle-challenge:demo-game-window-20261006-v1` passou em `bun run verify:full` em Docker/Linux, Bun 1.4.2, de **21:12:29 a 21:18:05 UTC**. PostgreSQL 17.6 e LocalStack 4.9.2 usaram o projeto descartável `portfolio-window-20261006`. O runner criou bancos e filas exclusivos, executou migrations `up → down → up` e registrou `cleanupComplete: true` nas duas suítes. SIGTERM real passou em Linux.

| Suíte            | Resultado                                                     |
| ---------------- | ------------------------------------------------------------- |
| Checks estáticos | Typecheck, lint e Prettier aprovados                          |
| Unidade          | 101 testes; 25.297 assertions                                 |
| Integração       | 75 testes; 33.479 assertions                                  |
| Concorrência     | 11 testes; 487 assertions                                     |
| Total            | **187 passaram; 59.263 assertions; zero falhas e zero skips** |

Os cenários novos comprovam prazo fixo e voo durante confirmações em andamento, expiração de intenções nunca enviadas, alternância da ordem de entrada e limite global de 32 chamadas entre BET/WIN/REFUND. A unidade cobre respostas perdidas, recuperação de REFUND pela identidade original, prioridade manual e impedimento de outro WIN/LOSS durante um saque incerto. Uma recusa terminal de estorno permanece visível e bloqueia outra rodada.

Na integração HTTP real, uma aposta confirmada no prazo pagou R$ 1,20 e encerrou sua carteira em **R$ 100,20**; duas confirmações tardias foram estornadas integralmente para **R$ 100,00**, inclusive um REFUND com resposta perdida após commit e replay sem crédito duplicado. Em outro cenário, 40 intenções produziram 32 BET/REFUND e oito carteiras com somente OPENING, sem débito; a recuperação preservou as expirações. Todas as carteiras foram reconciliadas pelo runner. O ensaio histórico de 8.000 carteiras com confirmação integral passou; o processamento de BET e desfechos mediu **153,005 s**. Esse tempo não mede a janela do novo perfil nem constitui SLO.

A execução anterior no Windows também passou; a imagem final acrescenta a rotação da entrada e o diagnóstico de estorno recusado. Relatórios finais: `test-results/portfolio-window-linux/verify-full.json`, `all.junit.xml` e `resources-all.json`; log em `test-results/portfolio-window-linux.log`. São arquivos ignorados pelo Git.

A imagem validada tem manifest `sha256:d9a16533e982a0cf12a0d293a1844a959ce64adec0d99c68b4d846e1055c8eed`; o archive transferido conferiu SHA-256 `a258bde45659bc39f80a53eb77c465cd8874ae2c39f09782494bf34ac7098914`. A release foi preparada em `releases/20261006-demo-game-window-v1`, com Compose validado sem ativação durante o gate.

### Publicação e observação real

O commit `d379f6e` foi enviado à `origin/demo-deploy`. Antes da troca, `POST /demo/autoplay` com `enabled: false` esperou o lote em curso: a rodada compartilhada 101 terminou com 1.000 apostas, 857 saques e 143 perdas; pendências e apostas abertas ficaram em zero. O journal foi preservado no volume em `/app/.tmp/pre-game-window-20261006.json`, SHA-256 `5ef26e2bffdf582246f976870f2d475945a1bf6f21626dadcdfeabbb97207204`. Não houve migrations ou remoção de volumes.

Com `.env` próprio e os dois arquivos Compose, `docker compose --env-file /home/subiu-sm/apps/jungle-challenge/.env -f releases/20261001-demo-52e850a/compose.subiu.yaml -f releases/20261006-demo-game-window-v1/compose.demo.yaml -p jungle-server up -d --no-deps --wait demo` recriou somente a demo. A imagem ficou saudável e as identidades de API, PostgreSQL e LocalStack conferiram com a baseline anterior; todos continuaram saudáveis. As opções `-f` acima são relativas à raiz da aplicação no servidor.

`POST /demo/session?view=dashboard` com `count: 1000`, `mode: independent` e `autoplay: true` abriu 1.000 carteiras novas, com R$ 100,00 fictícios cada, sem apagar dados da sessão anterior. A política retornada foi `deadline`. De **21:23:44 a 21:24:34 UTC**, a consulta agregada a `/demo/dashboard` observou:

| Rodada | Intenções | Admitidas | Fora da janela | WIN | LOSS | Apostado  | Prêmios   |
| ------ | --------- | --------- | -------------- | --- | ---- | --------- | --------- |
| 6      | 1.000     | 604       | 396            | 259 | 345  | R$ 604,00 | R$ 388,50 |
| 7      | 1.000     | 447       | 553            | 383 | 64   | R$ 447,00 | R$ 856,80 |
| 8      | 1.000     | 570       | 430            | 0   | 570  | R$ 570,00 | R$ 0,00   |

Nos três encerramentos, `active`, `confirming`, `refunding` e pendências ficaram em zero, sem apostas abertas ou erro de operação; a sequência avançou até a rodada 9 durante a amostra. O voo foi observado com confirmações ainda pendentes em todas as três rodadas. Por exemplo, a rodada 6 já estava em voo com 371 confirmações e 25 estornos pendentes; esses estornos concluíram durante o voo. O agregado “fora da janela” soma intenções não enviadas e confirmações tardias; não representa 396 estornos financeiros nessa rodada. O relatório local `test-results/portfolio-window-prod/observation.jsonl` contém apenas agregados e é ignorado pelo Git.

Uma consulta SQL de leitura comparou o saldo das 1.000 carteiras atuais com a soma assinada de seus lançamentos em uma única instrução/MVCC: **1.000 carteiras e zero divergências**. A sessão também conferiu 1.000 identidades de jogador distintas. A API respondeu HTTP 200 em `/health/ready` pelo loopback; a demo respondeu HTTP 204 em `/demo/health` pelo loopback. A consulta HTTPS direta ao health pelo Python do servidor recebeu HTTP 403; portanto, não é evidência de health externo aprovado. A página pública e sua atualização de rodadas foram conferidas no Chrome.

No layout, foram observados os dois perfis e os contadores de expiração/estorno. O resumo usa quatro colunas no desktop e duas no viewport de 390 px. A largura de conteúdo foi 1.905 px em viewport de 1.920 px e 375 px em viewport de 390 px, sem transbordamento horizontal. O viewport original foi restaurado após a inspeção.

**Limites:** a janela de cinco segundos não promete admitir todas as 1.000 intenções. A rotação da ordem reparte a oportunidade entre rodadas; apostas fora do prazo não participam. A próxima rodada ainda espera WIN, LOSS e REFUND concluírem, portanto não há garantia de duração fixa do ciclo completo. A observação acima não mede SLO, capacidade sustentada, autenticação pública ou entrega final de todos os eventos de outbox. O projeto/volumes descartáveis usados no gate Linux foram removidos após os relatórios registrarem limpeza completa.

## Carteira compartilhada e reposicionamento — 06/10/2026

`bun run verify:full` passou em Bun 1.4.2 no host Windows, com PostgreSQL 17.6 e LocalStack 4.9.2 em containers de teste. A primeira tentativa encontrou a harness sem serviço em `127.0.0.1:55432`. Para a execução aprovada, a infraestrutura foi iniciada no projeto Compose exclusivo `demo-bankroll-verify-20261006`, com volumes próprios `demo-bankroll-verify-20261006_wagering-db` e `demo-bankroll-verify-20261006_wagering-sqs`.

| Suíte            | Resultado                                                  |
| ---------------- | ---------------------------------------------------------- |
| Checks estáticos | Typecheck, lint e Prettier aprovados                       |
| Unidade          | 92 testes; 24.962 assertions                               |
| Integração       | 73 testes; 33.209 assertions                               |
| Concorrência     | 10 passaram; 1 skip documentado no Windows; 463 assertions |
| Total            | **175 aprovados, 1 skip, 58.634 assertions, zero falhas**  |

A integração `shared-wallet autoplay processes sequential peer rounds against one reconciled wallet` apostou com quatro peers por duas rodadas na mesma wallet e no mesmo player; confirmou WIN/LOSS e saldo reconciliado de **R$ 98,70**, diferença **R$ 0,00**. O teste novo de `HttpFinancialApi` abriu uma wallet com saldo configurado de R$ 10.000,00 pela API e conferiu a reconciliação SQL sem diferença. A unidade comprovou que uma rodada compartilhada inteiramente recusada por `INSUFFICIENT_FUNDS` pausa o autoplay sem abrir carteira substituta, mesmo com a opção legada de renovação ativa. O caso independente de 8.000 peers confirmou e liquidou uma rodada nas três APIs reais em **165,359 s**. Esses são ensaios locais, não um SLO nem uma medição da contenção do perfil compartilhado.

O skip é a prova de SIGTERM real da harness, marcada para Linux/CI porque Windows não entrega o sinal POSIX a processos filhos. Todas as migrations do runner concluíram `up → down → up`. `test-results/resources-all.json` registrou `cleanupComplete: true` nas suítes de integração e concorrência, sem recursos de teste restantes. Depois do registro, o projeto Compose efêmero também foi removido.

Comandos executados na raiz:

```powershell
docker compose --project-name demo-bankroll-verify-20261006 --file compose.yaml up --build --detach postgres localstack --wait
bun run verify:full
docker compose --project-name demo-bankroll-verify-20261006 --file compose.yaml down --volumes --remove-orphans
```

Relatórios JUnit e `resources-all.json` estão em `test-results/`, ignorado pelo Git. A seleção de testes pode ser verificada em `test-results/integration.junit.xml`.

## Reposicionamento da demo em produção — 06/10/2026

O commit `ea21767` publicou a identidade “Carteira em Jogo” e o perfil compartilhado de 100 peers, sem reiniciar API, PostgreSQL ou LocalStack. Antes da troca, a sessão independente em produção tinha 3.000 apostas planejadas, 2.839 confirmações pendentes e 163 apostas ativas. O autoplay foi pausado; a rodada 3.877 liquidou sem operações pendentes nem apostas abertas. Seu journal foi preservado no volume `server-demo` como `pre-portfolio-20261006-ea21767.json` (SHA-256 `8b116c747c525306b76193fe4d4545e2c28678e29924582bd6b68a3d8eb80613`). A nova sessão inicial com R$ 100,00 fictícios executou dois ciclos e pausou corretamente quando o saldo se esgotou; não houve recarga automática. O journal dessa sessão também foi preservado como `pre-bankroll-20261006-ea21767.json` (SHA-256 `4904ce828d4aa3dc1ea2c5e8e75b335d417a996f719264e6a84ca128fc3512ee`).

O commit `4480601` passou no gate completo antes do deploy e definiu `DEMO_INITIAL_BALANCE=10000.00`. A imagem `jungle-challenge:demo-portfolio-bankroll-20261006-4480601` foi construída para `linux/amd64` (manifest `sha256:7104d6a561b630f6567f087a9dfb86077a3f583e366e83a2778ef9d74e01d4ab`; tar transferido `sha256:07e31c414574b48c3f288126440e8ecbe9ac74f0044bd75213c0955f859d6c4c`). `docker compose config --quiet` passou e `up -d --no-deps --wait demo` recriou somente `jungle-server-demo-1`, preservando o volume. O container final ficou `healthy`; `/demo/health` respondeu 204 e `/` serviu `<title>Carteira em Jogo · Simulação</title>`. A API observada permaneceu no mesmo container e imagem saudável; banco, broker, journal e filas não foram recriados.

Após o release, a sessão foi deliberadamente aberta com 100 peers, modo `shared` e autoplay. A leitura agregada da rodada 4 mostrou 100 BETs, 61 ainda ativas, 39 saques e R$ 57,60 pagos; o ledger marcou R$ 9.961,40 disponíveis, `consistent: true` e diferença de R$ 0,00. As listas agregadas confirmaram um `walletId` e um `playerId` para os 100 peers; o autoplay seguia ativo no ciclo 4. A observação representa somente créditos fictícios e uma carteira compartilhada, não 100 clientes/titulares distintos.

### Perfil público de 1.000 apostas — 06/10/2026

O commit `2ee02e9` elevou o perfil público para 1.000 peers e 1.000 apostas de R$ 1,00 por rodada, mantendo a carteira única e o limite de 32 chamadas financeiras simultâneas. `bun run verify` passou em Bun 1.4.2: typecheck, lint, Prettier e 92 testes unitários com 24.962 assertions, sem falhas. O gate completo de 175 testes e 58.634 assertions havia passado no commit `4480601`; este incremento altera defaults e interface, sem mudar invariantes financeiros.

A imagem `jungle-challenge:demo-portfolio-1000-20261006-2ee02e9` foi construída para `linux/amd64` (manifest `sha256:875e51d779115da35f435855b6cbed1c09dea44ed57a48914d3f15e5914189da`; tar transferido `sha256:28ae3437cd16b7477673a336df82df1048c627c8af98545629a1435e871fb7d1`). `docker compose config --quiet` passou e `up -d --no-deps --wait demo` recriou somente `jungle-server-demo-1`. O health da demo respondeu HTTP 204 e o container ficou `healthy`. A API financeira continuou no mesmo container/imagem `jungle-challenge:messaging-recovery-20261006-v1`, saudável; PostgreSQL, LocalStack, filas e volume do journal não foram recriados.

Antes do deploy, o journal da sessão compartilhada pausada foi copiado no volume persistente como `pre-scale-1000-20261006-4480601.json` (SHA-256 `3938dabbb9f715e4c1110d0dd7d481a4e1554825e638777fc3b0286d973a8664`). A sessão existente foi preservada: adicionaram-se 900 peers à carteira e titular existentes, sem abrir outra carteira ou zerar o histórico; o autoplay retomou com `peersPerRound=1000`.

Na leitura das **20:27:58 UTC**, a rodada 83 estava confirmando 1.000 apostas: 936 já confirmadas, 64 em confirmação, nenhum peer pendente, autoplay ligado e sem erro de operação. Às **20:30:15 UTC**, a rodada 84 tinha confirmado todas as 1.000 BETs: 715 saques, 144 perdas e 141 apostas ativas em liquidação, com zero BETs rejeitadas. As 141 operações ainda pendentes não tinham erro; a mesa continuava `healthy` e o fluxo avançou para a rodada 85.

Na rodada 85, os 1.000 peers continuavam com um único `walletId` e `playerId`, e o autoplay seguia ligado. A carteira estava em **R$ 9.247,65**; a reconciliação retornou `consistent: true`, diferença **R$ 0,00** e 9.567 lançamentos verificados. Na amostra de recursos das 20:27:58 UTC, demo: 0,65% CPU e 21,48 MiB/512 MiB; API: 25,11% CPU e 206,1 MiB/1 GiB. Esses valores são snapshots, não SLO ou capacidade sustentada.

## Recuperação da mensageria — 06/10/2026

O diagnóstico confirmou OOM do Python do LocalStack às **09:57:40 UTC**, perda da topologia SQS após restart e retenção indefinida de envelopes completos no cache FIFO de deduplicação. Às **16:34:35 UTC**, a outbox tinha **9.702.387 envelopes pendentes** e lag de aproximadamente 23,3 horas. A telemetria exata a cada dois segundos concorria com a publicação sobre milhões de registros. Apostas financeiras já confirmadas não dependem da publicação desses eventos. A interpretação foi registrada antes da implementação em `specs/001-distributed-wagering/spec.md`; mudanças, limites e procedimento estão em [MESSAGING-RECOVERY](MESSAGING-RECOVERY.md).

### Pipeline e reprodução

A execução final de `bun run verify:full` passou em **Docker/Linux, Bun 1.4.2**, entre **17:09:10.973 e 17:14:17.143 UTC**, com PostgreSQL 17.6 e a imagem derivada de LocalStack 4.9.2 exclusivos da execução:

| Etapa        | Resultado                                                   |
| ------------ | ----------------------------------------------------------- |
| Typecheck    | exit 0; 6,167 s                                             |
| Lint         | exit 0; 12,771 s                                            |
| Formatação   | exit 0; 5,373 s                                             |
| Unidade      | 91 testes                                                   |
| Integração   | 71 testes                                                   |
| Concorrência | 11 testes                                                   |
| Total        | **173 testes, 58.622 assertions, zero falhas e zero skips** |

O gate inclui 8.000 BETs com WIN/LOSS, três processos HTTP, PostgreSQL/SQS reais, concorrência, crashes e reconciliação das wallets das fixtures. As provas novas cobrem claim ampliado, limitação pela profundidade da fila, polls agregados com ACK em lotes de até dez e replay de envelope publicado sem recibo. Replay conserva `published_at` e não reaplica efeitos financeiros. `resources-all.json` registrou `cleanupComplete: true` e nenhuma falha na limpeza de bancos/filas gerados pelo runner.

Comando executado, a partir da raiz do workspace:

```powershell
docker compose -f compose.yaml -f .tmp/messaging-recovery-test.yaml -p jungle-recovery-20261006 --profile test run --rm -T --no-deps --name jungle-recovery-full-20261006 --volume D:/code/jungle-gaming/backend-challenge/test-results/messaging-recovery-20261006:/app/test-results test bun run verify:full
```

O override isolado selecionou `jungle-challenge:messaging-recovery-20261006-v1` e `jungle-localstack:4.9.2-fifo-ttl-v1`. O Dockerfile usa Bun 1.4.2 e `bun install --frozen-lockfile --ignore-scripts`. Logs, JUnit e relatórios estão em `test-results/messaging-recovery-20261006/`, ignorados pelo Git.

As tentativas anteriores permanecem registradas. A primeira passou nos checks e nas 91 unidades, mas uma fixture nova esperava 25 eventos para 25 aberturas de carteira, que geram 50; a expectativa foi corrigida. A segunda passou nas 71 integrações e falhou na prova de SIGTERM: uma entrega seguinte era consumida porque o FIFO original recusava ACK depois da deadline inicial, mesmo após visibility renovada. Um reproducer no código da imagem confirmou esse defeito. O heartbeat foi antecipado para metade da janela e o broker recebeu a verificação upstream da visibility corrente; nenhuma assertion foi removida ou skip acrescentado.

Após o gate completo, a prova de SIGTERM foi reforçada para manter a operação bloqueada por mais 1,6 s, atravessando a visibility original de 1 s antes do commit. A suíte inteira de concorrência foi repetida sobre a mesma imagem com esse arquivo montado: **11 testes, 487 assertions, zero falhas e zero skips**, em 31,076 s. O teste direto do modelo FIFO da imagem derivada também comprovou deduplicação após ACK, expiração em cinco minutos, preservação de mensagens não confirmadas, limpeza de grupos vazios e aceitação de ACK com visibility renovada; handles realmente expirados continuam recusados. Evidências adicionais em `extended-shutdown/`, `visibility-fix/`, `attempt-1/` e `attempt-2/`.

A conferência após o commit `67c329d` identificou que o Compose base e o workflow ainda iniciavam a imagem upstream antiga. O Compose base passou a construir o broker derivado, e o workflow/roteiros usam `up --build`. A repetição completa com essa infraestrutura, sem override do broker, passou entre **17:45:10.799 e 17:49:59.029 UTC**: **173 testes, 58.623 assertions, zero falhas e zero skips**, incluindo a assertion reforçada de SIGTERM. Typecheck, lint e formatação também passaram. O test container foi reconstruído do workspace atual, com imagem `jungle-challenge:messaging-ci-20261006-v2`; o override temporário selecionou somente essa imagem. Evidências em `test-results/messaging-recovery-20261006/compose-base/`, com limpeza completa das fixtures.

Essa repetição usou `docker compose -f compose.yaml -p jungle-recovery-20261006 up --build -d postgres localstack --wait` e o runner Docker com `--no-deps`, projeto `jungle-recovery-20261006`, override `.tmp/messaging-ci-test.yaml` e relatórios montados em `/app/test-results`. README e este registro foram atualizados depois da construção da imagem, sem alterar runtime ou testes. Os SHA-256 dos seis módulos alterados de runtime, incluindo o script de replay, conferiram entre workspace e API implantada.

O push do alinhamento `6002023` disparou a [execução GitHub 37506860989](https://github.com/spanol/backend-challenge/actions/runs/37506860989), entre **17:52:06 e 17:52:11 UTC**. O GitHub não iniciou o job `verify`: a resposta contém **zero etapas executadas**, e não há log de testes. Portanto, essa execução remota **não valida a implementação**; o gate aprovado descrito acima foi executado em Docker local. A anotação operacional do provedor precisa ser resolvida antes de repetir o CI remoto. Nenhum teste, check ou proteção da branch foi desabilitado para contornar o impedimento.

### Publicação e manutenção

O auto bet foi pausado e a rodada **3368** liquidou com 3.000 BETs, 429 saques, 2.571 perdas, zero rejeições, apostas abertas ou operações pendentes. A publicação antiga foi suspensa, e as três filas foram drenadas antes de recriar o broker. Às **17:16:31 UTC**, somente API e broker foram atualizados; demo, PostgreSQL, sessão e identidades/saldos das carteiras foram preservados. Readiness retornou **200**. As imagens publicadas são as mesmas selecionadas no gate; ajustes posteriores atingiram configuração, documentação e a assertion adicional de SIGTERM.

A configuração final usa claim **500**, oito sequências de envio, fila aproximada limitada a **10.000**, **32 polls** do consumidor e telemetria a cada **60 s**. A quota efetiva do broker, ainda em **0,5 CPU** na base antiga, foi elevada ao vivo para **1 CPU às 17:27:02 UTC**, sem trocar o container ou perder mensagens; o override também passou a declarar esse limite. API e PostgreSQL mantêm 1,5 CPU/1 GiB cada; broker 2 GiB; demo 1 CPU/512 MiB.

`VACUUM (ANALYZE, PARALLEL 0, TRUNCATE OFF) public.outbox`, com `vacuum_cost_delay=2ms` e `vacuum_cost_limit=200`, terminou com exit 0 entre **17:25:23.987 e 17:31:31.313 UTC**. Limpou versões físicas mortas e atualizou estatísticas, preservando registros e escritas concorrentes; não houve `VACUUM FULL`, rollback, migration ou alteração financeira.

Às **17:33:53 UTC**, com auto bet ainda pausado, havia **8.991.555 envelopes pendentes**, broker com **338,9 MiB / 2 GiB**, readiness **200**, zero reinícios e `OOMKilled=false`. A profundidade aproximada de **10.183** ilustra o overshoot permitido pelo claim em andamento. A retomada ocorreu às **17:34:07 UTC**, com o mesmo grupo de **3.000** e cursor preservado.

Três rodadas naturais consecutivas liquidaram após a retomada, todas sem rejeição, aposta aberta, confirmação ou operação pendente:

| Rodada |  BETs | Saques | Perdas | Apostado BRL | Prêmios BRL | Observação UTC |
| ------ | ----: | -----: | -----: | -----------: | ----------: | -------------- |
| 3761   | 3.000 |    428 |  2.572 |      3000.00 |      513.60 | 17:35:13       |
| 3762   | 3.000 |  2.143 |    857 |      3000.00 |     4051.35 | 17:36:21       |
| 3763   | 3.000 |  1.713 |  1.287 |      3000.00 |     2869.80 | 17:37:32       |

Às **17:37:32 UTC**, a última coleta concluída mostrava **8.884.672 pendentes**: redução líquida de **817.715** frente à amostra anterior à manutenção, incluindo o período pausado. O contador de publicação cresceu de 126.000 às 17:34:22 para 208.000 nessa observação, aproximadamente **432 eventos/s**, com autoplay ativo; essa janela inclui o custo das rodadas e não mede capacidade máxima. A memória do broker foi de **309,1 a 309,7 MiB** entre essas duas amostras, sem restart; a fila ficou próxima do patamar de backpressure. Não se confunde publicação com recebimento downstream concluído.

Depois das mudanças, `bun run check` também passou no Windows/Bun 1.4.2: typecheck, lint e formatação, exit 0. Os containers, rede e dois volumes do projeto isolado `jungle-recovery-20261006` foram removidos; a limpeza não atingiu produção nem serviços locais de outros projetos. `CHALLENGE.md` conserva SHA-256 `47795FCE2FC38CAE5F1B91368EBAF80B7A2ED1FE147F36704B665FAF0613812E`.

O job finito `jungle-event-replay-20261006`, restrito à rede privada, aguarda uma coleta concluída com backlog inferior a 10.000 antes de recuperar publicados antigos sem recibo. Usa a role da aplicação, checkpoint em volume próprio, 0,25 CPU/512 MiB, sem servidor HTTP ou rota externa. O checkpoint conserva limite, cutoff, cursor e progresso; entregas repetidas usam a mesma identidade e o recibo único. Esse job não altera a história de publicação nem transações financeiras. A recuperação histórica permanece em andamento e não é apresentada como backlog zerado ou prova de persistência do broker.

A checagem final encontrou o job com `unhealthy` por ter herdado o healthcheck HTTP da API, embora execute somente um script. Às **17:39:55 UTC**, apenas esse job foi recriado com healthcheck HTTP desabilitado e somente a rede privada, conservando seu volume de checkpoint. A primeira tentativa foi interrompida por uma assertion de rede antes de qualquer alteração; a inspeção confirmou que o job herdara também a rede edge da API, removida na recriação. Os serviços de aplicação não foram recriados nesse ajuste, e o total de containers `unhealthy` voltou a zero. O estado do processo e o checkpoint são os sinais operacionais desse job finito.

Às **17:40:23 UTC**, readiness estava em **200**, autoplay seguia em **3.000**, sem erro de operação, e a última coleta concluída registrava **8.838.280 pendentes**. O job estava ativo, sem restart, aguardando a drenagem, somente na rede privada e com **zero bindings de portas publicadas**. O host não tinha containers `unhealthy`. Na consulta de 17:38:41 UTC, página e script públicos responderam **200** e `/demo/health` **204**; a agregação dos logs desde a retomada encontrou zero eventos de retry de worker/publicação/mensagem, falha de visibility/request, dead letter ou divergência de reconciliação. Ausência desses logs complementa a observação das rodadas, sem substituir uma auditoria SQL de todo o histórico.

Evidências agregadas da manutenção ficam em `evidence/demo-recovery-20261006/` no servidor; segredos, journal e envelopes financeiros não são publicados. Esta observação não declara estabilidade ilimitada nem capacidade equivalente em AWS.

## Inclusão de jogadores no auto bet — 06/10/2026

A consulta operacional encontrou **3.000 jogadores cadastrados**, sem peers pendentes, e grupo automático limitado a **1.000** na rodada 2757. O cadastro incorporava os assentos na rodada seguinte, mas conservava `peersPerRound`, mantendo o total de BETs em 1.000 e distribuindo os jogadores em rodízio.

DEM-19 amplia o grupo automático independente pela quantidade de peers pendentes incorporados, até 8.000, antes do planejamento financeiro da próxima rodada. A ampliação e a entrada dos assentos pertencem ao mesmo checkpoint do journal. A rodada em andamento, pausa/retomada e prioridade das reservas manuais conservam seus contratos. A interface informa a ampliação ao confirmar o cadastro.

`bun run check` passou em **Windows, Bun 1.4.2**, entre **04:17:15.872 e 04:18:31.964 UTC**: typecheck, lint e formatação, todos com exit code zero. `git diff --check` também passou. Relatório em `test-results/verify-static.json`. Esta execução é um gate estático; não foram adicionados ou executados testes unitários, integração, concorrência ou carga neste incremento. A inspeção do código não substitui uma prova executada de cadastro seguido de aposta, recuperação ou falha de transporte.

Às **04:22:05 UTC**, a imagem `jungle-challenge:demo-autoplay-growth-20261006-5bc9a6f` foi publicada somente na demo. A atualização aguardou a liquidação da rodada 2766, pausou o autoplay, preservou um backup restrito do journal e recuperou a mesma sessão e identidades das 3.000 carteiras. Os hashes de `demo/table.ts` e `demo/public/client.ts` conferiram com o commit `5bc9a6f`; a imagem deriva da anterior e substitui somente esses dois arquivos. O grupo existente foi alinhado explicitamente aos **3.000 jogadores** já cadastrados. O override da release fixa a imagem publicada, sem alterar o ambiente global.

A observação natural da rodada **2768** encontrou **3.000 BETs confirmadas**, 428 saques, 2.572 perdas, volume de **3.000.00 BRL** e prêmios de **513.60 BRL**, sem rejeição, aposta aberta ou operação pendente ao liquidar. Essa observação confirma o grupo existente de 3k; não foi criado um jogador adicional para testar a ampliação de DEM-19. O primeiro acesso HTTPS pelo cliente Python retornou 403 e interrompeu o observador depois da liquidação. A repetição por `curl` encontrou `/` e `/client.js` em **200**, `/demo/health` em **204**; a primeira tentativa permanece preservada.

A readiness financeira retornou **503**, com PostgreSQL disponível e SQS indisponível. A listagem do LocalStack não encontrou filas e os workers registravam `QueueDoesNotExist`. O container havia iniciado em **05/10 às 17:13:31 UTC**, com dois reinícios, antes desta publicação; o horário e a causa exatos da ausência das filas não foram comprovados. A consulta dos logs no intervalo anterior ao deploy não recuperou ocorrências, e não é usada como prova de quando o problema começou. Às **04:26:08 UTC**, `docker exec jungle-server-app-observed-1 bun scripts/queues.ts` restaurou as três filas com o inicializador do projeto. Seis consultas até **04:26:34 UTC** retornaram readiness **200**, com PostgreSQL e SQS disponíveis. Não foram apagadas filas ou mensagens, nem republicados eventos históricos; restaurar filas ausentes não comprova recuperar as mensagens que elas continham ou drenar o backlog.

Às **04:27:13 UTC**, os quatro containers da stack estavam saudáveis, sem OOM registrado. API, PostgreSQL e LocalStack conservaram horários de início anteriores ao deploy; a API permanece em `demo-cadence-20261005-6fc109d`. A demo preparava a rodada 2772 com autoplay em 3.000 e nenhum erro de operação; confirmações pendentes nessa leitura pertenciam ao processamento normal da nova rodada. Evidência agregada em `test-results/demo-autoplay-growth-20261006/deployment.json` e, no servidor, `evidence/demo-autoplay-growth-20261006/`. O journal de backup permanece restrito no servidor. A observação não declara estabilidade prolongada, auditoria SQL completa ou recuperação histórica das mensagens SQS.

## Carteiras esgotadas na apresentação — 05/10/2026

Às **16:51:13 UTC**, a consulta operacional encontrou autoplay ativo, 1.000 carteiras e nenhuma BET na rodada 1144. Todas as carteiras tinham saldo inferior à aposta de 1.00 BRL: mínimo **0.10**, máximo **0.85** e total **599.80 BRL**. Não havia operação pendente ou erro financeiro. O coordenador excluía participantes sem saldo e continuava avançando rodadas vazias.

O commit `1396e9e` renova somente carteiras esgotadas do grupo automático independente, pela abertura HTTP normal com outro jogador e 100.00 BRL fictícios. Preserva sessão, assentos, contador de rodadas e wallets anteriores. A associação das apostas históricas usa a wallet/jogador da BET original; resultados antigos não atualizam o saldo da carteira substituta. O perfil da apresentação habilita `DEMO_RENEW_EXHAUSTED_WALLETS`; o coordenador construído sem essa opção conserva o comportamento anterior. Provisão malsucedida bloqueia o avanço e requer retry. Aberturas não têm recuperação idempotente por identidade: uma resposta perdida pode deixar uma wallet sem utilização, conforme registrado na [especificação](../specs/002-decolagem-demo/spec.md).

`bun run check` passou em **Windows, Bun 1.4.2**, entre **16:54:10.299 e 16:54:40.473 UTC**: typecheck, ESLint e Prettier exit 0. Não foram acrescentados ou executados testes neste ajuste. O gate completo de 170 testes registrado abaixo pertence ao incremento anterior e não é apresentado como validação deste commit.

A imagem `jungle-challenge:demo-wallet-renewal-20261005-1396e9e` foi publicada somente na demo às **16:58:37 UTC**, com hashes de `demo/` conferidos e journal preservado. Os outros **40 containers** mantiveram identidade, imagem, reinícios e OOM. A primeira tentativa do procedimento falhou ao interpretar um agregado SQL em JSON com múltiplas linhas, antes de recriar containers; a leitura foi corrigida para JSONB compacto e o procedimento retomado. Não houve migration, rollback do banco ou reescrita financeira.

A observação operacional encontrou **1.000 carteiras renovadas** e três rodadas consecutivas encerradas, sem rejeição, aposta aberta ou confirmação pendente:

| Rodada |  BETs | Saques | Perdas | Apostado BRL | Prêmios BRL | Liquidação UTC |
| ------ | ----: | -----: | -----: | -----------: | ----------: | -------------- |
| 1194   | 1.000 |    714 |    286 |      1000.00 |     1349.55 | 16:59:02       |
| 1195   | 1.000 |    571 |    429 |      1000.00 |      955.90 | 16:59:20       |
| 1196   | 1.000 |    143 |    857 |      1000.00 |      171.60 | 16:59:36       |

A auditoria SQL das **2.000 wallets**, antigas e novas, encontrou zero diferenças de saldo/versão, saldos negativos, diários desbalanceados ou transações pendentes. Nas wallets novas não houve rejeição. As antigas conservam **599.80 BRL e 825.709 lançamentos**; o fingerprint de identidade, saldo, versão e cardinalidade do ledger permaneceu igual antes/depois da publicação. Existe uma BET histórica rejeitada por `INSUFFICIENT_FUNDS` às **16:45:33 UTC**, anterior ao diagnóstico e deploy. A assertion inicial do observador, que exigia ausência de qualquer rejeição histórica, falhou após observar as três rodadas; a leitura separada das populações confirmou sua origem anterior, sem remover ou reinterpretar esse registro.

Às **17:03:19 UTC**, a demo estava na rodada **1208**, autoplay ativo em 1.000, sem erro de operação; página pública e readiness financeiro responderam **200**. Os outros 40 containers continuaram preservados. Os dados brutos e comandos do procedimento ficam em `test-results/demo-wallet-renewal-20261005/`; os agregados do servidor em `evidence/demo-wallet-renewal-20261005/`, inclusive `financial-audit.json` e `final-health.json`. Essa observação cobre a renovação real e a retomada, sem declarar prova de falhas de transporte ou estabilidade ilimitada.

## Cadência de 1.000 e entrega auditada de eventos — 05/10/2026

O usuário confirmou **1.000 apostas em toda rodada**. O incremento `6fc109d` mantém as carteiras existentes, resultados financeiros históricos e confirmações terminais antes do voo. Atualiza o coordenador para repor vagas individuais no limite de 32 chamadas, usa contagem de 3 s e resultado de 1,5 s, otimiza os joins das validações SQL sem remover a soma/cadeia integral do ledger e adiciona dois índices parciais não únicos. O perfil da demo habilita o consumidor opcional `demo-event-audit`, que confere o envelope com a outbox, grava o recibo e só então envia o ACK. Contrato registrado em `specs/002-interactive-demo/spec.md`, garantias em [ARCHITECTURE](../ARCHITECTURE.md) e rastreabilidade em [TRACEABILITY](TRACEABILITY.md).

### Pipeline completa

O primeiro `bun run verify:full`, **14:06:35.725–14:12:08.580 UTC**, passou nos checks estáticos e nas 91 unidades, mas terminou com **10 falhas de integração**. A nova fixture com 500 WIN históricos deixou mais eventos reais que o limite fixo de publicação do teste de mensageria conseguia drenar; a primeira expectativa de outbox vazia deixou 718 eventos e provocou falhas subsequentes. Os sete testes novos do consumidor e as validações financeiras passaram nessa tentativa. Concorrência não foi executada, e essa tentativa não autorizou a publicação. Relatórios em `test-results/demo-cadence-20261005/linux/`, com limpeza completa.

O commit `c0ebfbc` calcula o limite de drenagem pelo backlog real da fixture isolada e conserva todas as assertions. A execução completa de sua fonte passou em **Docker/Linux, Bun 1.4.2**, entre **14:15:29.559 e 14:23:41.046 UTC**, usando PostgreSQL 17.6 e LocalStack 4.9.2 exclusivos da execução:

| Gate         | Resultado                                            |
| ------------ | ---------------------------------------------------- |
| Typecheck    | Exit 0; 17.572 ms                                    |
| ESLint       | Exit 0; 37.308 ms                                    |
| Prettier     | Exit 0; 13.205 ms                                    |
| Unidade      | 91 testes; 24.948 assertions                         |
| Integração   | 68 testes; 32.922 assertions                         |
| Concorrência | 11 testes; 486 assertions                            |
| Total        | **170 testes; 58.356 assertions; zero falhas/skips** |

As provas reais incluem ACK após commit durável, rollback sem ACK, falha após commit com redelivery/deduplicação, ACK ausente ou falho, envelope duplicado alterado e lote de dez eventos. As provas SQL cobrem imutabilidade de jogador/moeda até para o owner, `SET CONSTRAINTS`, replay histórico e rejeição de snapshot forjado depois de 500 WIN. Migrations foram exercitadas no ciclo isolado de `up → down → up`; uma rodada de 8.000 peers em três APIs reais continua na suíte. Não há reset do banco principal ou substituição das provas por mocks.

Os relatórios `verify-full.json`, JUnit e recursos ficam em `test-results/demo-cadence-20261005/linux-final/`; os três registros de recursos confirmam `cleanupComplete: true`. A stack própria foi removida com `POSTGRES_PORT=55596 SQS_PORT=4596 docker compose -f test-results/demo-cadence-20261005/qa/context/compose.yaml -p jungle-demo-cadence-20261005 down -v --remove-orphans`. As falhas da primeira execução e sua correção ficam preservadas no registro.

A revisão da documentação passou em `bun run check` no Windows, Bun 1.4.2, entre **14:34:26.562 e 14:35:11.889 UTC**, com typecheck, lint e formatação exit 0. Depois foram acrescentados somente os agregados da confirmação operacional; os arquivos alterados foram formatados novamente. A fonte executável conserva os hashes do gate completo.

### Publicação e medição real

Antes da revisão, readiness apresentou 503 após um reinício do LocalStack e ausência das três filas. O diagnóstico e a recuperação idempotente das filas estão em [DEMO-CAPACITY](DEMO-CAPACITY.md). O worker de outbox já validado `d7eb553` foi publicado na API às **13:35:00 UTC**. API e PostgreSQL receberam **1,5 CPU / 1 GiB**, aplicados sem recriar dependências; a sessão em curso retomou as mesmas operações por identidade. O comparativo imediatamente anterior, rodadas 366–368, ainda levou medianas de **33,014 s de preparação e 64,988 s até liquidar**, com todas as 1.000 carteiras reconciliadas.

Às **14:26:25 UTC**, publicou-se `jungle-challenge:demo-cadence-20261005-6fc109d` em API e demo, com hashes de `src/` e `demo/` conferidos. A fonte executável corresponde a `6fc109d`; `c0ebfbc` altera somente a drenagem da fixture de teste. Somente as migrations **009 e 010 foram aplicadas para cima** em produção. A troca aguardou fronteira liquidada, preservou journal, sessão e as 1.000 carteiras, sem reverter migrations ou restaurar um journal antigo. **39 outros containers** conservaram identidade, imagem, reinícios e estado de OOM, incluindo PostgreSQL e LocalStack. HTTP público e readiness financeiro retornaram **200**. Limites e configuração do consumidor estão persistidos em `compose.demo.yaml`. Prova do deploy em `evidence/demo-cadence-20261005/deploy-final.json` no servidor.

O observador `python3 scripts/demo-round-benchmark.py --expected-session-id <sessao-existente> --expected-peers 1000 --profiles 1000 --rounds 3 --output <diretorio-novo>` passou entre **14:26:50 e 14:28:41 UTC**. As rodadas **506–508** confirmaram exatamente 1.000 BETs cada e todos os WIN/LOSS e prêmios previstos. Mediana de preparação: **7,363 s**; até liquidar: **17,192 s**, redução de **77,7% / 73,5%** frente ao comparativo imediatamente anterior. Os tempos excluem 1,5 s de resultado. As auditorias inicial e final das 1.000 carteiras tiveram zero divergências, saldos negativos, diários desbalanceados e transações pendentes/rejeitadas. No encerramento havia 421 eventos da sessão ainda não publicados; às **14:29:24 UTC**, SQL encontrou **zero outbox pendente global**, 93.740 recibos e fila histórica em drenagem. Entrada e DLQ vazias. Os quatro serviços conservaram seus contadores durante o ensaio, com o reinício anterior do LocalStack registrado na baseline.

Autoplay terminou ativo com **1.000 participantes por rodada**. Recursos, detalhes por rodada e limites da comparação estão em [DEMO-CAPACITY](DEMO-CAPACITY.md#cadência-atual-1000-apostas-em-toda-rodada). Os perfis 2k/4k/8k permanecem como referências históricas da API anterior. Agregados foram transferidos somente após verificação remota por esquema restrito; amostras e logs detalhados continuam no servidor. O GitHub Actions permanece sujeito ao bloqueio de cobrança registrado abaixo; a pipeline aprovada nesta revisão é a execução completa em Docker/Linux.

Às **14:35:35 UTC**, a confirmação operacional encontrou rodada 530, autoplay em 1.000, ausência de erro e HTTP público/readiness 200. A fila de eventos caiu de 327.531 para **287.402 visíveis**, com **194.450 recibos** e entrada/DLQ vazias. A outbox tinha **1.540 eventos pendentes durante novas apostas**; seu zero anterior era uma leitura pontual. Não houve novo reinício ou OOM. Registro em `evidence/demo-cadence-20261005/final-health.json` no servidor.

O push `97fe8b2` publicou código, fixture e documentação em `demo-deploy`. A consulta remota confirmou a `main` em `09a5aea`, de 03/10. O [GitHub Actions 37326176983](https://github.com/spanol/backend-challenge/actions/runs/37326176983), criado às **14:37:19 UTC**, terminou como `failure`, com **zero etapas executadas**. A anotação oficial do check `111817385763` informa que o job não iniciou porque a conta está bloqueada por cobrança. Esse run não executou testes; os **170 testes aprovados** pertencem ao gate Docker/Linux descrito acima.

## Comparativo da demo e saques após resposta lenta — 05/10/2026

Método, resultados por perfil, limites da referência de 8k e primeira tentativa não aprovada estão em [DEMO-CAPACITY](DEMO-CAPACITY.md). O ensaio público usa créditos fictícios e a mesma mesa, com até 32 chamadas financeiras simultâneas; não é uma rajada de 8.000 conexões.

O commit `0bc178a` corrige a passagem do relógio pelo estouro durante a confirmação de WIN. O gate `bun run verify:full` passou em Docker/Linux entre **04:24:23.014 e 04:33:54.039 UTC**, com Bun 1.4.2: **158 testes, 58.139 assertions, zero falhas e zero skips** (90 unidade, 57 integração e 11 concorrência). Typecheck, lint e formatação tiveram exit 0. A rodada integrada de 8.000 peers em três APIs reais durou 373,520 segundos; o timeout específico de 600 segundos preserva todos os asserts. Recursos do runner têm `cleanupComplete: true`; `docker compose -f test-results/demo-cashout-20261005/context/compose.yaml -p jungle-demo-cashout-20261005 down -v --remove-orphans` removeu somente a infraestrutura exclusiva desta execução. Relatórios em `test-results/demo-cashout-20261005/linux/`.

Às **04:36:34 UTC**, publicou-se `jungle-challenge:demo-cashout-20261005-0bc178a` somente na demo. Os hashes de `demo/` conferiram; sessão, 8.000 carteiras e cursor foram recuperados. A mesa ficou pausada no grupo de 4.000 para iniciar o comparativo. Os outros 40 containers conservaram identidade, imagem, reinícios e estado de OOM; HTTP público retornou 200. A API financeira permaneceu na imagem anterior. Evidência agregada do deploy em `evidence/demo-cashout-20261005/deploy.json` no servidor.

O comparativo repetido passou entre **04:37:00 e 04:46:19 UTC**, com três rodadas completas de cada perfil 4k/2k/1k e auditorias das 8.000 carteiras. As medianas até liquidar foram 91,363 s / 47,763 s / 25,480 s; preparação: 43,084 s / 24,459 s / 10,413 s. Foram conferidos os saques previstos e o prêmio exato de cada rodada, sem rejeições ou divergências financeiras. A outbox tinha 13.406 / 16.391 / 7.959 eventos ainda não publicados nas pausas dos perfis; essa entrega assíncrona não está incluída como conclusão do ciclo medido. Recursos e rodadas estão em [DEMO-CAPACITY](DEMO-CAPACITY.md); dados completos permanecem no servidor em `evidence/demo-round-benchmark-20261005-v2/`.

O commit final de runtime **`f42e62e`** configura 1.000 peers no ambiente, Compose e frontend. Seu arquivo limpo passou novamente em `bun run verify:full` no Docker/Linux, Bun 1.4.2, entre **04:50:54.220 e 05:00:06.649 UTC**: **158 testes, 58.139 assertions, zero falhas/skips**, com typecheck, lint e formatação exit 0. A integração de 8k durou 366,051 s e reconciliou as 8.000 carteiras. Relatórios em `test-results/demo-presentation-20261005/linux/`; o runner confirmou limpeza completa. `docker compose --env-file .env.example -f test-results/demo-presentation-20261005/context/compose.yaml -p jungle-demo-presentation-20261005 down -v --remove-orphans` removeu os containers, volumes e rede dessa execução. O GitHub Actions continua limitado pelo bloqueio de cobrança já identificado abaixo; o gate aprovado é a execução local completa em Docker/Linux.

Às **05:02:06 UTC**, `jungle-challenge:demo-presentation-20261005-f42e62e` foi publicado com os hashes de `demo/` conferidos. A atualização aguardou liquidação, recuperou o journal anterior e criou explicitamente uma nova sessão de **1.000 carteiras independentes**, aposta 1.00 BRL e autoplay ativo, conforme a escolha de apresentação. O journal anterior tem backup restrito no servidor; todas as carteiras e lançamentos históricos permanecem no PostgreSQL. Os outros **40 containers** conservaram identidade, imagem, reinícios e estado de OOM; somente a demo foi recriada. HTTP público e readiness financeiro retornaram **200**. Evidência agregada em `evidence/demo-presentation-20261005/deploy.json` no servidor.

A confirmação final observou as rodadas **3–5**, cada uma com 1.000 BETs e todos os WIN/LOSS e prêmios previstos. Mediana de preparação: **16,765 s**; até liquidar: **37,080 s**, variação registrada separadamente do comparativo anterior de 25,480 s. Às **05:04:59 UTC**, as 1.000 carteiras reconciliaram com zero divergências, saldos negativos, diários desbalanceados, transações pendentes/rejeitadas ou outbox não publicada dessa sessão. Os quatro serviços permaneceram sem reinício, substituição ou OOM durante a observação. Autoplay terminou ativo em 1.000 por rodada. Relatório agregado verificado em `test-results/demo-presentation-20261005/rounds-aggregate.json`; originais em `evidence/demo-presentation-rounds-20261005/` no servidor.

No Chrome público, a página confirmou 1.000 peers, formulário sugerindo 1.000, progresso global e retry oculto durante processamento normal. O documento e a viewport natural mediram **1.905 px**, sem rolagem horizontal; mesa → atividade e atividade → jogadores conservaram **20 px**. Evidência visual em `test-results/demo-presentation-20261005/demo-1000-publicada.png`.

O push `28e589f` disparou o [GitHub Actions 37266397536](https://github.com/spanol/backend-challenge/actions/runs/37266397536). A consulta oficial confirmou conclusão `failure`, **zero etapas executadas** e anotação de conta bloqueada por problema de cobrança. Esse run não executou testes; os 158 testes aprovados pertencem ao gate Docker/Linux acima. Os commits posteriores a `f42e62e` registram somente documentação; a `main` local e remota permanece em `09a5aea`, de 03/10/2026.

## Participação de 8.000 peers por rodada — 05/10/2026

O usuário confirmou 8.000 peers em cada rodada, com o voo aguardando as confirmações. O teto anterior era o grupo configurado de 128, e não a pausa de 3,7 segundos após o estouro. O commit `c7c2df9` configura participação integral, apresenta progresso e inicia a contagem de cinco segundos somente após os resultados financeiros terminais. O grupo pode ser atualizado na sessão existente sem recriar carteiras. O commit `d6dfe2a` reserva 2 GiB para o LocalStack no override da demo, após a consulta mostrar cerca de 390 mil eventos acumulados e uso próximo do limite anterior de 768 MiB; o host tinha cerca de 4,2 GiB disponíveis.

O gate completo do commit `d6dfe2a` passou em Docker/Linux com Bun 1.4.2, entre **03:57:55 e 04:02:16 UTC**: `bun run verify:full`, **155 testes, 58.053 assertions, zero falhas e zero skips** (88 unidade, 56 integração e 11 concorrência). Typecheck, lint e formatação também passaram. A nova integração provisionou 8.000 carteiras, confirmou 8.000 BET e liquidou 1.142 WIN e 6.858 LOSS através de três APIs HTTP reais; todas as carteiras reconciliaram no `afterEach`. O teste levou 165,8 segundos, incluindo provisionamento; confirmação e liquidação levaram 107,9 segundos. A unidade percorreu duas rodadas de 8.000 peers e verificou uma preparação atrasada em 60 segundos, sem descartar participantes, além de retry de BET com resposta perdida e identidades preservadas. Uma execução anterior do mesmo código de jogo, no commit `c7c2df9`, também passou nos 155 testes.

As imagens foram construídas de `git archive` limpos, usando instalação congelada e sem scripts. PostgreSQL 17.6 e LocalStack 4.9.2 usaram exclusivamente o projeto `jungle-demo-participation-20261005`, nas portas 55586/4586. O container do gate recebeu as URLs dessa infraestrutura e montou `test-results/demo-participation-20261005/linux-final/` em `/app/test-results`. `resources-all.json` confirmou limpeza de bancos e filas; `docker compose -f test-results/demo-participation-20261005/context-final/compose.yaml -p jungle-demo-participation-20261005 down -v --remove-orphans` removeu somente containers, volumes e rede desse projeto. Relatórios anteriores estão em `linux/` na mesma pasta.

O GitHub Actions [37261134495](https://github.com/spanol/backend-challenge/actions/runs/37261134495), disparado pelo push da `demo-deploy`, falhou **antes de iniciar o job**. A anotação oficial informa que a conta está bloqueada por um problema de cobrança; não há logs nem etapas executadas. Esse run remoto não é apresentado como gate aprovado. A prova completa executada é o gate Docker/Linux acima.

Às **04:03:27 UTC**, a demo foi publicada como `jungle-challenge:demo-participation-20261005-d6dfe2a`, com os arquivos de `demo/` copiados sobre a imagem anterior. Todos os hashes conferiram com o commit. A atualização aguardou liquidação, preservou journal, sessão, 8.000 carteiras e cursor e configurou `peersPerRound: 8000` explicitamente. HTTP público retornou 200. Os outros 40 containers conservaram identidade, imagem, reinícios e estado de OOM; somente a quota do LocalStack foi ampliada ao vivo com `docker update --memory 2g --memory-swap 3g`, sem reinício nem remoção de mensagens. A API financeira conservou sua imagem anterior; este deploy não publicou as alterações de outbox da branch.

A prévia no Chrome confirmou o progresso de 8.000 apostas e o botão de retry oculto durante processamento normal. Na viewport 390×844, a largura visível e do documento foi 375 px, sem rolagem horizontal; o espaço entre mesa e atividade continuou em 20 px. Essa prévia visual usa fixture controlada; a prova financeira usa a infraestrutura real descrita acima. O Chrome público mostrou mais de 3.000 confirmações durante a preparação da rodada 191, com progresso e espaçamento correto.

### Branches solicitadas

Os commits de 05/10/2026 foram preservados em `demo-deploy`; `main` local e remota retornaram ao último commit de 03/10/2026, `09a5aea62d322b33d8695ef175c94ab57c5c151d`. A branch da demo foi publicada antes da atualização da `main` remota, que usou `--force-with-lease` contra o HEAD conferido `95b1ec6`. O trabalho posterior continua exclusivamente na `demo-deploy`.

## Correção de layout da demo — 05/10/2026

Publicado às 03:31:18 UTC como `jungle-challenge:demo-layout-20261005-6b8e916`, derivado da imagem anterior com apenas HTML/CSS do commit `6b8e916`. Os hashes dos dois arquivos servidos conferiram com os arquivos commitados. A atualização aguardou uma rodada liquidada, preservou o journal, a sessão de 8.000 peers e o cursor e retomou as apostas; a observação avançou da rodada 63 para a 65. A demo ficou saudável e HTTP público retornou 200; os outros 40 containers permaneceram intactos. No Chrome público, as duas colunas e os espaçamentos de 20 px foram confirmados, com autoplay ativo. Evidência agregada em `evidence/demo-layout-20261005/deploy.json` no servidor.

O formulário lateral determinava a altura da linha do grid e empurrava a atividade e os jogadores, deixando um espaço vazio abaixo do resumo. HTML e CSS agora usam duas colunas independentes. A prévia local no Chrome confirmou espaçamentos de 20 px entre voo, atividade e jogadores, em desktop e viewport de 390×844. No celular, a largura do documento e a área visível mediram 375 px, sem rolagem horizontal; a paginação quebra linha. Essa prévia usa uma fixture visual, sem comandos na sessão pública.

`bun run check` passou no Windows/PowerShell com Bun 1.4.2 entre 03:27:32 e 03:27:57 UTC: typecheck, lint e formatação com exit 0. Relatório `test-results/verify-static.json`. A alteração afeta somente a estrutura HTML e o CSS da demo.

## Consolidação da carga distribuída — 05/10/2026

Antes do commit das alterações de carga, outbox e relatórios, `bun run check` passou no Windows/PowerShell com Bun 1.4.2, de 03:22:22 a 03:22:49 UTC: typecheck, lint e formatação com exit 0. Relatório em `test-results/verify-static.json`. As validações financeiras e de carga já executadas estão registradas nas seções históricas abaixo; nenhuma nova bateria foi executada nesta consolidação. `passes.txt` contém credenciais locais e foi excluído do versionamento pelo `.gitignore`.

## Publicação com 8.000 peers — 05/10/2026

O commit `e236bc1` foi construído a partir de um `git archive` limpo, preservando as mudanças de carga já staged. A imagem `jungle-challenge:demo-continuous-20261005-e236bc1` passou em Docker/Linux com Bun 1.4.2: `bun run verify:full`, **146 testes, 1.726 assertions, zero falhas e zero skips** (83 unidade, 52 integração e 11 concorrência). Typecheck, lint e formatação passaram entre 03:10:44 e 03:12:35 UTC. A infraestrutura exclusiva `jungle-demo-release-20261005` usou PostgreSQL 17.6 e LocalStack 4.9.2; o runner confirmou limpeza completa, e `docker compose -f test-results/demo-production-20261005/context/compose.yaml -p jungle-demo-release-20261005 down -v --remove-orphans` removeu seus containers, volumes e rede. Os relatórios locais estão em `test-results/demo-production-20261005/linux/`.

No Subiu, `docker compose --env-file <raiz>/.env -f <base-existente>/compose.subiu.yaml -f <release>/compose.demo.yaml -p jungle-server up -d --no-deps --wait demo` publicou somente a demo às 03:13:33 UTC. O journal e a configuração anterior foram preservados em backup antes da troca. Depois da recuperação da sessão antiga, `POST /demo/session?view=dashboard` com `count: 8000`, `mode: independent` e `autoplay: true` criou 8.000 carteiras reais da demo, com créditos fictícios, e iniciou as apostas. O provisionamento começou às 03:13:47 e a sessão já estava em voo às 03:15:07 UTC.

Foram observadas seis rodadas consecutivas encerradas (2–7), com **128 BETs confirmadas por rodada**, WIN e LOSS, sem apostas abertas ou operação pendente ao final. O cursor avançou de 256 para 896. Na auditoria SQL de 03:16:42 UTC, as **8.000 carteiras** tinham saldo e versão coerentes com o ledger: zero divergências, saldos negativos, diários desbalanceados, transações pendentes/rejeitadas ou outbox não publicada. Foram contados 8.000 OPENING, 896 BET, 439 WIN e 457 LOSS; cinco carteiras também reconciliaram pela API. Essa observação cobre o início da rotação da população; não mede 8.000 apostas simultâneas nem um ciclo inteiro em produção.

A página pública respondeu HTTP 200 e foi conferida no Chrome: 8.000 peers, apostas automáticas ativas, saques/perdas e navegação para o grupo atual. A paginação 7.900 retornou Peer 7901–8000. Às 03:18:18 UTC, demo e API financeira estavam saudáveis, a demo sem reinício, `/demo/health` em 204 e `/health/ready` financeiro em 200. Os outros **40 containers** conservaram identidade, imagem e contagem de reinício. Os relatórios completos permanecem em `evidence/demo-continuous-20261005/` no servidor; o download desse pacote foi recusado pela revisão automática por conter dados financeiros e metadados de produção. Este registro contém somente resultados agregados.

## Demo com operação contínua — 04/10/2026

O perfil inicial configura 8.000 peers independentes, aposta automática de 1.00 BRL e grupos de 128 por rodada, com rotação persistente, saques variados, LOSS e pausa/retomada. O journal retém duas rodadas e contagens acumuladas. A unidade verifica a população de 8.000 e o tamanho do grupo; esse cenário usa a porta financeira controlada e não é uma medição de carga SQL.

`bun run verify:full` passou em Windows com Bun 1.4.2, 05/10/2026 02:51:38–02:53:42 UTC (04/10 em São Paulo). Typecheck, lint e formatação passaram; unidade: **85 aprovados**; integração: **55 aprovados**; concorrência: **10 aprovados**, com um skip previsto de SIGTERM no Windows. Nenhuma falha. A integração adicional percorre rodadas automáticas em três APIs HTTP reais, com PostgreSQL 17.6 e LocalStack 4.9.2, e confere valores exatos, ledger, reconciliação e replay.

Infraestrutura exclusiva: `docker compose --env-file .env.example -p jungle-demo-continuous-20261004 -f compose.yaml up -d postgres localstack --wait`, com `POSTGRES_PORT=55584` e `LOCALSTACK_PORT=4584`. O gate recebeu URLs de banco e SQS dessas portas e criou seus próprios bancos/filas. `resources-all.json` confirmou limpeza completa e nenhum recurso pendente. Relatórios preservados em `test-results/demo-continuous-20261004/`: `verify-full.json`, `resources-all.json`, `all.junit.xml` e `demo-continuous-verify.log`. A captura PowerShell retornou status 1 ao tratar stderr nativo como `NativeCommandError`; o relatório do gate e todos os filhos Bun registraram exit 0 e PASS. Ao terminar, `docker compose --env-file .env.example -p jungle-demo-continuous-20261004 -f compose.yaml down -v --remove-orphans` removeu exclusivamente os containers, volumes e rede criados nesta execução (exit 0).

A prévia da interface foi inspecionada no Chrome, em desktop e viewport de 390×844, com fixture controlada de 8.000 peers: pausa/retomada e navegação para o grupo atual funcionaram. Essa fixture serve somente à interface; as provas financeiras acima usam infraestrutura real. Após os ajustes de layout e rótulos, `bun run check` passou (exit 0), 05/10/2026 02:56:25–02:57:12 UTC; relatório `verify-static.json` preservado na mesma pasta. Ao encerrar essa validação local, a alteração ainda não havia sido publicada no Subiu; a publicação e a observação posteriores estão registradas acima.

## Perfil de jogo distribuído e sobrecarga — 03/10/2026

Foi preparado `game-scale` com 38.000 carteiras persistentes, rampa/sustentação pelo relógio, rajada de toda a população, BET e WIN/LOSS entre três APIs e SIGKILL de uma réplica. A fila e o limite de sessões pertencem ao gerador e seus descartes ficam explícitos. A implementação e os comandos estão em [DISTRIBUTED-LOAD](DISTRIBUTED-LOAD.md#população-persistente-jogo-e-sobrecarga). O rascunho anterior de amostragem de 1% foi retirado; não foi commitado nem publicado.

No Windows, `bun run verify` passou com Bun 1.4.2 e 77 testes de unidade. A imagem final `jungle-challenge:distributed-game-20261003-v4` foi construída localmente; manifest `sha256:2492a30f83e754691cc256fffbdec67fec3a48a16b26ed9e429d73075d79e18f`. Em Docker/Linux, `bun run verify:full` nessa imagem passou em 03/10/2026, 19:36:59–19:39:04 UTC: **139 testes, 1.435 assertions, zero falhas/skips**, incluindo migrations reversíveis, concorrência e SIGTERM real. Recursos de integração/concorrência foram limpos (`test-results/game-full-20261003-v4/resources-all.json`). A infraestrutura de apoio do projeto exclusivo `jungle-game-verify-20261003` também foi removida ao terminar.

O comando `python scripts/distributed-load-stack.py --project jungle-distributed-game-smoke-20261003-v4 --image jungle-challenge:distributed-game-20261003-v4 --output test-results/game-load-20261003/local-smoke-v4 --profile game-smoke` passou em Docker Desktop/Linux, com 96 jogadores e 24 sessões em voo. Houve três endereços SQL de API distintos, queda/restart real, exportação de telemetria e limpeza completa, sem disparar o guard. A auditoria esperou zero chamadas financeiras em execução nas três réplicas, incluindo chamadas cujo cliente já havia desconectado.

| Fase                  | Sessões oferecidas | Completas | Expiradas no gerador | Erros de transporte | p95 de sessões completas |
| --------------------- | -----------------: | --------: | -------------------: | ------------------: | -----------------------: |
| Rampa                 |                  8 |         8 |                    0 |                   0 |                 1.365 ms |
| Sustentação com queda |                 48 |        25 |                    0 |                  23 |                 4.113 ms |
| Rajada                |                 96 |        23 |                   27 |                  46 |                 5.820 ms |
| Recuperação           |                 12 |         9 |                    0 |                   3 |                 3.692 ms |

Todos os status HTTP recebidos foram os esperados. Foram submetidos 239 comandos e persistidos 167; 72 ficaram ausentes após falha de transporte. Nenhum comando confirmado ao cliente ficou ausente no SQL. Restaram 37 BETs sem desfecho, registradas como sessões incompletas, sem retry/refund para maquiar o resultado. As 96 carteiras coincidiram com o plano de efeitos duráveis, o ledger e as versões; partidas dobradas fecharam e a outbox drenou em 11,07 s. `passed: true` confirma o experimento e sua auditoria; somente a rampa atendeu à capacidade/SLO definido. **Esse preflight não demonstra capacidade para 38 mil jogadores no Subiu.**

Os preflights anteriores foram preservados. A primeira versão enviava referência em LOSS e recebeu HTTP 400, além de falhar na exportação enquanto o Grafana iniciava; essa execução não vale como prova de capacidade. O gerador foi corrigido e as consultas de telemetria agora aguardam a disponibilidade, registrando tentativas de coleta.

A transferência inicialmente recusada pela revisão automática foi autorizada explicitamente pelo usuário e concluída. O SHA-256 do pacote conferiu nos dois hosts: `380e215f21bb483e9158eec4864bd08276b9eb62f411ca6b520ce9deffca8851`. A imagem remota `jungle-challenge:distributed-game-20261003-subiu-v4` teve manifest `sha256:2d5a4039791cb45d4d3489e6e718d54f82d328afc22ff4106fe58169e82abc05`.

O baseline no Subiu passou como experimento/auditoria de **20:02:19 a 20:20:05 UTC**, no projeto exclusivo `jungle-distributed-game-subiu-20261003-v4`, com 38.000 jogadores, 512 sessões em voo, sustentação de 180 s, espera máxima de 20 s e conexões reutilizadas. Comando: `python3 scripts/distributed-load-stack.py --project jungle-distributed-game-subiu-20261003-v4 --image jungle-challenge:distributed-game-20261003-subiu-v4 --output test-results/game-load-20261003/subiu-v4 --profile game-scale --peers 38000 --concurrency 512 --stage-seconds 180 --max-wait-ms 20000 --guard-subiu`.

| Fase                                 | Oferecidas | Completas | Expiradas no gerador | Erros de transporte | p95 de sessões completas |
| ------------------------------------ | ---------: | --------: | -------------------: | ------------------: | -----------------------: |
| Rampa, 30 sessões/s                  |      1.800 |     1.799 |                    0 |                   1 |                 1.275 ms |
| Sustentação, 60 sessões/s, com queda |     10.800 |     6.249 |                    0 |               4.551 |                18.684 ms |
| Rajada da população inteira          |     38.000 |       459 |               36.622 |                 919 |                24.426 ms |
| Recuperação, 30 sessões/s            |      2.700 |     2.539 |                    0 |                 161 |                 5.650 ms |

Foram submetidos 30.565 comandos; 30.041 ficaram persistidos/processados, 524 ausentes após falha de transporte e 5.108 persistidos sem confirmação ao cliente. Nenhum comando confirmado ficou ausente. Restaram 2.725 BETs sem desfecho de jogo, sem reenvio/refund. As **38.000 carteiras** coincidiram com o plano dos efeitos duráveis, saldo, versão e ledger; auditoria final encontrou zero divergências, diários desbalanceados, operações não terminais, entregas falhas e eventos pendentes. A outbox atingiu 20.645 eventos e 152,58 s de lag, drenando em 41,30 s ao fim. Nenhuma fase satisfez integralmente o critério de capacidade; `passed` não significa que o servidor suportou a carga oferecida.

O SIGKILL ocorreu às 20:15:02,689 UTC; o comando de start, às 20:15:08,711 UTC. A primeira resposta 200 da réplica após start veio em 7,07 s. Antes da queda planejada já havia 555 erros de transporte na sustentação, evidenciando saturação além da indisponibilidade injetada. RAM disponível mínima do host: 2.854,85 MiB; guard não disparou e as sondas não registraram ocorrências. Banco, filas, containers e volumes exclusivos foram removidos. A sessão pública não foi reiniciada nem recebeu comandos financeiros desse experimento. Artefatos completos: `test-results/game-load-20261003/subiu-v4/`; análise: `analysis-subiu.json` no diretório pai.

### Otimização da confirmação de outbox

A publicação passou a confirmar os eventos aceitos em uma instrução SQL por lote, além de agrupar os reagendamentos, preservando lease token, backoff individual e entrega pelo menos uma vez. Em Docker/Linux, `bun run verify:full` da imagem `jungle-challenge:distributed-game-batch-20261003-v3` passou de **20:34:07 a 20:36:58 UTC**, com **141 testes, 1.506 assertions, zero falhas/skips**, migrations reversíveis e limpeza completa. Relatórios: `test-results/game-batch-full-20261003-v3/`; o projeto de apoio `jungle-game-batch-verify-20261003` também foi removido.

As execuções anteriores `v1` e `v2` ficaram preservadas: a primeira detectou contagem incorreta de eventos da nova fixture, e a segunda recusou DDL pela role restrita. A fixture final usa seu dono isolado para criar/remover os probes SQL; o publisher continua com a role restrita. Nenhum check foi desabilitado.

O pacote otimizado conferiu com SHA-256 `18a2581febf7ecf1cd1d77a52eea01a25989c5d9a6892b6727d3bef5fd0a5d96`. A imagem remota `jungle-challenge:distributed-game-batch-20261003-subiu-v3` tem manifest `sha256:ea206bf97d564edf0a054e2838add47e8e610ea381ea3414162856a586cceb01`. A bateria com os mesmos parâmetros e quotas passou de **20:37:19 a 20:54:27 UTC**, no projeto `jungle-distributed-game-batch-subiu-20261003-v3`, com auditoria/limpeza completas e guard sem ocorrências.

| Fase                  | Oferecidas | Completas | Expiradas no gerador | Erros de transporte | p95 de sessões completas |
| --------------------- | ---------: | --------: | -------------------: | ------------------: | -----------------------: |
| Rampa                 |      1.800 |     1.799 |                    0 |                   1 |                 1.335 ms |
| Sustentação com queda |     10.800 |     7.070 |                   88 |               3.642 |                26.992 ms |
| Rajada                |     38.000 |       553 |               36.664 |                 783 |                30.515 ms |
| Recuperação           |      2.700 |     2.700 |                    0 |                   0 |                 1.245 ms |

A sustentação completou 13,14% mais sessões, com vazão observada de 33,21 sessões/s contra 30,48 do baseline; entretanto o p95 das sessões completas piorou, e 88 intenções expiraram antes de começar. Somente a recuperação atendeu ao critério de capacidade. A outbox ainda atingiu 21.505 eventos/153,94 s de lag; a drenagem final caiu para 23,31 s. As 38.000 carteiras foram reconciliadas, com zero divergência ou diário desbalanceado. Foram submetidos 30.807 comandos, persistidos/processados 30.288, ausentes 519 e persistidos sem resposta 3.907; 2.240 BETs ficaram sem desfecho. RAM mínima disponível: 3.200,55 MiB. Artefatos: `test-results/game-load-20261003/subiu-batch-v3/`; análise `analysis-subiu-batch-v3.json`.

### Busca indexada do próximo lote

Durante a segunda bateria, com 11.838 eventos pendentes, duas consultas SELECT sem locks compararam a seleção por ocorrência e por agenda. A primeira ordenou os candidatos e visitou **10.998 blocos compartilhados**, com startup de **62,212 ms**. A ordem `next_attempt_at,id` usou `outbox_due`, sem Sort, visitando **25 blocos**, com execution total de **0,065 ms**. São planos pontuais sob carga, não o tempo total do claim/transação nem uma previsão de ganho da engine. Os planos estão em `subiu-batch-v3/profile-claim-order.txt`.

O código passou a adquirir pela agenda usando o índice existente. A prova real de seleção prioriza dez eventos elegíveis antes de dois eventos que ocorreram antes, mas ficaram elegíveis depois. `bun run verify:full` em Docker/Linux passou de **20:52:24 a 20:54:49 UTC**, com **142 testes, 1.524 assertions, zero falhas/skips** e limpeza completa. A imagem local `jungle-challenge:distributed-game-indexed-20261003-v1` (manifest `sha256:33401ac5daafa5e77d7c8b1549560606c077a1c823f0c07070c7c2de93339872`) foi executada com `tests/` e `docs/` atuais montados somente para leitura, incluindo o nome final do novo teste. Relatórios: `test-results/game-indexed-full-20261003-v1/`; infraestrutura de apoio exclusiva removida.

O pacote final conferiu com SHA-256 `6e0a51e6f62edb7ba8b53c7aee21fe9a4bb92c01dd07c4487cb474dcbc8256c2`. A imagem remota `jungle-challenge:distributed-game-indexed-20261003-subiu-v1` tem manifest `sha256:da8ebd625d31396bea11ac23b28888f032233dddd1944ba52b15f8b0c559e6c1`. A terceira bateria passou de **20:56:18 a 21:13:22 UTC**, no projeto `jungle-distributed-game-indexed-subiu-20261003-v1`, com parâmetros, população e quotas iguais aos anteriores. Os scripts da harness são idênticos nos três pacotes. Não houve alteração de migration ou garantia financeira.

| Fase                  | Oferecidas | Completas | Expiradas no gerador | Erros de transporte | p95 de sessões completas |
| --------------------- | ---------: | --------: | -------------------: | ------------------: | -----------------------: |
| Rampa                 |      1.800 |     1.800 |                    0 |                   0 |                 2.397 ms |
| Sustentação com queda |     10.800 |     6.380 |                  443 |               3.977 |                28.685 ms |
| Rajada                |     38.000 |       561 |               36.641 |                 798 |                30.173 ms |
| Recuperação           |      2.700 |     2.698 |                    0 |                   2 |                   906 ms |

As 38.000 carteiras coincidiram com o plano de efeitos duráveis, saldo, versão e ledger. Foram submetidos 29.984 comandos, persistidos/processados 29.500, ausentes 484 e persistidos sem resposta 4.293. Nenhum comando confirmado ficou ausente no SQL; 2.384 BETs ficaram sem desfecho. A auditoria final encontrou zero divergências, diários desbalanceados, operações não terminais, entregas falhas e eventos pendentes. Nenhuma fase satisfez todos os critérios de capacidade. O retorno 200 da réplica após o comando de start demorou 6,77 s.

O pico da outbox caiu para **13.899 eventos / 86,97 s de lag**, e a drenagem final para **2,30 s**. A CPU média amostrada do PostgreSQL na recuperação caiu de 75,58% de uma CPU para 51,48%, com a mesma taxa oferecida de 30 sessões/s e quase todas as sessões completas. Entretanto a sustentação concluiu **30,02 sessões/s**, contra **30,48** no baseline, com p95 pior e mais expirações no gerador. Não foi demonstrado aumento relevante da capacidade geral nem atendimento do pico de 38 mil intenções; o ganho claro está na publicação/drenagem. São execuções sequenciais únicas em host compartilhado, com CPU/RSS amostrados, sem isolamento de interferência ou prova de significância estatística.

O plano completo do claim, coletado com EXPLAIN sem executar o UPDATE, confirmou `Limit → LockRows → Index Scan(outbox_due)`, seguido da atualização pelo índice primário, sem Sort. Os contadores SQL mostraram índice ativo nas carteiras e transações, e doze conexões sem wait event naquela amostra de sustentação; o custo restante inclui processamento financeiro sob quotas e trabalho de publicação compartilhando CPU com HTTP. Esse diagnóstico não autoriza retirar constraints ou reduzir provas financeiras.

RAM disponível mínima do host: **3.247,53 MiB**; nenhuma ocorrência ou OOM observados. A comparação entre baselines e após a última limpeza confirmou os **41 containers preexistentes** com mesmas identidades, saúde e reinícios. Nenhum container, volume ou rede exclusivo da terceira bateria permaneceu; banco e filas também foram removidos. A sessão pública conserva sua imagem anterior e não recebeu restart ou operações financeiras.

Artefatos finais: `test-results/game-load-20261003/subiu-indexed-v1/`, `analysis-subiu-indexed-v1.json`, `comparison-summary.json`, `comparison-method.json` e `comparison-manifest.json`. A soma de sessões completas passou de 11.046 para 11.439, com as mesmas 53.300 intenções oferecidas, mas a vazão sustentada não melhorou. O checkpoint de conhecimento compartilhado permanece pendente: MCP `knowledge`, entrada CLI documentada e identidade de turno vinculada ao hook indisponíveis; nenhum recibo foi fabricado. Evidência operacional mínima em `knowledge-checkpoint-pending.json`.

### População ampliada para 60 mil peers — 03/10/2026

No Subiu, a rodada com imagem `jungle-challenge:distributed-game-indexed-20261003-subiu-v1` (manifest `sha256:da8ebd625d31396bea11ac23b28888f032233dddd1944ba52b15f8b0c559e6c1`) começou às 22:47:11 e terminou às 23:07:49, horário de São Paulo. O projeto isolado foi `jungle-distributed-game-subiu-20261003-60k`; não reiniciou a sessão pública nem usou seu banco ou filas. Comando executado no host:

```sh
python3 scripts/distributed-load-stack.py --project jungle-distributed-game-subiu-20261003-60k --image jungle-challenge:distributed-game-indexed-20261003-subiu-v1 --output test-results/game-load-20261003/subiu-60k-v1 --profile game-scale --peers 60000 --concurrency 512 --stage-seconds 180 --max-wait-ms 20000 --connection-reuse true --guard-subiu
```

| Fase                                             | Oferecidas | Completas | Expiradas | Erros de transporte | p95 de sessões completas | `capacityMet` |
| ------------------------------------------------ | ---------: | --------: | --------: | ------------------: | -----------------------: | :-----------: |
| Rampa, 30 sessões/s                              |      1.800 |     1.800 |         0 |                   0 |                 1.403 ms |      Sim      |
| Sustentação, 60 sessões/s, com SIGKILL planejado |     10.800 |     6.286 |         0 |               4.514 |                19.501 ms |      Não      |
| Rajada, população inteira                        |     60.000 |       464 |    58.608 |                 928 |                24.721 ms |      Não      |
| Recuperação, 30 sessões/s                        |      2.700 |     2.700 |         0 |                   0 |                   886 ms |      Sim      |

Na sustentação, 4.068 erros foram timeout, 37 fechamento de socket e 409 falhas de conexão; não houve status HTTP inesperado. Na rajada, somente 1.392 intenções iniciaram dentro da janela de espera de 20 s; não equivale a 60.000 sockets simultâneos. A vazão sustentada foi 30,58 sessões/s, semelhante ao baseline de 38.000 peers (30,48), com p95 um pouco maior (19,50 s contra 18,68 s). A recuperação concluiu as 2.700 sessões; a réplica reiniciada voltou a responder em 6,87 s.

A auditoria encontrou 60.000 carteiras íntegras; entre os comandos, 30.650 foram submetidos, 30.112 persistidos/processados e 538 ausentes após falha de transporte. Houve 4.904 operações persistidas sem resposta HTTP e 2.636 BETs sem desfecho. Nenhum comando confirmado ao cliente faltou no banco; o fechamento registrou zero falhas financeiras, pendências, registros não terminais, divergências, diários desbalanceados ou inbox restante. A outbox chegou a 11.861 eventos e 75,38 s de lag; drenou em 1,23 s.

O host manteve no mínimo 3.278 MiB disponíveis e zero ocorrências nas sondas; a guarda não foi acionada. `passed: true` significa runner, auditoria e limpeza concluídos: a capacidade-alvo não foi atingida na sustentação nem na rajada. A limpeza confirmou o banco/filas exclusivos removidos e nenhum container remanescente. Durante a execução, o Grafana ficou disponível pelo túnel SSH em `http://localhost:39473/d/distributed-load`; a stack temporária foi removida ao final. Artefatos e análise: `test-results/game-load-20261003/subiu-60k-v1/` e `test-results/game-load-20261003/analysis-subiu-60k-v1.json`.

## Capacidade online da demo — 03/10/2026

No host `subiu-sm`, aumentei sem reinício a cota de CPU de `jungle-server-demo-1` para 1 CPU (antes 0,5) e de `jungle-server-localstack-1` para 1 CPU (antes 0,75), usando `docker update --cpus 1.0`. Os limites persistentes foram atualizados nos Compose de release ativos; cópias anteriores estão ao lado com o sufixo `.pre-cpu-increase-20261003`. Os limites de memória permaneceram em 512 MiB para a demo e 768 MiB para LocalStack.

Antes do ajuste, em uma janela de aproximadamente 18 segundos, `cpu.stat` registrou na demo mais 61 throttles em 259 períodos (+3,30 s throttled) e no LocalStack mais 15 em 110 (+0,36 s). Depois do ajuste, em outra janela semelhante, a demo registrou mais 16 em 252 (+0,08 s) e o LocalStack mais 5 em 132 (+0,004 s). `app-observed` e Postgres não tiveram aumento nos contadores de throttling nesse intervalo. Após a mudança, ambos os contêineres continuaram `healthy`, com os mesmos IDs e zero reinícios; `docker compose config --quiet` passou para os dois arquivos de release. Uso observado: demo 98,6 MiB/512 MiB e LocalStack 485,3 MiB/768 MiB.

Esta alteração amplia a folga de CPU para picos; não foi executado um novo teste de carga de 20 mil peers. A imagem local `jungle-challenge:demo-stability-20261003`, que altera a leitura da dashboard e o enfileiramento em lote, não foi aplicada em produção: a última leitura da sessão mostrou operações financeiras incompletas, e reiniciar o processo chamaria a recuperação do journal. Nenhum retry, replay, settlement ou refund foi executado. A instabilidade durante uma nova rodada ainda precisa ser reavaliada depois de resolver esse estado financeiro sem reprocessamento automático.

## Paginação da lista da demo — 03/10/2026

Interpretação: o pedido para reduzir o peso da lista trata da interface; a quantidade cadastrada e a sessão persistente permanecem intactas. A tabela mostra 100 peers por página. O seletor de jogador busca por nome ou ID e mantém no máximo 100 opções no DOM, inclusive quando preserva a seleção atual. O render não cria a lista inteira nem serializa o roster completo a cada polling. `CHALLENGE.md` e o código da API financeira não mudaram; banco e fila não foram recriados, e o volume persistente do journal foi preservado.

No Windows com Bun 1.4.2 passaram `bun run typecheck`, `bun run lint`, `bun run --bun prettier --check demo/public/client.ts demo/public/index.html demo/public/style.css docs/DEMO.md` e `git diff --check`. A suíte de testes não foi executada.

`docker.exe build --platform linux/amd64 -t jungle-challenge:demo-peer-pagination-20261003 .` passou. A imagem tem digest `sha256:502049e873117a81b7d2dd9e146dd19c99214db3f1c6782b7bdebda712d77537`. O arquivo transferido (`114.967.040` bytes) conferiu com SHA-256 `dc376b8281817882addb56599271d43581fd4faf0d18c6308c0ddb6b80af3c9a` no host `subiu-sm`. Compose 5.3.0 passou `config --quiet`; no projeto `jungle-server`, `up -d --no-deps --wait demo` recriou somente `jungle-server-demo-1`, healthy, sem restart. O volume `jungle-server_server-demo` continua montado em `/app/.tmp`. A API financeira permaneceu com o mesmo ID (`b1824ef600bf914a746176f4314c4bef86117ac00c7c5ced17ccc28c571ff9f0`), healthy e com zero restarts.

Após o deploy, `/`, `/client.js`, `/style.css` e `/demo/state` retornaram HTTP 200 sem credenciais. A resposta pública confirmou os seletores da busca e paginação nos assets publicados. A sessão conservou 10.106 peers, zero pendentes, zero apostas ativas/em envio e zero erros não resolvidos; nenhuma operação financeira foi submetida.

## Demo pública sem autenticação — 02/10/2026

No rollout inicial do router, antes da atualização do frontend, a release `20261001-demo-52e850a` recebeu somente a alteração em `compose.demo.yaml`: removido `jungle-access` de página, assets e `/demo/*`. A API financeira segue com BasicAuth no router de `compose.subiu.yaml`; naquele ponto, o container da demo usava `jungle-challenge:demo-20261001-ui` (`sha256:da6e960ec23730fe2fca1a0f7e2d83934e943c716cb65d79a299ca2133bc547c`).

No host `subiu-sm`, Bun não foi reconstruído porque o ajuste é de configuração Traefik. `docker compose --env-file /home/subiu-sm/apps/jungle-challenge/.env -f /home/subiu-sm/apps/jungle-challenge/releases/20261001-demo-52e850a/compose.subiu.yaml -f /home/subiu-sm/apps/jungle-challenge/releases/20261001-demo-52e850a/compose.demo.yaml -p jungle-server config --quiet` passou. O mesmo projeto executou `up -d --no-deps --wait demo`; somente `jungle-server-demo-1` foi recriado e ficou healthy.

Smoke HTTP sem Authorization depois do deploy: `/` 200, `/demo/state` 200 e `/wallets/sentinel` 401. `docker inspect` confirmou a ausência do label de middleware no router `jungle-demo` e a permanência do volume `jungle-server_server-demo` montado em `/app/.tmp`. Antes da mudança, `/` retornava 401 sem credenciais. Não foram submetidas operações financeiras nem alteradas a API, o banco ou a fila.

## Início automático — deploy — 02/10/2026

`DemoTable.recover()` agora cria seis peers com carteiras independentes quando não existe journal salvo; journals existentes continuam sendo recuperados. A tela informa que a mesa inicia sozinha e reserva “Nova sessão” para reconfiguração. Windows local, Bun 1.4.2: `bun run typecheck`, `bun run lint`, `bun run --bun prettier --check demo/table.ts demo/public/index.html docs/DEMO.md docs/VALIDATION.md` e `git diff --check` passaram. Os testes automatizados não foram executados.

`docker.exe build --platform linux/amd64 -t jungle-challenge:demo-autostart-20261002 .` passou e produziu a imagem `sha256:e5d5b5e0fd122330c5dc6ea88357a8a1a77b35f324da349ee20e2bd17f6319e1`. O tar local tinha 114.963.456 bytes e SHA-256 `715c1c23aee5423021ddd42f6c9e7f452604b21dc664a36c628116f762d41584`; o checksum conferiu no host após a transferência aprovada. A imagem foi carregada e `JUNGLE_DEMO_IMAGE` atualizado para `jungle-challenge:demo-autostart-20261002`. No host `subiu-sm`, Bun 1.4.2 e Compose 5.3.0, passaram estes comandos:

```sh
docker compose --env-file /home/subiu-sm/apps/jungle-challenge/.env -f /home/subiu-sm/apps/jungle-challenge/releases/20261001-demo-52e850a/compose.subiu.yaml -f /home/subiu-sm/apps/jungle-challenge/releases/20261001-demo-52e850a/compose.demo.yaml -p jungle-server config --quiet
docker compose --env-file /home/subiu-sm/apps/jungle-challenge/.env -f /home/subiu-sm/apps/jungle-challenge/releases/20261001-demo-52e850a/compose.subiu.yaml -f /home/subiu-sm/apps/jungle-challenge/releases/20261001-demo-52e850a/compose.demo.yaml -p jungle-server up -d --no-deps --wait demo
```

Apenas `jungle-server-demo-1` foi recriado e ficou healthy.

Smoke público sem Authorization: `/` e `/demo/state` retornaram 200; `/wallets/sentinel` retornou 401. O HTML publicado agora contém “A mesa inicia automaticamente” e “Nova sessão”; o texto anterior “Criar nova sessão” não aparece mais. A consulta da mesa confirmou sessão ativa com seis peers na rodada 3, e `docker inspect` confirmou a imagem nova, a ausência do middleware no router `jungle-demo` e o volume persistente `jungle-server_server-demo`. O journal já tinha uma sessão antes da troca e foi preservado; o bootstrap de seis peers se aplica quando o journal está vazio. Nenhuma operação financeira foi submetida e a API, o banco e a fila não foram recriados. A suíte automatizada não foi executada.

## Carga pesada em três réplicas — 01/10/2026

A [bateria distribuída](DISTRIBUTED-LOAD.md) passou no local e no subiu com a mesma imagem Bun 1.4.2, PostgreSQL 17.6 e LocalStack 4.9.2. Cada host executou 19.000 comandos únicos pesados, além de 24 de aquecimento: 10.000 BETs/256 clientes/128 carteiras, 3.000 BETs em uma carteira, 1.000 comandos com duas chamadas HTTP e duas entregas SQS e 5.000 BETs durante SIGKILL/restart de uma API. Três processos, endereços SQL e pools independentes foram registrados; todas as réplicas consumiram SQS e publicaram outbox.

Zero falhas finais, status inesperados, divergências financeiras, diários desbalanceados, transações não terminais, entregas falhas ou eventos pendentes. Foram reconciliadas 260 carteiras por host, com saldo e versão esperados; os 408 replays adicionais conservaram resultados históricos. A disputa de saldo terminou com 100 aceites, 2.900 rejeições esperadas e saldo zero. A fase cruzada terminou com 1.000 inboxes e um efeito por comando. As 177 chaves locais e 227 do subiu com tentativas interrompidas pelo SIGKILL tiveram resposta 200 posterior pela mesma identidade.

O monitor registrou 196 amostras locais e 87 no subiu, sem ocorrências. As quatro aplicações sondadas no subiu responderam 200; RAM disponível mínima de 3.969,54 MiB. A comparação após a limpeza confirmou os 27 containers locais e 38 do servidor preservados. Os dois relatórios de recursos confirmaram remoção do banco/filas gerados; os dois projetos Compose foram removidos com seus volumes e nenhum container remanescente.

Comandos executados, quotas, vazão, percentis, lag/drenagem e limites estão em [DISTRIBUTED-LOAD](DISTRIBUTED-LOAD.md). Janela UTC em 02/10: local 00:00:00–00:18:09; subiu 00:00:05–00:08:15. Artefatos ignorados pelo Git em `test-results/distributed-load-20261001/{local,server}/`, com galeria `index.html`, gráficos derivados, séries Prometheus, traces Tempo, logs e manifests SHA-256. A implementação financeira, as migrations, `CHALLENGE.md` e `bun.lock` conservaram os arquivos do commit-base `959ef08`.

O gate completo da imagem passou em Docker/Linux de **23:56:53.210 a 23:59:02.341 UTC de 01/10**: typecheck, lint, formatação e **137 testes/1.425 assertions** (75 unidade/349, 51 integração/590, 11 concorrência/486), zero falhas/skips, migrations `up → down → up` e limpeza completa. Relatórios em `test-results/distributed-load-20261001/gate-2/`. O gate estático também passou no Windows com Bun 1.4.2.

O primeiro preflight falhou com duas conexões HTTP encerradas sem registro das chaves nas APIs e HTTP 400 na exportação Tempo por tags fora do formato logfmt. A harness passou a usar conexão HTTP nova por chamada e exportação logfmt, mantendo zero retries nas fases sem queda. O segundo preflight passou com 2.024 comandos, queda real, auditoria e limpeza completas. Ambas as execuções ficaram preservadas; não houve alteração financeira para obter o resultado.

A revisão posterior da guarda de isolamento acrescentou recusa de containers parados, volumes e redes preexistentes do projeto. Os três casos passaram com recursos vazios exclusivos, preservados até a limpeza deliberada; prova em `isolation-guard.json`. O gate completo foi repetido com os scripts/documentos atuais montados somente para leitura: **137 testes/1.425 assertions**, zero falhas/skips e limpeza completa, em `test-results/distributed-load-20261001/gate-3/`.

## Demo com rodadas automáticas — 01/10/2026

A demo agenda peers e apostas para a rodada seguinte, inicia cada voo pelo relógio do servidor e avança após exibir o resultado. O limite fixo de 24 peers foi removido. A identidade de cada BET é gravada no journal antes do envio financeiro; operações sem resposta confirmada pausam o avanço e são retomadas pela mesma identidade. A API financeira, as migrations e `bun.lock` não foram alterados.

No Windows local com Bun 1.4.2, `bun run typecheck`, `bun run lint`, `bun run --bun prettier --check` nos arquivos alterados e `git diff --check` passaram. `docker build -t jungle-challenge:demo-auto-20261001 .` produziu a imagem `sha256:4d27849af105637e3fcbb560c3919c44c3f253637630614873e9dbb7d86fb27e`. O tar transferido pela tailnet teve SHA-256 igual nos dois hosts (`690425b67d538012d89d6ff0986c4822987745ca4d01e8ffa5e8e303b59052c2`). O Compose foi validado com `config --quiet`; `up -d --no-deps --wait demo` recriou somente `jungle-server-demo-1`, que ficou healthy, preservando o volume `jungle-server_server-demo`.

Em leitura da mesa no subiu, a rodada passou de 4 (21:49:45 UTC) para 7 (21:50:29 UTC), sem bloqueio; a rota pública autenticada `/demo/state` respondeu HTTP 200 na rodada 10. O gate completo posterior passou conforme a seção de carga distribuída acima. As cargas diretas da API e os screenshots/reconciliações anteriores não medem a nova cadência nem 1.000 peers pela demo.

## Revisão final do enunciado — 01/10/2026

Revisão do commit-base `12adc9f`, com Docker/Linux local, Bun 1.4.2, PostgreSQL 17.6, LocalStack 4.9.2 e Keycloak 26.6.4 em stack descartável sem portas publicadas. `verify:full` passou de **20:30:46.654 a 20:35:29.483 UTC**: typecheck, lint, formatação e **137 testes/1.418 assertions** (75 unidade/344, 51 integração/588, 11 concorrência/486). O E2E Keycloak real passou em seguida com **15 testes/71 assertions**. Total: **152 testes, 1.489 assertions, zero falhas e zero skips**.

As oito migrations completaram `up → down → up` nos bancos exclusivos. Os relatórios das três suítes de infraestrutura confirmaram limpeza completa; a stack `jungle-final-audit-20261001` foi removida depois. O health público do subiu retornou `status: ok`, PostgreSQL e SQS disponíveis às 20:34:20.962 UTC. Relatórios em `test-results/final-audit-20261001/`; conferência por seção, comandos, identidade da imagem e limites em [FINAL-REVIEW](FINAL-REVIEW.md).

Não foi identificada lacuna obrigatória ou falha eliminatória nos cenários revisados. Foram corrigidos textos desatualizados sobre quantidade de testes, migrations e situação da demo, sem alteração de código financeiro. `CHALLENGE.md` conservou o SHA-256 original. Os experimentos de carga e telemetria anteriores foram revisados, sem repetir a carga nesta execução.

## Galeria das cargas maiores — 01/10/2026

A galeria visual foi ampliada com as cargas anteriores: **98.600 operações HTTP medidas entre os dois hosts**, até **256 clientes simultâneos**, cenários de carteira única e a rodada anterior de **1.000 comandos SQS únicos com 100 duplicados**. Inclui séries de CPU/RSS/event loop/outbox durante carga e recuperação, latência do cliente, auditorias SQL e acesso aos vinte relatórios finais. Consulte [LOAD-EVIDENCE.md](LOAD-EVIDENCE.md) para números, fontes e limites de interpretação. Clientes, carteiras e comandos têm legendas distintas; esses artefatos não certificam exatamente 100 ou 1.000 jogadores simultâneos.

A página é `test-results/demo-subiu-20261001/prints/carga/index.html`, ligada à galeria da demo. A ampliação reutilizou medições existentes, conferiu resultados e hashes e preservou os diagnósticos anteriores; não iniciou outra carga nem alterou código financeiro.

## Demo pública e provas visuais — 01/10/2026

Demo restaurada do stash no commit `a8f3603`, mantendo o stash como backup. O commit `52e850a` corrige feedback visual entre sessões; `9e1fea3` ajusta os limites do Grafana após OOM observado. O código financeiro em `src/`, as migrations e o lockfile permanecem iguais ao release anterior. A API do servidor conserva a imagem `jungle-challenge:delivery-20261001-6456f6e`, ID `sha256:a9887841fe25ae34b11f07558dfbfcc088879064650db4c5fed0ea4fe97f20cc`. A demo usa `jungle-challenge:demo-20261001-ui`, ID `sha256:da6e960ec23730fe2fca1a0f7e2d83934e943c716cb65d79a299ca2133bc547c`, e journal em volume próprio. O domínio `jungle.subiu.dev` mantém BasicAuth; somente página, assets e `/demo/*` ganham o router da demo.

### Gates e cenários

Imagem Docker/Linux da demo: `verify:full` passou com **137 testes e 1.418 assertions**, zero falhas e zero skips: 75 unidade/344 assertions, 51 integração/588 e 11 concorrência/486. PostgreSQL 17.6, LocalStack 4.9.2 e Bun 1.4.2; projeto Docker exclusivo `jungle-demo-validation-20261001`, portas 39432/39466. O runner confirmou limpeza completa dos bancos e filas próprios; depois o Compose exclusivo foi removido com seus volumes. O ajuste posterior da interface passou em `verify`: 75 testes/344 assertions. Os limites do Grafana foram validados por config Compose e execução no servidor.

As quatro integrações novas usam três apps NestJS reais e verificam disputa de saldo, REFUND/WIN/LOSS/ROLLBACK, replay histórico, conflito, perda de resposta depois do commit com recuperação e Origin HTTPS. As 12 unidades novas cobrem prêmio exato, estado, journal, locks e retry. A demo pública chama uma API financeira; N peers são jogadores simulados. Os testes de processos isolados continuam sendo a prova de concorrência distribuída.

### Bateria pelo domínio público

`bun run test:demo` com `DEMO_BASE_URL=https://jungle.subiu.dev`, 24 peers e seis rodadas mistas, mais smoke de três peers e três disputas compartilhadas. Cada execução cria 153 carteiras próprias e termina com três peers prontos para apresentação. Todas as carteiras são reconciliadas com saldo esperado calculado em BigInt, materializado e reconstruído iguais, diferença zero. Foram verificadas 150 BETs aceitas, 69 recusadas, 52 REFUNDs, 49 WINs, 49 LOSS e 49 ROLLBACKs por bateria; replays e conflitos usam as identidades originais.

| Execução                    | Janela UTC                | Chamadas às rotas da demo | Resultado                                         |
| --------------------------- | ------------------------- | ------------------------: | ------------------------------------------------- |
| Inicial, gerador local      | 19:01:12.576–19:04:16.041 |                       651 | Cenários financeiros passaram; Grafana sofreu OOM |
| Repetição, gerador no subiu | 19:15:13.854–19:18:12.628 |                       652 | Todos os cenários e monitor passaram              |

Na repetição, 645 respostas foram HTTP 200 e sete HTTP 409 esperados por saque tardio. Conflitos de payload são verificados no corpo da rota de demonstração, que confirma o HTTP 409 da API financeira. Não houve erro inesperado. O gerador próprio `jungle-demo-load-20261001`, com 0.25 CPU/256 MiB, lê BasicAuth de arquivo privado e observa o mesmo `GUARD_STOP` produzido pelo monitor; `--rm` removeu apenas esse container. A execução inicial tinha o monitor separado do gerador local; essa limitação também foi corrigida na repetição.

### Consumo, diagnóstico e preservação

O kernel confirmou OOM de cgroup do Grafana às 19:03:43 UTC com limite 384 MiB. O monitor inicial detectou o reinício; a primeira prova não foi descartada. Grafana recebeu 512 MiB, `memswap_limit=512m` e `GOMEMLIMIT=320MiB`. Somente demo e Grafana foram adicionados/recriados; os outros 36 containers, incluindo API, PostgreSQL, proxy e aplicações existentes, conservaram identidades, estado e reinícios.

Na repetição, 25 amostras entre 19:15:13.679 e 19:18:09.519 UTC tiveram zero ocorrências e mínimo de RAM disponível **4.612,94 MiB**. A comparação final também confirmou os 38 containers da baseline inalterados, sem OOM/reinícios. Probes de subway, betaki, superbet e aurabet retornaram HTTP 200 em todas as amostras. O monitor inclui o novo coordenador e os recursos consumidos pelo gerador no host.

Séries Prometheus em passos de cinco segundos: RSS da API até **191.717.376 bytes**, heap até **44.698.221 bytes**, event loop p99 até **4,375 ms**, outbox até dois eventos e lag amostrado até **35,702 ms**; todas as amostras de `up` foram 1. Docker stats observou pico de CPU da API de **20,4% de um núcleo**. Picos dependem da amostragem; a bateria da demo comprova cenários e comportamento e não mede capacidade máxima.

Auditoria SQL às 19:18:32.539 UTC: 1.320 carteiras, 74.190 transações, 73.929 lançamentos/diários e 147.858 linhas contábeis. Zero carteiras inconsistentes, diferenças de versão, diários desbalanceados, referências pendentes, entregas falhas ou eventos não publicados. A telemetria final foi coletada depois do encerramento da bateria. Grafana retornou 100 logs atribuídos a `decolagem-demo` e 20 traces na janela da repetição; cinco traces completos foram exportados.

### Prints agrupados

`test-results/demo-subiu-20261001/prints/index.html` reúne **13 prints originais**: abertura, BET, REFUND, replay histórico, conflito, WIN, ROLLBACK, LOSS, disputa de saldo, recursos, operações, logs/traces e sessão pronta. `manifest.json` registra SHA-256, escopo e commits; `ui-disputa.json` registra as 24 linhas visíveis da tabela (uma aposta aceita e 23 recusadas). As imagens complementam JUnit, reconciliações, SQL e telemetria preservados em `relatorios/`. A galeria foi aberta e conferida no navegador; as capturas da demo são de desktop.

O pacote `test-results/demo-subiu-20261001/provas-demo-subiu-20261001.zip` contém galeria, prints e relatórios selecionados, sem credenciais. A entrega anterior `backend-challenge-subiu-submission-20261001.zip` permanece preservada e antecede este incremento. Nenhum resultado prevê a nota do avaliador.

## Testes ampliados, índice financeiro e deploy subiu — 01/10/2026

O commit `1e564e9` acrescentou históricos mistos em seis processos, disputa de saldo até esgotamento em quatro processos, roteiro progressivo de stress e uma stack isolada para o home server. O commit `bfe8a8b` isolou integração e concorrência em bancos/filas distintos, acrescentou a validação da agregação JUnit e a migration 008 com índice não único em `wager_transactions(wallet_id)`. As invariantes financeiras e a autoridade PostgreSQL de idempotência continuam as mesmas.

### Gates da imagem entregue

A imagem da bateria inicial `jungle-challenge:validated-20261001-bfe8a8b`, ID `sha256:a728a650ee37c624c9a3dba956446616c2f86fcb4f4910f4f317dfbca6c7685e`, passou em `verify:full` nos dois hosts: **121 testes, 1.313 assertions, zero falhas e zero skips**, em 16 arquivos — 63 unitários, 47 de integração e 11 distribuídos. Bun 1.4.2, PostgreSQL 17.6 e LocalStack 4.9.2. Typecheck, lint e formatação passaram; oito migrations exercitadas em `up → down → up`. Cada gate confirmou limpeza completa dos recursos próprios de integração e concorrência.

| Host                           | Início UTC   | Fim UTC      | Relatórios                         |
| ------------------------------ | ------------ | ------------ | ---------------------------------- |
| Local, Docker/Linux com quotas | 16:26:09.987 | 16:29:41.060 | `verification-image-local/`        |
| subiu, Linux com quotas        | 16:26:52.886 | 16:29:54.990 | `server-verification-image-final/` |

Os dois cenários financeiros novos comprovam 180 operações BET/WIN/LOSS com 360 entregas em seis processos, e 80 débitos distintos com 240 entregas em quatro processos: 50 aceitos, 30 recusados por saldo insuficiente e saldo final zero. Conferem respostas históricas, identidades, versão, ledger, diários e reconciliação de todas as carteiras.

As primeiras execuções foram preservadas. Uma assertion global de outbox confundia um evento futuro de outra fixture com trabalho devido; agora o teste confere seus próprios eventos devidos e comprova que eventos futuros permanecem intactos. Outro gate local revelou que workers de concorrência podiam consumir referências pendentes de fixtures de integração. O runner passou a separar os recursos dessas suítes e a manter os totais, falhas e skips no JUnit agregado. O teste de referência aguarda o horário de retry durável em vez de depender da duração do startup do processo. Retries automáticos de testes permanecem desabilitados. Uma primeira chamada dos testes de agregação passou nas assertions, mas falhou ao gravar JUnit em uma pasta recém-criada pelo Docker; a execução em pasta de evidências existente passou com relatório preservado.

### Deploy e diagnóstico SQL

Acesso pelo alias SSH `subiu`, via tailnet, ao host `subiu-sm`: i5-4570, quatro núcleos, aproximadamente 11 GiB RAM. Release da bateria inicial em `/home/subiu-sm/apps/jungle-challenge/releases/20261001-index-bfe8a8b`, projeto `jungle-server`, com PostgreSQL/LocalStack, rede e volumes próprios. O DNS exclusivo `jungle.subiu.dev` foi criado para o túnel existente; o Traefik e o Cloudflared compartilhados não foram reiniciados. API pública protegida por BasicAuth operacional; health público. Grafana, Prometheus e Tempo têm portas somente em loopback e credenciais próprias fora do pacote.

Antes da migration, backups PostgreSQL em formato custom foram preservados nos dois hosts. A aplicação do índice ocorreu com geradores encerrados, outbox drenada e apenas a aplicação do challenge parada durante a troca. O plano de consulta por carteira passou de `Seq Scan` para `Bitmap Index Scan` em `wager_transactions_wallet`. Isso comprova o uso do índice nesse plano; os custos estimados do planner não substituem medições de execução. A contenção e a validação do histórico da própria carteira permanecem.

Smoke após deploy confirmou readiness SQL/SQS, BET 25.00, replay com a mesma identidade e saldo histórico 75.00, reconciliação, API pública sem credencial 401 e autenticada 200, HTTPS/DNS, dashboard Grafana e Prometheus. Uma primeira chamada ao dashboard ocorreu antes do HTTP do Grafana terminar o startup sob quota de 0,1 CPU e recebeu reset; após o startup o smoke passou, sem OOM ou restart desse container. As provas anteriores de OIDC/JWKS e traces SQS permanecem registradas abaixo; a bateria desta seção mede entrada HTTP interna.

### Protocolo de carga

Mesma imagem e quotas nos dois hosts: API e PostgreSQL com 0,75 CPU/512 MiB cada; LocalStack 0,5 CPU/512 MiB; gerador 0,5 CPU/1 GiB. Prometheus 0,15 CPU/192 MiB, Tempo 0,15 CPU/256 MiB, Grafana 0,1 CPU/384 MiB. Os serviços persistentes somam tetos de 2,4 CPUs e aproximadamente 2,3 GiB; são limites individuais, não reserva agregada. O host local é Ryzen 7 5700X/Docker Desktop com 16 CPUs lógicas e 19 GiB reportados pela VM. O servidor usa Linux nativo e compartilha recursos com as aplicações existentes.

`STRESS_PROFILE=heavy` executa 300/8, 2.000/16, 5.000/32, 5.000/64, 1.000/16 em uma carteira, 10.000/128, 10.000/256 e 3.000/48 em uma carteira: 36.300 BETs medidos por host, mais 24 operações de warmup em cada fase, usando 462 carteiras novas. Cada relatório confere saldo esperado em centavos, reconciliação exata, erros HTTP, coleta de telemetria e drenagem da outbox com métricas frescas. Timeout de drenagem de 600 segundos; os resultados permanecem em diretórios próprios.

O diagnóstico inicial passou nos cinco cenários comparáveis do servidor e chegou a 10.000/128 no host local, sem erros ou divergências nos casos concluídos. O crescimento do histórico revelou a ausência do índice por carteira. As rodadas incompletas foram encerradas deliberadamente com SIGTERM para aplicar a melhoria; seus manifests registram exit code 143 na fase interrompida e não representam baterias completas aprovadas. A auditoria posterior confirmou zero divergências, diários desbalanceados, referências pendentes, falhas de entrega ou outbox pendente. A carga final começa sobre esse histórico preservado.

### Consulta de traces após a carga

As oito fases terminaram nos dois hosts antes de ajustar os recursos de consulta. A primeira exportação completa do servidor revelou OOM do Tempo durante leitura de um trace, confirmada pelo kernel em **16:53:17 UTC**, após a bateria financeira terminar em 16:50:39. O container estava limitado a 256 MiB e usava o padrão de 20 consultas simultâneas. A API, o PostgreSQL e as aplicações existentes continuaram operacionais.

O Tempo passou a 512 MiB, swap desabilitado para esse container, `GOMEMLIMIT=384MiB` e duas consultas simultâneas. O limite do Go é um alvo de memória gerenciada; o teto efetivo é imposto pelo container. [Guia do GC do Go](https://go.dev/doc/gc-guide), [configuração do Tempo](https://grafana.com/docs/tempo/latest/configuration/). O orçamento persistente de deploy passou a aproximadamente 2,6 GiB/2,4 CPUs. Essa alteração ocorreu **depois das medições de carga**, que usaram a configuração anterior idêntica nos dois hosts; seus resultados foram preservados. As exportações posteriores retornaram cinco traces completos e auditoria SQL sem divergências em cada host. Arquivos `tempo-kernel-log.txt`, configurações, estados/reinícios e traces preservam o incidente e a validação posterior.

Evidências desta seção: `test-results/heavy-subiu-20261001/`, com fonte/hash da imagem medida, gates JSON/JUnit, manifests das rodadas, métricas/series Prometheus, dashboard Grafana, traces Tempo, logs, planos SQL, metadados dos backups e auditorias SQL. Dumps e credenciais ficam fora do pacote. O [runbook do servidor](SUBIU.md) contém os comandos de deploy, acesso e reprodução.

### Resultado da bateria pesada nos dois hosts

As oito fases passaram nos dois hosts, com **36.300 operações medidas por host**, zero erros HTTP, zero falhas de coleta, todas as carteiras reconciliadas e outbox drenada em cada fase. Local: 16:31:16.064–16:55:56.287 UTC; subiu: 16:32:19.358–16:50:39.457 UTC. Os relatórios completos ficam em `local-index-heavy/` e `server-index-heavy/`.

| Cenário                           | Host  | req/s | p95 cliente | Drenagem após reconciliação | RSS máximo amostrado |
| --------------------------------- | ----- | ----- | ----------- | --------------------------- | -------------------- |
| 10.000 / 128 clientes             | Local | 37,52 | 4.283 ms    | 106,66 s                    | 265,00 MiB           |
| 10.000 / 128 clientes             | subiu | 53,52 | 3.010 ms    | 57,77 s                     | 265,99 MiB           |
| 10.000 / 256 clientes             | Local | 36,66 | 9.191 ms    | 103,59 s                    | 270,55 MiB           |
| 10.000 / 256 clientes             | subiu | 53,36 | 5.582 ms    | 56,98 s                     | 271,68 MiB           |
| 3.000 / 48 clientes, uma carteira | subiu | 12,84 | 5.297 ms    | 14,69 s                     | 242,46 MiB           |

O servidor Linux nativo apresentou throughput maior nessa rodada que o Docker Desktop local; virtualização, armazenamento, histórico acumulado e outras tarefas limitam atribuir essa diferença ao hardware. Os picos de CPU são deltas amostrados como percentual de um núcleo; não são uso do host nem uma medição contínua da quota. `comparison.png` e `resources.png` derivam das séries exportadas, sem representar capturas de tela do Grafana.

Auditorias após a bateria e antes dos novos smokes: local com 923 carteiras e 61.962 transações/entradas de ledger/diários; subiu com 877 carteiras e 59.824 transações/entradas de ledger/diários. Ambas confirmaram zero inconsistências de saldo ou versão, diários desbalanceados, referências pendentes, entregas falhas e outbox pendente. Incluem o histórico de diagnóstico preservado e aberturas de carteiras, além dos débitos medidos.

### Dashboard de logs/traces e E2E real do IDP

O dashboard anterior continha somente métricas e um link para o Tempo com queries vazias. Foi acrescentado Loki 3.7.0, Alloy 1.20.1 e gateway de leitura restrito ao container da aplicação. O dashboard provisiona painéis de logs JSON e tabela TraceQL, com links Explore preenchidos e correlação por `correlationId`. Não foi alterado o código financeiro da aplicação. Os dados de log anteriores só podem ser coletados enquanto estiverem disponíveis na rotação Docker.

As consultas feitas por `/api/ds/query` do Grafana local 39323 e do servidor retornaram duas linhas de log e um trace para a mesma transação de validação em cada host. Três consultas históricas de traces em janela de seis horas passaram por host após o ajuste do Tempo. Um primeiro smoke consultou o trace antes da indexação e retornou vazio; a validação agora aguarda visibilidade com deadline de 60 segundos, sem aceitar erro de datasource. Evidências: `local-dashboard/` e `server-dashboard/`; roteiro em [OBSERVABILITY](OBSERVABILITY.md).

O E2E complementar usa Keycloak 26.6.4 real, com PostgreSQL/SQS exclusivos da stack descartável e banco/filas adicionais gerados pelo runner. Passou **nos dois hosts** com **15 testes, 71 assertions, zero falhas e zero skips**, e limpeza completa. Cobre client credentials, discovery/JWKS, token expirado e renovado, assinatura adulterada, audience e realm incorretos, provedor reservado, health público, rotas protegidas e fluxo financeiro autenticado com replay e bloqueio entre provedores. JUnit e identidade/limpeza em `idp-final-local/` e `idp-server/`; [IDP-E2E](IDP-E2E.md) descreve a reprodução. A execução final local durou 4,99 segundos com o IDP pronto; no subiu durou 119,05 segundos incluindo espera pelo startup frio. A stack descartável foi removida após preservar as evidências.

A primeira tentativa do IDP falhou no startup: o importador exige nome de arquivo correspondente ao realm; a configuração dos mounts foi corrigida. O startup sob quota também recebeu deadline de cinco minutos. A tentativa seguinte passou 14 casos e falhou na auditoria do teste por usar `ledger_entries` em vez de `wallet_ledger`; a assertion foi corrigida para conferir a abertura e o BET, com dois movimentos e diários balanceados. As falhas e a limpeza dos recursos foram preservadas em pastas próprias; não houve alteração das regras de autenticação para obter o resultado.

### Imagem e configuração finais

O commit `1bf2f1f` acrescentou logs/traces consultáveis e a suíte real do IDP. A imagem `jungle-challenge:observability-final-20261001`, ID `sha256:0c84de20661321126de4a01bcb617eb7230ef8bd36ec1d0c23537f5b8fea8022`, passou novamente em `verify:full`: local **17:28:31.360–17:31:39.869 UTC** e subiu **17:30:58.015–17:34:02.083 UTC**, mantendo 121 testes/1.313 assertions. Somando o E2E complementar, **136 testes/1.384 assertions por host**, sem falhas ou skips nas execuções finais e com limpeza completa. Os relatórios ficam em `verification-observability-final-{local,server}/` e nas pastas de IDP citadas acima.

O diretório `src/`, `bun.lock` e `scripts/load.ts` permanecem iguais ao commit da bateria financeira anterior; os hashes da imagem e da fonte/configuração são preservados. A documentação da entrega foi atualizada após construir a imagem; os arquivos executáveis e as configurações são conferidos separadamente no pacote. Release dessa etapa: `/home/subiu-sm/apps/jungle-challenge/releases/20261001-observability-final`. O orçamento persistente com Loki/Alloy/gateway é aproximadamente **3,1 GiB/2,75 CPUs**, em limites individuais.

Após trocar a imagem, consultas de logs/traces da mesma operação passaram novamente nos dois hosts, com três buscas históricas por host. A validação comprovou HTTP 403 para listar containers, inspecionar PostgreSQL e enviar DELETE, e HTTP 200 para a inspeção do container da aplicação. Os links de correlação foram conferidos nos dados provisionados; a renderização visual depende de login na sessão do navegador e não integra essa prova por API. Evidências finais em `local-dashboard-final/` e `server-dashboard-final/`.

Em seguida, o responsável confirmou que o Grafana local **39323 carrega corretamente logs e traces**. Essa é uma confirmação visual do usuário, complementando as provas por API. O agente havia observado um erro de frontend ao abrir Explore; sua causa não foi diagnosticada e não há uma correção de código atribuída a esse erro.

### Repetição com observabilidade completa e fechamento do monitor

`STRESS_PROFILE=observability` repetiu 10.000 BETs com 256 clientes/128 carteiras e 3.000 BETs com 48 clientes/uma carteira em cada host, com 48 warmups adicionais e 129 carteiras próprias. Local: **17:33:04.754–17:43:31.135 UTC**; subiu: **17:37:34.819–17:46:02.187 UTC**. Cada fase terminou com exit code 0, zero erros HTTP/coleta, reconciliação exata e outbox drenada. Somadas às oito fases iniciais, são **49.300 operações medidas por host**, sem contar warmups e rodadas de diagnóstico.

| Cenário                           | Host  | req/s | p95 cliente | Drenagem após reconciliação | RSS máximo amostrado |
| --------------------------------- | ----- | ----: | ----------: | --------------------------: | -------------------: |
| 10.000 / 256 clientes             | Local | 36,21 |    8.212 ms |                     97,90 s |           253,14 MiB |
| 10.000 / 256 clientes             | subiu | 52,18 |    5.627 ms |                     57,70 s |           256,99 MiB |
| 3.000 / 48 clientes, uma carteira | Local | 13,55 |    6.592 ms |                     24,94 s |           242,33 MiB |
| 3.000 / 48 clientes, uma carteira | subiu | 12,64 |    5.700 ms |                     15,85 s |           230,45 MiB |

As consultas históricas do Grafana e a validação de correlação ocorreram durante essa repetição, acrescentando carga de consulta. Não se trata de uma comparação causal isolada entre CPUs. Uma primeira tentativa local após trocar a imagem recebeu conexão recusada antes da readiness; a execução foi preservada como falha de startup. Após aguardar `up --wait`, ambas as fases passaram. Nenhuma regra financeira foi alterada.

Auditoria local em **17:44:25 UTC**: 1.056 carteiras, 75.147 transações/lançamentos/diários e 150.294 linhas contábeis. Auditoria subiu atualizada após o último smoke em **17:56:18 UTC**: 1.009 carteiras, 73.007 transações/lançamentos/diários e 146.014 linhas. Ambas com zero inconsistências de saldo/versão, diários desbalanceados, outbox/referências pendentes e entregas falhas. Evidências: `local-observed-export/`, `server-observed-export/` e `*-observed-heavy/`.

O monitor exclusivo foi encerrado e preservou **938 amostras, de 15:52:35 a 17:46:39 UTC**, sobre 28 containers existentes. Nenhuma amostra registrou problema, restart/OOM novo dos serviços acompanhados ou acionamento da proteção; probes HTTP retornaram 200. RAM disponível mínima amostrada: **4.122,88 MiB**. Os probes verificam as rotas raiz das aplicações e os estados Docker; não comprovam todos os fluxos de pagamento. Arquivo `host-samples.jsonl`; `summary.json`/`index.html` reúnem 34 fases concluídas, incluindo os diagnósticos preservados.

GitHub Actions remoto não é exigido pelo enunciado. Por orientação do responsável, essa execução fica fora do fechamento; a configuração permanece disponível e os resultados efetivos são os gates Docker/Linux documentados.

### Reprodução do README em fonte limpa

O commit `77e1b68` foi exportado com `git archive`, sem `.env`, dependências do host ou bind mount de código, para uma stack nova `jungle-review-clean-20261001`. Setup, readiness e seed repetido passaram, assim como o gate completo. A demo recebeu HTTP 400: o script ainda lia `walletId` da abertura, enquanto a API já retornava `id`, conforme a seção 9. A falha e a limpeza completa foram preservadas em `clean-readme-reproduction/`.

O commit `6456f6e` corrigiu somente o script `scripts/demo.ts`, usando `id` e tipando cada resposta utilizada. `bun run verify` passou no Windows com 63 testes/295 assertions, tipos, lint e formatação. Uma nova exportação desse commit foi construída com a instalação congelada do Dockerfile em outra stack, `jungle-review-clean-20261001-final`, com portas exclusivas 39400/39432/39466. Não foi reaproveitado banco, fila ou volume da primeira tentativa.

De **18:03:12.210 a 18:05:27.424 UTC**, passaram setup/migrations, liveness/readiness 200, seed duas vezes com a mesma identidade, BET/replay, duplicata SQS, LOSS e reconciliação de **75.00 BRL**, diferença **0.00**. O gate `verify:full` passou de **18:03:46.525 a 18:05:21.967 UTC**, com **121 testes/1.313 assertions, zero falhas/skips**. Os dois recursos das suítes foram removidos; ao final também foram removidos todos os containers/volumes próprios dessa stack.

Fonte: `6456f6e4926406aeed4a6a4c1d8ab9fab19bd9ec`; imagem construída: `sha256:a9887841fe25ae34b11f07558dfbfcc088879064650db4c5fed0ea4fe97f20cc`. Evidências em `clean-readme-reproduction-final/`, com comandos, timestamps, logs, JUnit, JSON e identidade/limpeza. `source-delivery-manifest.json` preserva os hashes; o pacote confere os arquivos executáveis/configurações contra a fonte construída. Alterações posteriores de documentação são identificadas pelo commit de entrega.

### Release final entregue no servidor

A mesma imagem validada foi identificada como `jungle-challenge:delivery-20261001-6456f6e` e implantada na release **`/home/subiu-sm/apps/jungle-challenge/releases/20261001-delivery-6456f6e`**. Apenas `jungle-server-app-observed-1` foi recriado; a comparação antes/depois confirmou ID, estado, saúde, restart count e OOM flag iguais para os **36 outros containers em execução**, incluindo os serviços do challenge e as aplicações compartilhadas. Banco, filas, proxy, túnel e Grafana foram preservados. Nenhuma migration ou configuração de runtime foi alterada nessa troca.

A demo corrigida passou no servidor com replay e reconciliação de 75.00 BRL. `verify:full` passou de **18:08:05.677 a 18:11:11.807 UTC**, com **121 testes/1.313 assertions, zero falhas/skips** e limpeza completa dos dois recursos exclusivos. Evidências: `deployment-delivery.json`, `verification-delivery-server/`. O E2E Keycloak já aprovado nos dois hosts continua aplicável à implementação e aos testes de autenticação sem mudanças; ele não foi repetido nessa troca exclusiva do script de demonstração/documentação.

Depois do deploy, a validação do Grafana retornou duas linhas de log e um trace da mesma operação, três consultas históricas e a política restrita do gateway. O smoke confirmou readiness SQL/SQS, BET/replay/reconciliação, HTTPS/DNS, acesso público 401 sem credencial e 200 autenticado, Grafana e Prometheus. Evidências: `server-dashboard-delivery/` e `server-delivery-smoke.json`.

Auditoria final em **18:12:51 UTC**: 1.012 carteiras, 73.014 transações, 73.013 lançamentos/diários e 146.026 linhas contábeis. A diferença de uma transação corresponde à LOSS da demo, sem movimento financeiro. Zero inconsistências de saldo/versão, diários desbalanceados, outbox/referências pendentes ou entregas falhas; cinco traces completos exportados. Evidências: `server-delivery-export/`.

As baterias de carga permanecem associadas às imagens/configurações efetivamente medidas. A imagem entregue acrescenta documentação e a correção do script CLI; `src/`, `scripts/load.ts`, demais scripts executáveis, testes, dependências e configurações são conferidos por hash contra a fonte da bateria com observabilidade. O commit final de documentação não muda os arquivos executáveis da fonte construída.

Após consolidar os documentos, `bun run check` passou no Windows de **18:14:32.947 a 18:14:50.865 UTC**: typecheck, lint sem warnings e formatação. Relatórios: `final-static.log` e `final-static.json`. Somente este registro foi acrescentado depois desse check e formatado com Prettier.

## Refinamento da outbox e fechamento da entrega — 01/10/2026

O publisher passou a enviar até dez eventos por `SendMessageBatch`, confirmar individualmente os IDs aceitos e repetir somente eventos sem confirmação válida. Claim, lease, fencing por token, identidade dos eventos e persistência financeira continuam com os mesmos contratos. Quando há trabalho, o loop continua drenando; vazio ou erro mantém espera. O shutdown conclui as confirmações de um lote já enviado. A interpretação operacional foi registrada previamente na especificação, sem alterar o enunciado ou migrations.

O gate final executado entre **15:14:11.894 e 15:15:25.042 UTC** passou em Docker/Linux com Bun 1.4.2, PostgreSQL 17.6 e LocalStack 4.9.2: typecheck, ESLint sem warnings, Prettier e **113 testes / 979 assertions / zero falhas / zero skips**, em 14 arquivos — 58 unitários, 46 de integração e nove distribuídos. As sete migrations passaram em `up → down → up`. Recurso isolado `wagering_test_1790867683013_4ed4e0b5`, `cleanupComplete: true`, `failedResources: []`. Uma primeira execução encontrou três falhas na nova fixture, que tratava a data retornada pelo driver como `Date`; a fixture foi corrigida para string/`Date.parse` antes deste gate final. Ambos os relatórios foram preservados.

```powershell
docker compose --profile test run --build --rm --no-deps --volume "D:\code\jungle-gaming\backend-challenge\test-results\refinement-20261001\verification-final:/app/test-results" test
```

Os seis novos cenários de integração cobrem sucesso parcial, confirmação ausente, falha da requisição, lease substituída antes de sucesso/falha e parada depois do send. SQL real comprova marcação por item, retries, fencing e recuperação por outro worker. Os itens aceitos usam SQS/LocalStack real; respostas de falha são injetadas de forma controlada. As provas distribuídas de crashes e publicação concorrente continuam passando.

### Carga reproduzível e comparação local

`bun run test:load` agora preserva `load.json` e `load-samples.json`, coleta CPU/RSS/heap/event loop/backlog, exige métricas frescas posteriores à carga para provar drenagem e compara cada saldo com o esperado calculado em centavos BigInt, além da reconciliação ledger/saldo. Métrica ausente não é interpretada como zero. Erro HTTP, divergência, falha de coleta ou timeout de drenagem tornam a execução malsucedida.

Stack exclusiva `jungle-refinement-20261001`, aplicação observada em 39310, Prometheus 39311, Tempo 39312 e Grafana 39313. Mesmo host Ryzen 7 5700X, 16 CPUs lógicas e 19 GiB reportados pelo container, sem quotas fixadas; stacks principal e anterior permaneceram ociosas no mesmo host. Cada execução usou **2.500 BETs de 0.01 BRL, warmup de 24 e 64 carteiras novas**, gerador em outro container, tracing e outbox ativos. Os gates ficaram fora da janela de carga.

| Versão / execução    | Clientes |  req/s | p95 cliente | Pico outbox | Drenagem após reconciliação |
| -------------------- | -------: | -----: | ----------: | ----------: | --------------------------: |
| Refinada — primeira  |       12 |  88,83 |   250,01 ms |       3.674 |                     17,72 s |
| Refinada — primeira  |       48 |  86,26 | 1.059,24 ms |       4.870 |                     16,57 s |
| Refinada — primeira  |       96 | 132,96 |   885,10 ms |       4.741 |                     19,68 s |
| Anterior — repetição |       48 | 113,22 |   616,03 ms |       4.854 |                     87,21 s |
| Refinada — repetição |       48 | 111,04 |   647,80 ms |       4.827 |                     26,84 s |

Todas as execuções terminaram com **zero erros, zero conflitos SQL contabilizados, nenhuma falha de coleta e 64/64 carteiras com saldo esperado e reconciliação consistente**. A auditoria SQL da stack refinada confirmou **256 carteiras, 10.352 lançamentos e diários, 20.704 linhas contábeis, zero saldos divergentes, zero diários desbalanceados, zero outbox pendente e zero falhas de entrega**. A comparação sequencial de 48 clientes no mesmo período observou redução de aproximadamente **69,2%** no tempo de drenagem; throughput HTTP caiu cerca de 1,9% e p95 aumentou cerca de 5,2%. As primeiras execuções evidenciam variabilidade. O resultado mede recuperação assíncrona local, sem comprovar ganho universal de throughput ou capacidade/SLO de produção.

O gerador da comparação anterior usou o mesmo protocolo, com um adaptador preservado em `load-baseline.ts`: a drenagem foi confirmada por leitura SQL fresca, pois a aplicação anterior não expõe o timestamp da coleta. Seu último gauge ainda mostrava 44 pendentes quando SQL confirmou zero; o relatório explica esse método. A aplicação anterior permaneceu na imagem antiga; apenas o gerador foi reconstruído. Amostras do gerador têm intervalo nominal de um segundo mais duração da coleta; durante recuperação há também polling independente. Prometheus coleta a cada cinco segundos. Picos de CPU são frações de um núcleo calculadas por deltas, com janelas variáveis, e não uso do host inteiro; não são diretamente comparáveis ao `rate[30s]` da coleta anterior. Não houve teste prolongado de vazamento de memória.

Evidências locais ignoradas: `test-results/refinement-20261001/`, com relatórios por execução, snapshots Grafana/Prometheus/Tempo, auditoria SQL, logs, commit base/patch do código medido e JSON/JUnit do gate. `comparison.png`, `resources.png` e `index.html` resumem os dados exportados. As figuras são derivadas das séries e não screenshots do Grafana. Reprodução das cargas: `measure.ps1` e comandos em [README](../README.md); a comparação legada exige a imagem anterior e o adaptador preservado. A coleta inicial completa permanece em `test-results/grafana-stress-20261001/`.

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

## Paginação e estabilidade da demo — 03/10/2026

Para evitar transferir e clonar o histórico inteiro a cada atualização da página, o dashboard agora retorna 100 peers por consulta, apostas da página e as 30 operações recentes. A busca de peers consulta no servidor apenas quando o texto ou a seleção muda, com até 100 opções. A aposta em lote envia uma intenção compacta ao servidor. Índices em memória eliminam buscas lineares no histórico para cada resultado financeiro, e os contadores de operação pendente e apostas abertas mantêm o tick constante. As identidades continuam persistidas antes do processamento; o checkpoint é salvo após concluir o lote ou ao pausar diante de resultado pendente.

Checks estáticos executados no workspace Windows: `bun run typecheck` (exit 0), `bun run lint` (exit 0, sem warnings), `bun run --bun prettier --check demo/table.ts demo/server.ts demo/types/contracts.ts demo/public/client.ts` (exit 0) e `git diff --check` (exit 0). Nenhum teste ou carga foi executado nesta alteração.

A imagem local `jungle-challenge:demo-stability-20261003` foi construída para `linux/amd64` com o Dockerfile de runtime (manifest `sha256:011290314d59942a81c0609d32e8ee0aa53b9241ae2eca9c4d1e37c7f75f1d54`); o container não foi iniciado localmente.

Na leitura remota somente de consulta, em 03/10/2026 por volta de 07:31 UTC, a produção estava na rodada 1367, fase `crashed`, com 10.106 peers, 2.375 apostas em `active` e 2.375 operações LOSS sem resultado. Treze dessas operações registravam fechamento inesperado do socket; as demais não tinham erro salvo. O total pendente permaneceu em 2.375 entre as leituras desta sessão. Demo, API observada, PostgreSQL e LocalStack apareciam `running/healthy`, sem reinícios: respectivamente 125/256 MiB, 122/512 MiB, 203/512 MiB e 415,5/512 MiB. A demo usa limite de 0,25 CPU e chegou a 22,27% na amostra, próximo ao teto; LocalStack estava com 81% do limite de memória. Não houve OOM observado.

A imagem não foi implantada e nenhuma operação foi reenviada. Como os LOSS ainda estão sem resultado e as apostas seguem abertas, reiniciar a demo pode iniciar operações financeiras automáticas durante a recuperação. O acesso HTTPS direto pelo cliente Windows continuou falhando com Schannel `SEC_E_NO_CREDENTIALS`; a inspeção remota via SSH com acesso elevado funcionou. Não há medição de carga pós-correção nem prova da nova versão em produção.

## Recuperação do lock da demo — 04/10/2026

O lock agora guarda PID, boot ID do host, instante de início em `/proc/<pid>/stat` e um token de proprietário. Ao encontrar um PID reutilizado, o processo compara a identidade, recupera o lock antigo sob o arquivo de guarda e continua a recuperação do journal. O token impede que o encerramento de um coordenador remova o lock de outro processo.

`bun run verify:full` passou com Bun 1.4.2 em um contexto limpo baseado no commit atual mais somente `demo/journal.ts` e `tests/unit/decolagem.test.ts`. PostgreSQL 17.6 e LocalStack 4.9.2 foram iniciados no projeto isolado `demo-lockpid-20261004`; o relatório marcou `cleanupComplete: true` para as duas suítes de infraestrutura. Resultado: 76 testes unitários, 51 de integração e 10 de concorrência aprovados, zero falhas e um skip previsto no teste de SIGTERM no Windows. Relatórios: `test-results/demo-lockpid-20261004/context/test-results/verify-full.json` e `resources-all.json`.

Ambiente local: Docker 29.5.3, Compose 5.1.4. Comandos no contexto isolado:

```sh
docker compose -p demo-lockpid-20261004 up -d postgres localstack --wait
bun run verify:full
docker compose -p demo-lockpid-20261004 down -v --remove-orphans
docker build --platform linux/amd64 -t jungle-challenge:demo-lockpid-20261004 .
```

A imagem `jungle-challenge:demo-lockpid-20261004` foi construída para `linux/amd64` (manifest `sha256:5747d93de90e624dbc7e1cfe12a4002b5edd00046cf200602d32e764d0f5430e`); o tar transferido conferiu SHA-256 `d445bdad2b00eda706a1f288b084699b24bfa9891b41eeaef94f79fc58fa88eb`. Um smoke Linux confirmou recuperação de PID reutilizado, rejeição de um segundo coordenador ativo e liberação do lock.

No host `subiu-sm`, Compose 5.3.0 validou a configuração e `up -d --no-deps --wait demo` recriou somente `jungle-server-demo-1`. A imagem financeira `jungle-challenge:delivery-20261001-6456f6e` manteve o mesmo container saudável. Sem credenciais, `GET /` e `GET /demo/state` retornaram HTTP 200; o container da demo ficou `healthy`. O journal da nova sessão foi preservado no volume: seis peers, zero apostas e zero operações pendentes. O journal anterior ao reset permanece em `pre-reset-20261004` dentro do mesmo volume. Banco e fila financeiros não foram alterados.
