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
