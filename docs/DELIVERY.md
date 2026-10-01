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

No PowerShell use `curl.exe`. O setup aplica migrations e cria as filas. O demo cria sua própria carteira, comprova BET/replay, duplicata SQS, LOSS e reconciliação. A demo jogável separada não integra o projeto entregue.

## Provas automatizadas

```sh
docker compose up -d postgres localstack --wait
docker compose --profile test run --build --rm --no-deps test
```

Esse comando executa `verify:full`: tipos, lint, formatação, unidade, integração e concorrência. Integração e concorrência criam bancos/filas exclusivos, exercitam migrations reversíveis e removem apenas os recursos da própria execução. O gate final registrou 121 testes/1.313 assertions nos dois hosts.

O E2E complementar do Keycloak real tem 15 testes/71 assertions por host e stack descartável própria; comandos em [IDP-E2E](IDP-E2E.md). Ele é separado do gate completo porque exige o IDP ativo.

GitHub Actions está configurado como conveniência. A execução remota não foi realizada e não é exigida pelo enunciado.

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

## Evidências que acompanham o pacote

O pacote inclui o código de um commit identificado, `submission.json`, JUnit/JSON dos gates, manifests de carga, auditorias SQL, logs e telemetria exportada. O relatório `test-results/heavy-subiu-20261001/index.html` resume as baterias e aponta para os dados brutos. Os resultados ficam ignorados pelo Git e são incluídos no ZIP de entrega.

As baterias finais mediram 49.300 operações por host: 36.300 antes da coleta Loki/Alloy e 13.000 com a observabilidade completa. Versões/configurações e incidentes anteriores são distinguidos nos manifests. Os testes comprovaram reconciliação e efeito único nos cenários executados; as medições locais não estimam capacidade AWS nem garantem nota.

O pacote exclui credenciais privadas de deploy, `.env`, dumps de banco, `.git`, dependências instaladas e a demo guardada no stash. Os exemplos de credenciais versionados são exclusivos de desenvolvimento local.
