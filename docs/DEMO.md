# Carteira em Jogo — demonstração do processador financeiro

Acesse `https://jungle.subiu.dev` sem login. O novo perfil sugerido é **Operação de jogo**: 1.000 jogadores, uma carteira por jogador e saldo fictício inicial de R$ 100,00 por carteira, com rodadas automáticas. A página chama a API financeira protegida internamente; BET, WIN, LOSS e REFUND seguem o contrato financeiro do serviço. Este documento descreve a implementação; a versão efetivamente publicada está registrada em [VALIDATION](VALIDATION.md).

Créditos, saldos e prêmios são fictícios. No perfil de jogo, cada participante tem `playerId` e wallet próprios. Em **Disputa de saldo**, os participantes são sessões do mesmo titular, com uma única wallet/player. O perfil compartilhado estuda contenção extrema. Sessões existentes conservam carteira, configuração e política de entrada; atualizar o runtime não converte uma sessão compartilhada em carteiras independentes. Crie uma sessão explicitamente para escolher o novo perfil.

## Operação contínua

Cada rodada automática planeja até **1.000 apostas de R$ 1,00**, com no máximo 32 chamadas financeiras em voo no total, incluindo entrada, saques e estornos. No perfil de jogo, a janela fecha em cinco segundos. Somente respostas BET/PROCESSED recebidas estritamente antes do prazo entram no voo. Intenções ainda não enviadas expiram sem débito; confirmações tardias recebem REFUND integral e não podem ganhar nem perder na rodada. Um resultado incerto é resolvido pela identidade original e, se confirmar depois do prazo, é estornado. Retry nunca estende a janela.

O voo começa no prazo persistido mesmo com confirmações pendentes. A ordem de entrada gira por um cursor persistido a partir das intenções despachadas na rodada anterior, evitando privilegiar sempre o início da lista quando a janela não comporta todos. Alvos automáticos variam entre 1,20×, 1,50×, 1,80×, 2,20×, 2,75×, 4,00× ou até o estouro. Apostas admitidas com alvo abaixo do crash geram WIN pelo valor contratado; as demais geram LOSS sem novo débito. Uma operação WIN ainda incerta impede outro WIN ou LOSS para a mesma aposta. A próxima rodada espera a conclusão de todas as operações e estornos. Uma recusa terminal de estorno fica visível e bloqueia outra rodada; retry não apaga esse diagnóstico. O perfil compartilhado e sessões antigas sem política de entrada conservam a confirmação integral seguida de três segundos de contagem.

O perfil público não renova carteiras nem repõe saldo. Jogadores sem saldo deixam de apostar. A renovação independente legada exige `DEMO_RENEW_EXHAUSTED_WALLETS=true` e permanece disponível para ensaios de contas de teste. Essa opção nunca se aplica à carteira compartilhada. Uma rodada compartilhada inteiramente recusada por `INSUFFICIENT_FUNDS` pausa o autoplay. Falhas de transporte conservam identidades para retry e impedem iniciar outra rodada com operações abertas.

Cada rodada recebe um ponto de estouro gerado no servidor com `crypto.randomInt`, persistido no journal antes de planejar operações. A distribuição produz perda instantânea em 1,00× em cerca de 1% das amostras e cauda decrescente até o limite de 100×. Isso não é prova provably-fair nem auditoria da fonte. Testes injetam uma sequência determinística.

O painel mostra apostas admitidas, participantes no voo, saques, perdas, volume apostado, prêmios pagos, intenções fora da janela e estornos pendentes. Um débito tardio não conta como volume apostado no jogo, mas permanece auditável com seu estorno no ledger. “Grupo atual” navega para a página do grupo planejado. Pausar o autoplay suspende novas rodadas automáticas, mas liquida as apostas já aceitas. Reservas manuais mantêm prioridade.

Adicionar participantes reserva os assentos para a rodada seguinte. No modo independente, o grupo automático cresce pela quantidade incorporada até 8.000 por rodada; no compartilhado, mantém o limite/cursor configurado. O journal conserva a rodada atual e a anterior, o cursor e contadores acumulados. Compactação exige o encerramento de operações e apostas. O histórico financeiro completo permanece no PostgreSQL. A demo mantém exclusão de processo, recuperação e retry; a idempotência financeira é garantida pelo banco.

## Roteiro

No perfil de jogo, a sequência é **janela de entrada fixa → voo → liquidação e estornos → 1,5 segundo de resultado → próxima rodada**. A janela é configurável por `DEMO_BETTING_WINDOW_MS`; `/demo/dashboard` informa sua duração em `roundTiming.countdownMilliseconds`. Apostas feitas pela interface e novos participantes ficam reservados para a próxima rodada. Reservar não debita a carteira. Antes do fechamento, uma BET confirmada pode ser cancelada. Uma reserva pode ser retirada antes de ser ativada.

A animação acompanha o relógio do servidor. Não há garantia de que todas as 1.000 intenções caibam na janela. Os comparativos históricos de confirmação integral não medem a capacidade deste perfil. Falhas incertas aparecem como operações pendentes; confirmações tardias aparecem como fora da janela e exigem estorno.

Selecione **Operação de jogo** ou **Disputa de saldo** ao criar uma sessão. Os controles de evidência mostram saldo, reconciliação e ledger do participante selecionado; o painel técnico permite consultar replay e reversões. Antes de trocar de perfil, pause o autoplay e espere a liquidação. Criar uma sessão abre novas carteiras fictícias e preserva o histórico financeiro anterior no PostgreSQL. O servidor publicado usa uma API; os testes isolados exercitam três apps HTTP reais.

## Execução local

Com a API financeira disponível:

```sh
DEMO_API_URLS=http://127.0.0.1:3000 bun run demo:game
```

Abra `http://127.0.0.1:3200`. No PowerShell, defina `$env:DEMO_API_URLS` antes do comando. `DEMO_HOST`, `DEMO_PORT`, `DEMO_PUBLIC_ORIGIN` e `DEMO_JOURNAL_PATH` configuram o servidor. O perfil de sessão nova usa `DEMO_PEERS=1000`, `DEMO_WALLET_MODE=independent`, `DEMO_INITIAL_BALANCE=100.00`, `DEMO_AUTOPLAY=true` e `DEMO_PEERS_PER_ROUND=1000`; use `DEMO_WALLET_MODE=shared` para disputa de saldo. A janela de entrada usa `DEMO_BETTING_WINDOW_MS=5000`, entre 1.000 e 60.000 ms. A renovação de carteiras é desativada por padrão. O saldo precisa ser decimal positivo com duas casas; ele só é aplicado ao abrir carteiras, sem recarga posterior. `DEMO_AUTOPLAY=false` cria uma mesa manual. O construtor isolado `DemoTable` mantém valores próprios para os cenários de teste. Por padrão, o servidor usa loopback e `.tmp/decolagem-session.json`. Não apague o journal para resolver uma operação pendente: use retry ou reinicie para recuperação.

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

O release público atual `jungle-challenge:demo-game-window-20261006-v1`, fonte `d379f6e`, usa **1.000 jogadores com carteiras individuais de R$ 100,00 fictícios** e janela de entrada de **cinco segundos**, sem renovação ou reposição. O voo inicia sem esperar todas as confirmações; somente apostas confirmadas no prazo participam e débitos tardios são estornados. A sessão compartilhada anterior foi pausada e liquidada antes da troca, com backup de seu journal e histórico financeiro preservado. A imagem passou no gate completo em Linux: **187 testes, 59.263 assertions, zero falhas/skips**. Três rodadas observadas encerraram sem pendências e as 1.000 carteiras reconciliaram sem divergências. O ciclo completo ainda espera a liquidação real. A [validação atual](VALIDATION.md#operação-de-jogo-com-janela-de-entrada--06102026) registra o deploy e seus limites.

Historicamente, o primeiro release de portfólio (`jungle-challenge:demo-portfolio-20261006-ea21767`) abriu uma carteira compartilhada de R$ 100,00 para 100 apostas por rodada; a carteira se esgotou após duas rodadas e o autoplay pausou sem criar saldo. O release de bankroll `jungle-challenge:demo-portfolio-bankroll-20261006-4480601` passou a usar `DEMO_INITIAL_BALANCE=10000.00`. O release anterior `jungle-challenge:demo-portfolio-1000-20261006-2ee02e9` conservou esse saldo fictício e iniciou com 1.000 peers apostando R$ 1,00 cada rodada na mesma carteira, com até 32 confirmações financeiras em voo. A sessão existente foi mantida e ampliada; não houve recarga nem troca de carteira nessa atualização. A [validação histórica](VALIDATION.md#reposicionamento-da-demo-em-produção--06102026) registra backups, comandos, saúde, carga observada e reconciliação.

O release **`jungle-challenge:demo-cadence-20261005-6fc109d`** foi publicado em 05/10 com as mesmas **1.000 carteiras e 1.000 peers por rodada**. A revisão passou em Docker/Linux: **170 testes, 58.356 assertions, zero falhas/skips**, incluindo concorrência financeira, histórico de 500 operações e sete provas reais de commit/ACK do consumidor de eventos. Três rodadas públicas reduziram a mediana de preparação de **33,014 para 7,363 s** e o tempo até liquidar de **64,988 para 17,192 s**, na população existente. O ciclo medido exclui os 1,5 s de resultado. Os prêmios exatos e todas as carteiras reconciliaram; a outbox assíncrona tinha 421 eventos da sessão ao encerrar, e a leitura posterior encontrou zero pendentes globais. A preparação aguarda todas as confirmações. O [registro atual](VALIDATION.md#cadência-de-1000-e-entrega-auditada-de-eventos--05102026) contém ambiente, comandos, correção da primeira execução de testes, restrição do GitHub Actions e dados do deploy. A [capacidade documentada](DEMO-CAPACITY.md) conserva separadamente os resultados anteriores de 8k/4k/2k/1k. Os resultados abaixo pertencem às validações anteriores, incluindo o perfil inicial de 128 por rodada.

O gate Docker/Linux passou em 01/10/2026: **137 testes, 1.418 assertions, zero falhas e zero skips** (75 unidade, 51 integração e 11 concorrência). Os recursos isolados foram removidos pelo runner. Os 16 testes adicionais verificam a demo, incluindo perda de resposta após commit, recuperação, três APIs, disputa de saldo e Origin HTTPS. O ajuste posterior de feedback da interface passou em `verify`, com 75 testes e 344 assertions.

A bateria pública inicial passou com 651 chamadas, mas o monitor revelou OOM do Grafana no limite de 384 MiB. Após configurar 512 MiB e `GOMEMLIMIT=320MiB`, a repetição passou com **652 chamadas, 11 fases e 153 carteiras reconciliadas**. O monitor registrou 25 amostras sem ocorrências; os 38 containers da baseline permaneceram com as mesmas identidades e contadores de reinício durante a repetição. As quatro aplicações acompanhadas responderam sempre HTTP 200. A auditoria SQL final encontrou zero divergências, diários desbalanceados ou pendências de outbox.

Relatórios reais estão em `test-results/demo-subiu-20261001/`. A galeria `prints/index.html` agrupa **13 prints originais** com legendas, hashes e relatórios. O ZIP `provas-demo-subiu-20261001.zip` é independente da entrega anterior. Capturas de BET, REFUND, replay, conflito, WIN, ROLLBACK, LOSS e disputa de saldo foram produzidas pela interface pública; os painéis Grafana mostram a janela da repetição. As capturas da demo são de desktop.
