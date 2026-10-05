# Validação executada

## Publicação com 8.000 peers — 05/10/2026

O commit `e236bc1` foi construído a partir de um `git archive` limpo, preservando as mudanças de carga já staged. A imagem `jungle-challenge:demo-continuous-20261005-e236bc1` passou em Docker/Linux com Bun 1.4.2: `bun run verify:full`, **146 testes, 1.726 assertions, zero falhas e zero skips** (83 unidade, 52 integração e 11 concorrência). Typecheck, lint e formatação passaram entre 03:10:44 e 03:12:35 UTC. A infraestrutura exclusiva `jungle-demo-release-20261005` usou PostgreSQL 17.6 e LocalStack 4.9.2; o runner confirmou limpeza completa, e `docker compose -f test-results/demo-production-20261005/context/compose.yaml -p jungle-demo-release-20261005 down -v --remove-orphans` removeu seus containers, volumes e rede. Os relatórios locais estão em `test-results/demo-production-20261005/linux/`.

No Subiu, `docker compose --env-file <raiz>/.env -f <base-existente>/compose.subiu.yaml -f <release>/compose.demo.yaml -p jungle-server up -d --no-deps --wait demo` publicou somente a demo às 03:13:33 UTC. O journal e a configuração anterior foram preservados em backup antes da troca. Depois da recuperação da sessão antiga, `POST /demo/session?view=dashboard` com `count: 8000`, `mode: independent` e `autoplay: true` criou 8.000 carteiras reais da demo, com créditos fictícios, e iniciou as apostas. O provisionamento começou às 03:13:47 e a sessão já estava em voo às 03:15:07 UTC.

Foram observadas seis rodadas consecutivas encerradas (2–7), com **128 BETs confirmadas por rodada**, WIN e LOSS, sem apostas abertas ou operação pendente ao final. O cursor avançou de 256 para 896. Na auditoria SQL de 03:16:42 UTC, as **8.000 carteiras** tinham saldo e versão coerentes com o ledger: zero divergências, saldos negativos, diários desbalanceados, transações pendentes/rejeitadas ou outbox não publicada. Foram contados 8.000 OPENING, 896 BET, 439 WIN e 457 LOSS; cinco carteiras também reconciliaram pela API. Essa observação cobre o início da rotação da população; não mede 8.000 apostas simultâneas nem um ciclo inteiro em produção.

A página pública respondeu HTTP 200 e foi conferida no Chrome: 8.000 peers, apostas automáticas ativas, saques/perdas e navegação para o grupo atual. A paginação 7.900 retornou Peer 7901–8000. Às 03:18:18 UTC, demo e API financeira estavam saudáveis, a demo sem reinício, `/demo/health` em 204 e `/health/ready` financeiro em 200. Os outros **40 containers** conservaram identidade, imagem e contagem de reinício. Os relatórios completos permanecem em `evidence/demo-continuous-20261005/` no servidor; o download desse pacote foi recusado pela revisão automática por conter dados financeiros e metadados de produção. Este registro contém somente resultados agregados.

## Demo com operação contínua — 04/10/2026

O perfil inicial configura 8.000 peers independentes, aposta automática de 1.00 BRL e grupos de 128 por rodada, com rotação persistente, saques variados, LOSS e pausa/retomada. O journal retém duas rodadas e contagens acumuladas. A unidade verifica a população de 8.000 e o tamanho do grupo; esse cenário usa a porta financeira controlada e não é uma medição de carga SQL.

`bun run verify:full` passou em Windows com Bun 1.4.2, 05/10/2026 02:51:38–02:53:42 UTC (04/10 em São Paulo). Typecheck, lint e formatação passaram; unidade: **85 aprovados**; integração: **55 aprovados**; concorrência: **10 aprovados**, com um skip previsto de SIGTERM no Windows. Nenhuma falha. A integração adicional percorre rodadas automáticas em três APIs HTTP reais, com PostgreSQL 17.6 e LocalStack 4.9.2, e confere valores exatos, ledger, reconciliação e replay.

Infraestrutura exclusiva: `docker compose --env-file .env.example -p jungle-demo-continuous-20261004 -f compose.yaml up -d postgres localstack --wait`, com `POSTGRES_PORT=55584` e `LOCALSTACK_PORT=4584`. O gate recebeu URLs de banco e SQS dessas portas e criou seus próprios bancos/filas. `resources-all.json` confirmou limpeza completa e nenhum recurso pendente. Relatórios preservados em `test-results/demo-continuous-20261004/`: `verify-full.json`, `resources-all.json`, `all.junit.xml` e `demo-continuous-verify.log`. A captura PowerShell retornou status 1 ao tratar stderr nativo como `NativeCommandError`; o relatório do gate e todos os filhos Bun registraram exit 0 e PASS. Ao terminar, `docker compose --env-file .env.example -p jungle-demo-continuous-20261004 -f compose.yaml down -v --remove-orphans` removeu exclusivamente os containers, volumes e rede criados nesta execução (exit 0).

A prévia da interface foi inspecionada no Chrome, em desktop e viewport de 390×844, com fixture controlada de 8.000 peers: pausa/retomada e navegação para o grupo atual funcionaram. Essa fixture serve somente à interface; as provas financeiras acima usam infraestrutura real. Após os ajustes de layout e rótulos, `bun run check` passou (exit 0), 05/10/2026 02:56:25–02:57:12 UTC; relatório `verify-static.json` preservado na mesma pasta. Ao encerrar essa validação local, a alteração ainda não havia sido publicada no Subiu; a publicação e a observação posteriores estão registradas acima.

## Capacidade online da demo — 03/10/2026

No host `subiu-sm`, aumentei sem reinício a cota de CPU de `jungle-server-demo-1` para 1 CPU (antes 0,5) e de `jungle-server-localstack-1` para 1 CPU (antes 0,75), usando `docker update --cpus 1.0`. Os limites persistentes foram atualizados nos Compose de release ativos; cópias anteriores estão ao lado com o sufixo `.pre-cpu-increase-20261003`. Os limites de memória permaneceram em 512 MiB para a demo e 768 MiB para LocalStack.

Antes do ajuste, em uma janela de aproximadamente 18 segundos, `cpu.stat` registrou na demo mais 61 throttles em 259 períodos (+3,30 s throttled) e no LocalStack mais 15 em 110 (+0,36 s). Depois do ajuste, em outra janela semelhante, a demo registrou mais 16 em 252 (+0,08 s) e o LocalStack mais 5 em 132 (+0,004 s). `app-observed` e Postgres não tiveram aumento nos contadores de throttling nesse intervalo. Após a mudança, ambos os contêineres continuaram `healthy`, com os mesmos IDs e zero reinícios; `docker compose config --quiet` passou para os dois arquivos de release. Uso observado: demo 98,6 MiB/512 MiB e LocalStack 485,3 MiB/768 MiB.

Esta alteração amplia a folga de CPU para picos; não foi executado um novo teste de carga de 20 mil peers. A imagem local `jungle-challenge:demo-stability-20261003`, que altera a leitura da dashboard e o enfileiramento em lote, não foi aplicada em produção: a última leitura da sessão mostrou operações financeiras incompletas, e reiniciar o processo chamaria a recuperação do journal. Nenhum retry, replay, settlement ou refund foi executado. A instabilidade durante uma nova rodada ainda precisa ser reavaliada depois de resolver esse estado financeiro sem reprocessamento automático.

## Paginação da lista da demo — 03/10/2026

Interpretação: o pedido para reduzir o peso da lista trata da interface; a quantidade cadastrada e a sessão persistente permanecem intactas. A tabela mostra 100 peers por página. O seletor de jogador busca por nome ou ID e mantém no máximo 100 opções no DOM, inclusive quando preserva a seleção atual. O render não cria a lista inteira nem serializa o roster completo a cada polling. `CHALLENGE.md` e o código da API financeira não mudaram; banco e fila não foram recriados, e o volume persistente do journal foi preservado.

No Windows com Bun 1.4.2 passaram `bun run typecheck`, `bun run lint`, `bun run --bun prettier --check demo/public/client.ts demo/public/index.html demo/public/style.css docs/DEMO.md` e `git diff --check`. A suíte de testes não foi executada.

`docker.exe build --platform linux/amd64 -t jungle-challenge:demo-peer-pagination-20261003 .` passou. A imagem tem digest `sha256:502049e873117a81b7d2dd9e146dd19c99214db3f1c6782b7bdebda712d77537`. O arquivo transferido (`114.967.040` bytes) conferiu com SHA-256 `dc376b8281817882addb56599271d43581fd4faf0d18c6308c0ddb6b80af3c9a` no host `subiu-sm`. Compose 5.3.0 passou `config --quiet`; no projeto `jungle-server`, `up -d --no-deps --wait demo` recriou somente `jungle-server-demo-1`, healthy, sem restart. O volume `jungle-server_server-demo` continua montado em `/app/.tmp`. A API financeira permaneceu com o mesmo ID (`b1824ef600bf914a746176f4314c4bef86117ac00c7c5ced17ccc28c571ff9f0`), healthy e com zero restarts.

Após o deploy, `/`, `/client.js`, `/style.css` e `/demo/state` retornaram HTTP 200 sem credenciais. A resposta pública confirmou os seletores da busca e paginação nos assets publicados. A sessão conservou 10.106 peers, zero pendentes, zero apostas ativas/em envio e zero erros não resolvidos; nenhuma operação financeira foi submetida.

## Demo pública sem autenticação — 02/10/2026

No rollout inicial do router, antes da atualização do frontend, a release `20261001-demo-52e850a` recebeu somente a alteração em `compose.demo.yaml`: removido `jungle-access` de página, assets e `/demo/*`. A API financeira segue com BasicAuth no router de `compose.subiu.yaml`; naquele ponto, o container da demo usava `jungle-challenge:demo-20261001-ui` (`sha256:da6e960ec23730fe2fca1a0f7e2d83934e943c716cb65d79a299ca2133bc547c`).

No host `subiu-sm`, Bun não foi reconstruído porque o ajuste é de configuração Traefik. `docker compose --env-file /home/subiu-sm/apps/jungle-challenge/.env -f /home/subiu-sm/apps/jungle-challenge/releases/20261001-demo-52e850a/compose.subiu.yaml -f /home/subiu-sm/apps/jungle-challenge/releases/20261001-demo-52e850a/compose.demo.yaml -p jungle-server config --quiet` passou. O mesmo projeto executou `up -d --no-deps --wait demo`; somente `jungle-server-demo-1` foi recriado e ficou healthy.

Smoke HTTP sem Authorization depois do deploy: `/` 200, `/demo/state` 200 e `/wallets/sentinel` 401. `docker inspect` confirmou a ausência do label de middleware no router `jungle-demo` e a permanência do volume `jungle-server_server-demo` montado em `/app/.tmp`. Antes da mudança, `/` retornava 401 sem credenciais. Não foram submetidas operações financeiras nem alteradas a API, o banco ou a fila.

## Início automático — deploy — 02/10/2026

`DemoTable.recover()` agora cria seis peers com carteiras independentes quando não existe journal salvo; journals existentes continuam sendo recuperados. A tela informa que a mesa inicia sozinha e reserva “Nova sessão” para reconfiguração. Windows local, Bun 1.4.2: `bun run typecheck`, `bun run lint`, `bun run --bun prettier --check demo/table.ts demo/public/index.html docs/DEMO.md docs/VALIDATION.md` e `git diff --check` passaram. Os testes automatizados não foram executados.

`docker.exe build --platform linux/amd64 -t jungle-challenge:demo-autostart-20261002 .` passou e produziu a imagem `sha256:e5d5b5e0fd122330c5dc6ea88357a8a1a77b35f324da349ee20e2bd17f6319e1`. O tar local tinha 114.963.456 bytes e SHA-256 `715c1c23aee5423021ddd42f6c9e7f452604b21dc664a36c628116f762d41584`; o checksum conferiu no host após a transferência aprovada. A imagem foi carregada e `JUNGLE_DEMO_IMAGE` atualizado para `jungle-challenge:demo-autostart-20261002`. No host `subiu-sm`, Bun 1.4.2 e Compose 5.3.0, passaram estes comandos:

```sh
docker compose --env-file /home/subiu-sm/apps/jungle-challenge/.env -f /home/subiu-sm/apps/jungle-challenge/releases/20261001-demo-52e850a/compose.subiu.yaml -f /home/subiu-sm/apps/jungle-challenge/releases/20261001-demo-52e850a/compose.demo.yaml -p jungle-server config --quiet
docker compose --env-file /home/subiu-sm/apps/jungle-challenge/.env -f /home/subiu-sm/apps/jungle-challenge/releases/20261001-demo-52e850a/compose.subiu.yaml -f /home/subiu-sm/apps/jungle-challenge/releases/20261001-demo-52e850a/compose.demo.yaml -p jungle-server up -d --no-deps --wait demo
```

Apenas `jungle-server-demo-1` foi recriado e ficou healthy.

Smoke público sem Authorization: `/` e `/demo/state` retornaram 200; `/wallets/sentinel` retornou 401. O HTML publicado agora contém “A mesa inicia automaticamente” e “Nova sessão”; o texto anterior “Criar nova sessão” não aparece mais. A consulta da mesa confirmou sessão ativa com seis peers na rodada 3, e `docker inspect` confirmou a imagem nova, a ausência do middleware no router `jungle-demo` e o volume persistente `jungle-server_server-demo`. O journal já tinha uma sessão antes da troca e foi preservado; o bootstrap de seis peers se aplica quando o journal está vazio. Nenhuma operação financeira foi submetida e a API, o banco e a fila não foram recriados. A suíte automatizada não foi executada.

## Carga pesada em três réplicas — 01/10/2026

A [bateria distribuída](DISTRIBUTED-LOAD.md) passou no local e no subiu com a mesma imagem Bun 1.4.2, PostgreSQL 17.6 e LocalStack 4.9.2. Cada host executou 19.000 comandos únicos pesados, além de 24 de aquecimento: 10.000 BETs/256 clientes/128 carteiras, 3.000 BETs em uma carteira, 1.000 comandos com duas chamadas HTTP e duas entregas SQS e 5.000 BETs durante SIGKILL/restart de uma API. Três processos, endereços SQL e pools independentes foram registrados; todas as réplicas consumiram SQS e publicaram outbox.

Zero falhas finais, status inesperados, divergências financeiras, diários desbalanceados, transações não terminais, entregas falhas ou eventos pendentes. Foram reconciliadas 260 carteiras por host, com saldo e versão esperados; os 408 replays adicionais conservaram resultados históricos. A disputa de saldo terminou com 100 aceites, 2.900 rejeições esperadas e saldo zero. A fase cruzada terminou com 1.000 inboxes e um efeito por comando. As 177 chaves locais e 227 do subiu com tentativas interrompidas pelo SIGKILL tiveram resposta 200 posterior pela mesma identidade.

O monitor registrou 196 amostras locais e 87 no subiu, sem ocorrências. As quatro aplicações sondadas no subiu responderam 200; RAM disponível mínima de 3.969,54 MiB. A comparação após a limpeza confirmou os 27 containers locais e 38 do servidor preservados. Os dois relatórios de recursos confirmaram remoção do banco/filas gerados; os dois projetos Compose foram removidos com seus volumes e nenhum container remanescente.

Comandos executados, quotas, vazão, percentis, lag/drenagem e limites estão em [DISTRIBUTED-LOAD](DISTRIBUTED-LOAD.md). Janela UTC em 02/10: local 00:00:00–00:18:09; subiu 00:00:05–00:08:15. Artefatos ignorados pelo Git em `test-results/distributed-load-20261001/{local,server}/`, com galeria `index.html`, gráficos derivados, séries Prometheus, traces Tempo, logs e manifests SHA-256. A implementação financeira, as migrations, `CHALLENGE.md` e `bun.lock` conservaram os arquivos do commit-base `959ef08`.

O gate completo da imagem passou em Docker/Linux de **23:56:53.210 a 23:59:02.341 UTC de 01/10**: typecheck, lint, formatação e **137 testes/1.425 assertions** (75 unidade/349, 51 integração/590, 11 concorrência/486), zero falhas/skips, migrations `up → down → up` e limpeza completa. Relatórios em `test-results/distributed-load-20261001/gate-2/`. O gate estático também passou no Windows com Bun 1.4.2.

O primeiro preflight falhou com duas conexões HTTP encerradas sem registro das chaves nas APIs e HTTP 400 na exportação Tempo por tags fora do formato logfmt. A harness passou a usar conexão HTTP nova por chamada e exportação logfmt, mantendo zero retries nas fases sem queda. O segundo preflight passou com 2.024 comandos, queda real, auditoria e limpeza completas. Ambas as execuções ficaram preservadas; não houve alteração financeira para obter o resultado.

A revisão posterior da guarda de isolamento acrescentou recusa de containers parados, volumes e redes preexistentes do projeto. Os três casos passaram com recursos vazios exclusivos, preservados até a limpeza deliberada; prova em `isolation-guard.json`. O gate completo foi repetido com os scripts/documentos atuais montados somente para leitura: **137 testes/1.425 assertions**, zero falhas/skips e limpeza completa, em `test-results/distributed-load-20261001/gate-3/`.

## Demo com rodadas automáticas — 01/10/2026

A demo agenda peers e apostas para a rodada seguinte, inicia cada voo pelo relógio do servidor e avança após exibir o resultado. O limite fixo de 24 peers foi removido. A identidade de cada BET é gravada no journal antes do envio financeiro; operações sem resposta confirmada pausam o avanço e são retomadas pela mesma identidade. A API financeira, as migrations e `bun.lock` não foram alterados.

No Windows local com Bun 1.4.2, `bun run typecheck`, `bun run lint`, `bun run --bun prettier --check` nos arquivos alterados e `git diff --check` passaram. `docker build -t jungle-challenge:demo-auto-20261001 .` produziu a imagem `sha256:4d27849af105637e3fcbb560c3919c44c3f253637630614873e9dbb7d86fb27e`. O tar transferido pela tailnet teve SHA-256 igual nos dois hosts (`690425b67d538012d89d6ff0986c4822987745ca4d01e8ffa5e8e303b59052c2`). O Compose foi validado com `config --quiet`; `up -d --no-deps --wait demo` recriou somente `jungle-server-demo-1`, que ficou healthy, preservando o volume `jungle-server_server-demo`.

Em leitura da mesa no subiu, a rodada passou de 4 (21:49:45 UTC) para 7 (21:50:29 UTC), sem bloqueio; a rota pública autenticada `/demo/state` respondeu HTTP 200 na rodada 10. O gate completo posterior passou conforme a seção de carga distribuída acima. As cargas diretas da API e os screenshots/reconciliações anteriores não medem a nova cadência nem 1.000 peers pela demo.

## Revisão final do enunciado — 01/10/2026

Revisão do commit-base `12adc9f`, com Docker/Linux local, Bun 1.4.2, PostgreSQL 17.6, LocalStack 4.9.2 e Keycloak 26.6.4 em stack descartável sem portas publicadas. `verify:full` passou de **20:30:46.654 a 20:35:29.483 UTC**: typecheck, lint, formatação e **137 testes/1.418 assertions** (75 unidade/344, 51 integração/588, 11 concorrência/486). O E2E Keycloak real passou em seguida com **15 testes/71 assertions**. Total: **152 testes, 1.489 assertions, zero falhas e zero skips**.

As oito migrations completaram `up → down → up` nos bancos exclusivos. Os relatórios das três suítes de infraestrutura confirmaram limpeza completa; a stack `jungle-final-audit-20261001` foi removida depois. O health público do subiu retornou `status: ok`, PostgreSQL e SQS disponíveis às 20:34:20.962 UTC. Relatórios em `test-results/final-audit-20261001/`; conferência por seção, comandos, identidade da imagem e limites em [FINAL-REVIEW](FINAL-REVIEW.md).

Não foi identificada lacuna obrigatória ou falha eliminatória nos cenários revisados. Foram corrigidos textos desatualizados sobre quantidade de testes, migrations e situação da demo, sem alteração de código financeiro. `CHALLENGE.md` conservou o SHA-256 original. Os experimentos de carga e telemetria anteriores foram revisados, sem repetir a carga nesta execução.

## Galeria das cargas maiores — 01/10/2026

A galeria visual foi ampliada com as cargas anteriores: **98.600 operações HTTP medidas entre os dois hosts**, até **256 clientes simultâneos**, cenários de carteira única e a rodada anterior de **1.000 comandos SQS únicos com 100 duplicados**. Inclui séries de CPU/RSS/event loop/outbox durante carga e recuperação, latência do cliente, auditorias SQL e acesso aos vinte relatórios finais. Consulte [LOAD-EVIDENCE.md](LOAD-EVIDENCE.md) para números, fontes e limites de interpretação. Clientes, carteiras e comandos têm legendas distintas; esses artefatos não certificam exatamente 100 ou 1.000 jogadores simultâneos.

A página é `test-results/demo-subiu-20261001/prints/carga/index.html`, ligada à galeria da demo. A ampliação reutilizou medições existentes, conferiu resultados e hashes e preservou os diagnósticos anteriores; não iniciou outra carga nem alterou código financeiro.

## Demo pública e provas visuais — 01/10/2026

Demo restaurada do stash no commit `a8f3603`, mantendo o stash como backup. O commit `52e850a` corrige feedback visual entre sessões; `9e1fea3` ajusta os limites do Grafana após OOM observado. O código financeiro em `src/`, as migrations e o lockfile permanecem iguais ao release anterior. A API do servidor conserva a imagem `jungle-challenge:delivery-20261001-6456f6e`, ID `sha256:a9887841fe25ae34b11f07558dfbfcc088879064650db4c5fed0ea4fe97f20cc`. A demo usa `jungle-challenge:demo-20261001-ui`, ID `sha256:da6e960ec23730fe2fca1a0f7e2d83934e943c716cb65d79a299ca2133bc547c`, e journal em volume próprio. O domínio `jungle.subiu.dev` mantém BasicAuth; somente página, assets e `/demo/*` ganham o router da demo.

### Gates e cenários

Imagem Docker/Linux da demo: `verify:full` passou com **137 testes e 1.418 assertions**, zero falhas e zero skips: 75 unidade/344 assertions, 51 integração/588 e 11 concorrência/486. PostgreSQL 17.6, LocalStack 4.9.2 e Bun 1.4.2; projeto Docker exclusivo `jungle-demo-validation-20261001`, portas 39432/39466. O runner confirmou limpeza completa dos bancos e filas próprios; depois o Compose exclusivo foi removido com seus volumes. O ajuste posterior da interface passou em `verify`: 75 testes/344 assertions. Os limites do Grafana foram validados por config Compose e execução no servidor.

As quatro integrações novas usam três apps NestJS reais e verificam disputa de saldo, REFUND/WIN/LOSS/ROLLBACK, replay histórico, conflito, perda de resposta depois do commit com recuperação e Origin HTTPS. As 12 unidades novas cobrem prêmio exato, estado, journal, locks e retry. A demo pública chama uma API financeira; N peers são jogadores simulados. Os testes de processos isolados continuam sendo a prova de concorrência distribuída.

### Bateria pelo domínio público

`bun run test:demo` com `DEMO_BASE_URL=https://jungle.subiu.dev`, 24 peers e seis rodadas mistas, mais smoke de três peers e três disputas compartilhadas. Cada execução cria 153 carteiras próprias e termina com três peers prontos para apresentação. Todas as carteiras são reconciliadas com saldo esperado calculado em BigInt, materializado e reconstruído iguais, diferença zero. Foram verificadas 150 BETs aceitas, 69 recusadas, 52 REFUNDs, 49 WINs, 49 LOSS e 49 ROLLBACKs por bateria; replays e conflitos usam as identidades originais.

| Execução                    | Janela UTC                | Chamadas às rotas da demo | Resultado                                         |
| --------------------------- | ------------------------- | ------------------------: | ------------------------------------------------- |
| Inicial, gerador local      | 19:01:12.576–19:04:16.041 |                       651 | Cenários financeiros passaram; Grafana sofreu OOM |
| Repetição, gerador no subiu | 19:15:13.854–19:18:12.628 |                       652 | Todos os cenários e monitor passaram              |

Na repetição, 645 respostas foram HTTP 200 e sete HTTP 409 esperados por saque tardio. Conflitos de payload são verificados no corpo da rota de demonstração, que confirma o HTTP 409 da API financeira. Não houve erro inesperado. O gerador próprio `jungle-demo-load-20261001`, com 0.25 CPU/256 MiB, lê BasicAuth de arquivo privado e observa o mesmo `GUARD_STOP` produzido pelo monitor; `--rm` removeu apenas esse container. A execução inicial tinha o monitor separado do gerador local; essa limitação também foi corrigida na repetição.

### Consumo, diagnóstico e preservação

O kernel confirmou OOM de cgroup do Grafana às 19:03:43 UTC com limite 384 MiB. O monitor inicial detectou o reinício; a primeira prova não foi descartada. Grafana recebeu 512 MiB, `memswap_limit=512m` e `GOMEMLIMIT=320MiB`. Somente demo e Grafana foram adicionados/recriados; os outros 36 containers, incluindo API, PostgreSQL, proxy e aplicações existentes, conservaram identidades, estado e reinícios.

Na repetição, 25 amostras entre 19:15:13.679 e 19:18:09.519 UTC tiveram zero ocorrências e mínimo de RAM disponível **4.612,94 MiB**. A comparação final também confirmou os 38 containers da baseline inalterados, sem OOM/reinícios. Probes de subway, betaki, superbet e aurabet retornaram HTTP 200 em todas as amostras. O monitor inclui o novo coordenador e os recursos consumidos pelo gerador no host.

Séries Prometheus em passos de cinco segundos: RSS da API até **191.717.376 bytes**, heap até **44.698.221 bytes**, event loop p99 até **4,375 ms**, outbox até dois eventos e lag amostrado até **35,702 ms**; todas as amostras de `up` foram 1. Docker stats observou pico de CPU da API de **20,4% de um núcleo**. Picos dependem da amostragem; a bateria da demo comprova cenários e comportamento e não mede capacidade máxima.

Auditoria SQL às 19:18:32.539 UTC: 1.320 carteiras, 74.190 transações, 73.929 lançamentos/diários e 147.858 linhas contábeis. Zero carteiras inconsistentes, diferenças de versão, diários desbalanceados, referências pendentes, entregas falhas ou eventos não publicados. A telemetria final foi coletada depois do encerramento da bateria. Grafana retornou 100 logs atribuídos a `decolagem-demo` e 20 traces na janela da repetição; cinco traces completos foram exportados.

### Prints agrupados

`test-results/demo-subiu-20261001/prints/index.html` reúne **13 prints originais**: abertura, BET, REFUND, replay histórico, conflito, WIN, ROLLBACK, LOSS, disputa de saldo, recursos, operações, logs/traces e sessão pronta. `manifest.json` registra SHA-256, escopo e commits; `ui-disputa.json` registra as 24 linhas visíveis da tabela (uma aposta aceita e 23 recusadas). As imagens complementam JUnit, reconciliações, SQL e telemetria preservados em `relatorios/`. A galeria foi aberta e conferida no navegador; as capturas da demo são de desktop.

O pacote `test-results/demo-subiu-20261001/provas-demo-subiu-20261001.zip` contém galeria, prints e relatórios selecionados, sem credenciais. A entrega anterior `backend-challenge-subiu-submission-20261001.zip` permanece preservada e antecede este incremento. Nenhum resultado prevê a nota do avaliador.

## Testes ampliados, índice financeiro e deploy subiu — 01/10/2026

O commit `1e564e9` acrescentou históricos mistos em seis processos, disputa de saldo até esgotamento em quatro processos, roteiro progressivo de stress e uma stack isolada para o home server. O commit `bfe8a8b` isolou integração e concorrência em bancos/filas distintos, acrescentou a validação da agregação JUnit e a migration 008 com índice não único em `wager_transactions(wallet_id)`. As invariantes financeiras e a autoridade PostgreSQL de idempotência continuam as mesmas.

### Gates da imagem entregue

A imagem da bateria inicial `jungle-challenge:validated-20261001-bfe8a8b`, ID `sha256:a728a650ee37c624c9a3dba956446616c2f86fcb4f4910f4f317dfbca6c7685e`, passou em `verify:full` nos dois hosts: **121 testes, 1.313 assertions, zero falhas e zero skips**, em 16 arquivos — 63 unitários, 47 de integração e 11 distribuídos. Bun 1.4.2, PostgreSQL 17.6 e LocalStack 4.9.2. Typecheck, lint e formatação passaram; oito migrations exercitadas em `up → down → up`. Cada gate confirmou limpeza completa dos recursos próprios de integração e concorrência.

| Host                           | Início UTC   | Fim UTC      | Relatórios                         |
| ------------------------------ | ------------ | ------------ | ---------------------------------- |
| Local, Docker/Linux com quotas | 16:26:09.987 | 16:29:41.060 | `verification-image-local/`        |
| subiu, Linux com quotas        | 16:26:52.886 | 16:29:54.990 | `server-verification-image-final/` |

Os dois cenários financeiros novos comprovam 180 operações BET/WIN/LOSS com 360 entregas em seis processos, e 80 débitos distintos com 240 entregas em quatro processos: 50 aceitos, 30 recusados por saldo insuficiente e saldo final zero. Conferem respostas históricas, identidades, versão, ledger, diários e reconciliação de todas as carteiras.

As primeiras execuções foram preservadas. Uma assertion global de outbox confundia um evento futuro de outra fixture com trabalho devido; agora o teste confere seus próprios eventos devidos e comprova que eventos futuros permanecem intactos. Outro gate local revelou que workers de concorrência podiam consumir referências pendentes de fixtures de integração. O runner passou a separar os recursos dessas suítes e a manter os totais, falhas e skips no JUnit agregado. O teste de referência aguarda o horário de retry durável em vez de depender da duração do startup do processo. Retries automáticos de testes permanecem desabilitados. Uma primeira chamada dos testes de agregação passou nas assertions, mas falhou ao gravar JUnit em uma pasta recém-criada pelo Docker; a execução em pasta de evidências existente passou com relatório preservado.

### Deploy e diagnóstico SQL

Acesso pelo alias SSH `subiu`, via tailnet, ao host `subiu-sm`: i5-4570, quatro núcleos, aproximadamente 11 GiB RAM. Release da bateria inicial em `/home/subiu-sm/apps/jungle-challenge/releases/20261001-index-bfe8a8b`, projeto `jungle-server`, com PostgreSQL/LocalStack, rede e volumes próprios. O DNS exclusivo `jungle.subiu.dev` foi criado para o túnel existente; o Traefik e o Cloudflared compartilhados não foram reiniciados. API pública protegida por BasicAuth operacional; health público. Grafana, Prometheus e Tempo têm portas somente em loopback e credenciais próprias fora do pacote.

Antes da migration, backups PostgreSQL em formato custom foram preservados nos dois hosts. A aplicação do índice ocorreu com geradores encerrados, outbox drenada e apenas a aplicação do challenge parada durante a troca. O plano de consulta por carteira passou de `Seq Scan` para `Bitmap Index Scan` em `wager_transactions_wallet`. Isso comprova o uso do índice nesse plano; os custos estimados do planner não substituem medições de execução. A contenção e a validação do histórico da própria carteira permanecem.

Smoke após deploy confirmou readiness SQL/SQS, BET 25.00, replay com a mesma identidade e saldo histórico 75.00, reconciliação, API pública sem credencial 401 e autenticada 200, HTTPS/DNS, dashboard Grafana e Prometheus. Uma primeira chamada ao dashboard ocorreu antes do HTTP do Grafana terminar o startup sob quota de 0,1 CPU e recebeu reset; após o startup o smoke passou, sem OOM ou restart desse container. As provas anteriores de OIDC/JWKS e traces SQS permanecem registradas abaixo; a bateria desta seção mede entrada HTTP interna.

### Protocolo de carga

Mesma imagem e quotas nos dois hosts: API e PostgreSQL com 0,75 CPU/512 MiB cada; LocalStack 0,5 CPU/512 MiB; gerador 0,5 CPU/1 GiB. Prometheus 0,15 CPU/192 MiB, Tempo 0,15 CPU/256 MiB, Grafana 0,1 CPU/384 MiB. Os serviços persistentes somam tetos de 2,4 CPUs e aproximadamente 2,3 GiB; são limites individuais, não reserva agregada. O host local é Ryzen 7 5700X/Docker Desktop com 16 CPUs lógicas e 19 GiB reportados pela VM. O servidor usa Linux nativo e compartilha recursos com as aplicações existentes.

`STRESS_PROFILE=heavy` executa 300/8, 2.000/16, 5.000/32, 5.000/64, 1.000/16 em uma carteira, 10.000/128, 10.000/256 e 3.000/48 em uma carteira: 36.300 BETs medidos por host, mais 24 operações de warmup em cada fase, usando 462 carteiras novas. Cada relatório confere saldo esperado em centavos, reconciliação exata, erros HTTP, coleta de telemetria e drenagem da outbox com métricas frescas. Timeout de drenagem de 600 segundos; os resultados permanecem em diretórios próprios.

O diagnóstico inicial passou nos cinco cenários comparáveis do servidor e chegou a 10.000/128 no host local, sem erros ou divergências nos casos concluídos. O crescimento do histórico revelou a ausência do índice por carteira. As rodadas incompletas foram encerradas deliberadamente com SIGTERM para aplicar a melhoria; seus manifests registram exit code 143 na fase interrompida e não representam baterias completas aprovadas. A auditoria posterior confirmou zero divergências, diários desbalanceados, referências pendentes, falhas de entrega ou outbox pendente. A carga final começa sobre esse histórico preservado.

### Consulta de traces após a carga

As oito fases terminaram nos dois hosts antes de ajustar os recursos de consulta. A primeira exportação completa do servidor revelou OOM do Tempo durante leitura de um trace, confirmada pelo kernel em **16:53:17 UTC**, após a bateria financeira terminar em 16:50:39. O container estava limitado a 256 MiB e usava o padrão de 20 consultas simultâneas. A API, o PostgreSQL e as aplicações existentes continuaram operacionais.

O Tempo passou a 512 MiB, swap desabilitado para esse container, `GOMEMLIMIT=384MiB` e duas consultas simultâneas. O limite do Go é um alvo de memória gerenciada; o teto efetivo é imposto pelo container. [Guia do GC do Go](https://go.dev/doc/gc-guide), [configuração do Tempo](https://grafana.com/docs/tempo/latest/configuration/). O orçamento persistente de deploy passou a aproximadamente 2,6 GiB/2,4 CPUs. Essa alteração ocorreu **depois das medições de carga**, que usaram a configuração anterior idêntica nos dois hosts; seus resultados foram preservados. As exportações posteriores retornaram cinco traces completos e auditoria SQL sem divergências em cada host. Arquivos `tempo-kernel-log.txt`, configurações, estados/reinícios e traces preservam o incidente e a validação posterior.

Evidências desta seção: `test-results/heavy-subiu-20261001/`, com fonte/hash da imagem medida, gates JSON/JUnit, manifests das rodadas, métricas/series Prometheus, dashboard Grafana, traces Tempo, logs, planos SQL, metadados dos backups e auditorias SQL. Dumps e credenciais ficam fora do pacote. O [runbook do servidor](SUBIU.md) contém os comandos de deploy, acesso e reprodução.

### Resultado da bateria pesada nos dois hosts

As oito fases passaram nos dois hosts, com **36.300 operações medidas por host**, zero erros HTTP, zero falhas de coleta, todas as carteiras reconciliadas e outbox drenada em cada fase. Local: 16:31:16.064–16:55:56.287 UTC; subiu: 16:32:19.358–16:50:39.457 UTC. Os relatórios completos ficam em `local-index-heavy/` e `server-index-heavy/`.

| Cenário                           | Host  | req/s | p95 cliente | Drenagem após reconciliação | RSS máximo amostrado |
| --------------------------------- | ----- | ----- | ----------- | --------------------------- | -------------------- |
| 10.000 / 128 clientes             | Local | 37,52 | 4.283 ms    | 106,66 s                    | 265,00 MiB           |
| 10.000 / 128 clientes             | subiu | 53,52 | 3.010 ms    | 57,77 s                     | 265,99 MiB           |
| 10.000 / 256 clientes             | Local | 36,66 | 9.191 ms    | 103,59 s                    | 270,55 MiB           |
| 10.000 / 256 clientes             | subiu | 53,36 | 5.582 ms    | 56,98 s                     | 271,68 MiB           |
| 3.000 / 48 clientes, uma carteira | subiu | 12,84 | 5.297 ms    | 14,69 s                     | 242,46 MiB           |

O servidor Linux nativo apresentou throughput maior nessa rodada que o Docker Desktop local; virtualização, armazenamento, histórico acumulado e outras tarefas limitam atribuir essa diferença ao hardware. Os picos de CPU são deltas amostrados como percentual de um núcleo; não são uso do host nem uma medição contínua da quota. `comparison.png` e `resources.png` derivam das séries exportadas, sem representar capturas de tela do Grafana.

Auditorias após a bateria e antes dos novos smokes: local com 923 carteiras e 61.962 transações/entradas de ledger/diários; subiu com 877 carteiras e 59.824 transações/entradas de ledger/diários. Ambas confirmaram zero inconsistências de saldo ou versão, diários desbalanceados, referências pendentes, entregas falhas e outbox pendente. Incluem o histórico de diagnóstico preservado e aberturas de carteiras, além dos débitos medidos.

### Dashboard de logs/traces e E2E real do IDP

O dashboard anterior continha somente métricas e um link para o Tempo com queries vazias. Foi acrescentado Loki 3.7.0, Alloy 1.20.1 e gateway de leitura restrito ao container da aplicação. O dashboard provisiona painéis de logs JSON e tabela TraceQL, com links Explore preenchidos e correlação por `correlationId`. Não foi alterado o código financeiro da aplicação. Os dados de log anteriores só podem ser coletados enquanto estiverem disponíveis na rotação Docker.

As consultas feitas por `/api/ds/query` do Grafana local 39323 e do servidor retornaram duas linhas de log e um trace para a mesma transação de validação em cada host. Três consultas históricas de traces em janela de seis horas passaram por host após o ajuste do Tempo. Um primeiro smoke consultou o trace antes da indexação e retornou vazio; a validação agora aguarda visibilidade com deadline de 60 segundos, sem aceitar erro de datasource. Evidências: `local-dashboard/` e `server-dashboard/`; roteiro em [OBSERVABILITY](OBSERVABILITY.md).

O E2E complementar usa Keycloak 26.6.4 real, com PostgreSQL/SQS exclusivos da stack descartável e banco/filas adicionais gerados pelo runner. Passou **nos dois hosts** com **15 testes, 71 assertions, zero falhas e zero skips**, e limpeza completa. Cobre client credentials, discovery/JWKS, token expirado e renovado, assinatura adulterada, audience e realm incorretos, provedor reservado, health público, rotas protegidas e fluxo financeiro autenticado com replay e bloqueio entre provedores. JUnit e identidade/limpeza em `idp-final-local/` e `idp-server/`; [IDP-E2E](IDP-E2E.md) descreve a reprodução. A execução final local durou 4,99 segundos com o IDP pronto; no subiu durou 119,05 segundos incluindo espera pelo startup frio. A stack descartável foi removida após preservar as evidências.

A primeira tentativa do IDP falhou no startup: o importador exige nome de arquivo correspondente ao realm; a configuração dos mounts foi corrigida. O startup sob quota também recebeu deadline de cinco minutos. A tentativa seguinte passou 14 casos e falhou na auditoria do teste por usar `ledger_entries` em vez de `wallet_ledger`; a assertion foi corrigida para conferir a abertura e o BET, com dois movimentos e diários balanceados. As falhas e a limpeza dos recursos foram preservadas em pastas próprias; não houve alteração das regras de autenticação para obter o resultado.

### Imagem e configuração finais

O commit `1bf2f1f` acrescentou logs/traces consultáveis e a suíte real do IDP. A imagem `jungle-challenge:observability-final-20261001`, ID `sha256:0c84de20661321126de4a01bcb617eb7230ef8bd36ec1d0c23537f5b8fea8022`, passou novamente em `verify:full`: local **17:28:31.360–17:31:39.869 UTC** e subiu **17:30:58.015–17:34:02.083 UTC**, mantendo 121 testes/1.313 assertions. Somando o E2E complementar, **136 testes/1.384 assertions por host**, sem falhas ou skips nas execuções finais e com limpeza completa. Os relatórios ficam em `verification-observability-final-{local,server}/` e nas pastas de IDP citadas acima.

O diretório `src/`, `bun.lock` e `scripts/load.ts` permanecem iguais ao commit da bateria financeira anterior; os hashes da imagem e da fonte/configuração são preservados. A documentação da entrega foi atualizada após construir a imagem; os arquivos executáveis e as configurações são conferidos separadamente no pacote. Release dessa etapa: `/home/subiu-sm/apps/jungle-challenge/releases/20261001-observability-final`. O orçamento persistente com Loki/Alloy/gateway é aproximadamente **3,1 GiB/2,75 CPUs**, em limites individuais.

Após trocar a imagem, consultas de logs/traces da mesma operação passaram novamente nos dois hosts, com três buscas históricas por host. A validação comprovou HTTP 403 para listar containers, inspecionar PostgreSQL e enviar DELETE, e HTTP 200 para a inspeção do container da aplicação. Os links de correlação foram conferidos nos dados provisionados; a renderização visual depende de login na sessão do navegador e não integra essa prova por API. Evidências finais em `local-dashboard-final/` e `server-dashboard-final/`.

Em seguida, o responsável confirmou que o Grafana local **39323 carrega corretamente logs e traces**. Essa é uma confirmação visual do usuário, complementando as provas por API. O agente havia observado um erro de frontend ao abrir Explore; sua causa não foi diagnosticada e não há uma correção de código atribuída a esse erro.

### Repetição com observabilidade completa e fechamento do monitor

`STRESS_PROFILE=observability` repetiu 10.000 BETs com 256 clientes/128 carteiras e 3.000 BETs com 48 clientes/uma carteira em cada host, com 48 warmups adicionais e 129 carteiras próprias. Local: **17:33:04.754–17:43:31.135 UTC**; subiu: **17:37:34.819–17:46:02.187 UTC**. Cada fase terminou com exit code 0, zero erros HTTP/coleta, reconciliação exata e outbox drenada. Somadas às oito fases iniciais, são **49.300 operações medidas por host**, sem contar warmups e rodadas de diagnóstico.

| Cenário                           | Host  | req/s | p95 cliente | Drenagem após reconciliação | RSS máximo amostrado |
| --------------------------------- | ----- | ----: | ----------: | --------------------------: | -------------------: |
| 10.000 / 256 clientes             | Local | 36,21 |    8.212 ms |                     97,90 s |           253,14 MiB |
| 10.000 / 256 clientes             | subiu | 52,18 |    5.627 ms |                     57,70 s |           256,99 MiB |
| 3.000 / 48 clientes, uma carteira | Local | 13,55 |    6.592 ms |                     24,94 s |           242,33 MiB |
| 3.000 / 48 clientes, uma carteira | subiu | 12,64 |    5.700 ms |                     15,85 s |           230,45 MiB |

As consultas históricas do Grafana e a validação de correlação ocorreram durante essa repetição, acrescentando carga de consulta. Não se trata de uma comparação causal isolada entre CPUs. Uma primeira tentativa local após trocar a imagem recebeu conexão recusada antes da readiness; a execução foi preservada como falha de startup. Após aguardar `up --wait`, ambas as fases passaram. Nenhuma regra financeira foi alterada.

Auditoria local em **17:44:25 UTC**: 1.056 carteiras, 75.147 transações/lançamentos/diários e 150.294 linhas contábeis. Auditoria subiu atualizada após o último smoke em **17:56:18 UTC**: 1.009 carteiras, 73.007 transações/lançamentos/diários e 146.014 linhas. Ambas com zero inconsistências de saldo/versão, diários desbalanceados, outbox/referências pendentes e entregas falhas. Evidências: `local-observed-export/`, `server-observed-export/` e `*-observed-heavy/`.

O monitor exclusivo foi encerrado e preservou **938 amostras, de 15:52:35 a 17:46:39 UTC**, sobre 28 containers existentes. Nenhuma amostra registrou problema, restart/OOM novo dos serviços acompanhados ou acionamento da proteção; probes HTTP retornaram 200. RAM disponível mínima amostrada: **4.122,88 MiB**. Os probes verificam as rotas raiz das aplicações e os estados Docker; não comprovam todos os fluxos de pagamento. Arquivo `host-samples.jsonl`; `summary.json`/`index.html` reúnem 34 fases concluídas, incluindo os diagnósticos preservados.

GitHub Actions remoto não é exigido pelo enunciado. Por orientação do responsável, essa execução fica fora do fechamento; a configuração permanece disponível e os resultados efetivos são os gates Docker/Linux documentados.

### Reprodução do README em fonte limpa

O commit `77e1b68` foi exportado com `git archive`, sem `.env`, dependências do host ou bind mount de código, para uma stack nova `jungle-review-clean-20261001`. Setup, readiness e seed repetido passaram, assim como o gate completo. A demo recebeu HTTP 400: o script ainda lia `walletId` da abertura, enquanto a API já retornava `id`, conforme a seção 9. A falha e a limpeza completa foram preservadas em `clean-readme-reproduction/`.

O commit `6456f6e` corrigiu somente o script `scripts/demo.ts`, usando `id` e tipando cada resposta utilizada. `bun run verify` passou no Windows com 63 testes/295 assertions, tipos, lint e formatação. Uma nova exportação desse commit foi construída com a instalação congelada do Dockerfile em outra stack, `jungle-review-clean-20261001-final`, com portas exclusivas 39400/39432/39466. Não foi reaproveitado banco, fila ou volume da primeira tentativa.

De **18:03:12.210 a 18:05:27.424 UTC**, passaram setup/migrations, liveness/readiness 200, seed duas vezes com a mesma identidade, BET/replay, duplicata SQS, LOSS e reconciliação de **75.00 BRL**, diferença **0.00**. O gate `verify:full` passou de **18:03:46.525 a 18:05:21.967 UTC**, com **121 testes/1.313 assertions, zero falhas/skips**. Os dois recursos das suítes foram removidos; ao final também foram removidos todos os containers/volumes próprios dessa stack.

Fonte: `6456f6e4926406aeed4a6a4c1d8ab9fab19bd9ec`; imagem construída: `sha256:a9887841fe25ae34b11f07558dfbfcc088879064650db4c5fed0ea4fe97f20cc`. Evidências em `clean-readme-reproduction-final/`, com comandos, timestamps, logs, JUnit, JSON e identidade/limpeza. `source-delivery-manifest.json` preserva os hashes; o pacote confere os arquivos executáveis/configurações contra a fonte construída. Alterações posteriores de documentação são identificadas pelo commit de entrega.

### Release final entregue no servidor

A mesma imagem validada foi identificada como `jungle-challenge:delivery-20261001-6456f6e` e implantada na release **`/home/subiu-sm/apps/jungle-challenge/releases/20261001-delivery-6456f6e`**. Apenas `jungle-server-app-observed-1` foi recriado; a comparação antes/depois confirmou ID, estado, saúde, restart count e OOM flag iguais para os **36 outros containers em execução**, incluindo os serviços do challenge e as aplicações compartilhadas. Banco, filas, proxy, túnel e Grafana foram preservados. Nenhuma migration ou configuração de runtime foi alterada nessa troca.

A demo corrigida passou no servidor com replay e reconciliação de 75.00 BRL. `verify:full` passou de **18:08:05.677 a 18:11:11.807 UTC**, com **121 testes/1.313 assertions, zero falhas/skips** e limpeza completa dos dois recursos exclusivos. Evidências: `deployment-delivery.json`, `verification-delivery-server/`. O E2E Keycloak já aprovado nos dois hosts continua aplicável à implementação e aos testes de autenticação sem mudanças; ele não foi repetido nessa troca exclusiva do script de demonstração/documentação.

Depois do deploy, a validação do Grafana retornou duas linhas de log e um trace da mesma operação, três consultas históricas e a política restrita do gateway. O smoke confirmou readiness SQL/SQS, BET/replay/reconciliação, HTTPS/DNS, acesso público 401 sem credencial e 200 autenticado, Grafana e Prometheus. Evidências: `server-dashboard-delivery/` e `server-delivery-smoke.json`.

Auditoria final em **18:12:51 UTC**: 1.012 carteiras, 73.014 transações, 73.013 lançamentos/diários e 146.026 linhas contábeis. A diferença de uma transação corresponde à LOSS da demo, sem movimento financeiro. Zero inconsistências de saldo/versão, diários desbalanceados, outbox/referências pendentes ou entregas falhas; cinco traces completos exportados. Evidências: `server-delivery-export/`.

As baterias de carga permanecem associadas às imagens/configurações efetivamente medidas. A imagem entregue acrescenta documentação e a correção do script CLI; `src/`, `scripts/load.ts`, demais scripts executáveis, testes, dependências e configurações são conferidos por hash contra a fonte da bateria com observabilidade. O commit final de documentação não muda os arquivos executáveis da fonte construída.

Após consolidar os documentos, `bun run check` passou no Windows de **18:14:32.947 a 18:14:50.865 UTC**: typecheck, lint sem warnings e formatação. Relatórios: `final-static.log` e `final-static.json`. Somente este registro foi acrescentado depois desse check e formatado com Prettier.

## Refinamento da outbox e fechamento da entrega — 01/10/2026

O publisher passou a enviar até dez eventos por `SendMessageBatch`, confirmar individualmente os IDs aceitos e repetir somente eventos sem confirmação válida. Claim, lease, fencing por token, identidade dos eventos e persistência financeira continuam com os mesmos contratos. Quando há trabalho, o loop continua drenando; vazio ou erro mantém espera. O shutdown conclui as confirmações de um lote já enviado. A interpretação operacional foi registrada previamente na especificação, sem alterar o enunciado ou migrations.

O gate final executado entre **15:14:11.894 e 15:15:25.042 UTC** passou em Docker/Linux com Bun 1.4.2, PostgreSQL 17.6 e LocalStack 4.9.2: typecheck, ESLint sem warnings, Prettier e **113 testes / 979 assertions / zero falhas / zero skips**, em 14 arquivos — 58 unitários, 46 de integração e nove distribuídos. As sete migrations passaram em `up → down → up`. Recurso isolado `wagering_test_1790867683013_4ed4e0b5`, `cleanupComplete: true`, `failedResources: []`. Uma primeira execução encontrou três falhas na nova fixture, que tratava a data retornada pelo driver como `Date`; a fixture foi corrigida para string/`Date.parse` antes deste gate final. Ambos os relatórios foram preservados.

```powershell
docker compose --profile test run --build --rm --no-deps --volume "D:\code\jungle-gaming\backend-challenge\test-results\refinement-20261001\verification-final:/app/test-results" test
```

Os seis novos cenários de integração cobrem sucesso parcial, confirmação ausente, falha da requisição, lease substituída antes de sucesso/falha e parada depois do send. SQL real comprova marcação por item, retries, fencing e recuperação por outro worker. Os itens aceitos usam SQS/LocalStack real; respostas de falha são injetadas de forma controlada. As provas distribuídas de crashes e publicação concorrente continuam passando.

### Carga reproduzível e comparação local

`bun run test:load` agora preserva `load.json` e `load-samples.json`, coleta CPU/RSS/heap/event loop/backlog, exige métricas frescas posteriores à carga para provar drenagem e compara cada saldo com o esperado calculado em centavos BigInt, além da reconciliação ledger/saldo. Métrica ausente não é interpretada como zero. Erro HTTP, divergência, falha de coleta ou timeout de drenagem tornam a execução malsucedida.

Stack exclusiva `jungle-refinement-20261001`, aplicação observada em 39310, Prometheus 39311, Tempo 39312 e Grafana 39313. Mesmo host Ryzen 7 5700X, 16 CPUs lógicas e 19 GiB reportados pelo container, sem quotas fixadas; stacks principal e anterior permaneceram ociosas no mesmo host. Cada execução usou **2.500 BETs de 0.01 BRL, warmup de 24 e 64 carteiras novas**, gerador em outro container, tracing e outbox ativos. Os gates ficaram fora da janela de carga.

| Versão / execução    | Clientes |  req/s | p95 cliente | Pico outbox | Drenagem após reconciliação |
| -------------------- | -------: | -----: | ----------: | ----------: | --------------------------: |
| Refinada — primeira  |       12 |  88,83 |   250,01 ms |       3.674 |                     17,72 s |
| Refinada — primeira  |       48 |  86,26 | 1.059,24 ms |       4.870 |                     16,57 s |
| Refinada — primeira  |       96 | 132,96 |   885,10 ms |       4.741 |                     19,68 s |
| Anterior — repetição |       48 | 113,22 |   616,03 ms |       4.854 |                     87,21 s |
| Refinada — repetição |       48 | 111,04 |   647,80 ms |       4.827 |                     26,84 s |

Todas as execuções terminaram com **zero erros, zero conflitos SQL contabilizados, nenhuma falha de coleta e 64/64 carteiras com saldo esperado e reconciliação consistente**. A auditoria SQL da stack refinada confirmou **256 carteiras, 10.352 lançamentos e diários, 20.704 linhas contábeis, zero saldos divergentes, zero diários desbalanceados, zero outbox pendente e zero falhas de entrega**. A comparação sequencial de 48 clientes no mesmo período observou redução de aproximadamente **69,2%** no tempo de drenagem; throughput HTTP caiu cerca de 1,9% e p95 aumentou cerca de 5,2%. As primeiras execuções evidenciam variabilidade. O resultado mede recuperação assíncrona local, sem comprovar ganho universal de throughput ou capacidade/SLO de produção.

O gerador da comparação anterior usou o mesmo protocolo, com um adaptador preservado em `load-baseline.ts`: a drenagem foi confirmada por leitura SQL fresca, pois a aplicação anterior não expõe o timestamp da coleta. Seu último gauge ainda mostrava 44 pendentes quando SQL confirmou zero; o relatório explica esse método. A aplicação anterior permaneceu na imagem antiga; apenas o gerador foi reconstruído. Amostras do gerador têm intervalo nominal de um segundo mais duração da coleta; durante recuperação há também polling independente. Prometheus coleta a cada cinco segundos. Picos de CPU são frações de um núcleo calculadas por deltas, com janelas variáveis, e não uso do host inteiro; não são diretamente comparáveis ao `rate[30s]` da coleta anterior. Não houve teste prolongado de vazamento de memória.

Evidências locais ignoradas: `test-results/refinement-20261001/`, com relatórios por execução, snapshots Grafana/Prometheus/Tempo, auditoria SQL, logs, commit base/patch do código medido e JSON/JUnit do gate. `comparison.png`, `resources.png` e `index.html` resumem os dados exportados. As figuras são derivadas das séries e não screenshots do Grafana. Reprodução das cargas: `measure.ps1` e comandos em [README](../README.md); a comparação legada exige a imagem anterior e o adaptador preservado. A coleta inicial completa permanece em `test-results/grafana-stress-20261001/`.

## Stress observado no Grafana — 01/10/2026

Experimento executado entre **08:45:31.201 e 08:55:48.199 UTC** (05:45:31–05:55:48 em America/Sao_Paulo), em uma stack Compose exclusiva `jungle-telemetry-stress-20261001`. Uma aplicação Bun 1.4.2/Linux, PostgreSQL 17.6 e LocalStack 4.9.2 reais, tracing ativo, Prometheus 3.15.0, Tempo 2.10.4 e Grafana 13.2.0. O gerador ficou em outro container; o cluster principal permaneceu ativo e ocioso no mesmo host Ryzen 7 5700X. A VM Docker reportou 16 CPUs lógicas e 19 GiB; não foram fixadas quotas de CPU/memória.

Antes da carga, a instrumentação recebeu CPU/RSS/heap/event loop, respostas HTTP por status, quantidade de eventos pendentes na outbox e profundidade da fila de entrada SQS. O dashboard mostra essas séries e as 20 anotações das fases. Prometheus coletou a cada cinco segundos; um monitor independente registrou **234 amostras** de readiness, métricas, SQL e SQS. `docker stats` também registrou os seis containers a cada cinco segundos aproximadamente. Os arquivos preservam o commit base `de7ae13`, o patch e hashes do código medido.

| Fase HTTP              | Clientes | Carteiras | Requisições | Erros |  req/s | p95 cliente | RSS pico amostrado |
| ---------------------- | -------: | --------: | ----------: | ----: | -----: | ----------: | -----------------: |
| Carteiras distribuídas |       12 |        64 |       2.500 |     0 | 135,24 |   149,69 ms |         264,37 MiB |
| Carteiras distribuídas |       48 |        64 |       2.500 |     0 | 118,99 |   853,68 ms |         281,06 MiB |
| Carteiras distribuídas |       96 |        64 |       2.500 |     0 |  99,16 | 1.318,81 ms |         311,54 MiB |
| Uma carteira disputada |       64 |         1 |         685 |     0 |  20,73 | 3.641,95 ms |         218,65 MiB |
| Replays idempotentes   |       96 |         8 |      10.000 |     0 | 388,31 |   388,41 ms |         299,88 MiB |

As **18.185 requisições medidas** responderam 200. Os replays geraram **zero novos lançamentos no ledger e zero eventos na outbox**. A rajada SQS enviou **1.100 entregas para 1.000 comandos únicos**, incluindo 100 duplicatas lógicas com deduplication IDs de transporte distintos: processamento e drenagem em **76,46 s**, aproximadamente **13,08 comandos únicos/s**. As 64 carteiras SQS reconciliaram; inbox terminou com 1.000 registros e o contador de duplicatas com 10.100 (HTTP + SQS).

### Consumo e comportamento observados

- CPU do processo: pico amostrado de **111,27% de um núcleo**, calculado com `rate(process_cpu_seconds_total[30s])`; não é percentual de utilização do host inteiro.
- RSS: baseline médio **142,35 MiB**, pico **311,54 MiB**, último valor **198,07 MiB**. Houve queda após a carga, mas a janela curta não comprova nem descarta vazamento de memória.
- Event loop: maior p99 entre scrapes **124,52 ms**. Os valores do heap são os expostos pela compatibilidade Node do Bun; RSS é a medida utilizada para consumo residente.
- Carteira única: até **11 sessões SQL esperando locks**, sem deadlock/serialization/lock timeout registrado. Espera por serialização não é contabilizada como conflito SQL.
- Outbox: pico de **4.986 eventos pendentes**, lag máximo de **108,76 s**. Após as reconciliações HTTP, levou **77,65 / 85,81 / 109,30 s** para drenar as fases 12/48/96. A API confirmou commits antes da publicação assíncrona, como previsto.
- Entrada SQS: pico aproximado de **1.051 mensagens visíveis**, final zero visíveis/em processamento, DLQ vazia. Outbox também terminou em zero; a fila de eventos publicados conserva mensagens porque não houve consumidor downstream nesta carga.
- Readiness retornou **200 em todas as 234 amostras**, e Prometheus registrou `up=1` durante toda a janela exportada. Nenhuma falha de entrega foi persistida.

`docker stats` observou CPU máxima de 153,01% na aplicação, 409,16% no PostgreSQL e 122,23% no LocalStack. Sua janela curta e o desconto de cache na memória diferem das séries Prometheus/RSS. Memória máxima Docker: aplicação 268,60 MiB, PostgreSQL 142,60 MiB, LocalStack 188,30 MiB, Prometheus 45,77 MiB, Tempo 104,30 MiB e Grafana 883,70 MiB. A coleta inclui o custo dos workers, instrumentação e navegação no Grafana.

Auditoria SQL final: **265 carteiras, zero saldos divergentes, 9.458 lançamentos no ledger, 9.458 diários contábeis, 18.916 linhas e zero diários desbalanceados**. Todas as carteiras reconciliaram também pela API contra o saldo esperado. Os 9.458 movimentos incluem 265 aberturas. Não houve achado de falha financeira ou operacional no driver.

A concorrência maior elevou latência sem aumentar throughput; a carteira única tornou a contenção explícita e a publicação da outbox acumulou backlog. Esses são limites observados para discussão de evolução, sem alteração de locks ou invariantes durante a medição. O experimento não determina capacidade máxima ou SLO de produção. A carga é fechada; cada fase dura até 30 segundos ou seu limite de requisições. Replays têm pausa de 50 ms por cliente e não são diretamente comparáveis a escritas. Carteiras novas por fase reduzem compartilhamento, mas a ordem acumula históricos e o experimento não constitui um benchmark independente. Picos menores que a coleta podem escapar; p95 cliente é exato nas amostras de requisições, p95 do Grafana é interpolado a partir dos buckets.

### Evidências e reprodução

Arquivos locais ignorados pelo Git: `test-results/grafana-stress-20261001/`. `index.html` e `REPORT.md` apresentam a coleta; `resources.png`, `messaging.png`, `containers.png` e `http-comparison.png` apresentam os gráficos. Dados brutos: `prometheus-series.json`, `server-samples.jsonl`, `docker-stats.jsonl`, latências/reconciliações por fase, traces HTTP/SQS retornados pelo Tempo, anotações/dashboard via API do Grafana e logs da aplicação. Capturas parciais reais do Grafana registram a primeira fase e a janela completa; capturas grandes falharam por timeout da ferramenta de browser. As figuras completas foram geradas a partir das séries exportadas e não são screenshots do Grafana.

O projeto mantém os volumes de Prometheus/Grafana da coleta. Dashboard local: `http://localhost:39303/d/distributed-wagering-overview/distributed-wagering-overview?from=1790844331201&to=1790844948199`. Prometheus em 39301, Tempo em 39302 e aplicação em 39300. O histórico no Prometheus obedece à retenção local; as exportações independem da stack ativa.

Procedimento executado no PowerShell, com os arquivos de configuração e driver preservados no pacote de evidências:

```powershell
docker compose --env-file test-results/grafana-stress-20261001/stack.env -p jungle-telemetry-stress-20261001 -f compose.yaml -f test-results/grafana-stress-20261001/override.yaml --profile observability up --build -d
python test-results/grafana-stress-20261001/collect-docker.py
docker compose --env-file test-results/grafana-stress-20261001/stack.env -p jungle-telemetry-stress-20261001 -f compose.yaml -f test-results/grafana-stress-20261001/override.yaml --profile test run --build --rm --no-deps -e STRESS_PROJECT=jungle-telemetry-stress-20261001 --volume "D:\code\jungle-gaming\backend-challenge\test-results\grafana-stress-20261001:/app/test-results/grafana-stress-20261001" test bun /app/test-results/grafana-stress-20261001/stress.ts
```

O coletor deve rodar em outro terminal e para quando recebe o arquivo `STOP`. Após a carga, `export.ps1` exportou APIs/logs e `analyze.py` gerou relatório/figuras, com Matplotlib 3.10.1 instalado apenas em `.tmp/telemetry-plot-deps`. O driver exige banco vazio e valida o projeto exclusivo antes de gravar: uma nova execução precisa de recursos novos e de ajuste explícito dessa identificação, sem limpar o banco principal nem sobrescrever esta coleta.

Após a medição, `docker compose --profile test run --build --rm --no-deps --volume "D:\code\jungle-gaming\backend-challenge\test-results\grafana-stress-20261001\verification:/app/test-results" test` executou `verify:full` entre **08:58:51.384 e 08:59:53.882 UTC**. Typecheck, ESLint sem warnings, Prettier e as suítes passaram: **103 testes, zero falhas, zero skips e 811 assertions** em 13 arquivos. As sete migrations passaram em `up → down → up`, exclusivamente no banco gerado `wagering_test_1790845152119_fcaf9d9b`. `resources-all.json` confirmou `cleanupComplete: true`, `failedResources: []`; relatórios JSON/JUnit estão em `verification/` no pacote. O gate foi executado fora da janela de carga para não contaminar a medição. `CHALLENGE.md` e a demo no stash permaneceram intactos.

## Opcionais e gate completo — 01/10/2026

Após implementar o diário contábil, OIDC com Keycloak/JWKS e tracing OTLP com dashboard, `verify:full` passou em Docker/Linux com Bun 1.4.2, PostgreSQL 17.6 e LocalStack 4.9.2. A execução final ocorreu de 08:27:43.104 a 08:28:38.267 UTC. Typecheck, ESLint sem warnings, Prettier e as suítes passaram: **103 testes, zero falhas, zero skips e 797 assertions** em 13 arquivos — 54 unitários, 40 de integração e nove de concorrência. As sete migrations passaram em `up → down → up`.

Comando executado no PowerShell:

```powershell
docker compose --profile test run --build --rm --no-deps --volume "D:\code\jungle-gaming\backend-challenge\test-results:/app/test-results" test
```

O runner usou `wagering_test_1790843282238_c095bb1d`, registrou `cleanupComplete: true` e `failedResources: []`. O JUnit confirmou 103/0/0 em 35,27 s; `verify-full.json` registrou sucesso em typecheck, lint, formatação e testes. O enunciado `CHALLENGE.md` permaneceu inalterado.

Smokes de opção executados em projetos Compose isolados: Keycloak emitiu token client-credentials aceito pela API (wallet 201, aposta 200, saldo 9.00); provider diferente retornou 403, health público 200 e `/metrics` sem token 401. No perfil de observabilidade, Tempo recebeu spans `wager.process` com `wager.transport=http` e `wager.transport=sqs`; a aposta SQS foi processada e deixou saldo 99.99. O alvo Prometheus retornou `up=1`; a API do Grafana retornou 200 para o dashboard `distributed-wagering-overview` e para as fontes Prometheus e Tempo.

O experimento de carga, no perfil isolado com outbox ativa, executou 300 BETs de 0.01 BRL em 12 carteiras, concorrência 12 e warmup 24. Bun 1.4.2/Linux no host Ryzen 7 5700X reportou 16 CPUs lógicas e 19 GiB visíveis ao contêiner. Resultado: **100.95 req/s**, p50 **102.27 ms**, p95 **202.00 ms**, p99 **244.56 ms**, zero erros e conflitos SQL, lag final da outbox **1.72 s** e reconciliação **12/12**. A harness foi ajustada para consumir `id`, campo devolvido pela API de abertura. Relatório local ignorado pelo Git: `test-results/load-optional-20261001.json`.

## Enum refactor e gate completo — snapshot anterior, 01/10/2026

Após centralizar status, kinds, direções financeiras, erros, eventos, mensagens e diagnósticos SQL em enums, `verify:full` passou em Docker/Linux com Bun 1.4.2, PostgreSQL 17.6 e LocalStack 4.9.2. Execução: **07:04:51.797–07:05:54.140 UTC**. Typecheck, ESLint sem warnings, Prettier, unidade, integração e concorrência passaram: **93 testes, zero falhas, zero skips e 745 assertions**. As seis migrations passaram em `up → down → up`.

Comandos executados no PowerShell:

```powershell
docker compose --profile test build test
docker compose --profile test run --rm --no-deps --volume "D:\code\jungle-gaming\backend-challenge\test-results\swarm-audit-2026-10-01-enums-final:/app/test-results" test
```

O runner isolado usou `wagering_test_1790838313377_8f32318b` e confirmou `cleanupComplete: true`, `failedResources: []`; `--no-deps` evitou executar `setup` no banco principal. Evidências: `test-results/swarm-audit-2026-10-01-enums-final/verify-full.json`, `all.junit.xml` e `resources-all.json`. O SHA-256 de `CHALLENGE.md` permaneceu `47795FCE2FC38CAE5F1B91368EBAF80B7A2ED1FE147F36704B665FAF0613812E`.

Registro contínuo, atualizado em 1º de outubro de 2026. Ambiente: Windows host, Bun 1.4.2 no container Linux, TypeScript 5.9.3, NestJS 12.1.2, MikroORM 6.6.0, Docker Linux/x86_64 29.5.3, Compose 5.1.4, PostgreSQL 17.6-alpine e LocalStack 4.9.2.

## Auditoria adversarial e gate completo — 01/10/2026

O gate completo após a extração dos mappers passou entre **06:17:57.118 e 06:18:48.454 UTC** (03:17:57–03:18:48 em America/Sao_Paulo). O workspace não tinha Bun no `PATH` do host; usei a imagem do projeto fixada em Bun 1.4.2, PostgreSQL 17.6-alpine e LocalStack 4.9.2 em Docker/Linux.

Comandos executados no PowerShell:

```powershell
docker compose --profile test build test
docker compose --profile test run --rm --no-deps --volume "D:\code\jungle-gaming\backend-challenge\test-results\swarm-audit-2026-10-01-mappers:/app/test-results" test
```

`verify:full` passou typecheck, ESLint sem warnings, Prettier e todas as suítes: **93 testes, zero falhas, zero skips e 745 assertions** em onze arquivos — 52 unitários, 32 de integração e nove de concorrência. O JUnit confirma 93/0/0; as suítes Bun levaram 33,77 s e o gate completo 51,34 s. As seis migrations passaram em `up → down → up`.

O runner usou `wagering_test_1790835495282_6823f951` e registrou `cleanupComplete: true`, `failedResources: []`. `--no-deps` evitou executar `setup` sobre o banco principal; o teste criou e limpou seu banco e filas próprios. Evidências: `test-results/swarm-audit-2026-10-01-mappers/verify-full.json`, `all.junit.xml` e `resources-all.json`.

A revisão paralela e a ampliação da suíte fecharam estas janelas:

- A mensagem recebida ao terminar um long poll depois do sinal de parada agora volta imediatamente à fila; um teste controlado prova que ela não inicia o caso de uso.
- O resultado terminal persiste `snapshotVersion` interno. O trigger SQL compara balance/status/currency e valida `LOSS` contra a versão histórica, sem exigir lançamento próprio; uma tentativa de resultado inconsistente por SQL é rejeitada.
- PostgreSQL prova `ROLLBACK` de BET e WIN, WIN pendente antes da BET, concorrência REFUND/ROLLBACK em processos distintos e cursor do ledger com escrita intercalada.
- Falha ao encaminhar à DLQ não dá ACK à mensagem original. Falha de `DeleteMessage` após commit redelivera pela inbox sem duplicar ledger/outbox.
- Mappers explícitos separam o resultado interno do público e centralizam a serialização de `WalletView`; testes confirmam que `snapshotVersion` não vaza pela projeção pública.

O SHA-256 de `CHALLENGE.md` permaneceu `47795FCE2FC38CAE5F1B91368EBAF80B7A2ED1FE147F36704B665FAF0613812E`. Nenhuma validação ou limpeza tocou recursos compartilhados.

## Registro anterior — prioridades 1 e 2, contrato de wallet e reversão entre tipos

Em 01/10/2026, no Windows com Bun 1.4.2, foi aplicado `bun run check`: typecheck, ESLint e Prettier passaram (exit code 0), de 05:12:21 a 05:12:39 UTC. O relatório está em `test-results/verify-static.json`.

`bun run test:integration` passou em 22,45 s: 25 testes, zero falhas, zero skips e 262 assertions em `financial.test.ts`, `http.test.ts` e `messaging.test.ts`. O runner verificou migrations `up → down → up` em banco isolado `wagering_test_1790831016681_c522e826`. PostgreSQL 17.6-alpine e LocalStack 4.9.2 foram usados pelo Compose. `test-results/resources-integration.json` confirma `cleanupComplete: true` e `failedResources: []`; o JUnit está em `test-results/integration.junit.xml`.

As provas desta atualização incluem AC-21: após um REFUND processado, um ROLLBACK direto à mesma BET é rejeitado com `REFERENCE_ALREADY_REVERSED`; saldo, versão e ledger não mudam e o evento de rejeição fica persistido. O teste HTTP confirma que `POST /wallets` retorna `id`, sem `walletId` na resposta, e usa esse valor como `walletId` nas chamadas seguintes.

Naquela etapa, nenhum serviço financeiro, schema ou migration foi alterado. A suíte de concorrência e `verify:full` ainda não tinham sido repetidos; a validação cobriu o gate estático e a suíte de integração afetada. A auditoria adversarial posterior e o gate final estão no início deste registro.

## Retomada do handoff — fechamento das provas

Em 30/09/2026, às **23:30:53–23:32:09 America/Sao_Paulo** (01/10/2026, 02:30:53–02:32:09 UTC), o gate completo passou em Docker/Linux com Bun 1.4.2 e PostgreSQL 17.6/LocalStack 4.9.2 reais. Foram **82 testes, zero falhas, zero skips e 656 assertions em dez arquivos**: 50 unitários, 24 de integração e oito de concorrência. Bun test levou 43,48 s e o gate completo 76,55 s. Typecheck, ESLint sem warnings e Prettier também passaram.

Comandos executados no PowerShell, com Bun disponível no PATH da sessão:

```powershell
bun run verify
bun run test:integration
docker compose --profile test build test
$linuxReports = Join-Path (Get-Location).Path 'test-results\handoff-linux'
New-Item -ItemType Directory -Force -Path $linuxReports | Out-Null
docker compose --profile test run --rm --no-deps --volume ($linuxReports + ':/app/test-results') test
```

O gate local `verify` passou com 50 testes unitários e 255 assertions; a integração Windows passou com 24 testes e 251 assertions em 22,77 s. A imagem foi construída com instalação congelada e scripts de dependências desativados, conforme o Dockerfile. O build usou este workspace com as alterações de teste; não representa um novo build de checkout limpo.

`--no-deps` evitou executar `setup` no banco principal. O runner Linux criou `wagering_test_1790821885230_c29db26e`, validou as cinco migrations em `up → down → up` e removeu seu banco e suas três filas. `test-results/handoff-linux/resources-all.json` registra `cleanupComplete: true` e `failedResources: []`. O runner Windows de integração usou `wagering_test_1790821809977_39951aeb`, também com limpeza completa. Nenhum rollback ou limpeza atingiu recursos principais.

As provas acrescentadas verificam:

- Efeitos de BET/WIN/LOSS/REFUND/ROLLBACK, inversões de BET/WIN/REFUND, versão, ledger, eventos e replay no use case; rejeição por moeda e cada campo de contexto/valor/status da referência; conflito real de payload sem substituir resultado/hash/efeitos.
- Reconciliação de todas as wallets criadas por cada suíte de infraestrutura em `afterEach`, com saldo reconstruído igual ao materializado e diferença zero, inclusive as 12 wallets dos publishers.
- Rollback pré-commit consultando wallet, transação, ledger, inbox e outbox diretamente; retry posterior confirma o conjunto. Eventos de LOSS e expiração consultados no SQL, sem WalletBalanceChanged/ledger para operações sem movimento.
- Crash após commit e antes do ACK: os dois eventos da operação estão duráveis e não publicados antes do primeiro send; outro processo publica os mesmos IDs. Redelivery não acrescenta eventos.
- SIGTERM POSIX real durante mensagem retida antes do commit: o lifecycle do NestJS aguarda a liberação, confirma e ACKa, encerra com código 143 e deixa a mensagem seguinte para outro runtime. Replay preserva um inbox e dois eventos, sem novo débito; ambas as wallets reconciliam. O teste passou em 5,16 s. Windows pula somente essa prova POSIX; o gate Linux executou todos os casos.
- HTTP 202, 422 e 503 para pendência, rejeição, FAILED terminal e falha técnica pré-commit. Readiness retorna 503 quando a conexão SQL está fechada ou uma fila consultada não existe, liveness continua 200 e readiness recupera. Isso não simula uma interrupção física dos containers.

Evidências preservadas em `test-results/handoff-integration-windows.log`, `test-results/handoff-docker-build.log`, `test-results/handoff-verify-linux.log`, `test-results/handoff-linux/verify-full.json`, `test-results/handoff-linux/all.junit.xml` e nos relatórios de recursos. O JUnit Linux foi lido como XML: 82 casos, nenhuma falha e nenhum skip. Logs e relatórios continuam ignorados pelo Git.

Naquele snapshot, o produto, as migrations e as interpretações financeiras não foram alterados. `CHALLENGE.md` mantém SHA-256 `47795FCE2FC38CAE5F1B91368EBAF80B7A2ED1FE147F36704B665FAF0613812E`. A diferença `id`/`walletId` e a escolha de reversão direta total estavam registradas como pontos de revisão; o estado atual está na [rastreabilidade](TRACEABILITY.md#provas-fechadas-e-pontos-de-revisão).

Após atualizar os documentos, `bun run check` passou novamente no Windows, de 02:34:43 a 02:35:15 UTC: typecheck, lint e formatação, exit code 0. Relatórios em `test-results/verify-static.json` e `test-results/handoff-final-static.log`. Esse check complementa o gate Linux; somente a documentação foi alterada depois daquele gate.

## Validação do conteúdo preparado para commit

Em 01/10/2026, de 2026-10-01T04:32:38.569Z a 2026-10-01T04:34:23.440Z, o conteúdo do índice foi exportado para `.tmp/challenge-commit/` e validado sem a demo jogável. O gate `verify:full` passou em Docker/Linux, Bun 1.4.2, PostgreSQL 17.6 e LocalStack 4.9.2: 82 testes, sem falhas ou skips. Typecheck, lint e formatação também passaram. O runner criou `wagering_test_1790829209901_ae314ec3` e confirmou limpeza completa.

Comandos: `git checkout-index --all --prefix=.tmp/challenge-commit/`, `docker compose --project-directory .tmp/challenge-commit -f .tmp/challenge-commit/compose.yaml --profile test build test` e `docker compose --project-directory .tmp/challenge-commit -f .tmp/challenge-commit/compose.yaml --profile test run --rm --no-deps --volume <pasta-de-relatórios>:/app/test-results test`. Relatórios em `test-results/challenge-commit-linux/`; log em `test-results/challenge-commit-verify-linux.log`. Após o gate, somente este registro foi acrescentado à documentação.

## Auditoria contra o challenge

Em 30/09/2026, às 21:57:54–21:59:34 em America/Sao_Paulo (01/10/2026, 00:57:54–00:59:34 UTC), `bun run verify:full` foi repetido sobre o código já commitado, no Windows/Bun 1.4.2 com PostgreSQL 17.6 e LocalStack 4.9.2 em Docker. O comando terminou com exit code 0: typecheck, lint sem warnings, formatação e todas as suítes aprovados.

Foram **54 testes, zero falhas e 215 assertions em nove arquivos**: 26 de unidade, 21 de integração e sete de concorrência. Bun test levou 54,31 s; o gate completo, 100,43 s. Os sete testes distribuídos combinam os oito cenários obrigatórios do enunciado.

Evidências: `test-results/verify-challenge-audit.log`, `test-results/verify-full.json`, `test-results/all.junit.xml` e `test-results/resources-all.json`. O JUnit confirmou 54 casos sem falhas. O runner usou `wagering_test_1790816317360_84d7639f`, verificou migrations em banco novo e registrou `cleanupComplete: true`, sem recursos cuja limpeza falhou. Banco e filas principais não foram usados para rollback ou limpeza.

A revisão das assertions identificou evidências parciais apesar do gate aprovado: unidade das cinco operações/idempotência, reconciliação final de todas as carteiras, consulta direta de inbox/outbox após rollback, eventos de LOSS/expiração, HTTP de falha e SIGTERM com mensagem controladamente em andamento. Essas lacunas deram origem à retomada registrada acima. Na auditoria, a documentação ainda não tinha commit; ela passou a integrar o commit de documentação. Nenhuma mudança de comportamento, migration ou harness foi feita naquela auditoria; somente o mapa, o estado da especificação e este registro foram atualizados após o gate.

Os três documentos atualizados foram formatados com `bun run --bun prettier --write docs/TRACEABILITY.md docs/VALIDATION.md specs/001-distributed-wagering/spec.md`, com exit code 0. O enunciado permaneceu com SHA-256 `47795FCE2FC38CAE5F1B91368EBAF80B7A2ED1FE147F36704B665FAF0613812E`.

## Execuções anteriores

**Após a padronização do espaçamento: 54 testes passaram no Windows com PostgreSQL/SQS em Docker, zero falhas e 215 assertions em nove arquivos.** O gate completo aprovou typecheck estrito, ESLint sem warnings, Prettier e todas as suítes. As execuções anteriores também estão registradas abaixo.

| Execução                                                   | Comando                                               | Resultado                        |
| ---------------------------------------------------------- | ----------------------------------------------------- | -------------------------------- |
| Windows, espaçamento padronizado, PostgreSQL/SQS em Docker | `bun run verify:full`                                 | 54 testes, zero falhas, 45,67 s  |
| Windows, contratos extraídos, PostgreSQL/SQS em Docker     | `bun run verify:full`                                 | 54 testes, zero falhas, 64,10 s  |
| Windows, antes da extração                                 | `bun run verify:full`                                 | 54 testes, zero falhas, 140,25 s |
| Docker/Linux, antes da extração                            | `docker compose --profile test run --build --rm test` | 54 testes, zero falhas, 64,13 s  |

Os tempos da tabela medem o Bun test. O gate completo após a padronização do espaçamento, incluindo checks, criação/migrations e limpeza, levou 91,59 s, de 23:42:52 a 23:44:24 UTC. Após a extração de tipos, levou 134,99 s, de 23:06:40 a 23:08:55 UTC. A execução Windows anterior levou 265,11 s. O gate Docker/Linux não foi repetido após a extração.

Foram comprovados três processos/sessões distintos e sobrepostos, 50 duplicatas, disputa de saldo, wallets independentes, refunds concorrentes, snapshots sob escrita, crashes de consumidor/publisher e referência recuperada por novo processo.

A suíte também validou migrations `up → down → up` em banco exclusivo, SQL direto contra as proteções, precisão de um centavo em saldo alto, HTTP/SQS, redrive após cinco tentativas, DLQ auditada e efeito downstream idempotente em SQL. A execução após a padronização do espaçamento está em `test-results/verify-code-spacing.log`, e a extração está em `test-results/verify-contract-refactor.log`; as anteriores estão em `test-results/verify-windows.log` e `test-results/verify-docker.log` (ignorados pelo Git).

As cinco migrations foram exercitadas. A última fixa o `search_path` dos triggers: o teste cria uma tabela temporária `wallets` com a role da aplicação, tenta alterar apenas o saldo real e comprova rejeição no commit e reconciliação preservada.

## Extração de tipos e contratos

Os contratos foram agrupados em 18 arquivos `types/` nas respectivas camadas; `wagerKinds` e o token `RUNTIME` foram extraídos para `constants/`. Imports de aplicação, infraestrutura, scripts e testes foram atualizados, assim como os links da documentação. O resultado financeiro persistido reutiliza `StoredResult` e a direção do ledger reutiliza `LedgerDirection`.

Uma comparação da estrutura JavaScript emitida dos 44 arquivos existentes, ignorando imports e descontando a movimentação das duas constantes, não encontrou mudanças de lógica. Os 18 arquivos de contratos não geram lógica em runtime e as constantes preservam suas definições. O relatório está em `test-results/contract-refactor.json`. Essa revisão complementa o gate completo executado sobre o código reorganizado.

`verify-full.json` registrou sucesso em todas as etapas, e `resources-all.json` confirmou `cleanupComplete: true` e nenhuma falha na limpeza. Os recursos exclusivos desta execução foram removidos.

## Espaçamento do código

Foram revisados 64 arquivos TypeScript e ajustados 45. Uma linha em branco separa funções, classes, métodos, getters e etapas de preparação, validação, execução e retorno. Campos e propriedades relacionadas permanecem juntos. O padrão está registrado em [DEVELOPMENT](DEVELOPMENT.md#regras-de-código).

A comparação dos arquivos anteriores com os finais confirmou alterações somente de whitespace e a mesma estrutura sintática em todos os 64 arquivos, incluindo tipos e literais de strings, templates SQL e expressões regulares. Os relatórios estão em `test-results/code-spacing.json` e `test-results/code-spacing-check.json`.

`bun run verify:full` aprovou todas as etapas. O JUnit confirmou 54 casos e nenhuma falha; a harness confirmou limpeza completa do banco e das filas exclusivos desta execução.

## Gate de qualidade e harnesses

ESLint 10.11.0 e typescript-eslint 8.71.0 executaram análise com tipos, regras de dependência entre camadas e verificações assíncronas. Três exemplos deliberadamente inválidos, analisados sem mudar arquivos de produto, foram bloqueados: framework no domínio, infraestrutura na aplicação e promise abandonada.

Cinco novos testes comprovaram identificação obrigatória dos recursos, rejeição de banco/prefixo compartilhado e término real de um processo filho antes da barreira IPC. O JUnit do Windows foi lido como XML e confirmou 54 casos e zero falhas. `resources-all.json` confirmou limpeza completa, sem recursos pendentes; `verify-full.json` registrou sucesso de todas as etapas.

A primeira execução Windows da nova harness expôs timeout de lock quando a fixture atrasava todos os replays em 200 ms. A espera foi limitada ao primeiro commit de cada processo, preservando as assertions; as cinquenta duplicatas passaram em 7,89 s na execução final. Os retries dos testes permaneceram desabilitados e o timeout de lock de produção permaneceu em cinco segundos.

O workflow GitHub Actions foi configurado com versões fixadas por SHA, Bun fixado, infraestrutura real e coleta de evidências. Sua execução no GitHub ainda não ocorreu; o mesmo comando foi aprovado localmente nos dois ambientes. Detalhes dos comandos e configurações estão em [DEVELOPMENT](DEVELOPMENT.md).

## Operação Docker — execução anterior à extração

Cluster com três aplicações, PostgreSQL e LocalStack saudáveis. Porta 3000 estava ocupada por outro serviço; o `.env` local configura **3100–3102**, sem encerrar esse serviço. Defaults para uma instalação nova permanecem 3000–3002.

O cluster final foi reconstruído após as cinco migrations. As três aplicações receberam apenas `DATABASE_URL` da role restrita, `PORT` e `SQS_ENDPOINT`; nenhuma recebeu `DATABASE_ADMIN_URL`.

Após a carga final, uma consulta SQL sobre todas as carteiras encontrou **zero divergências** entre saldo e soma assinada do ledger. A outbox tinha **zero eventos não publicados**; os três triggers estavam com `search_path=pg_catalog, public, pg_temp`.

`bun run seed` e `bun run demo` passaram. O demo confirmou replay HTTP, envio de duplicata SQS, LOSS sem movimento e reconciliação de 75.00 BRL com dois lançamentos (abertura + BET).

SIGTERM foi exercitado por `docker compose --profile cluster restart app-3`: `shutdown_draining` às 20:47:14.881 UTC, `shutdown_completed` às 20:47:16.522 UTC, aproximadamente **1,64 s**. Após o novo boot, readiness retornou 200. Os failpoints da suíte cobrem separadamente crashes com trabalho financeiro confirmado e publicação em andamento.

## Experimento de carga local

Execução da implementação financeira em 30/09/2026 às 21:22:49 UTC, antes da configuração das harnesses de qualidade: Windows, Ryzen 7 5700X, 16 CPUs lógicas, 40 GiB de RAM; três instâncias Docker ativas. Entrada HTTP na porta 3100, com outbox/publishers assíncronos ativos. A latência medida termina na resposta HTTP.

Metodologia: 12 carteiras novas, saldo inicial 10000.00 BRL, 24 operações de warmup fora da medição, 300 BETs de 0.01 BRL e concorrência 12. Todas as carteiras foram reconciliadas ao fim.

| Métrica                   |    Resultado |
| ------------------------- | -----------: |
| Tempo medido              |      4,957 s |
| Throughput                |  60,52 req/s |
| p50                       |    182,15 ms |
| p95                       |    333,98 ms |
| p99                       |    367,40 ms |
| Erros                     | 0 / 300 (0%) |
| Conflitos SQL registrados |            0 |
| Lag observado da outbox   |       1,21 s |
| Carteiras reconciliadas   |      12 / 12 |

O lag é a amostra Prometheus capturada ao fim, não o máximo durante a execução. Conflitos contam deadlock/serialization/lock timeout, não toda espera por lock. O experimento não mede a capacidade máxima do cluster nem substitui testes em AWS; a constraint de auditoria cresce com o histórico. O JSON detalhado fica em `test-results/load.json`.

## Escopo da evidência

PostgreSQL e SQS são reais no ambiente local (SQS em LocalStack). Falhas são injetadas nos limites de commit/publicação; os dois testes de crash encerram de fato processos do sistema operacional. Unidade do diagnóstico injeta um snapshot legado inconsistente na consulta, sem violar as proteções do banco principal.

Recursos das suítes usam prefixos exclusivos e são removidos ao término. Reversão e limpeza foram executadas somente em bancos novos e descartáveis, preservando os dados existentes.

Nenhum resultado local constitui uma previsão de nota ou capacidade de produção em AWS.

## Paginação e estabilidade da demo — 03/10/2026

Para evitar transferir e clonar o histórico inteiro a cada atualização da página, o dashboard agora retorna 100 peers por consulta, apostas da página e as 30 operações recentes. A busca de peers consulta no servidor apenas quando o texto ou a seleção muda, com até 100 opções. A aposta em lote envia uma intenção compacta ao servidor. Índices em memória eliminam buscas lineares no histórico para cada resultado financeiro, e os contadores de operação pendente e apostas abertas mantêm o tick constante. As identidades continuam persistidas antes do processamento; o checkpoint é salvo após concluir o lote ou ao pausar diante de resultado pendente.

Checks estáticos executados no workspace Windows: `bun run typecheck` (exit 0), `bun run lint` (exit 0, sem warnings), `bun run --bun prettier --check demo/table.ts demo/server.ts demo/types/contracts.ts demo/public/client.ts` (exit 0) e `git diff --check` (exit 0). Nenhum teste ou carga foi executado nesta alteração.

A imagem local `jungle-challenge:demo-stability-20261003` foi construída para `linux/amd64` com o Dockerfile de runtime (manifest `sha256:011290314d59942a81c0609d32e8ee0aa53b9241ae2eca9c4d1e37c7f75f1d54`); o container não foi iniciado localmente.

Na leitura remota somente de consulta, em 03/10/2026 por volta de 07:31 UTC, a produção estava na rodada 1367, fase `crashed`, com 10.106 peers, 2.375 apostas em `active` e 2.375 operações LOSS sem resultado. Treze dessas operações registravam fechamento inesperado do socket; as demais não tinham erro salvo. O total pendente permaneceu em 2.375 entre as leituras desta sessão. Demo, API observada, PostgreSQL e LocalStack apareciam `running/healthy`, sem reinícios: respectivamente 125/256 MiB, 122/512 MiB, 203/512 MiB e 415,5/512 MiB. A demo usa limite de 0,25 CPU e chegou a 22,27% na amostra, próximo ao teto; LocalStack estava com 81% do limite de memória. Não houve OOM observado.

A imagem não foi implantada e nenhuma operação foi reenviada. Como os LOSS ainda estão sem resultado e as apostas seguem abertas, reiniciar a demo pode iniciar operações financeiras automáticas durante a recuperação. O acesso HTTPS direto pelo cliente Windows continuou falhando com Schannel `SEC_E_NO_CREDENTIALS`; a inspeção remota via SSH com acesso elevado funcionou. Não há medição de carga pós-correção nem prova da nova versão em produção.

## Recuperação do lock da demo — 04/10/2026

O lock agora guarda PID, boot ID do host, instante de início em `/proc/<pid>/stat` e um token de proprietário. Ao encontrar um PID reutilizado, o processo compara a identidade, recupera o lock antigo sob o arquivo de guarda e continua a recuperação do journal. O token impede que o encerramento de um coordenador remova o lock de outro processo.

`bun run verify:full` passou com Bun 1.4.2 em um contexto limpo baseado no commit atual mais somente `demo/journal.ts` e `tests/unit/decolagem.test.ts`. PostgreSQL 17.6 e LocalStack 4.9.2 foram iniciados no projeto isolado `demo-lockpid-20261004`; o relatório marcou `cleanupComplete: true` para as duas suítes de infraestrutura. Resultado: 76 testes unitários, 51 de integração e 10 de concorrência aprovados, zero falhas e um skip previsto no teste de SIGTERM no Windows. Relatórios: `test-results/demo-lockpid-20261004/context/test-results/verify-full.json` e `resources-all.json`.

Ambiente local: Docker 29.5.3, Compose 5.1.4. Comandos no contexto isolado:

```sh
docker compose -p demo-lockpid-20261004 up -d postgres localstack --wait
bun run verify:full
docker compose -p demo-lockpid-20261004 down -v --remove-orphans
docker build --platform linux/amd64 -t jungle-challenge:demo-lockpid-20261004 .
```

A imagem `jungle-challenge:demo-lockpid-20261004` foi construída para `linux/amd64` (manifest `sha256:5747d93de90e624dbc7e1cfe12a4002b5edd00046cf200602d32e764d0f5430e`); o tar transferido conferiu SHA-256 `d445bdad2b00eda706a1f288b084699b24bfa9891b41eeaef94f79fc58fa88eb`. Um smoke Linux confirmou recuperação de PID reutilizado, rejeição de um segundo coordenador ativo e liberação do lock.

No host `subiu-sm`, Compose 5.3.0 validou a configuração e `up -d --no-deps --wait demo` recriou somente `jungle-server-demo-1`. A imagem financeira `jungle-challenge:delivery-20261001-6456f6e` manteve o mesmo container saudável. Sem credenciais, `GET /` e `GET /demo/state` retornaram HTTP 200; o container da demo ficou `healthy`. O journal da nova sessão foi preservado no volume: seis peers, zero apostas e zero operações pendentes. O journal anterior ao reset permanece em `pre-reset-20261004` dentro do mesmo volume. Banco e fila financeiros não foram alterados.
