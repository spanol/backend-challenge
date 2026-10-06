# Métricas, logs e traces

O perfil `observability` provisiona o dashboard **Distributed Wagering Overview**, UID `distributed-wagering-overview`, com Prometheus, Loki e Tempo. Abra os painéis **Application JSON logs** e **Wager processing traces** no final do dashboard; a janela de tempo escolhida vale para todos os painéis. Os links superiores abrem Explore com consultas preenchidas.

```sh
docker compose --profile observability up --build -d --wait
```

No Compose local padrão, Grafana usa `http://localhost:3030`, usuário `admin` e senha `local-admin-only`, configuráveis por ambiente. A stack de comparação local usa a porta 39323 e credencial própria; no subiu, use o túnel descrito em [SUBIU](SUBIU.md). O Grafana tem autenticação própria, independente do OIDC da API.

## Coleta e correlação

Alloy lê stdout/stderr da aplicação observada pelo gateway Docker. O gateway permite somente ping/version e GET da inspeção/logs do container `${COMPOSE_PROJECT_NAME}-app-observed-1`; não permite listar containers, acessar outros serviços ou escrever na API Docker. Alloy não recebe o socket. O gateway não publica porta no host. A inspeção desse container é necessária para o coletor identificar o formato do stream.

Loki persiste logs em volume próprio, com retenção de 24 horas pelo compactor. A única dimensão de serviço é `service_name`; IDs de carteira, transação e correlação permanecem no JSON, sem criar streams por ID. Posições de leitura do Alloy ficam em outro volume. A coleta aproveita os logs ainda disponíveis na rotação Docker; não recupera arquivos já descartados antes de sua implantação.

Uma operação HTTP aceita `X-Correlation-Id` válido e devolve esse identificador. Logs usam `correlationId`; spans usam `wager.correlation_id`. No detalhe de um log, **Find matching trace** abre uma busca TraceQL por esse valor. No span, **Logs for this span** consulta Loki pelo mesmo valor com margem de dois segundos. Um correlationId fornecido pelo cliente pode se repetir e corresponder a várias operações; não é a identidade única de um trace.

Consultas úteis:

```logql
{service_name="distributed-wagering-processor"} | json
{service_name="distributed-wagering-processor"} | json | correlationId="ID"
{service_name="distributed-wagering-processor"} | json | event="wager_committed"
```

```traceql
{ resource.service.name = "distributed-wagering-processor" }
{ span.wager.correlation_id = "ID" }
{ status = error }
```

O painel de traces limita a busca a 20 resultados. Um trace recém-emitido pode levar alguns segundos para ficar pesquisável; a validação aguarda a publicação/indexação, com deadline. Para consultar a carga antiga, ajuste a janela para seu período UTC. Ausência de dados na janela atual pode ser normal quando não há operações.

## Orçamento e diagnóstico

Na demo, `wager_outbox_pending` é a contagem SQL exata dos envelopes ainda não publicados; `wager_outbox_lag_seconds` mede a idade do mais antigo. O intervalo configurado é de 60 s e a consulta pode demorar: verifique `time() - wager_telemetry_timestamp_seconds` antes de interpretar a amostra. Esse timestamp corresponde ao início da última coleta concluída. Backlog de eventos não significa aposta financeira sem commit.

`rate(wager_outbox_published_total[5m])` mede envelopes aceitos pelo SQS e confirmados no SQL com o token corrente do publisher. O contador reinicia com o processo. `wager_event_queue_depth` é a soma aproximada de mensagens visíveis e em trânsito na última consulta do backpressure, com cache de 500 ms. Um claim em andamento pode ultrapassar o patamar de 10.000. Esses sinais não comprovam que todos os recibos downstream já foram gravados. Configuração e recuperação histórica estão em [MESSAGING-RECOVERY](MESSAGING-RECOVERY.md).

No subiu, Loki tem teto de 384 MiB/0,2 CPU, Alloy 128 MiB/0,1 CPU e gateway 32 MiB/0,05 CPU. Tempo usa 512 MiB, alvo de GC de 384 MiB e duas consultas simultâneas. Esses limites foram validados em consultas reais; retenção não é um teto de disco e deve ser acompanhada pelo operador. As medições financeiras anteriores registram a configuração usada naquele momento em [VALIDATION](VALIDATION.md).

Para diagnóstico, confira as fontes provisionadas, consulte `/api/ds/query` pelo Grafana autenticado e os logs de Alloy/Loki/Tempo. Readiness da API não comprova disponibilidade da observabilidade. Reinicie apenas o Grafana depois de alterar as fontes provisionadas; o dashboard em arquivo é atualizado pelo provisionador. Preserve volumes e exporte a evidência antes de expirar a retenção.

Referências: [coleta Docker do Alloy](https://grafana.com/docs/alloy/latest/reference/components/loki/loki.source.docker/), [retenção Loki](https://grafana.com/docs/loki/latest/operations/storage/retention/), [TraceQL no Grafana](https://grafana.com/docs/grafana/latest/datasources/tempo/query-editor/), [correlação com logs](https://grafana.com/docs/grafana/latest/datasources/tempo/configure-tempo-data-source/configure-trace-to-logs/).
