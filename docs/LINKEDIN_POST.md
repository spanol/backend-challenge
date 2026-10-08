# Primeira publicação: processador de apostas

Status: texto preparado para revisão, ainda não publicado. A operação pendente foi retomada com autorização; as correções de compactação dos índices e seleção/retenção das operações de replay foram publicadas em 07/10. A sessão e as 1.500 carteiras existentes foram preservadas.

A demo teve o autoplay retomado às 21:29 BRT de 07/10, após solicitação explícita do usuário, na mesma sessão de 1.500 carteiras e sem reposição de saldo. O bloqueio anterior da revisão automática referia-se à autorização disponível na captura e foi resolvido para essa retomada. Texto, vídeo, capa e prints continuam preparados, sem upload ou publicação nesta etapa.

A mídia principal é o [vídeo de 60 segundos](../marketing/portfolio/videos/processador-demo-60s.mp4), com app, reconciliação, replay confirmado e 12 segundos de Grafana. O [vídeo técnico de 90 segundos](../marketing/portfolio/videos/processador-inspecao-90s.mp4) é material complementar. As capturas reais e os exports foram conferidos; o roteiro está em [DEMO_VIDEOS](DEMO_VIDEOS.md). A assinatura das capas é **Vinicius Spanol**, com a logo do Subiu no canto superior direito; o [kit editável](../marketing/portfolio/README.md) permite repetir o padrão em próximas publicações.

O editor do LinkedIn de Vinicius Spanol já contém a versão enxuta abaixo, com audiência pública e parágrafos preservados. O preview automático do link foi removido para permitir o anexo do vídeo. O editor de mídia exibe “Compartilhe imagens ou um único vídeo na sua publicação”; os prints serão preparados como complemento nos comentários da mesma publicação. A revisão automática bloqueou anteriormente o upload das quatro imagens por exigir aprovação desse conjunto específico; nenhum anexo foi enviado e a publicação não foi enviada.

## Texto

Enviei a mesma aposta 50 vezes, distribuídas entre três processos. O saldo foi debitado uma única vez.

Esse foi um dos cenários que validei no processador de apostas que desenvolvi com TypeScript, Bun, NestJS, PostgreSQL e SQS.

O projeto foi pensado para manter saldo e histórico consistentes com apostas concorrentes, mensagens repetidas e falhas durante o processamento.

Saldo, transação, ledger e outbox são confirmados no mesmo commit do PostgreSQL. Quando uma operação é reenviada, o processador recupera o resultado original, sem repetir o débito.

No vídeo, mostro a aplicação em funcionamento, a reconciliação de uma carteira, o replay de uma aposta e um pouco do Grafana.

Demo com créditos fictícios: https://jungle.subiu.dev

#Backend #SistemasDistribuidos #iGaming

## Fontes para conferir antes de publicar

- Processador: `README.md`, `ARCHITECTURE.md`, `docs/REVIEW.md`, `docs/VALIDATION.md`, `test-results/journal-durable-linux/verify-full.json` e `all.junit.xml`.
- As 50 entregas entre três processos pertencem ao cenário histórico da suíte de concorrência documentada em 06/10, com PostgreSQL real e SQS em LocalStack. O vídeo mostra o replay na demo pública, que usa uma API financeira.
- Não há pessoas marcadas, promessa de capacidade AWS ou garantia de entrega da publicação aos revisores.

## Imagens de apoio

O vídeo será a mídia principal. Três prints reais do Grafana já receberam a assinatura da marca, com data e período visíveis: [recursos e operação](../marketing/portfolio/support/01-recursos-operacao-1080x1350.png), [latência p95](../marketing/portfolio/support/02-latencia-1080x1350.png) e [traces financeiros](../marketing/portfolio/support/03-traces-1080x1350.png). Os [originais e o contexto](../marketing/portfolio/assets/README.md) conservam escalas, lacunas e timestamps. O editor aceita imagens ou um único vídeo; os prints serão anexados como comentários da mesma publicação, após aprovação do conjunto final.

### Comentários de apoio preparados

1. **Recursos e operação:** “Por trás da demo: CPU, memória, operações e latência da API financeira. Captura real de 07/10/2026, com uma janela de 12 horas.”
2. **Latência:** “Latência p95 da API financeira ao longo do período exibido. O histórico mostra as variações no tempo de resposta; a escala e os intervalos de coleta estão preservados.”
3. **Traces:** “Traces de processamento de apostas no Grafana: operação, horário e duração de cada span, com acesso aos logs relacionados.”

Esta primeira publicação é dedicada ao processador de apostas. A versão anterior, com o portfólio iGaming completo, foi preservada em `.tmp/linkedin-20261007/post-portfolio-v1.md` para preparar publicações futuras.

[Prévia atual do rascunho focado no processador, ainda sem anexos](../.tmp/linkedin-20261007/post-processador-preview.png). O editor foi atualizado com os sete parágrafos do texto acima, totalizando 779 caracteres. A prévia anterior com o portfólio completo permanece em `.tmp/linkedin-20261007/05-rascunho-linkedin.jpg` como registro histórico.
