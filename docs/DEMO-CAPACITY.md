# Carga da demo — 05/10/2026

## Método e ambiente

Os números das seções históricas abaixo usam a API anterior. A revisão de cadência de 05/10 mantém 1.000 apostas por rodada e está registrada separadamente, na mesma população de apresentação. Os perfis 2k, 4k e 8k não foram repetidos com essa revisão.

O comparativo usa a mesa publicada no Subiu, com carteiras independentes e créditos fictícios. Cada participante aposta R$ 1,00 e recebe WIN ou LOSS na mesma rodada. **Participantes simultâneos na rodada não são conexões HTTP simultâneas:** o coordenador mantém até 32 chamadas financeiras em voo. A confirmação de todas as BETs antecede a contagem; a próxima rodada aguarda a liquidação completa. Os pontos de estouro são predefinidos. Os ensaios históricos usam contagem de cinco segundos e resultado de 3,7 segundos; a revisão atual usa três segundos e 1,5 segundo.

Os perfis 4.000, 2.000 e 1.000 usam a mesma população existente de 8.000 carteiras, com cursor persistente, três rodadas completas por perfil e auditoria integral entre perfis. A instrumentação é [scripts/demo-round-benchmark.py](../scripts/demo-round-benchmark.py). O perfil de apresentação foi escolhido pela menor mediana de tempo completo entre 1.000 e 2.000, usando preparação como desempate.

A demo chama uma API financeira interna, na imagem `jungle-challenge:delivery-20261001-6456f6e`; este ensaio não publica a implementação posterior de outbox da branch. O coordenador tem 1 CPU e 512 MiB; API e PostgreSQL têm 512 MiB cada, e LocalStack tem 2 GiB. A comparação ocorre na instalação compartilhada, com histórico e filas já existentes, sem limpeza de dados e sem isolamento de CPU do host. Não representa capacidade máxima de três réplicas nem um ensaio prolongado de estabilidade.

O dashboard é amostrado com pausa de um segundo, e `docker stats` a cada dez segundos acrescenta seu próprio tempo de coleta. Os tempos usam marcos do servidor e o primeiro estado de preparação observado; o começo observado pode atrasar alguns segundos. Preparação exclui os cinco segundos de contagem. Voo/liquidação inclui espera pelas confirmações de WIN e LOSS; o ciclo medido termina na liquidação e exclui os 3,7 segundos de exibição do resultado. Três amostras por perfil não sustentam percentis de produção ou SLOs.

O campo auxiliar `lossSettlementMs` mede a diferença até a liquidação a partir do primeiro estado `crashed` observado. Pode ser zero quando a primeira amostra já encontra as perdas encerradas; não representa uma medição exata do tempo de processamento dos LOSS.

## Cadência atual: 1.000 apostas em toda rodada

A publicação de **14:26:25 UTC** usa `jungle-challenge:demo-cadence-20261005-6fc109d` na API financeira e na demo. A sessão criada às 05:02 foi recuperada com as mesmas 1.000 carteiras e todo o histórico, sem reposição artificial de saldo. API e PostgreSQL têm **1,5 CPU / 1 GiB cada**; coordenador: **1 CPU / 512 MiB**; LocalStack: **1 CPU / 2 GiB**. Os limites de API e banco já estavam aplicados no comparativo imediatamente anterior. O host é compartilhado, com quatro CPUs.

### Diagnóstico e mudanças

A instalação havia perdido as três filas após um reinício do LocalStack. Readiness retornava 503 com PostgreSQL disponível e SQS indisponível; `RestartCount` era 1 e `OOMKilled` era false. Isso não identifica a causa histórica do reinício. `bun scripts/queues.ts` recriou as filas esperadas, sem purge ou alteração dos lançamentos. A outbox acumulava 332.111 eventos não publicados. A API ainda usava o publicador antigo, cuja seleção ultrapassava o timeout de cinco segundos; o plano da seleção já corrigida levou 5,965 ms. Publicar o worker validado `d7eb553` e ampliar os recursos drenou essa pendência, mas a preparação das 1.000 apostas continuou lenta.

O diagnóstico também mediu **2.225,613 ms e cerca de 1,16 GiB de leitura de blocos** para a consulta de telemetria da outbox. A validação financeira repetia joins de transações e snapshots de todo o histórico a cada operação. A revisão `6fc109d`:

- Cria índices parciais para telemetria de outbox pendente e OPENING processado por carteira, sem alterar unicidade.
- Confere os vínculos e snapshots da operação atual, preservando soma integral do ledger, versão, cadeia de saldos e imutabilidade dos resultados históricos. Alterar jogador ou moeda de uma carteira continua proibido, inclusive para o owner.
- Mantém até 32 chamadas em voo, repondo cada vaga quando sua resposta chega. Uma confirmação incerta interrompe novos envios e conserva as identidades para retry.
- Reduz a contagem para 3 s e a exibição do resultado para 1,5 s. O benchmark lê `roundTiming` do servidor e rejeita mudança desses intervalos durante o ensaio.
- Habilita neste perfil um consumidor que confere os eventos publicados e grava recibos duráveis antes de remover mensagens da SQS. Falhas de commit/ACK e envelopes duplicados alterados são cobertos por testes reais.

### Comparação na população existente

Os dois ensaios têm três rodadas, os mesmos pontos de estouro e 1.000 participantes em todas elas. O anterior já usa o worker `d7eb553` e os limites ampliados, mas conserva a validação SQL e o coordenador antigos. O posterior ocorre enquanto o consumidor drena a fila histórica; não é um ensaio isolado nem permite atribuir todo o ganho a uma única mudança.

| Versão medida                       | Janela UTC        | Rodadas | Preparação: mediana (mín.–máx.) | Voo/liquidação: mediana | Até liquidar: mediana (mín.–máx.) |
| ----------------------------------- | ----------------- | ------- | ------------------------------- | ----------------------- | --------------------------------- |
| Worker atualizado; validação antiga | 13:44:26–13:48:13 | 366–368 | 33,014 s (31,086–34,480)        | 25,508 s                | 64,988 s (55,248–66,329)          |
| Revisão atual                       | 14:26:50–14:28:41 | 506–508 | **7,363 s (5,943–8,202)**       | **8,249 s**             | **17,192 s (16,216–20,266)**      |

A preparação ficou **77,7% menor**, e o tempo até liquidar, **73,5% menor**. A mediana medida equivale a aproximadamente 3,8 vezes a velocidade anterior. Acrescente **1,5 s de resultado** ao ciclo atual para estimar o intervalo completo entre preparações; os 17,192 s incluem a contagem de três segundos e excluem a exibição do resultado. A preparação ainda leva segundos e depende da API e do histórico. Essas três amostras não definem SLO, percentis ou capacidade sustentada de um crash game.

| Rodada | Estouro |   BET | WIN | LOSS | Apostado (BRL) | Prêmios exatos (BRL) | Preparação | Voo/liquidação | Até liquidar |
| -----: | ------: | ----: | --: | ---: | -------------: | -------------------: | ---------: | -------------: | -----------: |
|    506 |   1,35× | 1.000 | 142 |  858 |       1.000,00 |               170,40 |    7,363 s |        5,853 s |     16,216 s |
|    507 |   3,10× | 1.000 | 714 |  286 |       1.000,00 |             1.349,85 |    8,202 s |        9,064 s |     20,266 s |
|    508 |   2,40× | 1.000 | 571 |  429 |       1.000,00 |               956,30 |    5,943 s |        8,249 s |     17,192 s |

As auditorias inicial e final abrangem **todas as 1.000 carteiras**: zero divergências de saldo/versão, saldos negativos, diários desbalanceados, transações pendentes ou rejeitadas. Todos os WIN/LOSS e prêmios corresponderam aos alvos previstos. Às **14:28:33 UTC**, havia **421 eventos da sessão ainda não publicados**; às **14:29:24 UTC**, a consulta global encontrou **zero outbox pendente**. A entrega assíncrona não integra o tempo até liquidar. O ensaio terminou com autoplay habilitado em 1.000 por rodada.

Nove amostras de `docker stats` observaram os seguintes picos; CPU é percentual de aproximadamente um núcleo, com janela amostrada, e os picos de CPU e memória podem ocorrer em momentos diferentes:

| Serviço        |     CPU | Memória (MiB) |
| -------------- | ------: | ------------: |
| Demo           |  18,59% |         28,01 |
| API financeira |  93,54% |        211,90 |
| PostgreSQL     | 151,32% |        281,60 |
| LocalStack     |  85,28% |      1.004,00 |

A fila de eventos tinha **401.530 mensagens visíveis às 14:17:54 UTC**, antes da revisão. Às **14:29:24 UTC**, restavam **327.531 visíveis e 10 em voo**, com **93.740 recibos duráveis**; entrada e DLQ tinham zero mensagens. A redução ocorre mesmo com novas rodadas publicando eventos. Esse registro comprova drenagem observada, sem recuperação demonstrada de mensagens que já haviam sido publicadas antes do reinício anterior do LocalStack. Durante as três rodadas, os quatro containers conservaram identidade, reinícios e estado de OOM; o reinício 1 do LocalStack pertence à baseline.

Na confirmação operacional de **14:35:35 UTC**, a mesa estava na rodada 530, com autoplay em 1.000, sem erro de operação e HTTP público/readiness 200. A fila histórica caiu para **287.402 visíveis e 10 em voo**, com **194.450 recibos**; entrada e DLQ continuavam vazias. A outbox global tinha **1.540 eventos pendentes durante novas apostas**. Portanto, zero pendentes às 14:29 descreve aquela leitura, e não uma promessa de fila sempre vazia. Containers continuaram sem novos reinícios ou OOM. Evidência em `evidence/demo-cadence-20261005/final-health.json` no servidor.

Relatórios agregados verificados: `test-results/demo-cadence-20261005/rounds-before-aggregate.json`, SHA-256 `a708b8202fea019091458481d38f34710ec3cb5dd0e8727eaf86c221e0a37e49`, e `rounds-final-aggregate.json`, SHA-256 `eba5dcd6d9c57043436588b15c58c6b5e1b2a855ca08e0bf650c5b778e031058`. Originais e amostras detalhadas permanecem em `evidence/demo-cadence-rounds-20261005-v2/` e `evidence/demo-cadence-rounds-20261005-final/` no servidor. O deploy, a pipeline e a correção da primeira execução estão em [VALIDATION](VALIDATION.md#cadência-de-1000-e-entrega-auditada-de-eventos--05102026).

## Comparativo histórico aprovado

Execução de **04:37:00 a 04:46:19 UTC**, com a correção publicada e sem reinícios, substituições de containers ou OOM durante o comparativo. Todas as nove rodadas confirmaram o grupo inteiro, com zero rejeições e nenhum comando financeiro pendente ao encerrar. Cada saque e o total pago corresponderam aos alvos previstos.

| Apostas por rodada | Rodadas                  | Preparação: mediana (mín.–máx.) | Voo/liquidação: mediana | Até liquidar: mediana (mín.–máx.) |
| -----------------: | ------------------------ | ------------------------------- | ----------------------- | --------------------------------- |
|              8.000 | 191; referência anterior | Sem medição completa            | Sem medição completa    | ≥ 387 s; início parcial           |
|              4.000 | 305–307                  | 43,1 s (42,0–44,5)              | 43,3 s                  | 91,4 s (76,7–92,1)                |
|              2.000 | 309–311                  | 24,5 s (21,7–29,2)              | 21,1 s                  | 47,8 s (42,5–57,7)                |
|          **1.000** | 313–315                  | **10,4 s (10,1–11,7)**          | **9,9 s**               | **25,5 s (22,0–26,6)**            |

A preparação de 1k foi cerca de 57% menor que em 2k, e o tempo até liquidar foi cerca de 47% menor. **1.000 peers por rodada** foi escolhido para a apresentação: novas sessões usam 1.000 carteiras independentes e todos participam, com saldo inicial fictício de R$ 100,00. A configuração de 8k continua disponível explicitamente; o histórico da população do ensaio é preservado.

### Resultados de cada rodada

| Perfil | Rodada | Estouro |   BET |   WIN |  LOSS | Apostado (BRL) | Prêmios exatos (BRL) |
| -----: | -----: | ------: | ----: | ----: | ----: | -------------: | -------------------: |
|  4.000 |    305 |   1,35× | 4.000 |   571 | 3.429 |       4.000,00 |               685,20 |
|  4.000 |    306 |   3,10× | 4.000 | 2.858 | 1.142 |       4.000,00 |             5.402,00 |
|  4.000 |    307 |   2,40× | 4.000 | 2.286 | 1.714 |       4.000,00 |             3.828,40 |
|  2.000 |    309 |   3,10× | 2.000 | 1.428 |   572 |       2.000,00 |             2.698,70 |
|  2.000 |    310 |   2,40× | 2.000 | 1.142 |   858 |       2.000,00 |             1.913,20 |
|  2.000 |    311 |   1,35× | 2.000 |   286 | 1.714 |       2.000,00 |               343,20 |
|  1.000 |    313 |   2,40× | 1.000 |   571 |   429 |       1.000,00 |               956,30 |
|  1.000 |    314 |   1,35× | 1.000 |   143 |   857 |       1.000,00 |               171,60 |
|  1.000 |    315 |   3,10× | 1.000 |   714 |   286 |       1.000,00 |             1.349,55 |

### Recursos observados

Cada célula mostra **pico de CPU / pico de memória em MiB**. São picos amostrados, que podem ocorrer em instantes diferentes; 100% de CPU corresponde aproximadamente a um núcleo. O histórico, cache e filas persistem entre perfis, portanto o aumento de memória do LocalStack não mede um custo isolado de 1k.

| Perfil | Amostras | Demo           | API financeira  | PostgreSQL      | LocalStack        |
| -----: | -------: | -------------- | --------------- | --------------- | ----------------- |
|  4.000 |       27 | 41,04% / 97,50 | 76,05% / 202,20 | 83,48% / 503,30 | 46,44% / 1.141,76 |
|  2.000 |       16 | 11,56% / 75,20 | 73,67% / 202,20 | 80,89% / 471,10 | 43,15% / 1.177,60 |
|  1.000 |       10 | 5,39% / 57,33  | 70,68% / 194,10 | 76,42% / 247,20 | 46,08% / 1.211,39 |

### Reconciliação e entrega de eventos

As auditorias inicial e após cada perfil abrangem **todas as 8.000 carteiras**. Em todas: zero divergências de saldo e versão, saldos negativos, diários desbalanceados, transações pendentes ou rejeitadas. Isso confirma a consistência financeira; a publicação assíncrona teve atraso observado:

| Marco                | UTC      | Outbox não publicada da população |
| -------------------- | -------- | --------------------------------: |
| Antes do comparativo | 04:37:00 |                                 0 |
| Depois de 4k         | 04:41:42 |                            13.406 |
| Depois de 2k         | 04:44:32 |                            16.391 |
| Depois de 1k         | 04:46:14 |                             7.959 |

O tempo de confirmação HTTP termina antes da publicação de todos os eventos. As pendências caíram durante 1k, mas este ensaio não exige outbox vazia em cada pausa e não comprova vazão sustentada de entrega. Naquela execução, a imagem financeira conservava seu publicador anterior e não havia consumidor da fila de eventos, que acumulava as mensagens publicadas. A revisão atual e sua drenagem estão registradas acima.

Relatório agregado: `test-results/demo-cashout-20261005/comparison-aggregate.json`, SHA-256 `cc0c5c7d6c7d30601a0d206821b6bb98aa90a6688d331ab56a42b562b584ba26`. As amostras completas e o relatório original permanecem em `evidence/demo-round-benchmark-20261005-v2/` no servidor. O download do resumo ocorreu após verificação do conteúdo por esquema restrito, sem identidades, credenciais ou saldos individuais.

## Apresentação publicada: 1.000 carteiras

Às **05:02:06 UTC**, foi publicado `jungle-challenge:demo-presentation-20261005-f42e62e`, com runtime, Compose e sugestão da página em 1.000. Depois da liquidação da mesa anterior, criou-se uma nova sessão de 1.000 carteiras independentes com autoplay ativo. O journal anterior tem backup no servidor, e seu histórico financeiro permanece no PostgreSQL. Os outros 40 containers foram preservados, e a página e readiness financeiro responderam HTTP 200.

Uma nova observação de três rodadas na população de apresentação confirmou:

| Rodada | Estouro |   BET | WIN | LOSS | Prêmios exatos (BRL) | Preparação | Até liquidar |
| -----: | ------: | ----: | --: | ---: | -------------------: | ---------: | -----------: |
|      3 |   3,10× | 1.000 | 714 |  286 |             1.349,85 |   16,765 s |     37,805 s |
|      4 |   2,40× | 1.000 | 571 |  429 |               956,30 |   17,394 s |     37,080 s |
|      5 |   1,35× | 1.000 | 143 |  857 |               171,60 |   15,498 s |     29,966 s |

Medianas: **16,765 s de preparação e 37,080 s até liquidar**. A variação frente aos 25,480 s do comparativo ocorre em uma nova sessão, em outro momento da mesma instalação compartilhada; o ensaio não isolou sua causa. O resultado de 25,5 s serve à seleção naquele comparativo e não é uma promessa de latência para toda rodada. Alvos também rotacionam com peer e rodada, portanto grupos distintos podem pagar totais diferentes no mesmo ponto de estouro.

A auditoria às **05:04:59 UTC** reconciliou todas as **1.000 carteiras**: zero divergências de saldo/versão, saldos negativos, diários desbalanceados, transações pendentes/rejeitadas e outbox não publicada **dessa sessão**. Sem reinícios, substituições ou OOM nos quatro serviços durante a observação. O observador terminou com autoplay ativo em 1.000 por rodada.

Relatório: `test-results/demo-presentation-20261005/rounds-aggregate.json`, SHA-256 `6c8cfc879a956c716f597f7199fb5a6cf77c74383e08de702e6f52441f90b621`; amostras originais em `evidence/demo-presentation-rounds-20261005/` no servidor. O gate completo do commit de runtime e a publicação estão em [VALIDATION](VALIDATION.md#comparativo-da-demo-e-saques-após-resposta-lenta--05102026).

## Referência de 8.000

A rodada 191, concluída às **04:09:54 UTC**, confirmou 8.000 BETs e liquidou **1.142 WIN + 6.858 LOSS**, com R$ 8.000,00 apostados e R$ 1.370,40 pagos. O estouro em 1,35× permite somente o alvo automático de 1,20×, e o total pago corresponde exatamente a esse alvo. Não havia apostas abertas, rejeições ou operações pendentes ao final.

A observação começou com a preparação já em andamento, às 04:03:27 UTC: há **pelo menos 387 segundos (6 min 27 s)** até a liquidação, sem medição completa separada de preparação e voo. É uma referência histórica de uma rodada, não uma mediana comparável às três rodadas dos demais perfis. A auditoria SQL das 8.000 carteiras às 04:14:21 UTC encontrou zero divergências de saldo/versão, saldos negativos, diários desbalanceados, transações pendentes/rejeitadas ou outbox não publicada.

## Ocorrência encontrada no primeiro ensaio

O primeiro ensaio de 4.000 revelou que o relógio podia atingir o estouro enquanto um lote de saques em 1,20× aguardava respostas. O coordenador encerrava os demais participantes com LOSS sem revisar os alvos superiores já alcançados. Na rodada 213, com estouro em 3,10×, ocorreram 571 saques; o grupo deveria ter 2.857 saques. Os lançamentos reconciliavam, mas a decisão de resultado estava incorreta. Esse ensaio não é usado como medição aprovada, e os resultados históricos permanecem preservados.

A correção `0bc178a` revisa os saques elegíveis depois da espera e antes de planejar perdas. Uma confirmação incerta continua bloqueando perdas até retry com a mesma identidade. A primeira instrumentação também encontrou um intervalo entre o último ACK e a gravação de `crashedEndsAt`; agora o observador aguarda esse marco. O comparativo repetido valida tanto a contagem de saques quanto o valor exato dos prêmios, além da reconciliação SQL.

O gate Docker/Linux da correção passou entre **04:24:23 e 04:33:54 UTC**, com Bun 1.4.2: **158 testes, 58.139 assertions, zero falhas/skips** (90 unidade, 57 integração e 11 concorrência), typecheck, lint e formatação. Inclui respostas lentas/incertas e uma rodada de 8.000 carteiras em três APIs reais. A infraestrutura isolada e seus recursos foram removidos; os relatórios ficam em `test-results/demo-cashout-20261005/linux/`.

## Reprodução

Execute no servidor da demo, usando uma sessão independente existente, já provisionada, e confirme a população esperada. Reserve a mesa durante a medição; alterações públicas de configuração interrompem o ensaio. O comando modifica somente o autoplay da demo e audita SQL em transação de leitura:

```sh
python3 scripts/demo-round-benchmark.py \
  --expected-session-id <uuid-da-sessao> \
  --expected-peers 1000 \
  --profiles 1000 --rounds 3 \
  --output <diretorio-novo-de-evidencias>
```

Para repetir o comparativo histórico, use uma população existente de 8.000 carteiras e registre a versão financeira e os intervalos atuais:

```sh
python3 scripts/demo-round-benchmark.py \
  --expected-session-id <uuid-da-sessao> \
  --expected-peers 8000 \
  --profiles 4000,2000,1000 --rounds 3 \
  --output <diretorio-novo-de-evidencias>
```

O relatório registra cada rodada, medianas, auditorias e o perfil escolhido. Amostras detalhadas permanecem no servidor; documentação e transferências usam somente agregados verificados. O script conserva identidades, saldo, histórico, journal e filas e pausa novas apostas quando encontra uma falha. Não use esse comando para executar testes de integração/migrations: esses continuam exclusivos do runner isolado descrito em [DEVELOPMENT](DEVELOPMENT.md).
