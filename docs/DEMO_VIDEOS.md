# Vídeos da demo para LinkedIn

Status em 07/10/2026: as duas capturas do OBS foram encontradas e inspecionadas. `2026-10-07 11-35-47.mp4` tem 370,833 segundos; `2026-10-07 12-03-49.mp4`, 160,4 segundos. Ambas têm H.264/AAC, 1280 × 720, 30 fps, com app e Grafana lado a lado. A edição principal tem 60 segundos; a técnica, 90 segundos. Os exports H.264 têm 1920 × 1080, 30 fps e nenhuma faixa de áudio; o conteúdo original de 720p foi recortado e ampliado. As mídias usam a assinatura Vinicius Spanol no canto superior esquerdo e a logo oficial do Subiu no canto superior direito. Ainda não houve upload ou publicação.

O seletor de replay ficou vazio no primeiro percurso; a correção foi publicada na demo v2. Na captura complementar, a mesma `BET · Jogador 1 · PROCESSED` foi reenviada e recebeu `Replay: confirmado`, saldo histórico de R$ 32,10. A consulta posterior conservou saldo R$ 32,10, versão 657, 657 lançamentos e diferença R$ 0,00. A tentativa adicional de conflito foi rejeitada pela revisão automática antes do envio por não haver autorização específica para alterar o valor; não foi executada nem incluída na edição. As capturas foram feitas com controle manual do OBS enquanto o MCP retornava `Transport closed`. Em 07/10/2026, a recarga das conexões MCP pelo canal local do Codex recuperou a integração: as ferramentas responderam com OBS 32.2.1, WebSocket 5.7.4 e gravação parada (`outputActive: false`). Grafana está autenticado pelo usuário, pelo túnel privado em localhost:39333.

## Entrega

Revisão visual de 07/10/2026: capas, molduras e imagens de apoio seguem o design system **PAPEL** do Subiu, com fundo `#eaebe6`, tinta `#0c0f0d`, verde `#12b24c`, logo oficial e fontes Archivo Black / Archivo / JetBrains Mono. A duplicação de “créditos fictícios” no primeiro trecho foi removida; o contexto aparece uma vez no rodapé. Os textos dos demais trechos foram enxugados. Os cortes e as capturas reais permanecem os mesmos.

- [Vídeo principal, 60 segundos](../marketing/portfolio/videos/processador-demo-60s.mp4): app, reconciliação, replay e 12 segundos de Grafana.
- [Vídeo técnico, 90 segundos](../marketing/portfolio/videos/processador-inspecao-90s.mp4): a mesma operação antes/depois, com tempo para ler a resposta e a consulta de reconciliação. Material complementar; sem conflito de chave.
- Arquivos finais em MP4, H.264, 1920 × 1080, 30 fps, sem áudio de ambiente. Legendas curtas na imagem e abertura com a [capa da marca](../marketing/portfolio/covers/01-processador-1920x1080.png).

O formato horizontal preserva a leitura da interface. A identidade da moldura segue o design system PAPEL do Subiu; a captura conserva as cores originais da demo. A edição acompanha a gravação real, sem fabricar saldos, respostas ou estados da aplicação. O texto permanente é **“Demo · créditos fictícios”**.

O [LinkedIn permite um vídeo por publicação](https://www.linkedin.com/help/linkedin/answer/a554001/sharing-a-video-on-linkedin-faq?office=6129). Por isso, os trechos do vídeo principal serão reunidos em um único arquivo. A resolução e a taxa de quadros propostas estão dentro dos [requisitos oficiais de upload](https://www.linkedin.com/help/linkedin/answer/a7174587).

## Vídeo principal — 60 segundos

| Tempo | Captura real                                                                     | Legenda                            |
| ----- | -------------------------------------------------------------------------------- | ---------------------------------- |
| 00–03 | Capa Vinicius Spanol e logo Subiu; números identificados como evidência de teste | Uma aposta. Um único débito.       |
| 03–21 | Entrada de apostas, voo e resultados de rodadas                                  | Da aposta ao resultado             |
| 21–28 | Carteira existente: reconciliação de R$ 32,10 e 657 lançamentos                  | Saldo e histórico reconciliados    |
| 28–43 | Repetir a BET selecionada e mostrar a confirmação do replay                      | Mesmo comando. Nenhum novo débito. |
| 43–55 | Grafana: recursos, latência e eventos; depois logs ou traces disponíveis         | A operação por dentro              |
| 55–60 | Encerrar com endereço da demo e assinatura da marca                              | Conheça a demo: jungle.subiu.dev   |

Os tempos orientam a montagem. Se a rodada durar mais, encurtar a espera entre ações, preservando a sequência e os resultados. O trecho de replay deve permitir comparar a mesma operação e sua resposta histórica; apenas mostrar o avião não demonstra idempotência.

## Vídeo técnico — 90 segundos

1. **00–03:** capa da marca; números do ensaio histórico de concorrência.
2. **03–13:** reconciliação antes do replay e a BET selecionada.
3. **13–38:** repetir a operação e ler o resultado histórico confirmado.
4. **38–58:** observar a mesma seleção e a carteira, com autoplay pausado.
5. **58–73:** consulta posterior: 657 lançamentos e diferença zero preservados.
6. **73–85:** recursos, logs e traces da API no período exibido no Grafana.
7. **85–90:** endereço da demo e assinatura.

O ensaio de cinquenta entregas entre três processos pertence à suíte de concorrência documentada. A gravação pública não deve ser apresentada como esse ensaio: a demo utiliza uma API financeira.

## Captura e edição

Gravar o enquadramento preparado pelo usuário com `https://jungle.subiu.dev` e Grafana lado a lado, com a interface legível. Capturar de dois a três minutos brutos para selecionar os melhores trechos. OBS pode gravar em MKV; converter para MP4 na edição com ffmpeg. Manter microfone e áudio do ambiente desligados.

Antes da captura, resolver a operação pendente usando os mesmos comandos da sessão existente, sem abrir outra sessão ou repor saldos. A gravação exige a demo avançando normalmente. A conexão com OBS ou o envio de gravações pelo usuário fornece a matéria-prima para a edição prevista na skill `brand-reels`.

Os arquivos finais foram conferidos com ffprobe (60 e 90 segundos exatos, H.264, 1920 × 1080, 30 fps, sem áudio) e frames extraídos da edição. As listas de cortes [principal](../marketing/portfolio/videos/edit-main.json) e [técnica](../marketing/portfolio/videos/edit-technical.json) registram os tempos e recortes dos originais. As ampliações financeiras mostram regiões do mesmo frame, no mesmo instante; não foram substituídos valores, respostas ou gráficos. O início da captura complementar com o editor de código ficou fora dos cortes. O histórico de Grafana não é apresentado como o trace específico desse replay.

O primeiro rascunho sem replay, `processador-primeira-captura-60s.mp4`, permanece como acervo. As capas PNG/SVG estão em `marketing/portfolio/covers`. Imagens de apoio priorizam prints reais do Grafana com período visível. O editor do LinkedIn oferece imagens ou um único vídeo; a proposta usa o vídeo principal com capa e três prints nos comentários da mesma publicação. Publicação e anexos aguardam a confirmação do conjunto final.

A tentativa inicial de retomar apostas automáticas após a captura foi bloqueada pela revisão automática por exigir autorização específica para rodadas contínuas. Em 07/10, às 21:29 BRT, a solicitação explícita do usuário autorizou a retomada na mesma sessão de 1.500 carteiras, sem reposição de saldo. O avanço das rodadas e a saúde observada estão em [VALIDATION](VALIDATION.md#retomada-do-autoplay-e-gate-estático--07102026). As capturas do vídeo conservam o estado histórico mostrado na gravação.

Em 07/10/2026, o endereço público mudou para `https://wagering.subiu.dev`. A revisão `paper-v4` atualiza capas, molduras, prints de apoio e os dois exports com o novo endereço. As gravações brutas permanecem originais; a barra de endereço do navegador fica fora dos recortes.

Depois, na mesma data, o usuário pediu o retorno a `https://jungle.subiu.dev`. A revisão `paper-v5` restaura esse endereço em todas as mídias finais; `paper-v4` permanece preservada como histórico. Os cortes e as capturas reais continuam iguais.

## Textos animados com Remotion

A revisão `paper-v6-remotion` do vídeo principal usa Remotion 4.0.534, em um [projeto isolado](../marketing/portfolio/remotion/README.md). Títulos e textos de apoio entram por linhas, com opacidade e deslocamento vertical de 18 px em 18 frames; o intervalo entre linhas é de três frames. Depois, permanecem imóveis para leitura. A entrada acontece uma vez por seção, mesmo quando há vários cortes da captura.

Logo, assinatura e aviso de créditos fictícios permanecem fixos. Os números da abertura aparecem com seus valores finais. Saldo, ledger, resposta do replay e gráficos são as imagens reais da gravação, sem animação ou substituição de valores. A versão técnica de 90 segundos continua estática. A exportação principal mantém 60 segundos, 1920 × 1080, 30 fps, H.264 e ausência de áudio.
