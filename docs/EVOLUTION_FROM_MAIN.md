# Do desafio ao produto demonstrável

O processador evoluiu para uma experiência completa de demonstração: app público, rodadas contínuas, carteira e reconciliação visíveis, inspeção de replay, observabilidade, recuperação documentada e materiais de apresentação. O resultado permite usar o sistema e conferir suas garantias financeiras pelo código, pelos cenários executados e pelos registros operacionais.

## Base da comparação

Comparação de 07/10/2026 entre a `main`/`origin/main` atualizada, commit **`09a5aea62d322b33d8695ef175c94ab57c5c151d`**, e a `demo-deploy` com os ajustes e materiais desta sessão. Antes desses ajustes serem commitados, a branch já tinha 32 commits exclusivos e HEAD `95d9efc7e4b664f3b5f87c70e94391b99673e824`. O merge-base era a própria `main`.

Os ajustes da demo e do acompanhamento operacional de 07/10 estão no commit **`bc2f07a`**. Capas, vídeos, fontes licenciadas, geradores e o projeto Remotion acompanham esta comparação no commit de apresentação.

A `main` já continha uma base financeira sólida: `Money` com BigInt, idempotência persistida, commit atômico, ledger, partidas dobradas, inbox/outbox, locks por carteira e testes distribuídos. Também já havia demo pública, Grafana, métricas, logs e traces. A evolução descrita abaixo amplia essa entrega.

`src/domain`, `src/application`, `src/adapters`, `package.json`, `bun.lock` e `CHALLENGE.md` são idênticos à `main`. As diferenças em `src/` estão em **12 arquivos de infraestrutura, com 393 linhas adicionadas e 30 removidas**. Os ajustes de apresentação e saúde de 07/10 não acrescentaram alterações em `src/`.

## O que evoluiu

| Área                      | Base já existente na `main`                                            | Entrega atual                                                                                                                                                                                 | Evidência                                                                                                                                                                                                                                    |
| ------------------------- | ---------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Experiência de uso        | Demo de crash, seleção de jogador, ações manuais e inspeção financeira | **Carteira em Jogo**, autoplay contínuo, perfis de operação/disputa de saldo, carteiras por jogador, janela fixa de entrada, expiração de intenções e estorno de confirmações tardias         | [Demo e perfis](DEMO.md), [spec da demo](../specs/002-decolagem-demo/spec.md), [mesa](../demo/table.ts), [integração PostgreSQL](../tests/integration/decolagem.test.ts)                                                                     |
| Interface em operação     | Dashboard paginado e busca de jogadores                                | Leituras serializadas, polling apenas na aba visível, backoff, descarte de respostas de outra seleção, recuperação dos alertas e histórico limitado para replay                               | [Cliente](../demo/public/client.ts), [validação de 07/10](VALIDATION.md#consultas-da-apresentação-e-preparo-do-portfólio--07102026) e [saúde](PRODUCTION_HEALTH.md)                                                                          |
| Publicação de eventos     | Outbox transacional, lease, retry e identidade persistente             | Publicação em lotes SQS, concorrência limitada, confirmação SQL em lote e controle de backlog                                                                                                 | [Workers](../src/infrastructure/messaging/workers.ts), [configuração](../src/infrastructure/messaging/settings.ts), [provas de mensageria](../tests/integration/messaging.test.ts)                                                           |
| Entrega e recuperação     | Retry de mensagens e prova de crash entre commit e ACK                 | Auditor opcional da demo com recibos duráveis, validação do payload arquivado, ACK após commit e replay de eventos históricos sem recibo                                                      | [Recibos](../src/infrastructure/messaging/event-receipts.ts), [replay](../scripts/replay-demo-events.ts), [integração real](../tests/integration/event-receipts.test.ts), [recuperação](MESSAGING-RECOVERY.md)                               |
| Persistência e desempenho | Auditoria SQL, triggers e constraints financeiros                      | Dois índices parciais e validação concentrada na operação corrente, preservando a auditoria completa da carteira e a imutabilidade histórica                                                  | [Migration 009](../src/infrastructure/persistence/migrations/Migration202610050009.ts), [migration 010](../src/infrastructure/persistence/migrations/Migration202610050010.ts), [provas financeiras](../tests/integration/financial.test.ts) |
| Broker e falhas reais     | SQS FIFO em LocalStack e cenários entre processos                      | Renovação de visibilidade adequada a prazos curtos, cache de deduplicação com TTL e metadados compactos, correção de visibilidade no broker derivado e CI que constrói essa imagem            | [Patch FIFO](../docker/localstack/patch_fifo.py), [cenários distribuídos](../tests/concurrency/distributed.test.ts), [workflow](../.github/workflows/quality.yml)                                                                            |
| Operação e continuidade   | Deploy HTTPS, volumes persistentes e observabilidade                   | Journal sincronizado antes dos envios, recuperação pelo histórico SQL após incidente, replay histórico concluído, monitor de saúde a cada cinco minutos e procedimento de manutenção/rollback | [Journal](../demo/journal.ts), [incidente e gate](VALIDATION.md#recuperação-após-reinício-do-host--06102026), [monitor](../scripts/ops/production-health.py), [saúde em produção](PRODUCTION_HEALTH.md)                                      |
| Apresentação              | Documentação, provas e galeria técnica                                 | Roteiro de avaliação em cinco minutos, vídeo real de 60 segundos com textos animados em Remotion, versão técnica de 90 segundos, prints do Grafana e padrão de capa com identidade Subiu      | [Revisão](REVIEW.md), [vídeos](DEMO_VIDEOS.md), [kit de marca](../marketing/portfolio/README.md), [Remotion](../marketing/portfolio/remotion/README.md), [texto preparado](LINKEDIN_POST.md)                                                 |

## Avanços concretos no processamento

1. **Menos trabalho por publicação:** a outbox busca eventos devidos por `next_attempt_at, id`, envia lotes de até dez mensagens e confirma grupos no SQL. Concorrência, tamanho de claim e limite de fila são configuráveis e validados. Lease/token e IDs originais permanecem na recuperação.
2. **Entrega verificável:** o auditor opcional confirma o recibo no PostgreSQL antes do ACK. Falha no ACK permite reentrega com recibo já durável; divergência entre payload e evento arquivado é rejeitada. O replay preserva as identidades dos eventos.
3. **SQL otimizado com invariantes preservados:** as migrations 009/010 acrescentam índices e concentram verificações de transação na operação atual. As provas cobrem tentativa de forjar saldo/snapshot, mudança de titular/moeda, replay após 500 movimentos e alternância de constraints imediatas/diferidas. A auditoria da carteira ainda percorre seu histórico.
4. **Falhas observadas e corrigidas:** o broker derivado reduz retenção de dados na deduplicação e respeita extensão de visibilidade. O journal grava e sincroniza antes de liberar envios. Os registros distinguem provas de crash de processo, reinício de container e o incidente real de recuperação.

Esses avanços estão entregues na branch atual. Os commits `d7eb553`, `6fc109d`, `67c329d`, `6002023` e `95d9efc` registram marcos de publicação em lote, auditoria, recuperação da mensageria, CI e durabilidade do journal.

## Evidências para apresentar

| Evidência                                | Resultado e escopo                                                                                                                                                                                                      |
| ---------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Gate completo documentado na `main`      | **137 testes**, com PostgreSQL/SQS e cenários distribuídos; o E2E de Keycloak era complementar e separado                                                                                                               |
| Gate Docker/Linux da imagem de 06/10     | **189 testes, 59.270 assertions, zero falhas/skips**; resultado histórico dessa imagem, registrado em [VALIDATION](VALIDATION.md#recuperação-após-reinício-do-host--06102026)                                           |
| Conciliação integral da sessão em 07/10  | **1.500 carteiras, 917.089 lançamentos, zero divergências**, por SQL somente leitura durante a inspeção com autoplay pausado                                                                                            |
| Recuperação histórica concluída em 07/10 | **1.407.797 eventos reenviados**, total acumulado do checkpoint; `done=true`, exit code zero e fila drenada ao final                                                                                                    |
| Retomada autorizada do autoplay em 07/10 | Mesma sessão de 1.500 carteiras, sem reposição de saldo; avanço da rodada **4.115 para 4.141** entre 21:30:19 e 21:35:43 BRT, sem erro operacional; carteira selecionada com **672 lançamentos e diferença de R$ 0,00** |
| Validação dos ajustes de 07/10           | `bun run check` aprovado com Bun 1.4.2: TypeScript, ESLint e Prettier; observação real no navegador e monitor sem erros/avisos às 21:35:35 BRT; nenhuma nova suíte financeira executada nessa revisão                   |
| Vídeo principal                          | **60 segundos, 1920 × 1080, 30 fps, H.264**, captura real do app, reconciliação, replay e Grafana; textos animados sobre a gravação, sem alteração dos valores apresentados                                             |

Os comandos, ambientes e arquivos de evidência estão em [VALIDATION](VALIDATION.md), [PRODUCTION_HEALTH](PRODUCTION_HEALTH.md) e [DEMO_VIDEOS](DEMO_VIDEOS.md). Os registros privados completos permanecem em `test-results/`, ignorado pelo Git.

## Como descrever o resultado

> Transformei um desafio de backend em um produto demonstrável: aplicação pública em operação, carteira e reconciliação visíveis, replay idempotente, observabilidade e recuperação documentada. A evolução também chegou à infraestrutura, com publicação de eventos em lote, recibos duráveis e melhorias no SQL, preservando os contratos financeiros.

“Produto demonstrável completo” descreve a experiência entregue. A demo utiliza créditos fictícios; os resultados pertencem aos ambientes e cenários registrados. A entrega de mensagens continua pelo menos uma vez, com efeito financeiro idempotente. Os números de população e de testes não representam capacidade sustentada ou operação com dinheiro real.

## Reproduzir a comparação no Git

```sh
git rev-parse main origin/main demo-deploy
git rev-list --left-right --count main...demo-deploy
git diff --stat main demo-deploy -- src
git diff main demo-deploy -- src/domain src/application src/adapters package.json bun.lock CHALLENGE.md
git log --oneline main..demo-deploy
```

A comparação serve para evidenciar a evolução já entregue. A `main` permanece no commit de referência indicado acima.
