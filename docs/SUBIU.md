# Execução no home server

`compose.subiu.yaml` é uma stack exclusiva do challenge. Usa PostgreSQL/LocalStack próprios, rede privada e volumes persistentes. Apenas a API ingressa na rede externa `subiu_edge`; o Traefik e o túnel Cloudflare existentes fornecem a rota `jungle.subiu.dev`. Nenhuma aplicação existente participa do setup ou da limpeza dos testes.

Entrega original: `releases/20261001-delivery-6456f6e`, imagem `jungle-challenge:delivery-20261001-6456f6e`, fonte executável `6456f6e`. O script CLI demo e o gate completo passaram nessa imagem no host local e no servidor. A API atual usa `jungle-challenge:messaging-recovery-20261006-v1`, validada no gate completo de 173 testes; o broker usa `jungle-localstack:4.9.2-fifo-ttl-v1`. O override ativo está em `releases/20261006-demo-portfolio-1000-2ee02e9/compose.demo.yaml`, com a imagem da demo `jungle-challenge:demo-portfolio-1000-20261006-2ee02e9`; API e broker mantêm suas imagens atuais. A base continua em `releases/20261001-demo-52e850a/compose.subiu.yaml`. A sessão pública usa 1.000 peers e até 1.000 apostas de R$ 1,00 por rodada na mesma carteira, com R$ 10.000,00 fictícios de abertura. Falta de saldo pausa sem recarga. O release passou em `bun run verify` e foi observado em produção com 1.000 apostas sequenciais, reconciliação sem divergência e API financeira intacta. Versões, procedimento e resultados estão em [VALIDATION](VALIDATION.md#reposicionamento-da-demo-em-produção--06102026) e [DEMO](DEMO.md).

## Release e configuração

Construa a imagem no host de desenvolvimento com Bun 1.4.2, depois transfira/carregue a imagem no servidor. A configuração exige `JUNGLE_IMAGE`, `POSTGRES_OWNER_PASSWORD`, `POSTGRES_APP_PASSWORD` (64 caracteres hexadecimais), `JUNGLE_GRAFANA_PASSWORD` e `JUNGLE_INGRESS_USERS` (usuário/hash bcrypt). Guarde `.env` e credenciais com modo 600, fora do Git. O bootstrap cria a role de aplicação com segredo próprio antes das migrations, preservando as permissões restritas e as migrations originais.

```sh
docker compose --env-file ../../.env -f compose.subiu.yaml -p jungle-server config --quiet
docker compose --env-file ../../.env -f compose.subiu.yaml -p jungle-server up -d --wait
curl http://127.0.0.1:39320/health/ready
```

Esses comandos partem da pasta `releases/<release>` dentro do diretório exclusivo da aplicação. `.env` fica na raiz desse diretório. Configuração DNS cria somente o CNAME do challenge para o túnel existente; não substitui registros divergentes nem altera o ingress compartilhado. Na primeira entrega não há release anterior para rollback.

Na apresentação atual, inclua `compose.demo.yaml` com a base `compose.subiu.yaml` ao operar API, demo e dependências. `JUNGLE_IMAGE` referencia a API, `JUNGLE_DEMO_IMAGE` a demo e `JUNGLE_SQS_IMAGE` a imagem derivada do broker; o override da release atual fixa explicitamente essas imagens. O override define API/PostgreSQL em **1,5 CPU e 1 GiB cada**, demo em **1 CPU / 512 MiB** e LocalStack em **1 CPU / 2 GiB**. A quota efetiva antiga do broker era 0,5 CPU; foi corrigida ao vivo e no override em 06/10. `DEMO_EVENT_AUDIT=true` habilita neste perfil o consumidor de eventos com recibo durável antes do ACK; fora do override ele fica desabilitado. Aplique migrations para cima quando houver mudança de schema e aguarde liquidação antes de recriar a demo. Antes de recriar o broker, pause o auto bet e o publisher e drene todas as filas: seu volume não comprovou persistência das mensagens. O procedimento está em [MESSAGING-RECOVERY](MESSAGING-RECOVERY.md#procedimento-operacional); a preservação do journal está em [DEMO](DEMO.md#deploy). Não omita o override em um futuro `up`, pois a base conserva os limites originais.

API, Prometheus, Tempo e Grafana publicam somente em loopback nas portas 39320–39323, configuráveis. Health permanece público pelo proxy; as rotas públicas da API exigem BasicAuth operacional do Traefik. O router separado da demo publica somente página, assets e `/demo/*` sem login; a identidade OIDC/JWKS do provedor continua disponível conforme o README. O gerador interno acessa a API pela rede privada e não mede autenticação/TLS/Cloudflare.

```sh
ssh -N -L 39333:127.0.0.1:39323 -L 39330:127.0.0.1:39320 subiu
```

Grafana pode então ser aberto em `http://localhost:39333`, e a API em `http://localhost:39330`. A credencial é gerada por ambiente e não integra o pacote de evidências. As portas locais do túnel diferem das da stack de carga local para permitir manter as duas acessíveis.

## Recursos e dados

A base original define API 512 MiB/0,75 CPU; PostgreSQL 512 MiB/0,75; LocalStack 512 MiB/0,5; Prometheus 192 MiB/0,15; Tempo 512 MiB/0,15; Grafana 384 MiB/0,1; Loki 384 MiB/0,2; Alloy 128 MiB/0,1; gateway de logs 32 MiB/0,05. O override atual amplia API, PostgreSQL e LocalStack conforme a seção anterior; ajustes posteriores de observabilidade estão registrados em VALIDATION. São limites por container, não uma reserva exclusiva nem um limite agregado do projeto. Setup e teste têm limites adicionais e devem ser executados fora da janela de carga. Prometheus retém até sete dias ou 512 MB; Loki retém logs por 24 horas e Docker tem rotação. Exportações preservam os dados necessários fora dessa retenção. A coleta e os painéis são descritos em [OBSERVABILITY](OBSERVABILITY.md).

Volumes não são removidos ao trocar release. Para rollback de código, use uma imagem anterior com schema compatível e repita `up -d --wait` no mesmo projeto; não use `down -v` nem reverta migrations com dados de carga. Backup SQL deve anteceder uma futura mudança de schema. O primeiro deploy deste roteiro não modifica invariantes ou migrations.

A release `20261001-index-bfe8a8b` aplicou a migration 008 após backup do banco próprio e fora da janela de carga. Depois da bateria, uma consulta de traces confirmou OOM do Tempo com 256 MiB. O orçamento atual usa 512 MiB, sem swap, alvo do GC de 384 MiB e duas consultas concorrentes; API, banco e gerador mantêm os limites medidos. `up --wait` deve ser seguido de smoke das APIs de observabilidade para confirmar seu startup e consultas. Detalhes e provas estão em VALIDATION.

## Validação e carga

```sh
docker compose --env-file ../../.env -f compose.subiu.yaml -p jungle-server --profile test run --rm --no-deps test
docker compose --env-file ../../.env -f compose.subiu.yaml -p jungle-server --profile test run --rm --no-deps -e LOAD_BASE_URL=http://app-observed:3000 -e STRESS_PROFILE=server test bun run test:stress
```

Monte `/app/test-results` para preservar os relatórios. O gate usa exclusivamente banco/filas gerados pelo runner. A carga cria carteiras novas na aplicação exclusiva do challenge; não limpa nem consulta bancos de outras aplicações.

`test:stress` executa baseline de 300 requisições/8 clientes, 2.000/16, 5.000/32, 5.000/64 e carteira única com 1.000/16, confirmando saldo esperado e drenagem a cada fase. `STRESS_PROFILE=heavy` acrescenta 10.000/128, 10.000/256 e carteira única com 3.000/48. Para a comparação entre hosts, use a mesma imagem/configuração, limites e posição do gerador. O roteiro para na primeira fase malsucedida, preservando as evidências; a primeira execução é um diagnóstico, não uma certificação de capacidade.

Antes e durante a carga, registre CPU/RAM/disco, pressão CPU/memória/IO, swap, readiness, estados/reinícios/OOM dos containers e amostras de saúde das aplicações existentes. Avance em etapas e interrompa o gerador se os serviços existentes perderem saúde ou se a margem de memória do host ficar insuficiente. Um teste pesado no servidor compartilhado não deve virar teste de interrupção das outras aplicações.

Referências operacionais: [limites Compose](https://docs.docker.com/reference/compose-file/services/) e [BasicAuth Traefik](https://doc.traefik.io/traefik/reference/routing-configuration/http/middlewares/basicauth/). Resultados realmente executados estão em [VALIDATION](VALIDATION.md).
