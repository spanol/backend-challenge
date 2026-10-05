# Carga da demo — 05/10/2026

## Método e ambiente

O comparativo usa a mesa publicada no Subiu, com carteiras independentes e créditos fictícios. Cada participante aposta R$ 1,00 e recebe WIN ou LOSS na mesma rodada. **Participantes simultâneos na rodada não são conexões HTTP simultâneas:** o coordenador mantém até 32 chamadas financeiras em voo. A confirmação de todas as BETs antecede os cinco segundos de contagem; a próxima rodada aguarda a liquidação completa. Os pontos de estouro são predefinidos.

Os perfis 4.000, 2.000 e 1.000 usam a mesma população existente de 8.000 carteiras, com cursor persistente, três rodadas completas por perfil e auditoria integral entre perfis. A instrumentação é [scripts/demo-round-benchmark.py](../scripts/demo-round-benchmark.py). O perfil de apresentação foi escolhido pela menor mediana de tempo completo entre 1.000 e 2.000, usando preparação como desempate.

A demo chama uma API financeira interna, na imagem `jungle-challenge:delivery-20261001-6456f6e`; este ensaio não publica a implementação posterior de outbox da branch. O coordenador tem 1 CPU e 512 MiB; API e PostgreSQL têm 512 MiB cada, e LocalStack tem 2 GiB. A comparação ocorre na instalação compartilhada, com histórico e filas já existentes, sem limpeza de dados e sem isolamento de CPU do host. Não representa capacidade máxima de três réplicas nem um ensaio prolongado de estabilidade.

O dashboard é amostrado com pausa de um segundo, e `docker stats` a cada dez segundos acrescenta seu próprio tempo de coleta. Os tempos usam marcos do servidor e o primeiro estado de preparação observado; o começo observado pode atrasar alguns segundos. Preparação exclui os cinco segundos de contagem. Voo/liquidação inclui espera pelas confirmações de WIN e LOSS; o ciclo medido termina na liquidação e exclui os 3,7 segundos de exibição do resultado. Três amostras por perfil não sustentam percentis de produção ou SLOs.

## Comparativo aprovado

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

O tempo de confirmação HTTP termina antes da publicação de todos os eventos. As pendências caíram durante 1k, mas este ensaio não exige outbox vazia em cada pausa e não comprova vazão sustentada de entrega. A imagem financeira em produção conserva seu publicador anterior. Os eventos publicados também permanecem na SQS; esta demo não acrescenta um consumidor dessa fila. Acompanhar outbox e memória é necessário na operação prolongada.

Relatório agregado: `test-results/demo-cashout-20261005/comparison-aggregate.json`, SHA-256 `cc0c5c7d6c7d30601a0d206821b6bb98aa90a6688d331ab56a42b562b584ba26`. As amostras completas e o relatório original permanecem em `evidence/demo-round-benchmark-20261005-v2/` no servidor. O download do resumo ocorreu após verificação do conteúdo por esquema restrito, sem identidades, credenciais ou saldos individuais.

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
  --expected-peers 8000 \
  --profiles 4000,2000,1000 --rounds 3 \
  --output <diretorio-novo-de-evidencias>
```

O relatório registra cada rodada, medianas, auditorias e o perfil escolhido. Amostras detalhadas permanecem no servidor; documentação e transferências usam somente agregados verificados. O script conserva identidades, saldo, histórico, journal e filas e pausa novas apostas quando encontra uma falha. Não use esse comando para executar testes de integração/migrations: esses continuam exclusivos do runner isolado descrito em [DEVELOPMENT](DEVELOPMENT.md).
