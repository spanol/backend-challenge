# Demo Decolagem

Acesse `https://jungle.subiu.dev` sem login. A configuração inicial da demo cria **1.000 jogadores com carteiras independentes**, saldo inicial de R$ 100,00 e jogo automático. O [comparativo de 8k, 4k, 2k e 1k](DEMO-CAPACITY.md) escolheu 1k pela cadência mais rápida. Sessões existentes são recuperadas com sua população e configuração. A página e `/demo/*` são públicos; a API financeira segue protegida no proxy e é chamada internamente pela demo. Os créditos são fictícios, os pontos de estouro são predefinidos e a mesa é compartilhada por todos os visitantes.

## Operação contínua

Em cada rodada do perfil de apresentação, **1.000 peers** entram com aposta de **R$ 1,00**, conforme escolha pelos resultados reais em 05/10/2026. A preparação envia todas as intenções em blocos de 32 chamadas simultâneas e aguarda resultados terminais; só depois começa a contagem de cinco segundos para o voo. O painel mostra o progresso global, independentemente da página de 100 jogadores. Os alvos automáticos variam entre 1,20×, 1,50×, 1,80×, 2,20×, 2,75×, 4,00× e permanecer até o estouro; só os alvos estritamente anteriores ao estouro recebem WIN. O prêmio usa exatamente o alvo contratado, inclusive se o tick chegar atrasado ou se uma resposta de WIN demorar até depois do estouro. Os demais recebem LOSS, sem novo débito. Jogadores sem saldo suficiente ficam de fora, sem crédito artificial.

O painel mostra apostas confirmadas, jogadores no voo, saques, perdas, volume apostado e prêmios pagos. “Grupo atual” navega para a página do grupo que entrou. “Pausar próximas apostas” suspende a entrada automática e mantém a liquidação das apostas já aceitas. Uma reserva manual tem prioridade sobre a aposta automática daquele jogador. A operação automática exige carteiras independentes; o modo compartilhado continua disponível para demonstrações manuais de disputa de saldo.

O journal conserva a rodada atual e a anterior, o cursor e contadores acumulados. A compactação acontece somente após encerrar operações e apostas. O histórico financeiro completo permanece no PostgreSQL, acessível por ledger e reconciliação. A participação padrão é de 1.000 por rodada; há no máximo 32 chamadas financeiras simultâneas. A duração da preparação depende da capacidade da API. Processamento em andamento mostra progresso; erro de confirmação mostra o controle de retomada.

O provisionamento inicial pode levar alguns minutos; a página e o dashboard ficam disponíveis durante o preparo. A operação começa depois de concluir as carteiras. Uma sessão existente de 8.000 peers pode receber `POST /demo/autoplay` com `enabled: true` e `peersPerRound: 8000`; a configuração vale para a próxima rodada e preserva carteiras, sessão e cursor. Reiniciar conserva a configuração persistida, mesmo quando o ambiente sugere outro grupo.

## Roteiro

O servidor avança continuamente por **confirmação das apostas → 5 segundos de contagem → voo e liquidação → 3,7 segundos de resultado → próxima rodada**, seguindo a cadência da mesa Aviator do `backend-gateway`. O relógio é do servidor; a página apenas mostra a contagem. Apostas feitas pela interface e novos peers ficam reservados no journal para a rodada seguinte e só entram quando ela abre. O pedido de aposta não debita a carteira; a operação financeira é planejada, persistida e enviada na abertura da rodada seguinte. Durante a preparação, uma BET já ativada pode ser cancelada. Uma reserva pode ser retirada antes de entrar. Sem operações financeiras pendentes, a mesa continua sozinha; uma falha que deixa resultado incerto pausa o avanço até o retry com a mesma identidade.

Não há limite fixo de 24 peers na mesa ou na bateria. O número efetivamente processável depende dos recursos e da duração do provisionamento das carteiras, em especial no modo independente. A mesa compartilhada permite estudar contenção de muitas apostas sobre a mesma carteira.

Depois do provisionamento, as rodadas avançam sozinhas. Adicione peers e reserve apostas para a próxima rodada. Durante o voo, saque ou espere a perda. Uma BET ativa cancelada antes do voo gera REFUND; uma reserva retirada antes da ativação não gera transação financeira. Os controles de evidência mostram ledger, reconciliação e resultado histórico; repetir conserva esse resultado, mesmo após o saldo atual mudar. Reverter um saque envia ROLLBACK. Pause as apostas automáticas e finalize a rodada antes de usar “Nova sessão” para mudar a quantidade de jogadores ou experimentar o modo compartilhado, em que apostas de 80.00 disputam uma carteira de 100.00.

No modo independente, N peers têm carteiras e identidades de jogador próprias. No modo compartilhado, N agentes disputam a mesma carteira e identidade para evidenciar o lock financeiro. O servidor publicado chama uma API; os testes isolados exercitam três apps HTTP reais. A demo mantém intenções em journal persistente, com exclusão de processo, recuperação e retry. A idempotência financeira continua sendo garantida pelo PostgreSQL.

## Execução local

Com a API financeira disponível:

```sh
DEMO_API_URLS=http://127.0.0.1:3000 bun run demo:game
```

Abra `http://127.0.0.1:3200`. No PowerShell, defina `$env:DEMO_API_URLS` antes do comando. `DEMO_HOST`, `DEMO_PORT`, `DEMO_PUBLIC_ORIGIN` e `DEMO_JOURNAL_PATH` configuram o servidor. `DEMO_PEERS=1000`, `DEMO_AUTOPLAY=true` e `DEMO_PEERS_PER_ROUND=1000` configuram o perfil inicial; `DEMO_AUTOPLAY=false` inicia uma mesa manual. Para retomar 8k, configure explicitamente os dois valores como `8000`, em uma nova sessão ou atualize o grupo de uma sessão com população suficiente. O padrão de grupo do construtor isolado `DemoTable` continua em 8.000; `demo/main.ts` fornece o perfil de apresentação. Por padrão, ele usa loopback e `.tmp/decolagem-session.json`. Não apague o journal para resolver uma operação pendente: use retry ou reinicie para recuperação.

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

`compose.demo.yaml` complementa `compose.subiu.yaml` no projeto `jungle-server`. Defina `JUNGLE_DEMO_IMAGE` para a imagem com a demo e execute `up -d --no-deps --wait demo` com os dois arquivos. O volume `server-demo` conserva o journal. O router público tem prioridade 150 somente para página, assets e `/demo/*`, sem middleware de autenticação. O serviço financeiro mantém o middleware `jungle-access` e continua na imagem já validada.

O override também define 2 GiB para o LocalStack, devido ao acúmulo de eventos da operação contínua. Na atualização desta instalação, o limite é aplicado ao container existente com `docker update --memory 2g --memory-swap 3g jungle-server-localstack-1`, preservando identidade, filas e contador de reinício. Em instalações novas, o Compose aplica o limite ao criar a dependência. A fila de eventos deve ser acompanhada porque este perfil não acrescenta um consumidor de eventos.

## Validação do incremento

O release `jungle-challenge:demo-participation-20261005-d6dfe2a` está publicado com **8.000 peers por rodada**, preservando a sessão existente. O commit passou em Docker/Linux: **155 testes, 58.053 assertions, zero falhas/skips**, incluindo uma rodada de 8.000 carteiras reais em três APIs, liquidação e reconciliação integral. A preparação aguarda todas as confirmações e pode levar minutos conforme a capacidade da API. O [registro atual](VALIDATION.md#participação-de-8000-peers-por-rodada--05102026) contém ambiente, comandos, restrição de cobrança do GitHub Actions e dados do deploy. Os resultados abaixo pertencem às validações anteriores, incluindo o perfil inicial de 128 por rodada.

O gate Docker/Linux passou em 01/10/2026: **137 testes, 1.418 assertions, zero falhas e zero skips** (75 unidade, 51 integração e 11 concorrência). Os recursos isolados foram removidos pelo runner. Os 16 testes adicionais verificam a demo, incluindo perda de resposta após commit, recuperação, três APIs, disputa de saldo e Origin HTTPS. O ajuste posterior de feedback da interface passou em `verify`, com 75 testes e 344 assertions.

A bateria pública inicial passou com 651 chamadas, mas o monitor revelou OOM do Grafana no limite de 384 MiB. Após configurar 512 MiB e `GOMEMLIMIT=320MiB`, a repetição passou com **652 chamadas, 11 fases e 153 carteiras reconciliadas**. O monitor registrou 25 amostras sem ocorrências; os 38 containers da baseline permaneceram com as mesmas identidades e contadores de reinício durante a repetição. As quatro aplicações acompanhadas responderam sempre HTTP 200. A auditoria SQL final encontrou zero divergências, diários desbalanceados ou pendências de outbox.

Relatórios reais estão em `test-results/demo-subiu-20261001/`. A galeria `prints/index.html` agrupa **13 prints originais** com legendas, hashes e relatórios. O ZIP `provas-demo-subiu-20261001.zip` é independente da entrega anterior. Capturas de BET, REFUND, replay, conflito, WIN, ROLLBACK, LOSS e disputa de saldo foram produzidas pela interface pública; os painéis Grafana mostram a janela da repetição. As capturas da demo são de desktop.
