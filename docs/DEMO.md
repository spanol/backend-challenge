# Carteira em Jogo — demonstração do processador financeiro

Acesse `https://jungle.subiu.dev` sem login. Uma sessão nova começa com **1.000 peers, uma carteira compartilhada e saldo fictício inicial de R$ 10.000,00, com rodadas automáticas**. Os peers representam sessões do mesmo titular, concorrendo pelo mesmo saldo. A página chama a API financeira protegida internamente; BET, WIN e LOSS seguem o contrato financeiro do serviço. O saldo é de simulação, sem valor ou saque real. Sessões já gravadas no journal são recuperadas sem troca automática de carteira ou configuração; crie uma sessão deliberadamente para mudar o estado financeiro demonstrado.

O navegador apresenta uma simulação independente de processamento financeiro para jogos. Créditos, saldos e prêmios são fictícios. Os peers não representam titulares diferentes: todos compartilham o `playerId` da carteira para obedecer à propriedade financeira. A página não afirma que existem jogadores externos, depósitos, pagamentos bancários ou operação com dinheiro real.

## Operação contínua

O modo independente legado pode renovar carteiras esgotadas para demonstrar rotação de contas de teste. Essa opção nunca se aplica à carteira compartilhada: peers não recebem carteira substituta nem créditos adicionais. Quando uma rodada compartilhada não confirma nenhuma aposta por `INSUFFICIENT_FUNDS`, o autoplay para com motivo explícito. Falhas de transporte preservam identidade e bloqueiam avanço até retry; não são confundidas com falta de saldo. Reversões de apostas antigas usam as identidades financeiras originais.

Cada rodada automática agenda uma aposta de **R$ 1,00 por peer**; no perfil padrão, até 1.000 BETs disputam a mesma carteira. O servidor mantém até 32 chamadas em voo e inicia o relógio de jogo depois de todas as confirmações. Os alvos variam entre 1,20×, 1,50×, 1,80×, 2,20×, 2,75×, 4,00× ou até o estouro. Um alvo abaixo do estouro gera WIN pelo valor contratado; as outras apostas geram LOSS sem novo débito. O saldo resultante de cada operação permanece na mesma carteira e no mesmo ledger.

Cada rodada nova recebe um ponto de estouro gerado no servidor com `crypto.randomInt`, persistido no journal antes de planejar operações. A distribuição produz perda instantânea em 1,00× em cerca de 1% das amostras e cauda decrescente até o limite de 100×. Isso elimina o ciclo repetido, mas não é prova provably-fair nem auditoria da fonte. Testes injetam uma sequência determinística. A demonstração usa somente créditos fictícios.

O painel mostra apostas confirmadas, peers no voo, saques, perdas, volume apostado e prêmios pagos. “Grupo atual” navega para a página do grupo que entrou. Pausar o autoplay suspende novas apostas, mas liquida as já aceitas. Uma reserva manual tem prioridade sobre a aposta automática do mesmo peer. Saldo compartilhado esgotado exige criar uma sessão nova; não há recarga automática.

Em mesas independentes, adicionar peers amplia o grupo automático na próxima rodada pela quantidade provisionada, até 8.000 por rodada. Na sessão compartilhada, os peers adicionados passam a disputar a mesma carteira e participam conforme o limite/cursor persistido. A rodada em andamento conserva suas apostas. Reservas manuais mantêm prioridade.

O journal conserva a rodada atual e a anterior, o cursor e contadores acumulados. A compactação acontece somente após encerrar operações e apostas. O histórico financeiro completo permanece no PostgreSQL, acessível por ledger e reconciliação. A nova sessão de apresentação começa com 1.000 peers por rodada; há no máximo 32 chamadas financeiras simultâneas. A duração da preparação depende da capacidade da API. Processamento em andamento mostra progresso; erro de confirmação mostra o controle de retomada.

O provisionamento inicial pode levar alguns minutos; a página e o dashboard ficam disponíveis durante o preparo. A operação começa depois de concluir as carteiras. Uma sessão existente de 8.000 peers pode receber `POST /demo/autoplay` com `enabled: true` e `peersPerRound: 8000`; a configuração vale para a próxima rodada e preserva carteiras, sessão e cursor. Reiniciar conserva a configuração persistida, mesmo quando o ambiente sugere outro grupo.

## Roteiro

O servidor avança continuamente por **confirmação das apostas → 3 segundos de contagem → voo e liquidação → 1,5 segundo de resultado → próxima rodada**. `/demo/dashboard` informa esses intervalos em `roundTiming`, também utilizado pelo benchmark. O relógio é do servidor; a página apenas mostra a contagem. Apostas feitas pela interface e novos peers ficam reservados no journal para a rodada seguinte e só entram quando ela abre. O pedido de aposta não debita a carteira; a operação financeira é planejada, persistida e enviada na abertura da rodada seguinte. Durante a preparação, uma BET já ativada pode ser cancelada. Uma reserva pode ser retirada antes de entrar. Sem operações financeiras pendentes, a mesa continua sozinha; uma falha que deixa resultado incerto pausa o avanço até o retry com a mesma identidade.

Não há limite fixo de 24 peers na mesa ou na bateria. O número efetivamente processável depende dos recursos e da duração do provisionamento das carteiras, em especial no modo independente. A mesa compartilhada permite estudar contenção de muitas apostas sobre a mesma carteira.

Depois do provisionamento, as rodadas avançam sozinhas. Adicione peers e reserve apostas para a rodada seguinte. Durante o voo, saque ou espere a perda. Uma BET ativa cancelada antes do voo gera REFUND; uma reserva retirada antes da ativação não gera transação financeira. Os controles de evidência mostram reconciliação e ledger da carteira; o painel técnico permite consultar replay e reversões. Antes de trocar a sessão, pause o autoplay e espere a liquidação. Uma sessão nova sugere 1.000 peers na mesma carteira fictícia com saldo inicial configurável, por padrão R$ 10.000,00; falta de saldo pausa a operação sem recarga.

No modo independente, N peers têm carteiras e identidades de titular próprias. No modo compartilhado, N sessões representam o mesmo titular e disputam a mesma carteira para evidenciar o lock financeiro. O servidor publicado chama uma API; os testes isolados exercitam três apps HTTP reais. A demo mantém intenções em journal persistente, com exclusão de processo, recuperação e retry. A idempotência financeira continua sendo garantida pelo PostgreSQL.

## Execução local

Com a API financeira disponível:

```sh
DEMO_API_URLS=http://127.0.0.1:3000 bun run demo:game
```

Abra `http://127.0.0.1:3200`. No PowerShell, defina `$env:DEMO_API_URLS` antes do comando. `DEMO_HOST`, `DEMO_PORT`, `DEMO_PUBLIC_ORIGIN` e `DEMO_JOURNAL_PATH` configuram o servidor. O perfil de sessão nova usa `DEMO_PEERS=1000`, `DEMO_WALLET_MODE=shared`, `DEMO_INITIAL_BALANCE=10000.00`, `DEMO_AUTOPLAY=true` e `DEMO_PEERS_PER_ROUND=1000`; selecione `DEMO_WALLET_MODE=independent` para carteiras separadas. O saldo precisa ser decimal positivo com duas casas; ele só é aplicado ao abrir carteiras, sem recarga posterior. `DEMO_AUTOPLAY=false` cria uma mesa manual. O construtor isolado `DemoTable` mantém valores próprios para os cenários de teste. Por padrão, o servidor usa loopback e `.tmp/decolagem-session.json`. Não apague o journal para resolver uma operação pendente: use retry ou reinicie para recuperação.

## Bateria pela demo

```powershell
$env:DEMO_BASE_URL = 'https://jungle.subiu.dev'
$env:DEMO_LOAD_PEERS = '24'
$env:DEMO_LOAD_ROUNDS = '6'
$env:DEMO_LOAD_PHASE_TIMEOUT_MS = '600000'
$env:DEMO_LOAD_OUTPUT = 'test-results/demo-load-public'
bun run test:demo
```

Pause as apostas automáticas, finalize a rodada atual antes da execução e não altere a mesa durante a bateria. O script aguarda o relógio automático; cada fase cria carteiras próprias e conserva todo o histórico financeiro. A bateria cobre BET, WIN, LOSS, REFUND, ROLLBACK, saque tardio, replay histórico, conflito e disputa de saldo. Confere saldo exato e reconciliação de cada carteira e termina com uma sessão manual pronta para apresentação. `demo-load.json` registra respostas e tempos; respostas 409 previstas fazem parte das verificações.

## Grafana do servidor

```sh
ssh -N -L 39333:127.0.0.1:39323 subiu
```

Abra `http://localhost:39333/d/distributed-wagering-overview` e use o usuário `admin` e a senha local do Grafana do servidor. A porta 39323 local pertence à outra stack. Selecione a janela da bateria para observar operações, rejeições, duplicatas, HTTP, CPU, memória, outbox, logs e traces da API financeira. A configuração atual de `compose.demo.yaml` limita o coordenador a 1 CPU e 512 MiB; a carga também consome recursos e não mede a capacidade máxima da API.

## Lista de peers

No desktop, o voo, a atividade financeira e a lista de jogadores formam uma coluna independente dos controles e da reconciliação. Os blocos ficam separados por 20 px, sem aguardar a altura do formulário lateral. Em telas estreitas, as colunas se empilham e os controles de paginação podem quebrar linha.

Interpretação: a mudança reduz o custo da tela sem alterar a quantidade de peers cadastrados ou a sessão. O navegador consulta `/demo/dashboard?offset=...`, que retorna uma página de 100 peers, os dados financeiros dessa página, contagens globais e as 30 operações recentes. A busca consulta `/demo/peer-options` quando o texto ou a seleção muda e mantém no máximo 100 opções renderizadas. O botão de aposta em lote envia uma única intenção `allPeers`; o servidor escolhe os peers ainda sem aposta agendada, sem receber uma lista de 20 mil IDs do navegador. `/demo/state` continua disponível com o estado completo para os scripts de diagnóstico.

O processamento usa índices em memória para peer, aposta e operação; o avanço da mesa consulta contadores de pendências e apostas abertas. As identidades das operações continuam gravadas no journal antes dos débitos. Um lote concluído gera um checkpoint do journal; se um bloco de operações continuar sem resultado, o journal é salvo e o envio pausa para retry com as mesmas identidades.

## Deploy

`compose.demo.yaml` complementa `compose.subiu.yaml` no projeto `jungle-server`. A revisão atual usa a imagem validada em `JUNGLE_IMAGE` e `JUNGLE_DEMO_IMAGE`, com migrations aplicadas antes de atualizar API e demo. Inclua o override ao operar `app-observed` e `postgres`: ele define 1,5 CPU e 1 GiB para cada um e habilita `DEMO_EVENT_AUDIT=true` somente neste perfil de apresentação. Use `up -d --no-deps --wait app-observed` e, em uma fronteira liquidada, `up -d --no-deps --wait demo`. O volume `server-demo` conserva o journal. O router público tem prioridade 150 somente para página, assets e `/demo/*`, sem middleware de autenticação. O serviço financeiro mantém o middleware `jungle-access`.

O override também define 2 GiB para o LocalStack. Na atualização desta instalação, os limites das dependências são aplicados aos containers existentes com `docker update`, preservando identidade, filas e contador de reinício; o deploy não recria PostgreSQL ou LocalStack. Em instalações novas, o Compose aplica os limites ao criar as dependências. O consumidor opcional confere cada envelope com a outbox e grava o recibo `demo-event-audit` no PostgreSQL antes do ACK na SQS. Falha de commit ou de ACK conserva a mensagem para nova entrega; duplicatas são conferidas e deduplicadas. Fora desse override, o consumidor permanece desabilitado. Acompanhe profundidade da fila, recibos e outbox: drenagem pontual não comprova estabilidade prolongada.

## Validação do incremento

O reposicionamento e o saldo de abertura configurável foram verificados localmente em Bun 1.4.2 com `bun run verify:full`: 175 testes aprovados, 58.634 assertions, zero falhas e um skip esperado pela harness Windows na prova de SIGTERM. A integração passou por duas rodadas sequenciais de quatro peers na mesma carteira e reconciliou R$ 98,70 sem divergência; outra abriu R$ 10.000,00 por HTTP e confirmou reconciliação zero. Detalhes e limpeza da stack isolada estão em [VALIDATION](VALIDATION.md#carteira-compartilhada-e-reposicionamento--06102026). O resultado gerado pelo RNG real é persistido no journal e os testes usam injeção determinística; a demo não afirma ser provably-fair.

O primeiro release de portfólio (`jungle-challenge:demo-portfolio-20261006-ea21767`) abriu uma carteira compartilhada de R$ 100,00 para 100 apostas por rodada; a carteira se esgotou após duas rodadas e o autoplay pausou sem criar saldo. O release de bankroll `jungle-challenge:demo-portfolio-bankroll-20261006-4480601` passou a usar `DEMO_INITIAL_BALANCE=10000.00`. O release público atual `jungle-challenge:demo-portfolio-1000-20261006-2ee02e9` conserva esse saldo fictício e inicia com 1.000 peers apostando R$ 1,00 cada rodada na mesma carteira, com até 32 confirmações financeiras em voo. A sessão existente foi mantida e ampliada; não houve recarga nem troca de carteira. A [validação de produção](VALIDATION.md#reposicionamento-da-demo-em-produção--06102026) registra backups, comandos, saúde, carga observada e reconciliação.

O release **`jungle-challenge:demo-cadence-20261005-6fc109d`** foi publicado em 05/10 com as mesmas **1.000 carteiras e 1.000 peers por rodada**. A revisão passou em Docker/Linux: **170 testes, 58.356 assertions, zero falhas/skips**, incluindo concorrência financeira, histórico de 500 operações e sete provas reais de commit/ACK do consumidor de eventos. Três rodadas públicas reduziram a mediana de preparação de **33,014 para 7,363 s** e o tempo até liquidar de **64,988 para 17,192 s**, na população existente. O ciclo medido exclui os 1,5 s de resultado. Os prêmios exatos e todas as carteiras reconciliaram; a outbox assíncrona tinha 421 eventos da sessão ao encerrar, e a leitura posterior encontrou zero pendentes globais. A preparação aguarda todas as confirmações. O [registro atual](VALIDATION.md#cadência-de-1000-e-entrega-auditada-de-eventos--05102026) contém ambiente, comandos, correção da primeira execução de testes, restrição do GitHub Actions e dados do deploy. A [capacidade documentada](DEMO-CAPACITY.md) conserva separadamente os resultados anteriores de 8k/4k/2k/1k. Os resultados abaixo pertencem às validações anteriores, incluindo o perfil inicial de 128 por rodada.

O gate Docker/Linux passou em 01/10/2026: **137 testes, 1.418 assertions, zero falhas e zero skips** (75 unidade, 51 integração e 11 concorrência). Os recursos isolados foram removidos pelo runner. Os 16 testes adicionais verificam a demo, incluindo perda de resposta após commit, recuperação, três APIs, disputa de saldo e Origin HTTPS. O ajuste posterior de feedback da interface passou em `verify`, com 75 testes e 344 assertions.

A bateria pública inicial passou com 651 chamadas, mas o monitor revelou OOM do Grafana no limite de 384 MiB. Após configurar 512 MiB e `GOMEMLIMIT=320MiB`, a repetição passou com **652 chamadas, 11 fases e 153 carteiras reconciliadas**. O monitor registrou 25 amostras sem ocorrências; os 38 containers da baseline permaneceram com as mesmas identidades e contadores de reinício durante a repetição. As quatro aplicações acompanhadas responderam sempre HTTP 200. A auditoria SQL final encontrou zero divergências, diários desbalanceados ou pendências de outbox.

Relatórios reais estão em `test-results/demo-subiu-20261001/`. A galeria `prints/index.html` agrupa **13 prints originais** com legendas, hashes e relatórios. O ZIP `provas-demo-subiu-20261001.zip` é independente da entrega anterior. Capturas de BET, REFUND, replay, conflito, WIN, ROLLBACK, LOSS e disputa de saldo foram produzidas pela interface pública; os painéis Grafana mostram a janela da repetição. As capturas da demo são de desktop.
