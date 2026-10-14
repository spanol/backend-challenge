# Textos animados da demo

Remotion 4.0.534 renderiza o vídeo principal de 60 segundos em 1920 × 1080, 30 fps, H.264 e sem áudio. O projeto e seu lockfile ficam separados das dependências do processador.

## Movimento e identidade

Os textos entram em sequência com opacidade e deslocamento vertical de 18 px, em 18 frames. O intervalo entre linhas é de três frames. A curva de entrada desacelera sem saltos, zoom ou efeito de digitação. Depois da entrada, o texto permanece visível até a próxima cena.

As fontes e o espaçamento vêm dos mesmos paths vetoriais das capas PAPEL. `prepare.mjs` separa cada linha em uma camada PNG transparente, preservando o desenho tipográfico. Assinatura, logo e aviso de créditos fictícios permanecem fixos. Os valores de evidência aparecem com seus números finais, sem contagem animada.

As sequências acompanham seis blocos: abertura, app, reconciliação, replay, Grafana e encerramento. Cortes consecutivos da mesma seção compartilham a animação, sem recomeçá-la. As capturas reais e as ampliações financeiras são montadas em um intermediário H.264 sem perda; Remotion adiciona somente as camadas de texto. Nenhum valor, resposta ou gráfico da gravação é redesenhado.

## Reproduzir

Com Bun 1.4.2 e ffmpeg no PATH:

1. Regenere capas e molduras conforme o [kit](../README.md). As gravações do OBS precisam estar nos caminhos da [lista de cortes](../videos/edit-main.json).
2. Nesta pasta, execute `bun install --frozen-lockfile --ignore-scripts`.
3. Execute `bun run prepare` para preparar as camadas e os recortes originais.
4. Execute `bun run studio` para revisar a timeline, ou `bun run render` para exportar `../videos/processador-demo-remotion-60s.mp4`.
5. Execute `bun finalize.mjs` para conferir o formato com ffprobe e atualizar o vídeo principal e seu plano de edição.

O Bun gerencia as dependências; o CLI usa Node (24.16.0 na exportação registrada) e Chrome Headless Shell oficial, baixado automaticamente na primeira renderização. [Comando de renderização](https://www.remotion.dev/docs/cli/render) e [animações por frame](https://www.remotion.dev/docs/animating-properties) estão documentados pelo Remotion.

Arquivos intermediários em `public/generated` e metadados em `generated` são ignorados pelo Git e pela formatação global: são saídas derivadas, recriadas pelo preparador, sem edição manual. Código, lockfile próprio, configuração e planos finais continuam versionados. Os originais do OBS permanecem intactos. A versão técnica de 90 segundos continua com textos estáticos.

## Composição atual para LinkedIn

A composição `LinkedInMasterpiece` prioriza o funcionamento do processador. Preserva trechos e animações de reconciliação, replay e Grafana do vídeo original, recupera uma consulta posterior ao replay e reaproveita as camadas originais na abertura e na rodada. O componente `src/motion.jsx` é compartilhado pelas duas composições. Os diagramas e cartões recentes complementam as provas, sem substituí-las.

Com Bun 1.4.2 e as dependências exatas já instaladas:

1. Execute `bun run prepare:linkedin` para preparar as camadas originais, os trechos reais e a captura atual do ledger. Exige o export original de 60 segundos e a gravação complementar do OBS nos caminhos registrados.
2. Execute `bun run render:linkedin` para gerar o vídeo de 107 segundos em `../videos/processador-masterpiece-linkedin-remotion.mp4`.
3. Inspecione as cenas e suas transições, especialmente as ligações do diagrama e as provas antes/depois do replay. Confirme H.264, 1920 × 1080, 30 fps e ausência de áudio com ffprobe.
4. A entrada única `marketing/portfolio/generator/compose-linkedin-video.mjs` chama os dois comandos acima.

`render-linkedin.mjs` exporta no Remotion as cenas novas e uma camada transparente com os textos originais da consulta posterior. A montagem FFmpeg preserva os trechos já animados, acrescenta suas datas e concatena o conjunto. A camada transparente usa [ProRes 4444 com alpha](https://www.remotion.dev/docs/transparent-videos); a saída pública continua H.264 sem áudio. Esse caminho evita decodificar novamente todos os vídeos históricos frame a frame no navegador. Os intermediários ficam em `generated/linkedin-render`, ignorado pelo Git.

As ligações do slide de concorrência usam os centros dos cartões e das entregas. Cartões conectados entram com opacidade, conservando sua posição para que as linhas permaneçam alinhadas durante a animação. As capturas históricas têm data na tela; saldo, ledger, respostas e gráficos nunca são redesenhados. O painel atual é de outra carteira e aparece em uma cena própria.
