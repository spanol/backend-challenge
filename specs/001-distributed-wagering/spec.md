# Especificação do processador distribuído de apostas

Estado em 1º de outubro de 2026: a revisão final Docker/Linux local passou com **137 testes/1.418 assertions** no `verify:full` e **15 testes/71 assertions** no E2E complementar com Keycloak real, sem falhas ou skips. Inclui SIGTERM real, oito migrations reversíveis e os critérios AC-22 a AC-31. As provas anteriores no subiu e os experimentos de carga, logs e traces permanecem preservados; a demo está integrada e implantada em `jungle.subiu.dev`. A [revisão final](../../docs/FINAL-REVIEW.md) registra a conferência do enunciado; a [rastreabilidade](../../docs/TRACEABILITY.md) relaciona requisitos, decisões e testes, e a [validação](../../docs/VALIDATION.md) registra comandos e resultados.

Esta especificação transforma o [enunciado](../../CHALLENGE.md) em comportamentos verificáveis. O objetivo é cobrir os 100 pontos da avaliação e eliminar falhas financeiras, com decisões que possam ser explicadas na apresentação. Em caso de divergência, o enunciado prevalece; interpretações adicionais estão identificadas ao final.

A [arquitetura](../../ARCHITECTURE.md) descreve como garantir esses comportamentos. O [plano de implementação e estudo](../../plans/2026-09-30-implementation.md) define a sequência de trabalho. Requisitos, decisões e testes permanecem relacionados durante a implementação.

## Escopo e restrições

- Bun 1.x como runtime, gerenciador de pacotes e executor de testes; TypeScript estrito; NestJS; PostgreSQL; SQS via LocalStack ou MiniStack; Docker Compose.
- MikroORM preferencial ou TypeORM. Prisma e Drizzle não atendem ao challenge.
- API HTTP, consumidor SQS, worker de referências pendentes, publisher de outbox e consultas financeiras.
- Migrations versionadas e reversíveis. Domínio com classes encapsuladas, factories e reidratação explícita.
- Precisão monetária, idempotência e correção com pelo menos três processos independentes.
- Autenticação externa, partidas dobradas, OpenTelemetry, dashboard e teste de carga são opcionais. Não disputarão tempo com requisitos obrigatórios.

## Matriz de avaliação

| Área do enunciado       | Pontos | Requisitos relacionados | Evidência necessária                                                |
| ----------------------- | -----: | ----------------------- | ------------------------------------------------------------------- |
| Correção financeira     |     20 | FIN-01 a FIN-09         | Dinheiro exato, operações, reversões e reconciliação                |
| Concorrência            |     20 | CON-01 a CON-04         | Disputa real de saldo, wallets independentes e três instâncias      |
| Idempotência            |     15 | IDE-01 a IDE-04         | Unicidade persistente, conflito e replay histórico                  |
| Mensageria e falhas     |     15 | MSG-01 a MSG-07         | Atomicidade, redelivery, referências, outbox, retry, DLQ e shutdown |
| Modelagem e arquitetura |     10 | MOD-01 a MOD-03         | Domínio encapsulado, portas, estados e invariantes no schema        |
| Testes                  |     10 | TST-01 a TST-03         | Testes unitários, containers reais e falhas controladas             |
| Observabilidade         |      5 | OBS-01 a OBS-03         | Logs, métricas e health checks                                      |
| Documentação            |      5 | DOC-01 a DOC-02         | Setup reproduzível, decisões, limitações e comandos                 |

Os pontos são pesos de avaliação, não uma previsão de nota. Um requisito só estará concluído quando sua evidência passar e puder ser reproduzida.

## Requisitos financeiros

| ID     | Comportamento obrigatório                                                                                                                                                                                                                        |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| FIN-01 | `Money` é imutável, recebe e serializa string decimal com duas casas e não usa `number`, `float` ou `double` para valores monetários. Rejeita NaN, Infinity, notação científica, vazio, casas extras e valores negativos em entradas.            |
| FIN-02 | Operações entre moedas diferentes falham. O domínio permanece multi-moeda mesmo se a execução do challenge ficar em BRL.                                                                                                                         |
| FIN-03 | Existe no máximo uma wallet por jogador e moeda. O saldo nunca fica negativo. A versão começa em 1 e muda somente quando o saldo muda.                                                                                                           |
| FIN-04 | Abertura com saldo positivo grava wallet, transação interna `OPENING` e ledger de crédito atomicamente. Abertura com zero não cria movimento financeiro. API e SQS recusam `OPENING`.                                                            |
| FIN-05 | `BET` debita; `WIN` credita; `LOSS` registra resultado sem ledger, mudança de saldo ou incremento de versão.                                                                                                                                     |
| FIN-06 | `REFUND` exige referência a uma `BET` processada e devolve exatamente seu valor.                                                                                                                                                                 |
| FIN-07 | `ROLLBACK` exige referência a `BET`, `WIN` ou `REFUND` processada e aplica seu efeito inverso, pelo mesmo valor.                                                                                                                                 |
| FIN-08 | Referências são resolvidas por provedor/ID externo e devem compartilhar provedor, jogador, wallet, moeda e rodada. Cada transação aceita uma reversão direta processada no total entre tipos (INT-03). Reversão sem saldo recebe código próprio. |
| FIN-09 | Toda mudança de saldo tem lançamento correspondente e vice-versa. O ledger é imutável. Reconciliação inclui o crédito de abertura, informa divergências, gera log/métrica e não corrige dados silenciosamente.                                   |

## Concorrência e idempotência

| ID     | Comportamento obrigatório                                                                                                                                                                                      |
| ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CON-01 | A unidade de serialização é a wallet. Não há lock global de todas as wallets nem leitura seguida de atualização sem controle de concorrência.                                                                  |
| CON-02 | Com saldo `100.00`, duas apostas distintas de `80.00` simultâneas produzem uma processada, uma rejeitada, saldo `20.00` e um débito.                                                                           |
| CON-03 | Wallets diferentes podem avançar em paralelo. Pelo menos três processos independentes disputam o mesmo PostgreSQL durante a validação.                                                                         |
| CON-04 | Ordem de locks e retries limitados são definidos. Timeout, deadlock e falha de conexão não viram rejeição financeira por saldo insuficiente.                                                                   |
| IDE-01 | `Idempotency-Key` HTTP é obrigatório e define a identidade de replay; no SQS, a chave vem do campo definido no envelope. A garantia persiste após reinício.                                                    |
| IDE-02 | O hash usa JSON canônico dos campos de negócio, com chaves ordenadas. Headers, IDs de entrega, correlação e outros metadados de transporte ficam fora dele. O algoritmo e a normalização são documentados.     |
| IDE-03 | A mesma chave com payload divergente retorna conflito e não muda saldo, ledger ou a operação original. A identidade externa `(providerId, externalTransactionId)` também não pode produzir efeitos duplicados. |
| IDE-04 | Repetir uma operação processada retorna seu resultado persistido, inclusive o saldo histórico, com `idempotentReplay: true`. Cinquenta envios simultâneos da mesma aposta produzem um único débito.            |

## Mensageria e recuperação

| ID     | Comportamento obrigatório                                                                                                                                                                                                             |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| MSG-01 | HTTP e SQS executam o mesmo use case. Inbox usa `(consumerName, messageId)` persistente e verifica conflito de payload.                                                                                                               |
| MSG-02 | Operação, mudança financeira, ledger, inbox quando aplicável e outbox são confirmados na mesma transação SQL. Falha antes do commit desfaz o conjunto. Ack acontece depois do commit.                                                 |
| MSG-03 | Referência ausente persiste `PENDING_REFERENCE`, com evento correspondente e responsabilidade durável de reprocessamento. Worker agendado usa backoff exponencial e prazo/limite documentados; esgotamento produz rejeição e evento.  |
| MSG-04 | Outbox publica apenas dados confirmados. Dois publishers concorrentes conseguem dividir o trabalho e recuperar registros abandonados sem perda; duplicação eventual tem identidade estável e é segura para um consumidor idempotente. |
| MSG-05 | Filas de entrada e DLQ são `wager-transactions.fifo` e `wager-transactions-dlq.fifo`. FIFO e deduplicação do broker são otimizações. Negócio terminal recebe ack; falha transitória recebe retry; falha permanente segue para DLQ.    |
| MSG-06 | Morte após commit e antes de ack não repete o movimento financeiro. Morte após commit e antes de publicação não perde o evento. Morte após envio e antes de registrar publicação permite redelivery seguro.                           |
| MSG-07 | SIGTERM interrompe novas aquisições e permite concluir trabalhos em andamento ou devolver a visibilidade. Trabalho abandonado volta a ser elegível por mecanismos persistentes.                                                       |

## Modelagem, API e evidências

| ID     | Comportamento obrigatório                                                                                                                                                                                    |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| MOD-01 | `Money`, `Wallet`, `WagerTransaction`, `WalletLedgerEntry`, `InboxMessage` e `OutboxMessage` têm factories e estado encapsulado. `rehydrate` reconstrói estado persistido sem repetir transições de negócio. |
| MOD-02 | `PROCESSED`, `REJECTED` e `FAILED` são terminais. Eventos usam classe abstrata e subclasses concretas, tipo/versão no tipo, envelope com correlação e dinheiro serializado como strings.                     |
| MOD-03 | O schema aplica unicidade, não-negatividade e imutabilidade. As regras não dependem somente de decorators, validação HTTP ou disciplina do programador.                                                      |
| API-01 | Implementar todos os endpoints da seção 9: abertura, wallet, ledger, consulta por ID interno/externo, submissão, reconciliação e health. Cursor do ledger é opaco e estável.                                 |
| API-02 | HTTP distingue payload inválido, conflito, rejeição de negócio, aceite pendente e indisponibilidade transitória, com códigos de falha estáveis.                                                              |
| TST-01 | Unidade cobre dinheiro, invariantes, cinco operações, moeda e payload divergente usando Bun.                                                                                                                 |
| TST-02 | Integração usa PostgreSQL e LocalStack/MiniStack reais para migrations, constraints, atomicidade, inbox, publishers, retry, DLQ e reinício.                                                                  |
| TST-03 | Concorrência e crash usam processos independentes, coordenação reproduzível e pontos de falha controlados. A reconciliação financeira fecha cada cenário.                                                    |
| OBS-01 | Logs JSON incluem contexto aplicável de correlação, mensagem, transação, wallet e provedor, sem dados sensíveis nem payload financeiro completo.                                                             |
| OBS-02 | Métricas cobrem status, duplicatas, retries, DLQ, conflitos de lock, lag da outbox e latência. IDs de jogador/wallet/transação não são labels de alta cardinalidade.                                         |
| OBS-03 | Liveness verifica vida do processo; readiness verifica PostgreSQL e SQS. Health não exige autenticação.                                                                                                      |
| DOC-01 | README de execução documenta setup, migrations, seeds, testes e execução concorrente. O enunciado original deve continuar acessível.                                                                         |
| DOC-02 | ARCHITECTURE registra ORM, mapeamento monetário, limites transacionais, locks, hashes, estados, failure codes, autenticação opcional e limitações.                                                           |

## Cenários de aceite prioritários

Os arquivos implementados e os nomes dos testes estão relacionados na [rastreabilidade](../../docs/TRACEABILITY.md).

| Cenário                           | Dado                                                          | Quando                                                                                                 | Então                                                                                                     |
| --------------------------------- | ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------- |
| AC-01 Precisão                    | `0.10 BRL` e `0.20 BRL`                                       | Somar                                                                                                  | Resultado exatamente `0.30 BRL`, sem conversão para `number`                                              |
| AC-02 Entrada inválida            | Número JSON, `1e2`, `1.001`, NaN, infinito, vazio ou negativo | Submeter dinheiro                                                                                      | Entrada rejeitada; nenhuma movimentação                                                                   |
| AC-03 Abertura                    | Jogador sem wallet BRL                                        | Abrir com `100.00` e repetir a criação                                                                 | Primeira operação cria crédito `OPENING` e versão 1; segunda conflita                                     |
| AC-04 Disputa                     | Wallet com `100.00`                                           | Duas apostas de `80.00` disputam a linha em processos distintos                                        | Uma processada, uma rejeitada, saldo `20.00`, um débito                                                   |
| AC-05 Replay concorrente          | Uma aposta e a mesma chave                                    | Enviar cinquenta vezes por três instâncias                                                             | Uma transação e um débito; respostas convergem para o resultado original                                  |
| AC-06 Replay histórico            | Aposta processada; depois ocorre outro crédito                | Reenviar a aposta                                                                                      | Resposta usa o saldo da aposta original, não o saldo atual                                                |
| AC-07 Conflito                    | Chave já registrada                                           | Reusar com outro valor, wallet, provedor ou rodada                                                     | Conflito sem substituir hash, resultado ou efeitos originais                                              |
| AC-08 LOSS                        | Wallet com saldo e versão conhecidos                          | Processar LOSS e reenviá-lo                                                                            | Resultado e evento persistidos; saldo/versão preservados; sem ledger                                      |
| AC-09 Estorno                     | BET processada                                                | Dois REFUNDs diferentes disputam a mesma referência                                                    | Um crédito de estorno; o outro rejeitado; repetir o vencedor é replay                                     |
| AC-10 Reversão de crédito         | WIN já gasto e saldo insuficiente para revertê-lo             | Processar ROLLBACK                                                                                     | Rejeição auditável com código de reversão sem fundos; nenhuma mudança financeira                          |
| AC-11 Fora de ordem               | Referência ainda inexistente                                  | REFUND/ROLLBACK chega; depois chega a operação original                                                | Pendência durável; reprocessamento aplica uma única vez quando a referência estiver processada            |
| AC-12 Referência expirada         | Pendência sem referência válida                               | Relógio/prazo de retry avança                                                                          | Rejeição terminal e evento; sem ledger ou mudança de saldo                                                |
| AC-13 Atomicidade                 | Processamento iniciado                                        | Injetar falha antes do commit em etapas distintas                                                      | Nenhum efeito parcial; retry posterior continua correto                                                   |
| AC-14 Crash após commit           | Mensagem SQS aplicada                                         | Encerrar o worker antes de DeleteMessage e aguardar redelivery                                         | Inbox/idempotência impedem novo débito e evento financeiro extra                                          |
| AC-15 Publishers                  | Outbox confirmada                                             | Dois publishers disputam e um morre durante uma publicação                                             | Todos os eventos ficam recuperáveis; duplicata eventual mantém eventId e consumidor aplica uma vez        |
| AC-16 Schema                      | SQL direto por conexão com permissões da aplicação            | Tentar saldo negativo, duplicidade, UPDATE/DELETE/TRUNCATE de ledger e commit financeiro inconsistente | Banco recusa cada violação                                                                                |
| AC-17 Reconciliação               | Saldo e ledger mudando concorrentemente                       | Reconciliar                                                                                            | Comparação usa uma visão consistente; não relata divergência causada por leituras de instantes diferentes |
| AC-18 Independência               | Wallet A travada e wallet B livre                             | Processar B em outro processo                                                                          | B conclui antes da liberação de A, dentro do timeout definido pelo teste                                  |
| AC-19 Falhas do broker            | Erro transitório e mensagem permanentemente inválida          | Reprocessar e esgotar política                                                                         | Retry/backoff e DLQ observáveis; não perde mensagem ao tentar encaminhá-la                                |
| AC-20 Recuperação                 | Aplicação já movimentou dinheiro                              | Reiniciar os processos e repetir operações                                                             | Respostas/efeitos continuam idempotentes; todas as wallets reconciliam                                    |
| AC-21 Reversão direta entre tipos | BET revertida por REFUND                                      | ROLLBACK aponta para a mesma BET                                                                       | REJECTED/REFERENCE_ALREADY_REVERSED; saldo/versão preservados, sem novo ledger; rejeição persistida       |
| AC-22 WIN fora de ordem           | BET referenciada ainda inexistente                            | WIN pendente chega antes da BET; worker retoma após a BET                                              | Um crédito processado, replay terminal estável e saldo reconciliado                                       |
| AC-23 Race cross-type             | BET processada                                                | REFUND e ROLLBACK direto concorrem em processos separados                                              | Uma reversão processada; a outra rejeitada; um movimento e saldo reconciliado                             |
| AC-24 Cursor intercalado          | Primeira página do ledger já retornada                        | Inserir novo movimento antes de buscar a próxima página                                                | Paginação não duplica nem perde lançamentos já existentes                                                 |
| AC-25 Shutdown durante poll       | ReceiveMessage já está em andamento                           | Parar workers antes da resposta do poll, que retorna uma mensagem                                      | Mensagem não inicia processamento e volta imediatamente à fila                                            |
| AC-26 Replay de LOSS no schema    | Resultado terminal com snapshot de saldo histórico            | Inserir por SQL um saldo que não corresponde à versão guardada                                         | Commit rejeitado sem alterar saldo ou ledger                                                              |
| AC-27 DLQ indisponível            | Mensagem permanente recebida                                  | Falhar o envio à DLQ e disponibilizar novamente a mensagem                                             | Sem ACK prematuro; nova tentativa audita e encaminha uma vez                                              |
| AC-28 Falha de ACK pós-commit     | Commit financeiro confirmado                                  | Falhar DeleteMessage e redeliver a mesma mensagem                                                      | Replay usa inbox, sem novo ledger ou evento; a segunda entrega pode ser ACKada                            |
| AC-29 Diário de partidas dobradas | Movimento de saldo confirmado                                 | Consultar o diário da transação e tentar confirmar linhas desbalanceadas                               | Duas linhas imutáveis, débito igual a crédito; rejeição e LOSS sem diário                                 |
| AC-30 Autenticação OIDC opcional  | AUTH_ENABLED=true                                             | Sem token, token expirado/inválido, emissor/audience incorretos, provider diferente e health público   | Negócio exige bearer JWT verificado por JWKS; provider deve corresponder a azp; health continua público   |
| AC-31 OpenTelemetry opcional      | OTEL_EXPORTER_OTLP_ENDPOINT configurado                       | Submeter operação HTTP e processar mensagem SQS                                                        | Spans úteis exportados via OTLP; métricas Prometheus visíveis no dashboard local                          |

## Interpretações adotadas

Estas escolhas adicionais não são afirmações de que o enunciado as prescreve.

A unicidade entre tipos restringe a regra mínima por tipo do §7 e evita creditar duas vezes quando `REFUND` e `ROLLBACK` apontariam diretamente para a mesma `BET`. `ROLLBACK` de um `REFUND` continua permitido porque referencia outra transação.

| ID     | Tema                                | Proposta ou questão                                                                                                                                                                                                                                                                                  |
| ------ | ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| INT-01 | Dinheiro zero                       | `Money.zero` e abertura zero são válidos. BET, WIN, REFUND e ROLLBACK exigem valor positivo; LOSS admite valor não negativo e sempre tem efeito financeiro zero. Documentar e testar a política.                                                                                                     |
| INT-02 | Referência opcional de WIN          | Sem referência, WIN pode ser aplicado. Com referência, exigir BET processada com o mesmo contexto; referência ainda ausente/não processada aguarda, referência terminal inválida rejeita.                                                                                                            |
| INT-03 | REFUND e ROLLBACK sobre a mesma BET | Uma reversão direta processada total por transação de referência, inclusive entre tipos. `ROLLBACK` de `REFUND` permanece permitido; o índice parcial e AC-21 registram essa proteção.                                                                                                               |
| INT-04 | Escopo da chave                     | Chave de idempotência globalmente única, além de unicidade por provedor e ID externo. Mesmo ID externo com outra chave retorna EXTERNAL_TRANSACTION_CONFLICT. Locks transacionais por chave não serializam todas as wallets.                                                                         |
| INT-05 | Replay pendente                     | Resultado terminal fica congelado. Replay de operação ainda pendente informa seu estado durável atual; não impede que o worker a conclua. Explicitar essa interpretação da resposta original.                                                                                                        |
| INT-06 | Prazo de referência                 | TTL configurável de 15 minutos, até 20 reprocessamentos, backoff exponencial de 1 a 60 segundos. Expiração gera REFERENCE_NOT_FOUND ou REFERENCE_TIMEOUT. Testes avançam relógio controlado.                                                                                                         |
| INT-07 | FAILED e DLQ                        | Falha permanente de operação já aceita e não terminal permite FAILED. Payload inválido antes do aceite gera auditoria/DLQ sem transação financeira fabricada. Sem banco, não há ACK; redrive SQS após cinco recebimentos e auditoria persistente quando o banco volta, preservando mensagens na DLQ. |

## Opcionais selecionados (2026-10-01)

Com os requisitos obrigatórios fechados, esta entrega inclui opcionais sem alterar os contratos obrigatórios:

1. **Partidas dobradas:** `wallet_ledger` continua registrando a mutação da carteira. Um diário separado registra cada movimento confirmado com duas linhas imutáveis, uma para o passivo da carteira e outra para a conta de compensação da plataforma, na mesma moeda e transação SQL. Aumentar o saldo credita o passivo da carteira e debita a compensação; reduzir o saldo debita o passivo e credita a compensação. A validação SQL diferida exige débito igual a crédito. `LOSS` e `REJECTED` não criam diário por não alterarem saldo. A conta de compensação é uma contrapartida técnica interna e não representa liquidação bancária ou reconhecimento de receita.
2. **Identity Provider:** Keycloak fornece OIDC local para desenvolvimento. Quando `AUTH_ENABLED=true`, a API valida JWT RS256 com chaves do issuer fixo, issuer, audience e validade temporal. O `azp` autenticado precisa corresponder ao `providerId` da operação/consulta externa. Health e mensagens internas SQS preservam o contrato original. O modo local sem auth continua disponível para a harness.
3. **OpenTelemetry e dashboard:** o processo cria spans explícitos nas entradas HTTP e SQS e exporta traces via OTLP/HTTP somente quando configurado. Falhas no exporter não podem alterar o resultado financeiro. Prometheus continua recebendo as métricas de produto; Grafana visualiza métricas e traces com o perfil opcional de observabilidade.
4. **Carga:** o experimento opcional existente e seus resultados permanecem documentados em `docs/VALIDATION.md`.

## Refinamento operacional da outbox (2026-10-01)

A carga instrumentada mostrou backlog de publicação apesar dos commits corretos. O publisher passa a enviar o claim de até dez eventos usando `SendMessageBatch`, fora da transação financeira. Cada evento mantém o próprio `eventId`, grupo e lease token. Apenas IDs confirmados em `Successful` podem receber `published_at`; falhas individuais, resposta sem confirmação e erro da requisição inteira preservam o evento e o retry persistente. Um erro de banco depois do envio continua recuperável por lease e deduplicação downstream. O loop drena claims não vazios sem a espera fixa entre lotes; espera quando não há trabalho ou quando a aquisição falha. Não há nova garantia de ordem global entre publishers.

Esta é uma otimização de transporte e agendamento; a semântica financeira, o limite do claim, as migrations e a regra de ACK da entrada permanecem as mesmas. A comparação de carga deve usar carteiras e recursos próprios, sem substituir o histórico anterior. Testes adicionais devem conferir aceitação parcial, falha total, confirmação ausente e fencing de publisher com lease substituído.

## Índice do histórico por carteira (2026-10-01)

A carga ampliada em ambiente com quotas mostrou latência crescente conforme o histórico global aumentava. `EXPLAIN` confirmou `Seq Scan` no filtro `wager_transactions.wallet_id`, usado pela validação financeira SQL. Uma migration adicional cria um índice B-tree não único nessa coluna, para permitir acesso ao histórico da carteira sem varrer as operações das demais. A mudança preserva triggers, locks, snapshots, unicidade, precisão e atomicidade. A reversibilidade deve ser comprovada no runner isolado; a aplicação em ambiente com dados ocorre após backup e fora da janela de carga. A comparação preserva as execuções anteriores e registra planos SQL e versão efetivamente medida.

## Regra de mudança da especificação

Quando surgir uma interpretação nova ou um teste revelar contradição: registrar o caso, atualizar esta especificação e a decisão arquitetural, ajustar os critérios de aceite e então alterar o código. Nenhuma alteração transforma um requisito obrigatório em opcional. Casos ainda abertos não são tratados como decisões fechadas.
