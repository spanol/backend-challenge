# Capturas Grafana — 07/10/2026

Capturas reais pelo Chrome autenticado no túnel privado `localhost:39333`. As imagens mostram a API financeira; seus gráficos de memória não representam o processo coordenador da demo corrigido em 07/10.

| Arquivo                            | Conteúdo                                          | Contexto                                                                   |
| ---------------------------------- | ------------------------------------------------- | -------------------------------------------------------------------------- |
| `grafana-visao-geral-20261007.jpg` | CPU, RSS, heap, event loop, operações e p95       | Consulta com “Last 12 hours”; inclui períodos sem amostras                 |
| `grafana-latencia-20261007.jpg`    | Painel ampliado de latência p95                   | Capturado às 11:23 BRT; escalas e lacunas preservadas                      |
| `grafana-traces-20261007.jpg`      | Traces `wager.process` com durações e identidades | Registros de 07/10 às 11:01 BRT; duração de spans não equivale ao p95 HTTP |

Não houve edição dos valores, das curvas ou das respostas. O auto-refresh estava desligado para permitir a conclusão das consultas. Não interpretar lacunas como zero, traces isolados como SLO ou reconciliação de uma carteira como auditoria global.

As placas de apoio em `../support` acrescentam assinatura e contexto ao redor da captura original. Os JPEGs originais acima permanecem disponíveis para inspeção.
