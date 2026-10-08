# Saúde da demo — 07/10/2026

Endereço: **https://jungle.subiu.dev/**. A inspeção usou HTTPS público, navegador Chrome, serviços privados, métricas, logs e SQL somente leitura. A sessão preservada tem 1.500 carteiras. As apostas estavam pausadas durante a inspeção inicial e foram retomadas às 21:29 BRT, por solicitação do usuário.

## Retomada das apostas — 21:29 BRT

`POST /demo/autoplay` com `enabled: true` retomou a sessão existente, sem criar carteiras ou repor saldos. Às 21:30:19 BRT, a rodada 4.115 estava em voo, com autoplay ativo, ciclo 1.220, zero operações pendentes e nenhum erro operacional. Às 21:35:43 BRT, a sessão avançara para a rodada 4.141 e o ciclo 1.246; a carteira selecionada reconciliou 672 lançamentos com diferença de R$ 0,00. A conciliação integral de 1.500 carteiras abaixo pertence à inspeção anterior à retomada.

O monitor distingue processamento normal de falha: `blocked` também ocorre enquanto uma rodada confirma ou liquida apostas. Um erro operacional é registrado por `operationError`; falta de progresso por dez minutos com autoplay ativo também gera erro. Às 21:35:35 BRT, a execução passou sem erros ou avisos. As 897 operações pendentes na amostra seguinte eram confirmações/estornos em andamento, com avanço da rodada e sem erro operacional.

Após corrigir a formatação pendente e excluir somente intermediários derivados do Remotion, `bun run check` passou com Bun 1.4.2 entre 21:35:43 e 21:36:11 BRT: TypeScript, ESLint e Prettier, todos com exit code zero. Evidências: `test-results/autoplay-resume-20261007/{first-observation.json,final-observation.txt,monitor-active.json,static-check.json,demo-active.jpg}`. Não foi executada uma nova suíte de testes financeiros.

## Correções aplicadas

### Painel acumulado publicado — 22:07 BRT

A imagem atual é `jungle-challenge:demo-session-summary-20261007-v1`, aplicada pelo quinto override `releases/20261007-demo-session-summary-v1/compose.session-summary.yaml`. Ela preserva as correções da imagem de saúde abaixo e acrescenta resultados acumulados. O baseline da sessão foi recuperado por SQL somente leitura com a demo pausada, liquidada e parada: 287.159 saques, 373.186 perdas e R$ 548.428,95 em prêmios brutos. Somente `history.outcomes` do journal mudou; sessão, 1.500 carteiras e saldos foram preservados. O autoplay foi retomado e o monitor de 22:07:43 BRT passou sem erros/avisos. Procedimento, checks e captura estão em [VALIDATION](VALIDATION.md#resultados-acumulados-da-sessão--07102026).

- O worker de recuperação histórica fazia scans e hash joins sobre milhões de eventos e recibos. A conexão exclusiva do novo worker usa os índices existentes, pool de uma conexão, timeout de dez segundos e pausa de 250 ms entre páginas. CPU do PostgreSQL passou de aproximadamente 80% para 9–14% nas amostras. Nenhum parâmetro global, índice, schema ou comando financeiro foi alterado. O worker anterior permanece parado, com checkpoint e configuração privados preservados.
- O replay terminou normalmente, com `done=true`, exit code zero e 1.407.797 eventos históricos reenviados no total acumulado do checkpoint. A fila de eventos ficou com zero mensagens visíveis, em trânsito ou atrasadas; outbox e atraso também estavam zerados. Reenvio de evento não reexecuta aposta: payload/eventId e recibo único foram preservados.
- A interface agora remove o alerta da leitura recuperada, preservando alertas de ações e operações pendentes. A busca de jogadores tenta novamente com espera progressiva de até 30 segundos. O Chrome bloqueou a antiga URL GET com `view=dashboard` (`ERR_BLOCKED_BY_CLIENT`); remover esse parâmetro redundante restabeleceu a atualização da mesa. A origem específica do bloqueio no cliente não foi comprovada. A seleção dos jogadores 1 e 2 carregou e reconciliou sem alerta na versão final.

O SQL comparou **todas as 1.500 carteiras da sessão** com seus **917.089 lançamentos**: zero diferenças de saldo, de versão/quantidade de lançamentos e de saldo do journal. A transação foi somente leitura, limitada a 15 segundos e encerrada por `ROLLBACK`; levou 3.575 ms. Isso verifica a sessão atual, não todas as carteiras históricas do banco.

## Implantação da revisão de saúde e manutenção atual

Somente a demo foi recriada, usando `jungle-challenge:demo-health-20261007-v2`. A imagem deriva da demo anterior e substitui apenas `demo/public/client.ts`; não instala dependências. As 1.500 identidades e saldos foram comparados nos journals antes/depois. API, PostgreSQL, LocalStack, Traefik e Cloudflared mantiveram seus containers.

Na implantação atual, inclua os cinco arquivos. O quarto introduziu a correção de consultas; o quinto acrescenta o painel acumulado:

```sh
cd /home/subiu-sm/apps/jungle-challenge
docker compose --env-file .env -p jungle-server \
  -f releases/20261001-demo-52e850a/compose.subiu.yaml \
  -f releases/20261007-demo-review-v2/compose.demo.yaml \
  -f releases/20261007-jungle-domain-v2/compose.domain.yaml \
  -f releases/20261007-demo-health-v2/compose.health.yaml \
  -f releases/20261007-demo-session-summary-v1/compose.session-summary.yaml config --quiet
```

Para voltar à imagem de saúde anterior, retire somente o quinto override e recrie `demo` com `up -d --no-deps --no-build --pull never --wait`, depois de confirmar autoplay pausado, ausência de apostas abertas/pendências e preservar um backup novo do journal. Não restaure um journal antigo sobre operações posteriores. Se a versão anterior operar novas rodadas, recapture o baseline SQL antes de republicar o painel acumulado: a imagem anterior não atualiza `history.outcomes`. Voltar à interface anterior à revisão de saúde exige retirar também o quarto override e reintroduz os defeitos de leitura corrigidos.

## Monitoramento dos próximos dias

O cron do usuário `subiu-sm` executa [production-health.py](../scripts/ops/production-health.py) **a cada cinco minutos**, com `flock` para impedir sobreposição. Encerra automaticamente em **12/10/2026, 19:56 BRT**, removendo apenas sua própria entrada, identificada por `jungle-prod-health-20261007`. O daemon cron e execuções automáticas foram confirmados.

Pasta privada no servidor:

```text
/home/subiu-sm/apps/jungle-challenge/operations/prod-health-20261007
```

| Arquivo               | Uso                                                   |
| --------------------- | ----------------------------------------------------- |
| `latest.json`         | Último resultado, erros, avisos, latências e recursos |
| `history.jsonl`       | Histórico de cada execução                            |
| `cron.log`            | Saída do monitor e falhas de execução                 |
| `monitor-config.json` | Expiração e baseline de containers/restarts           |

São verificadas página/assets, readiness público e privado, dashboard, busca de jogadores, carteira/ledger selecionado, Grafana, Prometheus/target, Tempo, Loki e existência de logs recentes. O monitor registra saúde/OOM/restarts de 12 containers, memória ≥85%, disco livre <10 GiB, latência >3 s, telemetria de mensageria antiga e backlog. A carteira selecionada é uma amostra em cada execução; a conciliação integral foi feita separadamente.

Consulta rápida:

```sh
ssh subiu 'cat /home/subiu-sm/apps/jungle-challenge/operations/prod-health-20261007/latest.json'
```

O monitor registra os resultados localmente; não envia notificações, reinicia serviços ou cria apostas/carteiras. O User-Agent `SubiuDemoHealth/1.0` permite reconhecer essas visitas sintéticas nas análises de tráfego.

## Observabilidade e limites

Às **20:15:30 BRT**, os **16 checks do monitor** passaram, sem erro ou aviso. As execuções automáticas de 20:10 e 20:15 também passaram. Após a conclusão do replay, PostgreSQL estava em 2,33% de CPU na amostra; demo em 11,2 MiB/512 MiB, API em 161,1 MiB/1 GiB e broker em 417,2 MiB/2 GiB. As filas de pedidos, eventos e DLQ informaram zero mensagens visíveis, em trânsito ou atrasadas na consulta final. São observações pontuais, não limites de capacidade sustentada.

Tempo e Loki responderam 503 nas primeiras consultas de readiness e 200 posteriormente, sem reinício ou OOM. O Loki explicitou a espera de 15 segundos antes de liberar readiness; a consulta de logs já retornava registros recentes. Esse comportamento é compatível com a espera iniciada na primeira checagem do [lifecycler Grafana](https://github.com/grafana/dskit/blob/main/ring/lifecycler.go). A amostra de quatro segundos não encontrou throttling de CPU nesses serviços. Não foram alteradas suas quotas nem autenticação.

Na inspeção inicial, TypeScript e ESLint passaram e `bun run check` falhou somente na formatação de 16 arquivos anteriores e alheios à correção. Essa pendência foi resolvida e o gate estático completo passou na retomada registrada acima. A inspeção inicial não executou suíte financeira, migration, carga, aposta ou criação de carteira; a ativação posterior do autoplay foi solicitada separadamente pelo usuário. A revisão comprova o estado observado e instala acompanhamento; não constitui garantia de disponibilidade futura.

Evidências locais, ignoradas pelo Git: `test-results/production-health-20261007/`. Configurações privadas do worker e backups de `.env`/crontab permanecem no servidor com acesso restrito; não integram o relatório.
