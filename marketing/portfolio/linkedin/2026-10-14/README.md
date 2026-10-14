# LinkedIn carousel — 14/10/2026

Three current-branding images prepared from the public demo capture made on 14 October 2026:

1. `01-ate-1500-jogadores.png` — cover for the expanded round configuration.
2. `02-interface-atual.png` — current Subiu PAPEL interface.
3. `03-configuracao-da-rodada.png` — real crop of the round controls, including participant configuration, the 1,500-bet ceiling, and five-second window.

For LinkedIn, these current assets are combined with the original distributed-wallet video in [`processador-masterpiece-linkedin-74s.mp4`](../../videos/processador-masterpiece-linkedin-74s.mp4). The output opens with image 01, keeps the original 60-second video intact in the middle, and closes with images 02 and 03. LinkedIn accepts one video or multiple images per post, so the hybrid keeps all media in a single post.

The two source crops (`source-interface-overview.png` and `source-round-controls.png`) preserve only the UI regions shown in the carousel. The cards identify the experience as a demo with fictional credits. The carousel describes interface configuration; it does not claim a load-test result or production capacity benchmark.

Regenerate the PNGs with Bun 1.4.2 from the repository root:

```powershell
bun marketing/portfolio/generator/linkedin-20261014.mjs
```

The renderer uses the existing isolated dependencies and official Subiu logo and fonts.

Regenerate the combined video with FFmpeg from the repository root:

```powershell
bun marketing/portfolio/generator/compose-linkedin-video.mjs
```
