# Execução no home server

`compose.subiu.yaml` é uma stack exclusiva do challenge. Usa PostgreSQL/LocalStack próprios, rede privada e volumes persistentes. Apenas a API ingressa na rede externa `subiu_edge`; o Traefik e o túnel Cloudflare existentes fornecem a rota `jungle.subiu.dev`. Nenhuma aplicação existente participa do setup ou da limpeza dos testes.

## Release e configuração

Construa a imagem no host de desenvolvimento com Bun 1.4.2, depois transfira/carregue a imagem no servidor. A configuração exige `JUNGLE_IMAGE`, `POSTGRES_OWNER_PASSWORD`, `POSTGRES_APP_PASSWORD` (64 caracteres hexadecimais), `JUNGLE_GRAFANA_PASSWORD` e `JUNGLE_INGRESS_USERS` (usuário/hash bcrypt). Guarde `.env` e credenciais com modo 600, fora do Git. O bootstrap cria a role de aplicação com segredo próprio antes das migrations, preservando as permissões restritas e as migrations originais.

```sh
docker compose --env-file ../../.env -f compose.subiu.yaml -p jungle-server config --quiet
docker compose --env-file ../../.env -f compose.subiu.yaml -p jungle-server up -d --wait
curl http://127.0.0.1:39320/health/ready
```

Esses comandos partem da pasta `releases/<release>` dentro do diretório exclusivo da aplicação. `.env` fica na raiz desse diretório. Configuração DNS cria somente o CNAME do challenge para o túnel existente; não substitui registros divergentes nem altera o ingress compartilhado. Na primeira entrega não há release anterior para rollback.

API, Prometheus, Tempo e Grafana publicam somente em loopback nas portas 39320–39323, configuráveis. Health permanece público pelo proxy; as demais rotas públicas exigem BasicAuth operacional do Traefik. A proteção do acesso ao ambiente de demonstração é separada da identidade do provedor: OIDC/JWKS continua disponível conforme o README. O gerador interno acessa a API pela rede privada e não mede autenticação/TLS/Cloudflare.

```sh
ssh -N -L 39323:127.0.0.1:39323 -L 39320:127.0.0.1:39320 subiu
```

Grafana pode então ser aberto em `http://localhost:39323`. A credencial é gerada por ambiente e não integra o pacote de evidências.

## Recursos e dados

Os serviços persistentes têm tetos somados de aproximadamente 2,3 GiB e 2,5 CPUs: API 512 MiB/0,75 CPU; PostgreSQL 512 MiB/0,75; LocalStack 512 MiB/0,5; Prometheus 192 MiB/0,15; Tempo 256 MiB/0,15; Grafana 384 MiB/0,1. São limites por container, não uma reserva exclusiva nem um limite agregado do projeto. Setup e teste têm limites adicionais e devem ser executados fora da janela de carga. Prometheus retém até sete dias ou 512 MB; logs Docker têm rotação. Exportações preservam os dados necessários fora dessa retenção.

Volumes não são removidos ao trocar release. Para rollback de código, use uma imagem anterior com schema compatível e repita `up -d --wait` no mesmo projeto; não use `down -v` nem reverta migrations com dados de carga. Backup SQL deve anteceder uma futura mudança de schema. O primeiro deploy deste roteiro não modifica invariantes ou migrations.

## Validação e carga

```sh
docker compose --env-file ../../.env -f compose.subiu.yaml -p jungle-server --profile test run --rm --no-deps test
docker compose --env-file ../../.env -f compose.subiu.yaml -p jungle-server --profile test run --rm --no-deps -e LOAD_BASE_URL=http://app-observed:3000 -e STRESS_PROFILE=server test bun run test:stress
```

Monte `/app/test-results` para preservar os relatórios. O gate usa exclusivamente banco/filas gerados pelo runner. A carga cria carteiras novas na aplicação exclusiva do challenge; não limpa nem consulta bancos de outras aplicações.

`test:stress` executa baseline de 300 requisições/8 clientes, 2.000/16, 5.000/32, 5.000/64 e carteira única com 1.000/16, confirmando saldo esperado e drenagem a cada fase. `STRESS_PROFILE=heavy` acrescenta 10.000/128, 10.000/256 e carteira única com 3.000/48. Para a comparação entre hosts, use a mesma imagem/configuração, limites e posição do gerador. O roteiro para na primeira fase malsucedida, preservando as evidências; a primeira execução é um diagnóstico, não uma certificação de capacidade.

Antes e durante a carga, registre CPU/RAM/disco, pressão CPU/memória/IO, swap, readiness, estados/reinícios/OOM dos containers e amostras de saúde das aplicações existentes. Avance em etapas e interrompa o gerador se os serviços existentes perderem saúde ou se a margem de memória do host ficar insuficiente. Um teste pesado no servidor compartilhado não deve virar teste de interrupção das outras aplicações.

Referências operacionais: [limites Compose](https://docs.docker.com/reference/compose-file/services/) e [BasicAuth Traefik](https://doc.traefik.io/traefik/reference/routing-configuration/http/middlewares/basicauth/). Resultados realmente executados estão em [VALIDATION](VALIDATION.md).
