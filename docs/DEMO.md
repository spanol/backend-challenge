# Demo Decolagem

Acesse `https://jungle.subiu.dev` com o login atual. A página e `/demo/*` usam BasicAuth do proxy; a demo chama a API financeira interna. Os créditos são fictícios, os pontos de estouro são predefinidos e a mesa é compartilhada por todos os visitantes.

## Roteiro

Crie uma sessão com carteiras independentes, aposte e inicie o voo. Saque durante o voo ou espere a perda. Antes do voo, cancelar gera REFUND. Os controles de evidência mostram ledger, reconciliação e resultado histórico; repetir conserva esse resultado, mesmo após o saldo atual mudar. Reverter um saque envia ROLLBACK. No modo compartilhado, 24 apostas de 80.00 disputam uma carteira de 100.00: uma pode ser aceita.

N peers são jogadores simulados. O servidor publicado chama uma API; os testes isolados exercitam três apps HTTP reais. A demo mantém intenções em journal persistente, com exclusão de processo, recuperação e retry. A idempotência financeira continua sendo garantida pelo PostgreSQL.

## Execução local

Com a API financeira disponível:

```sh
DEMO_API_URLS=http://127.0.0.1:3000 bun run demo:game
```

Abra `http://127.0.0.1:3200`. No PowerShell, defina `$env:DEMO_API_URLS` antes do comando. `DEMO_HOST`, `DEMO_PORT`, `DEMO_PUBLIC_ORIGIN` e `DEMO_JOURNAL_PATH` configuram o servidor. Por padrão, ele usa loopback e `.tmp/decolagem-session.json`. Não apague o journal para resolver uma operação pendente: use retry ou reinicie para recuperação.

## Bateria pela demo

```powershell
$env:DEMO_BASE_URL = 'https://jungle.subiu.dev'
$env:DEMO_BASIC_ACCESS_FILE = (Resolve-Path '.tmp/heavy-subiu/access.json').Path
$env:DEMO_LOAD_PEERS = '24'
$env:DEMO_LOAD_ROUNDS = '6'
$env:DEMO_LOAD_OUTPUT = 'test-results/demo-load-public'
bun run test:demo
```

O arquivo privado de acesso tem `api.username` e `api.password`; o script lê os valores sem imprimi-los. Finalize a rodada atual antes da execução e não altere a mesa durante a bateria. Cada fase cria carteiras próprias e conserva todo o histórico financeiro. A bateria cobre BET, WIN, LOSS, REFUND, ROLLBACK, saque tardio, replay histórico, conflito e disputa de saldo. Confere saldo exato e reconciliação de cada carteira e termina com uma sessão pronta para apresentação. `demo-load.json` registra respostas e tempos; respostas 409 previstas fazem parte das verificações.

## Grafana do servidor

```sh
ssh -N -L 39333:127.0.0.1:39323 subiu
```

Abra `http://localhost:39333/d/distributed-wagering-overview` e use o usuário `admin` e a senha local do Grafana do servidor. A porta 39323 local pertence à outra stack. Selecione a janela da bateria para observar operações, rejeições, duplicatas, HTTP, CPU, memória, outbox, logs e traces da API financeira. O coordenador da demo tem limite de 0.25 CPU e 256 MiB; a carga também consome recursos e não mede a capacidade máxima da API.

## Deploy

`compose.demo.yaml` complementa `compose.subiu.yaml` no projeto `jungle-server`. Defina `JUNGLE_DEMO_IMAGE` para a imagem com a demo e execute `up -d --no-deps --wait demo` com os dois arquivos. O volume `server-demo` conserva o journal. O router usa o middleware `jungle-access` existente e prioridade 150 somente para página, assets e `/demo/*`. O serviço financeiro continua na imagem já validada.

## Validação do incremento

O gate Docker/Linux passou em 01/10/2026: **137 testes, 1.418 assertions, zero falhas e zero skips** (75 unidade, 51 integração e 11 concorrência). Os recursos isolados foram removidos pelo runner. Os 16 testes adicionais verificam a demo, incluindo perda de resposta após commit, recuperação, três APIs, disputa de saldo e Origin HTTPS. Relatórios reais estão em `test-results/demo-subiu-20261001/`; a evidência da bateria pública será registrada após a execução.
