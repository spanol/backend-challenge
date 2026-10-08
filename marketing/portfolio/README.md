# Vinicius Spanol · Engenharia aplicada

Padrão de capa para a série **Engenharia aplicada**. A assinatura **Vinicius Spanol** permanece fixa no canto superior esquerdo; título, categoria, evidências e endereço mudam a cada projeto.

## Arquivos

- [Configuração editável](brand.json): textos, cores e ordem das capas.
- [Gerador](generator/render.mjs): produz SVG e PNG com as fontes do Subiu em curvas.
- [Capa do processador, horizontal](covers/01-processador-1920x1080.png).
- [Capa do processador, vertical](covers/01-processador-1080x1350.png).
- [Capa Grafana](covers/02-grafana-1920x1080.png).
- [Modelo para a próxima publicação](covers/03-modelo-futuro-1080x1350.png).
- [Print de recursos e operação](support/01-recursos-operacao-1080x1350.png).
- [Print de latência](support/02-latencia-1080x1350.png).
- [Print de traces](support/03-traces-1080x1350.png).
- [Vídeo principal, 60 segundos](videos/processador-demo-60s.mp4): app, reconciliação, replay e Grafana.
- [Prévia animada dos textos](videos/processador-textos-preview.gif): entrada das linhas na seção de replay.
- [Vídeo técnico, 90 segundos](videos/processador-inspecao-90s.mp4): leitura da reconciliação antes/depois do replay.
- Listas de cortes [principal](videos/edit-main.json) e [técnica](videos/edit-technical.json).
- Primeiro rascunho sem replay em `videos/processador-primeira-captura-60s.mp4`, como acervo.

## Padrão visual

| Elemento      | Regra                                                 |
| ------------- | ----------------------------------------------------- |
| Assinatura    | Vinicius Spanol, no alto à esquerda                   |
| Identificação | Logo oficial do Subiu e número da publicação          |
| Tipografia    | Archivo Black, Archivo e JetBrains Mono               |
| Fundo         | Papel `#eaebe6`; console `#141815` na área da captura |
| Destaque      | Verde `#12b24c`, em pequenos sinais                   |
| Texto         | Tinta `#0c0f0d`; apoio `#4b534e`                      |
| Margens       | 80 px no horizontal; 72 px no vertical                |
| Título        | Uma ideia concreta, em até três linhas                |
| Evidências    | Até três fatos verificáveis; sem métricas inventadas  |
| Rodapé        | Endereço do projeto e contexto da demonstração        |

Use 1920 × 1080 para abertura do vídeo e 1080 × 1350 para capa de imagens. Os títulos têm quebras próprias para cada formato. Revise a imagem renderizada após mudar textos.

Revisão visual de 07/10/2026: o kit segue a direção **PAPEL** do checkout `D:/code/subiu`, com tokens confirmados em `apps/web/app/globals.css` e tipografia confirmada no layout do site. A logo vem de `marketing/subiu/out/logo-transparente.svg`; os paths originais estão preservados em `assets/subiu-logo.svg`. Réguas grossas, cantos retos e verde pontual acompanham o design system. O texto do primeiro trecho menciona créditos fictícios uma única vez, no rodapé. Os demais trechos também têm descrições mais curtas.

O ai-memory foi consultado com buscas globais pelo Subiu e pela identidade visual, além das páginas recentes de `jungle-gaming/backend-challenge`. A integração disponível não retornou uma página de design system do Subiu; a referência visual foi confirmada nos arquivos locais, sem inferir tokens a partir da memória. A primeira versão das mídias foi preservada em `.tmp/portfolio-v1`.

Os números **50 entregas / 3 processos / 1 débito** vêm do cenário histórico de concorrência descrito em `docs/REVIEW.md` e no gate de 06/10. A demo pública usa uma API financeira. A gravação do app não reproduz, por si só, esse teste entre processos.

## Gerar novamente

O renderer fica isolado em `.tmp/brand-kit-deps`, sem alterar dependências do aplicativo. Com Bun 1.4.2:

1. Crie `.tmp/brand-kit-deps/package.json` com `{"private":true,"dependencies":{"@resvg/resvg-js":"2.6.2","fontkit":"2.0.4"}}`.
2. Naquela pasta, execute `bun install --lockfile-only --ignore-scripts` uma vez para gerar o lockfile.
3. Execute `bun install --frozen-lockfile --ignore-scripts`.
4. Na raiz do repositório, execute `bun marketing/portfolio/generator/render.mjs`.
5. Para as placas com capturas reais já presentes em `assets`, execute `bun marketing/portfolio/generator/support.mjs`.
6. Para as molduras e o encerramento do vídeo, execute `bun marketing/portfolio/generator/video-frames.mjs`.
7. Para o vídeo principal com textos animados, siga os comandos do [projeto Remotion](remotion/README.md).
8. Para a versão técnica, use o mesmo comando com `marketing/portfolio/videos/edit-technical.json`.

As fontes originais ficam em `assets/fonts`, com suas licenças. O helper compartilhado `generator/brand-kit.mjs` transforma o texto em paths com kerning e ajusta linhas à largura disponível. A renderização não usa fontes do sistema nem substitui fontes ausentes silenciosamente.

## Mídia real

O vídeo usa as capturas fornecidas pelo OBS. Os originais têm 1280 × 720; o export 1920 × 1080 amplia recortes da aplicação e do Grafana, com molduras vetoriais da marca. As ampliações de prova financeira mostram regiões do mesmo frame ao mesmo tempo. Nenhuma faixa de áudio do original é usada. Gráficos de apoio devem conservar período e escala legíveis, com data da captura. Zero em um painel não prova uma auditoria financeira completa. Identidades fictícias não devem ser apresentadas como clientes reais.

O roteiro e o estado da gravação estão em [DEMO_VIDEOS](../../docs/DEMO_VIDEOS.md). O texto da publicação está em [LINKEDIN_POST](../../docs/LINKEDIN_POST.md).

Revisão `paper-v4` de 07/10/2026: endereço da demo atualizado para `wagering.subiu.dev` nas capas, imagens de apoio e ambos os vídeos. A revisão anterior está preservada em `.tmp/portfolio-paper-v3`.

Revisão `paper-v5`, na mesma data: endereço principal restaurado para `jungle.subiu.dev` nas capas, imagens de apoio e ambos os vídeos, por pedido do usuário. A revisão Wagering permanece em `.tmp/portfolio-paper-v4`.

A revisão atual do vídeo principal, `paper-v6-remotion`, adiciona entradas suaves aos textos da abertura, molduras e encerramento. Logo, assinatura e aviso de créditos fictícios permanecem fixos. Os seis blocos de texto acompanham as seções do vídeo sem repetir a entrada a cada corte. O vídeo técnico continua na revisão estática `paper-v5`. Código, dependências exatas, lockfile e comandos estão em [remotion](remotion/README.md).
