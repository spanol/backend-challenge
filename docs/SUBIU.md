# Execução no home server

`compose.subiu.yaml` é uma stack exclusiva do challenge. Usa PostgreSQL/LocalStack próprios, rede privada e volumes persistentes. API e demo ingressam na rede externa `subiu_edge`; o Traefik e o túnel Cloudflare existentes fornecem a rota `jungle.subiu.dev`. Nenhuma aplicação existente participa do setup ou da limpeza dos testes.

Entrega original: `releases/20261001-delivery-6456f6e`, imagem `jungle-challenge:delivery-20261001-6456f6e`, fonte executável `6456f6e`. O script CLI demo e o gate completo passaram nessa imagem no host local e no servidor. Até 07/10, a API usava `jungle-challenge:messaging-recovery-20261006-v1`, validada no gate completo de 173 testes; o broker continua usando `jungle-localstack:4.9.2-fifo-ttl-v1`. Os overrides de 07/10 e seus resultados abaixo são históricos; a revisão ativa de API/demo e o procedimento com seis arquivos estão registrados nesta página. A base continua em `releases/20261001-demo-52e850a/compose.subiu.yaml`. Novas sessões sugerem 1.000 jogadores com carteiras individuais de R$ 100,00 fictícios, até 1.000 intenções de R$ 1,00 por rodada e janela fixa de cinco segundos. Confirmações tardias são estornadas; não há reposição automática de saldo. O perfil alternativo mantém várias sessões concorrendo pela mesma carteira. Versões, procedimento, observações e reconciliação estão em [VALIDATION](VALIDATION.md) e [DEMO](DEMO.md).

## Release e configuração

### Admissão e identidade publicadas — 14/10/2026

**Gate para uma próxima publicação:** a rechecagem solicitada depois deste deploy ficou vermelha na comparação de admissão; a reprodução focada também encontrou timeouts com operações incertas. Não considerar o incremento de capacidade certificado nem executar outra publicação com base apenas no gate histórico. O resultado atual está em [VALIDATION](VALIDATION.md#rechecagem-solicitada-antes-de-novo-deploy--14102026). A sessão pública não foi alterada por essa rechecagem.

A revisão publicada mantém a janela de cinco segundos e a mesma sessão/1.500 carteiras. A imagem atual de API/demo é `jungle-challenge:demo-subiu-admission-20261014-0e1ec38d`. O [compose.admission.yaml](../compose.admission.yaml), em `releases/20261014-demo-subiu-admission-v1`, é o sexto override, depois dos cinco arquivos existentes, com `JUNGLE_ADMISSION_IMAGE` apontando para essa imagem. A API usa `DATABASE_POOL_MAX=24`; a demo usa `DEMO_FINANCIAL_CONCURRENCY=64` e serve os assets da subiu.dev. Somente trocar a variável no processo financeiro antigo não habilita o pool configurável. Os overrides anteriores preservam domínio, autenticação, volumes e demais serviços.

Após autorização do usuário, as 12 LOSS incertas foram confirmadas pelos IDs originais, a demo foi pausada/parada e seu journal recebeu backup privado antes da atualização de API/demo. Não houve migrations, reposição de saldo ou alteração de quotas. As 1.500 carteiras reconciliaram sem divergência; os oito containers de dependências foram preservados. O autoplay retomou e três rodadas terminaram sem pendências. Somente 442–444 carteiras tinham saldo para apostar nessa amostra, portanto ela não comprova participação acima de 600 nem ganho de vazão sobre a imagem anterior. Resultados e limites em [VALIDATION](VALIDATION.md#publicação-e-observação-no-servidor).

### Domínio público — 07/10/2026

O endereço principal voltou a ser `https://jungle.subiu.dev`, por pedido do usuário após esclarecer a situação do processo seletivo. Os dois CNAMEs com proxy continuam no túnel Subiu existente, cujo ingress já cobre `*.subiu.dev`. `wagering.subiu.dev` redireciona temporariamente para Jungle com HTTP 302, preservando caminho e parâmetros. O destino acrescenta `domain=jungle` para evitar ciclos em clientes que possam ter guardado o 301 anterior de Jungle para Wagering.

O override adicional ativo é `releases/20261007-jungle-domain-v2/compose.domain.yaml`, correspondente a [compose.domain.yaml](../compose.domain.yaml). Ele atualiza o hostname e a origem permitida da demo e define o redirecionamento temporário de Wagering. O router original da API já atende Jungle com `jungle-access`; os aliases financeiros da migração anterior foram removidos. Somente a demo foi recriada, conservando a mesma imagem e volume. API, PostgreSQL, LocalStack, Traefik e Cloudflared conservaram suas identidades. A troca preservou as mesmas 1.500 carteiras e saldos, com autoplay pausado naquele momento. Às 21:29 BRT, o usuário solicitou a retomada: a sessão existente passou a persistir autoplay ativo no journal. `DEMO_AUTOPLAY=false` continua impedindo autoplay apenas na criação automática de uma sessão vazia nesse override.

### Saúde para a apresentação — 07/10/2026

A revisão de saúde publicou `jungle-challenge:demo-health-20261007-v2`, definida pelo quarto override `releases/20261007-demo-health-v2/compose.health.yaml`, correspondente a [compose.health.yaml](../compose.health.yaml). Ela deriva da imagem de revisão citada acima e altera somente a recuperação das leituras no navegador. Carteiras, saldos e containers das dependências foram preservados. A imagem atual com acumulados, descrita abaixo, deriva dessa revisão. O replay histórico terminou com `done=true` e exit code zero. Um monitor privado roda a cada cinco minutos até 12/10, 19:56 BRT. Resultados, limites e consulta operacional estão em [PRODUCTION_HEALTH](PRODUCTION_HEALTH.md).

Após a retomada do autoplay, a sessão avançou até a rodada 4.141 na observação de 21:35:43 BRT, sem erro operacional e com a carteira selecionada reconciliada. O monitor considera pendências normais durante a rodada e acusa erro operacional ou ausência de progresso por dez minutos. O gate estático completo passou; os recibos da retomada estão em [VALIDATION](VALIDATION.md#retomada-do-autoplay-e-gate-estático--07102026).

### Resultados acumulados — 07/10/2026

A imagem atual é `jungle-challenge:demo-session-summary-20261007-v1`, no quinto override `releases/20261007-demo-session-summary-v1/compose.session-summary.yaml`, correspondente a [compose.session-summary.yaml](../compose.session-summary.yaml). Ela acrescenta saques, perdas, prêmios e operações acumulados da sessão. O PostgreSQL forneceu o baseline somente leitura; a gravação alterou exclusivamente `history.outcomes` no journal, após pausa, liquidação, parada e backup. O coordenador retomou a mesma sessão e as 1.500 carteiras com autoplay ativo. API, PostgreSQL e broker mantiveram seus IDs. A baseline do monitor foi atualizada somente para o novo container da demo, conservando a expiração original.

Para manutenção da implantação atual, parta de `/home/subiu-sm/apps/jungle-challenge` e inclua os seis arquivos, nesta ordem:

```sh
export JUNGLE_ADMISSION_IMAGE=jungle-challenge:demo-subiu-admission-20261014-0e1ec38d

docker compose --env-file .env -p jungle-server \
  -f releases/20261001-demo-52e850a/compose.subiu.yaml \
  -f releases/20261007-demo-review-v2/compose.demo.yaml \
  -f releases/20261007-jungle-domain-v2/compose.domain.yaml \
  -f releases/20261007-demo-health-v2/compose.health.yaml \
  -f releases/20261007-demo-session-summary-v1/compose.session-summary.yaml \
  -f releases/20261014-demo-subiu-admission-v1/compose.admission.yaml config --quiet

docker compose --env-file .env -p jungle-server \
  -f releases/20261001-demo-52e850a/compose.subiu.yaml \
  -f releases/20261007-demo-review-v2/compose.demo.yaml \
  -f releases/20261007-jungle-domain-v2/compose.domain.yaml \
  -f releases/20261007-demo-health-v2/compose.health.yaml \
  -f releases/20261007-demo-session-summary-v1/compose.session-summary.yaml \
  -f releases/20261014-demo-subiu-admission-v1/compose.admission.yaml \
  up -d --no-deps --no-build --pull never --wait --wait-timeout 120 app-observed demo
```

O segundo comando corresponde à atualização de admissão de 14/10, depois de pausa, liquidação, parada e backup. Para uma mudança futura exclusivamente na interface, selecione somente `demo`, mantendo os seis arquivos. Alterações de schema exigem seu procedimento específico. Não omita os overrides de domínio e admissão em futuros `up`: eles mantêm a origem correta, a rota de compatibilidade, a pausa inicial e as imagens/configurações atuais. O processador foi recriado em 14/10; PostgreSQL e broker foram preservados.

`JUNGLE_DOMAIN=jungle.subiu.dev` está no `.env` da aplicação. Backups anteriores da configuração e do journal permanecem nos diretórios exclusivos das duas alterações de domínio (configuração com modo 600). A release `20261007-wagering-domain-v1` é histórica; a ativa é `20261007-jungle-domain-v2`. Alterações de domínio recriam somente a demo, sem restaurar saldo, banco ou journal histórico. Verificações do retorno estão em [VALIDATION](VALIDATION.md#retorno-ao-subdomínio-jungle--07102026).

**Atualização de 07/10:** o override ativo é `releases/20261007-demo-review-v2/compose.demo.yaml`, imagem `jungle-challenge:demo-review-20261007-v2`. A compactação agora libera referências dos índices em memória; a interface serializa consultas e aplica backoff. A seleção de replay filtra operações concluídas antes do limite de 30, e o journal conserva esse conjunto limitado. Somente a demo foi recriada, após pausa, liquidação e backup do journal. Carteiras, saldos e containers das dependências foram comparados antes/depois. A revisão recebeu checks estáticos e observação operacional; os 189 testes em Linux pertencem à imagem anterior, de 06/10. A sessão recuperada conserva as 1.500 carteiras já usadas e seus saldos; novas sessões continuam sugerindo 1.000 jogadores. A gravação do journal sincroniza arquivo/diretório antes de liberar envios. Se a página pedir login após startup, confira primeiro saúde/logs da demo: seu router pode desaparecer quando o backend falha, deixando o router protegido da API atender `/`. Não remova BasicAuth da API para corrigir essa falha. Preserve qualquer journal inválido e confirme operações/saldos no SQL antes de reconstruir a mesa. O procedimento e seus limites estão em [VALIDATION](VALIDATION.md#recuperação-após-reinício-do-host--06102026).

Construa a imagem no host de desenvolvimento com Bun 1.4.2, depois transfira/carregue a imagem no servidor. A configuração exige `JUNGLE_IMAGE`, `POSTGRES_OWNER_PASSWORD`, `POSTGRES_APP_PASSWORD` (64 caracteres hexadecimais), `JUNGLE_GRAFANA_PASSWORD` e `JUNGLE_INGRESS_USERS` (usuário/hash bcrypt). Guarde `.env` e credenciais com modo 600, fora do Git. O bootstrap cria a role de aplicação com segredo próprio antes das migrations, preservando as permissões restritas e as migrations originais.

```sh
docker compose --env-file ../../.env -f compose.subiu.yaml -p jungle-server config --quiet
docker compose --env-file ../../.env -f compose.subiu.yaml -p jungle-server up -d --wait
curl http://127.0.0.1:39320/health/ready
```

Esses comandos partem da pasta `releases/<release>` dentro do diretório exclusivo da aplicação. `.env` fica na raiz desse diretório. Configuração DNS cria somente o CNAME do challenge para o túnel existente; não substitui registros divergentes nem altera o ingress compartilhado. Na primeira entrega não há release anterior para rollback.

Na apresentação atual, inclua os seis arquivos do comando de manutenção acima ao operar API, demo e dependências. `JUNGLE_IMAGE` e `JUNGLE_DEMO_IMAGE` são referências históricas da base/overrides; `JUNGLE_ADMISSION_IMAGE` seleciona a API e a demo atuais no último override. `JUNGLE_SQS_IMAGE` referencia a imagem derivada do broker. O override define API/PostgreSQL em **1,5 CPU e 1 GiB cada**, demo em **1 CPU / 512 MiB** e LocalStack em **1 CPU / 2 GiB**. A quota efetiva antiga do broker era 0,5 CPU; foi corrigida ao vivo e no override em 06/10. `DEMO_EVENT_AUDIT=true` habilita neste perfil o consumidor de eventos com recibo durável antes do ACK; fora do override ele fica desabilitado. Aplique migrations para cima quando houver mudança de schema e aguarde liquidação antes de recriar a demo. Antes de recriar o broker, pause o auto bet e o publisher e drene todas as filas: seu volume não comprovou persistência das mensagens. O procedimento está em [MESSAGING-RECOVERY](MESSAGING-RECOVERY.md#procedimento-operacional); a preservação do journal está em [DEMO](DEMO.md#deploy). Não omita os overrides em um futuro `up`, pois a base conserva os limites originais e a imagem anterior da demo.

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
