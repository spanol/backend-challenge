# Recuperação da mensageria da demo — 06/10/2026

## Diagnóstico

O kernel confirmou OOM do processo Python do LocalStack em **06:57:40 BRT (09:57:40 UTC)** no cgroup do broker, com aproximadamente 2 GiB de RSS. O restart perdeu as três filas; inicializá-las novamente recuperou a readiness, mas não recuperou mensagens já aceitas pelo broker. Os envelopes financeiros permanecem na outbox do PostgreSQL.

Na inspeção do código executado de LocalStack 4.9.2, `FifoQueue.deduplication` guardava o `SqsMessage` inteiro por cada ID enviado. O ACK não removia essa referência e não havia expiração do cache; apenas purge limpava o mapa. Essa retenção é uma causa concreta de crescimento contínuo, mesmo com a fila de eventos praticamente vazia. Antes da manutenção, a memória atingiu **1,624 GiB / 2 GiB**. A emissão usa IDs únicos e o histórico possui milhões de eventos.

Outro custo observado era a telemetria: `COUNT(*)` exato dos eventos pendentes a cada dois segundos varria milhões de entradas e disputava CPU/IO com processamento financeiro e publicação. Em 16:34:35 UTC havia **9.702.387 eventos pendentes**, com atraso do evento mais antigo de aproximadamente 23,3 horas. Não se interpreta esse backlog como apostas financeiras ainda não confirmadas.

## Correção

| Componente              | Alteração                                                                                                                                      | Proteção preservada                                                                   |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| Broker da demo          | Imagem derivada de LocalStack 4.9.2 fixada por digest; cache FIFO guarda apenas identificação, grupo e tempos; expiração pelo worker periódico | Deduplicação após ACK durante cinco minutos; mensagens pendentes permanecem na fila   |
| Startup do broker       | Hook idempotente recria a topologia SQS da demo                                                                                                | DLQ de 14 dias, visibility de 30 s e redrive após cinco recebimentos                  |
| Publisher               | Claim SQL configurável e chamadas SQS em sequências por agregado                                                                               | Máximo de dez por chamada, token, lease, SKIP LOCKED, confirmações parciais e backoff |
| Consumidor de auditoria | Polls paralelos agregados em uma transação SQL                                                                                                 | Comparação integral com o envelope arquivado, recibo único e ACK após commit          |
| Backpressure            | Suspende novos claims quando a fila de eventos alcança o limite aproximado                                                                     | Eventos aguardam no PostgreSQL, sem descarte                                          |
| Telemetria              | Intervalo de 60 s na demo; contagem continua exata                                                                                             | Timestamp da última coleta concluída; valor não é uma estimativa                      |
| Recuperação             | Replay paginado dos eventos publicados antes do cutoff e sem recibo do consumidor da demo                                                      | Mesmo payload/eventId; não altera `published_at`, dinheiro, ledger ou transações      |

A retenção FIFO de cinco minutos, inclusive após a exclusão da mensagem, segue o [contrato do Amazon SQS](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/FIFO-key-terms.html). O patch do broker é específico da imagem fixada e falha no build quando o código esperado não coincide. Não deve ser aplicado indiscriminadamente a outras versões.

O Compose local e o workflow de CI também constroem essa imagem. Assim, a prova de SIGTERM com visibility renovada exercita o broker corrigido nas execuções usuais de `verify:full`, sem depender de um override privado de teste. O default de publicação continua em dez eventos e uma sequência fora do perfil da demo.

### Configuração

Na prova de SIGTERM, o heartbeat de uma visibility de 1 s era agendado no próprio limite de 1 s. Foi antecipado para metade da janela, com piso de 100 ms. Um reproducer independente confirmou outro defeito da imagem original: o FIFO recusava ACK após o prazo original mesmo depois de `ChangeMessageVisibility` renovar a deadline. O patch incorpora a [verificação upstream pela visibility corrente](https://github.com/localstack/localstack/blob/v4.14.0/localstack-core/localstack/services/sqs/models.py#L978), conserva a recusa de handles realmente expirados e passou na suíte real de concorrência. A configuração pública de 30 s usa heartbeat de 15 s.

A expiração também libera grupos FIFO vazios que não estão em trânsito. A criação e o uso do grupo ficam sob o mesmo mutex da limpeza; grupos com mensagens ou entregas em trânsito permanecem intactos. Isso evita acumular grupos antigos quando a demo renova carteiras esgotadas.

| Variável                       | Default fora da demo | Perfil público                                                 |
| ------------------------------ | -------------------- | -------------------------------------------------------------- |
| `OUTBOX_CLAIM_SIZE`            | 10                   | 500                                                            |
| `OUTBOX_SEND_CONCURRENCY`      | 1                    | 8                                                              |
| `OUTBOX_QUEUE_LIMIT`           | 0, desabilitado      | 10.000                                                         |
| `EVENT_RECEIPT_POLL_BATCHES`   | 1                    | 32                                                             |
| `OUTBOX_TELEMETRY_INTERVAL_MS` | 2.000                | 60.000                                                         |
| `OUTBOX_PUBLISH_ENABLED`       | habilitado           | habilitado; `false` permite drenar o broker durante manutenção |

O limite de fila é aproximado e consultado a cada 500 ms; um claim em andamento pode ultrapassá-lo. Não é um limite rígido de mensagens ou de RAM. Paralelismo de envio conserva a sequência de cada agregado dentro do claim; não acrescenta ordem global entre publishers. O consumidor agrega até 320 mensagens, mantendo cada poll e ACK em no máximo dez.

## Procedimento operacional

O override fixa também `localstack.cpus: 1.0`. A inspeção da configuração efetiva encontrou `NanoCpus=500000000` na base antiga do servidor. O limite foi aplicado em 17:27:02 UTC por `docker update --cpus 1.0`, conservando o mesmo container e as mensagens em trânsito. Alterações futuras no broker exigem o drain descrito abaixo antes de uma recriação.

Foi executado `VACUUM (ANALYZE, PARALLEL 0, TRUNCATE OFF) public.outbox`, com `vacuum_cost_delay=2ms` e `vacuum_cost_limit=200`, para limpar versões MVCC mortas e atualizar estatísticas. A forma utilizada mantém leituras/escritas concorrentes e não reescreve a tabela; os registros financeiros históricos são preservados. [Referência PostgreSQL 17](https://www.postgresql.org/docs/17/sql-vacuum.html).

1. Pausar o auto bet e aguardar `confirming=0`, `active=0` e operações pendentes zero. Preservar journal, carteiras, grupo e cursor.
2. Suspender o publisher, manter o consumidor ativo e aguardar filas requests/events/DLQ sem mensagens visíveis, em trânsito ou atrasadas. Na primeira manutenção foi usado `WORKERS_ENABLED=false` da versão antiga com um consumidor separado para o drain.
3. Aplicar a imagem corrigida somente ao broker e à API. Não recriar PostgreSQL, remover volumes ou executar migrations para baixo.
4. Confirmar topologia, readiness, publicação, recibos, memória e saúde dos demais serviços. Drenar o backlog persistente.
5. Quando necessário, recuperar entregas antigas sem recibo com `bun scripts/replay-demo-events.ts`, `DEMO_EVENT_AUDIT=true` e `EVENT_REPLAY_CHECKPOINT` apontando para arquivo privado persistente. O checkpoint guarda limite de paginação, cutoff fixo, cursor e progresso; reinícios conservam as identidades e podem redeliver. A fila é limitada pelo mesmo patamar de 10.000 mensagens.
6. Retomar o grupo existente e observar rodadas completas e a taxa de publicação frente à geração de novos eventos.

`PERSISTENCE=1` e um volume montado **não comprovaram snapshots** na edição executada: o diretório de estado estava vazio. O hook restaura somente nomes/atributos das filas; não é recuperação das mensagens. A durabilidade dos pedidos ainda não processados continua dependendo de SQS; não se declara tolerância a perda de um broker efêmero. A recuperação de eventos publicados é viável porque seus envelopes e recibos permanecem no PostgreSQL.

## Evidências

Comandos, resultados completos da pipeline e medições posteriores ficam em [VALIDATION](VALIDATION.md). Relatórios privados desta intervenção estão em `test-results/messaging-recovery-20261006/` no workspace e em `evidence/demo-recovery-20261006/` no servidor. Dados financeiros e credenciais não integram este documento.
