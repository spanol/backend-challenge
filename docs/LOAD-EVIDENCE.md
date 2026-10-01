# Evidências das cargas maiores

Galeria de demo e carga: `test-results/demo-subiu-20261001/prints/index.html`.
Página das cargas: `test-results/demo-subiu-20261001/prints/carga/index.html`.
Os artefatos são locais e ignorados pelo Git; esta documentação registra sua leitura e rastreabilidade.

## O que foi medido

As baterias finais de 01/10/2026 somam **49.300 operações HTTP medidas por host**, ou **98.600** entre local e subiu: oito fases de 36.300 operações, seguidas de duas fases repetidas de 13.000 com logs/traces. Os warmups e as execuções diagnósticas anteriores estão fora desse total.

| Cenário                               |                              Operações |          Clientes HTTP simultâneos | Carteiras |
| ------------------------------------- | -------------------------------------: | ---------------------------------: | --------: |
| Distribuído intermediário             |                                 10.000 |                                128 |       128 |
| Distribuído maior                     |                                 10.000 |                                256 |       128 |
| Carteira disputada                    |                                  3.000 |                                 48 |         1 |
| HTTP anterior, sem quotas posteriores |                                  2.500 |                                 96 |        64 |
| Rajada SQS anterior                   | 1.000 comandos únicos / 1.100 entregas | Não mede clientes HTTP simultâneos |        64 |

Clientes são emissores HTTP em loop fechado: cada um espera a resposta anterior. A rajada SQS inclui 100 duplicados lógicos com deduplicação de transporte distinta, verificando inbox SQL e saldo esperado. **Não há prova de exatamente 100 ou 1.000 jogadores simultâneos nesses relatórios.**

## Como o algoritmo se comportou

| Subiu, oito fases finais                     | Vazão (operações/s) | p95 do cliente (s) | Drenagem após reconciliação (s) | RSS pico (MiB) |
| -------------------------------------------- | ------------------: | -----------------: | ------------------------------: | -------------: |
| 128 clientes / 10.000 operações              |               53,52 |               3,01 |                           57,77 |         265,99 |
| 256 clientes / 10.000 operações              |               53,36 |               5,58 |                           56,98 |         271,68 |
| 48 clientes / uma carteira / 3.000 operações |               12,84 |               5,30 |                           14,69 |         242,46 |

A vazão estabilizou enquanto o tempo de espera aumentou. A carteira única apresentou menor vazão, compatível com contenção e serialização do lock. Essas observações não isolam a causa de cada espera nem estabelecem capacidade máxima ou SLO.

Nas vinte fases finais dos dois hosts: zero erros HTTP, zero erros de coleta, todas as carteiras reconciliadas com saldo esperado exato e outbox drenada. A repetição no subiu com 256 clientes registrou 52,18 operações/s, p95 5,63 s, RSS pico 256,99 MiB e final 186,42 MiB. A outbox chegou a **19.947 eventos**, lag máximo **190,80 s**, e terminou em zero após drenagem registrada de 57,70 s. Publicação assíncrona teve atraso mensurável durante a rajada.

Auditoria global do subiu às 17:56:18 UTC: 1.009 carteiras, 73.007 transações e 146.014 linhas contábeis. Zero carteiras inconsistentes, versões divergentes, diários desbalanceados, referências/outbox pendentes e entregas falhas. Esses totais incluem histórico e warmups, além das operações medidas.

## Fontes e apresentação

- `test-results/heavy-subiu-20261001/{local,server}-index-heavy/*/stress.json`: manifests das oito fases por host, com limites de tempo, códigos de saída e caminhos dos relatórios.
- `test-results/heavy-subiu-20261001/{local,server}-observed-heavy/*/stress.json`: duas fases repetidas por host com logs/traces.
- `load.json`: latência do cliente, vazão, recursos máximos, drenagem e reconciliação individual de cada carteira.
- `load-samples.json`: séries temporais com fases `baseline`, `http-load` e `outbox-recovery`; os gráficos mostram recursos e retorno da outbox a zero.
- `{local,server}-observed-export/`: séries Prometheus exportadas, auditorias SQL e buscas Tempo.
- `test-results/grafana-stress-20261001/`: rodada anterior de 96 clientes, replays HTTP e 1.000 comandos SQS; configuração sem quotas posteriores.
- `prints/carga/manifest.json`: origens e SHA-256 dos 58 arquivos copiados, além das imagens. Capturas originais do Grafana e gráficos derivados de JSON têm legendas distintas.

Cada cenário da tabela HTML abre seu JSON original copiado. Os gráficos derivados podem ser consultados sem depender da retenção do Grafana. O ZIP combinado `test-results/demo-subiu-20261001/provas-demo-e-carga-subiu-20261001.zip` inclui a demo, a página de carga e os relatórios selecionados; o ZIP anterior da demo permanece preservado.

Para servir a galeria somente no computador local:

```powershell
python -m http.server 39480 --bind 127.0.0.1 --directory test-results/demo-subiu-20261001/prints
```

Abra `http://127.0.0.1:39480/carga/`. Nenhuma nova carga é iniciada para visualizar esses artefatos.

## Ambiente e limites de interpretação

Local Ryzen 7 / Docker Desktop, subiu i5-4570 / Linux com aplicações compartilhadas. Nas baterias pesadas, API e PostgreSQL tiveram 0,75 CPU/512 MiB cada; SQS 0,5 CPU/512 MiB; gerador 0,5 CPU/1 GiB. Uma API HTTP por carga, outbox e tracing ativos. Históricos diferentes, virtualização, consultas de observabilidade e tarefas simultâneas limitam comparação causal de hardware.

As oito fases por host precedem Loki/Alloy e usam Tempo 256 MiB. O kernel registrou OOM do Tempo às 16:53:17 UTC, após terminar a primeira bateria do servidor às 16:50:39. O limite passou a 512 MiB, GOMEMLIMIT 384 MiB e paralelismo de consultas 2; a repetição de 13.000 operações por host é posterior. A tentativa local anterior à readiness e a execução interrompida para aplicar o índice do ledger permanecem no histórico diagnóstico. O OOM posterior do Grafana durante a demo é registrado em [VALIDATION.md](VALIDATION.md).

CPU amostrada é percentual de um núcleo calculado por deltas; picos curtos podem ultrapassar a quota na amostragem. RSS de processo difere da memória reportada pelo Docker. Picos dependem da frequência de coleta, e redução de RSS ao final não comprova ausência de vazamento. O p95 HTTP do cliente difere do p95 interpolado dos buckets do Grafana. Drenagem começa depois da reconciliação e não mede todo o intervalo desde o último commit.

Esta ampliação da galeria reutilizou relatórios existentes: conferiu os vinte códigos de saída, erros, reconciliações e drenagens; confrontou totais com os manifests e preservou hashes dos arquivos copiados. Não alterou o algoritmo nem executou uma nova bateria de stress.

Empacotamento: 90 referências locais das duas páginas conferidas; 107 arquivos no ZIP, incluindo manifesto combinado; integridade ZIP e varredura pelas senhas de acesso conhecidas passaram. Pacote: 3.166.174 bytes, SHA-256 `4ec520e0860e6fb6110639473287a71d0942a6187c8d52c96d1fb85fb4687c5f`. A captura histórica do Grafana para 256 clientes foi conferida visualmente; a sessão expirou durante a tentativa de uma segunda captura, que não integra o pacote.
