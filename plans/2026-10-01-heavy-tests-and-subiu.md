# Testes ampliados e execução no subiu.dev

## Objetivo autorizado

Expandir testes e executar cenários mais pesados; verificar, fazer deploy do challenge no home server subiu.dev e repetir as medições no hardware mais fraco. Preservar as aplicações existentes, inclusive bets/subway pay, e manter a demo no stash.

## Frente de testes

1. Acrescentar históricos mistos com duplicatas em seis processos e disputa até esgotamento de uma carteira em quatro processos, com provas SQL e reconciliação.
2. Executar o gate completo usando o runner isolado; preservar JUnit, limpeza e resultados reais.
3. Medir carga de 10.000 requisições distribuídas, maior concorrência e histórico de carteira única em stack exclusiva, com telemetria e reconciliação exata. Registrar falhas e capacidade observada sem meta artificial de RPS.

## Frente do servidor

1. Confirmar acesso SSH, CPU/RAM/disco, Docker, proxy, redes, portas, processos e baseline das aplicações existentes.
2. Preparar release revisável e stack exclusiva do challenge com volumes, rede, portas locais, limites de recursos e rollback. Escolher exposição após conhecer proxy e autenticação existentes.
3. Fazer deploy autorizado, validar migrations/setup, readiness, transação e replay, métricas/traces e gate isolado no servidor.
4. Aumentar carga em etapas dentro do orçamento de recursos observado; coletar CPU/RSS, pressão do host, latências e backlog. Interromper a carga se saúde ou margem operacional das aplicações existentes se deteriorarem.
5. Comparar os hosts usando protocolo, versão e configuração registrados; distinguir gerador remoto de gerador no próprio servidor.

## Estado inicial

- Base: commit `5caaf74`, 113 testes/979 assertions no último gate.
- O usuário confirmou tailnet/Magic SSH e `jungle.subiu.dev`. Alias SSH `subiu` resolve `subiu-sm.tail82f788.ts.net`, usuário `subiu-sm`, chave de deploy configurada; o acesso público inicial em `subiu.dev:22` expirou e o peer do painel `subiu` não atende SSH.
- Inventário: i5-4570, quatro núcleos, aproximadamente 11 GiB RAM, 5,8 GiB disponíveis inicialmente, Docker 29.6.1/Compose 5.3.0. Aplicações existentes preservadas e acompanhadas por estados Docker e probes HTTP.
- Stack exclusiva implantada em `/home/subiu-sm/apps/jungle-challenge/releases/20261001-heavy`, projeto `jungle-server`; imagem construída no host de desenvolvimento, segredos próprios e limites de recursos. DNS do challenge criado para o túnel existente; smoke público e interno passou, com health 200, API sem credencial 401, acesso autenticado 200, BET/replay/reconciliação e Grafana/Prometheus.
- Gate ampliado local passou com 115 testes/1297 assertions e limpeza completa. Gate no servidor e roteiro de carga pesada local em andamento; resultados finais serão registrados em VALIDATION.
- Fonte funcional e interpretação financeira permanecem as atuais; esta expansão acrescenta provas e infraestrutura operacional.

## Resultados e refinamentos

- `bfe8a8b`: migration 008 e runner com recursos separados; 121 testes/1.313 assertions passaram localmente e no subiu.
- Ambos os hosts completaram oito fases pesadas, 36.300 operações medidas cada, sem erros e com reconciliação/drenagem completas. Evidências e limitações em VALIDATION.
- OOM de consulta no Tempo após a carga foi corrigida com 512 MiB, alvo de GC 384 MiB e duas consultas concorrentes; exportações históricas passaram.
- Steering do usuário: dashboard local 39323 sem logs/traces. Loki/Alloy/gateway restrito adicionados; consultas de log e trace da mesma transação passaram nos dois hosts. Em 01/10 o responsável confirmou a renderização correta de logs/traces na porta 39323; o erro anterior observado no Explore não foi reproduzido ou diagnosticado como corrigido pelo agente.
- Steering seguinte: E2E do IDP. Keycloak real em stack descartável passou nos dois hosts com 15 testes/71 assertions e limpeza completa. Gate final passou em ambos com 121 testes/1.313 assertions.
- Repetição com observabilidade completa: duas fases adicionais e 13.000 operações por host, sem erros, com reconciliação/drenagem completas. Monitor encerrado, 938 amostras, 28 containers existentes, nenhuma ocorrência de problema ou acionamento da proteção.
- Fechamento: reprodução do README em checkout limpo e recursos próprios, consolidação das evidências, commit e pacote sem credenciais. GitHub Actions remoto não é requisito e fica fora desta etapa por orientação do responsável. A demo continua no stash.

## Fechamento executado

- A reprodução limpa identificou o script CLI demo usando `walletId` na resposta de criação; corrigido no commit `6456f6e` para `id`, sem mudar a API ou o domínio. A demo jogável continua no stash.
- Nova reprodução por `git archive`: setup, health, seed/replay, demo e gate completo passaram. Stack, volumes e recursos de teste removidos. Falha anterior preservada.
- A mesma imagem foi implantada na release `20261001-delivery-6456f6e`, recriando somente a API. Os 36 outros containers em execução foram preservados. Demo e gate completo passaram no servidor; logs/traces, smoke público e auditoria SQL final também passaram.
- Documentos de entrega, rastreabilidade, versões/configurações e limitações consolidados. Empacotamento exige árvore limpa, hashes compatíveis, gates/JUnit, auditorias, limpeza, caminhos seguros e ausência de credenciais privadas. Envio aos avaliadores e publicação no GitHub não foram realizados.
