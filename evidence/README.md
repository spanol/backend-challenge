# Evidências para avaliação

O [relatório da revisão final](../docs/FINAL-REVIEW.md) relaciona cada seção do enunciado à implementação. O gate Docker/Linux local passou com **137 testes/1.418 assertions**; o E2E com Keycloak real passou com **15 testes/71 assertions**. Total: **152 testes/1.489 assertions, sem falhas ou skips**. As provas financeiras anteriores no home server e os limites dos experimentos estão em [VALIDATION](../docs/VALIDATION.md).

## Ver rapidamente

| Cenário                               | Prova                                                  |
| ------------------------------------- | ------------------------------------------------------ |
| BET e débito exato na demo            | [Captura](prints/02-bet-debito.jpg)                    |
| Replay conserva o resultado histórico | [Captura](prints/04-replay-historico.jpg)              |
| Disputa de saldo na mesa              | [Captura](prints/09-disputa-saldo.jpg)                 |
| Logs e traces no Grafana              | [Captura](prints/12-grafana-logs-traces.jpg)           |
| Recursos durante 256 clientes         | [Captura](prints/grafana-256-recursos.jpg)             |
| Comparação de carga entre cenários    | [Gráfico derivado das amostras](prints/comparison.png) |

## Baixar os relatórios

| Arquivo                                                | Conteúdo                                                                    | SHA-256                                                            |
| ------------------------------------------------------ | --------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| [Revisão final](final-audit-20261001.zip)              | JUnit/JSON do gate, Keycloak, limpeza de recursos e relatório por requisito | `bc13a3888c41c8495abaf5f77bcdb27a3768ef56145ae1b5c4071a8cdfc4047f` |
| [Demo e carga](provas-demo-e-carga-subiu-20261001.zip) | Galerias HTML, prints, relatórios de carga e telemetria exportada           | `4ec520e0860e6fb6110639473287a71d0942a6187c8d52c96d1fb85fb4687c5f` |

Depois de extrair o segundo ZIP, abra `index.html` para os cenários da demo e `carga/index.html` para as cargas. As **98.600 operações HTTP medidas** somam os dois hosts; o máximo observado foi **256 clientes simultâneos**, com reconciliação e drenagem comprovadas nos cenários executados. A rajada separada de 1.000 comandos SQS não representa 1.000 jogadores simultâneos. Metodologia e limites em [LOAD-EVIDENCE](../docs/LOAD-EVIDENCE.md).

Os prints registram execuções anteriores. Na demonstração ao vivo, a demo está em `https://jungle.subiu.dev`; o Grafana do servidor é acessado por túnel SSH, conforme [DEMO](../docs/DEMO.md). As credenciais são fornecidas separadamente.
