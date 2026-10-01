# Guia de entrega e avaliação

## Percurso inicial

Requisitos: Docker com Compose. Bun 1.4.2 é necessário somente para executar os scripts diretamente no host. Os defaults funcionam sem `.env`; para trocar portas, consulte [.env.example](../.env.example).

Na raiz do projeto:

```sh
docker compose --profile app up --build -d --wait
curl http://localhost:3000/health/ready
docker compose exec app bun run seed
docker compose exec app bun run demo
```

No PowerShell use `curl.exe`. O setup aplica migrations e cria as filas. O comando `bun run demo` cria sua própria carteira e comprova BET/replay, duplicata SQS, LOSS e reconciliação. A demo jogável Decolagem também integra o repositório e está publicada em `https://jungle.subiu.dev`; veja [DEMO](DEMO.md).

## Provas automatizadas

```sh
docker compose up -d postgres localstack --wait
docker compose --profile test run --build --rm --no-deps test
```

Esse comando executa `verify:full`: tipos, lint, formatação, unidade, integração e concorrência. Integração e concorrência criam bancos/filas exclusivos, exercitam migrations reversíveis e removem apenas os recursos da própria execução. O gate final Docker/Linux local registrou **137 testes/1.418 assertions**, sem falhas ou skips. As provas anteriores executadas nos dois hosts permanecem documentadas em [VALIDATION](VALIDATION.md).

O E2E complementar do Keycloak real passou na revisão final com **15 testes/71 assertions** em stack descartável própria; comandos em [IDP-E2E](IDP-E2E.md). Ele é separado do gate completo porque exige o IDP ativo. O total final é **152 testes/1.489 assertions**.

GitHub Actions está configurado como conveniência. A prova final registrada neste guia foi executada em Docker/Linux local; o enunciado não exige execução remota do workflow.

## Revisão técnica

| Pergunta                                                   | Onde encontrar a resposta                                                                       |
| ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Como subir e chamar a API?                                 | [README](../README.md)                                                                          |
| Por que o saldo permanece correto entre instâncias?        | [ARCHITECTURE](../ARCHITECTURE.md): locks por carteira, commit atômico e constraints SQL        |
| Por que uma duplicata não move dinheiro novamente?         | [ARCHITECTURE](../ARCHITECTURE.md): identidade persistente, hash canônico e resultado histórico |
| O que acontece em crash, retry e referência fora de ordem? | [TRACEABILITY](TRACEABILITY.md): critérios de mensageria e concorrência                         |
| Quais decisões adaptam o enunciado?                        | [Especificação](../specs/001-distributed-wagering/spec.md) e [ARCHITECTURE](../ARCHITECTURE.md) |
| O que foi efetivamente executado?                          | [VALIDATION](VALIDATION.md): comandos, versões, resultados e limitações                         |
| Como consultar métricas, logs e traces?                    | [OBSERVABILITY](OBSERVABILITY.md)                                                               |
| Como acessar o deploy demonstrativo?                       | [SUBIU](SUBIU.md); credenciais fornecidas separadamente                                         |
| Onde estão os resultados finais e as capturas?             | [Evidências](../evidence/README.md) e [revisão final](FINAL-REVIEW.md)                          |

## Evidências que acompanham o pacote

O repositório contém o código, o [relatório da revisão final](FINAL-REVIEW.md), a [galeria selecionada e os dois ZIPs de evidências](../evidence/README.md). Os ZIPs incluem JUnit/JSON dos gates, manifests de carga, auditorias, logs e telemetria exportada. Os relatórios completos de desenvolvimento continuam em `test-results/`, ignorado pelo Git.

As baterias finais mediram 49.300 operações por host: 36.300 antes da coleta Loki/Alloy e 13.000 com a observabilidade completa. Versões/configurações e incidentes anteriores são distinguidos nos manifests. Os testes comprovaram reconciliação e efeito único nos cenários executados; as medições locais não estimam capacidade AWS nem garantem nota.

O repositório exclui credenciais privadas de deploy, `.env`, dumps de banco, `.git` e dependências instaladas. A demo está integrada; o stash é apenas uma cópia local de segurança. Os exemplos de credenciais versionados são exclusivos de desenvolvimento local.
