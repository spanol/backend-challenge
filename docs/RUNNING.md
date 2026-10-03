# Perfis e operação local

Execute os comandos na raiz do projeto. Docker Compose é necessário para a infraestrutura e Bun 1.4.2 para os scripts executados no host. O [README](../README.md) contém a inicialização básica; [.env.example](../.env.example) lista as portas e configurações.

## Três instâncias

```sh
docker compose --profile cluster up --build -d --wait
```

As três APIs usam portas 3000, 3001 e 3002, o mesmo PostgreSQL e as mesmas filas. Cada instância executa seus próprios consumidores, publishers e jobs. Locks, unicidade, inbox e leases no banco sustentam a correção entre processos.

```sh
docker compose --profile cluster logs -f app app-2 app-3
```

## Autenticação e observabilidade

O perfil `auth` inicia o Keycloak local e uma API protegida. Os demais perfis mantêm autenticação desligada para desenvolvimento e testes.

```sh
docker compose --profile auth up --build -d
```

O token de desenvolvimento usa client credentials do client `provider-a` (segredo local `provider-a-local-only`) e deve enviar `providerId: "provider-a"`. Emita-o com:

```sh
curl.exe -X POST http://localhost:8180/realms/jungle-gaming/protocol/openid-connect/token -H "Content-Type: application/x-www-form-urlencoded" -d "grant_type=client_credentials&client_id=provider-a&client_secret=provider-a-local-only"
```

Health permanece público; as rotas de negócio e `/metrics` exigem bearer token nesse perfil. Nunca reutilize as credenciais do Compose fora do ambiente local. Os perfis auth e observability usam a mesma porta padrão 3100; configure `APP_AUTH_PORT` e `APP_OBSERVED_PORT` para iniciá-los juntos.

```sh
docker compose --profile observability up --build -d --wait
```

Esse perfil inicia a API instrumentada, Prometheus, Tempo, Loki, Alloy, gateway de logs e Grafana. Acesse Grafana em `http://localhost:3030` (`admin` / `local-admin-only`), Prometheus em `http://localhost:9090` e a API de consulta do Tempo em `http://localhost:3200`. O dashboard `Distributed Wagering Overview` reúne métricas, logs JSON e traces correlacionados. Gere tráfego com `bun run test:load` ou os exemplos HTTP para visualizar dados recentes. Exportação OTLP fica desligada quando `OTEL_EXPORTER_OTLP_ENDPOINT` não está definido.

O dashboard também mostra CPU do processo em percentual de um núcleo, memória residente (RSS), heap JavaScript, atraso p99 do event loop, respostas HTTP por status, eventos pendentes na outbox e mensagens SQS visíveis/em processamento/atrasadas. CPU pode ultrapassar 100% com múltiplas threads; contagens SQS são aproximadas. Prometheus coleta a cada cinco segundos. Compare a carga com a drenagem posterior: resposta HTTP confirma o commit financeiro, enquanto a publicação da outbox continua assíncrona. Veja as medições e seus limites em [VALIDATION](VALIDATION.md).

## Migrations e preservação dos dados

```sh
bun run db:migrate
bun run db:rollback
```

`db:rollback` reverte uma versão por execução. A reversão da migration inicial remove o schema: use somente em um banco descartável ou com uma decisão explícita sobre os dados. Os testes de reversibilidade já fazem isso em um banco isolado. As migrations usam transação e são executadas com `DATABASE_ADMIN_URL`; runtime usa `DATABASE_URL`.

Para encerrar, use os mesmos perfis habilitados na inicialização. Por exemplo, `docker compose --profile cluster down` encerra as três APIs e sua infraestrutura, preservando os volumes. Evite `down -v` se quiser manter o histórico.

## Carga e evidências

A demo jogável Decolagem está em `https://jungle.subiu.dev` e não exige login. Consulte [DEMO](DEMO.md) para jogar, executar a bateria pelas rotas da interface e acompanhar o Grafana do servidor. Localmente, `bun run demo:game` inicia o servidor da demo; `bun run test:demo` exercita os cenários financeiros pela mesa.

O dashboard reúne métricas, logs Loki e traces Tempo, com correlação por `correlationId`; veja [OBSERVABILITY](OBSERVABILITY.md). O E2E complementar obtém tokens do Keycloak real em stack descartável: [IDP-E2E](IDP-E2E.md).

Com a aplicação e seus workers ativos:

```sh
bun run test:load
```

Configurações: `LOAD_BASE_URL`, `LOAD_REQUESTS` (300), `LOAD_CONCURRENCY` (12), `LOAD_WALLETS` (12), `LOAD_DRAIN_TIMEOUT_SECONDS` (180). O teste cria carteiras próprias, aquece 24 apostas e mede BETs de um centavo. Confere cada saldo e quantidade de lançamentos contra os débitos observados, incluindo warmup. HTTP tem timeout de 30 segundos; a latência/throughput terminam na resposta, e a recuperação da outbox tem medição separada. O comando retorna falha se houver erros, divergências, falhas de coleta ou timeout de drenagem.

`test-results/load.json` registra ambiente, metodologia, throughput, p50/p95/p99, erros, conflitos, picos amostrados de CPU/RSS/heap/event loop, backlog/lag e reconciliações. `test-results/load-samples.json` preserva amostras durante a carga e a recuperação, com intervalo de um segundo mais o tempo da coleta. A drenagem exige outbox zero em uma coleta completa de telemetria iniciada após a carga; uma gauge zero antiga não basta. Consumo representa o processo acessado por `LOAD_BASE_URL`, enquanto a outbox é compartilhada. Esses arquivos são ignorados pelo Git; resultados selecionados ficam em [VALIDATION](VALIDATION.md).

Para reproduzir a carga na API instrumentada sem Bun no host:

```sh
docker compose --profile observability up --build -d --wait
docker compose --profile test run --build --rm --no-deps -e LOAD_BASE_URL=http://app-observed:3000 test bun run test:load
```

Use o Grafana para selecionar a janela indicada por `measuredAt` e pelas amostras. No perfil opcional de autenticação, esse gerador sem bearer token deve apontar para uma API local sem auth. CPU é percentual de um núcleo; picos dependem da frequência de amostragem. Não há meta de RPS nem previsão de capacidade AWS.

Cada movimento financeiro confirmado, incluindo a abertura da wallet, também produz um diário contábil com débito/crédito balanceados na mesma transação SQL. O ledger da wallet continua sendo a fonte de reconstrução do saldo; a conta de compensação é interna e não simula liquidação bancária.

## Limitações documentadas

Autenticação não soma pontos e permanece desligada por padrão; o perfil opcional integra Keycloak e valida vínculo do token com o provedor. `ProviderIdentityPort` continua sendo a extensão de identidade do domínio. Credenciais do Compose são exclusivas de desenvolvimento local.

A constraint financeira reconstrói o ledger da carteira no commit. Isso privilegia verificabilidade; seu custo cresce com o histórico. Outbox oferece entrega pelo menos uma vez e não promete ordem de commit entre publishers concorrentes. Consumidores devem persistir `eventId` e usar versão para projeções que dependam de ordem. LocalStack comprova o fluxo local; não substitui validação operacional em AWS.
