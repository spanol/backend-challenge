# Processador distribuído de apostas

Challenge Jungle Gaming implementado com **Bun, NestJS, TypeScript, PostgreSQL e SQS/LocalStack**. A API HTTP e os consumidores SQS compartilham o processamento financeiro, com idempotência persistida no PostgreSQL.

## Requisitos

- Docker com Compose v2.
- Bun **1.4.2**, somente para executar a aplicação e os scripts no host.

Execute os comandos na raiz do projeto e escolha um dos modos abaixo. A configuração padrão funciona sem `.env`; para trocar portas, copie [.env.example](.env.example) para `.env` e ajuste as URLs dos comandos.

## Iniciar com Docker

```sh
docker compose --profile app up --build -d --wait
curl http://localhost:3000/health/ready
docker compose exec app bun run demo
```

O setup aplica migrations e cria as filas automaticamente. A API fica em **http://localhost:3000**, com os workers ativos. O script `demo` cria uma carteira e executa BET, replay HTTP, duplicata SQS, LOSS e reconciliação.

No PowerShell, use `curl.exe` no lugar de `curl`.

Para acompanhar logs e encerrar, preservando os dados:

```sh
docker compose --profile app logs -f app
docker compose --profile app down
```

## Iniciar com Bun local

```sh
docker compose up --build -d postgres localstack --wait
bun install --frozen-lockfile --ignore-scripts
bun run db:migrate
bun run queues:init
bun run start
```

A API usa **http://localhost:3000**, PostgreSQL **localhost:55432** e LocalStack **localhost:4566**. Em outro terminal, execute `bun run demo` para exercitar o fluxo financeiro. Para desenvolvimento com reinício automático, use `bun run dev`.

## Demo jogável

A demo **Decolagem** está disponível publicamente em [jungle.subiu.dev](https://jungle.subiu.dev), sem necessidade de login. Para executar localmente e acompanhar as rodadas automáticas, consulte [DEMO](docs/DEMO.md#execução-local).

## Verificar a implementação

Com Bun instalado, `bun run verify` executa os checks estáticos e os testes de unidade; `bun run verify:full` inclui integração e concorrência com PostgreSQL/SQS ativos.

Para executar o gate completo somente com Docker:

```sh
docker compose up --build -d postgres localstack --wait
docker compose --profile test run --build --rm --no-deps test
```

As suítes de infraestrutura criam bancos e filas exclusivos e removem os recursos da própria execução. Os dados da aplicação são preservados.

## Documentação

| Guia                                     | Conteúdo                                      |
| ---------------------------------------- | --------------------------------------------- |
| [API e SQS](docs/API.md)                 | Rotas, payloads, idempotência e recuperação   |
| [Perfis de execução](docs/RUNNING.md)    | Três instâncias, Keycloak, migrations e carga |
| [Observabilidade](docs/OBSERVABILITY.md) | Grafana, métricas, logs e traces              |
| [Desenvolvimento](docs/DEVELOPMENT.md)   | Comandos, testes, isolamento e CI             |
| [Entrega e evidências](docs/DELIVERY.md) | Roteiro de avaliação, resultados e capturas   |

O [enunciado](CHALLENGE.md), a [especificação](specs/001-distributed-wagering/spec.md) e a [arquitetura](ARCHITECTURE.md) documentam os requisitos e as decisões técnicas.
