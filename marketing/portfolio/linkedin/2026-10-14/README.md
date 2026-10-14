# LinkedIn media · Subiu PAPEL · 14/10/2026

The three current-branding images were prepared from the public demo capture made on 14 October 2026:

1. `01-ate-1500-jogadores.png` is the cover for configurable round participation.
2. `02-interface-atual.png` shows the current Subiu PAPEL interface.
3. `03-configuracao-da-rodada.png` shows the current participant controls and five-second window.

The 107-second LinkedIn video is generated at `../../videos/processador-masterpiece-linkedin-remotion.mp4`. It presents processor behavior: concurrent duplicate delivery, HTTP/SQS, commit and ACK, atomicity, round execution, reconciliation, replay, financial reversals, ledger inspection, admission and observability.

The original animations are preserved in the historical reconciliation, replay and Grafana excerpts. Cover, round and post-replay text use the same `AnimatedText` component and the original generated layers. Historical financial panels remain as recorded on 7 October; the round is cropped to remove the older website header. These excerpts are dated and never presented as the current UI.

`source-wallet-ledger-current.png` is a real read-only capture from 14 October: the selected wallet had BRL 0.89, 1421 ledger entries and zero reconciliation difference. This wallet differs from the historical replay wallet (BRL 32.10, 657 entries). The table had a pending operation during this read-only capture, so this image does not claim a new completed round or session-wide reconciliation.

The media describes configuration and an earlier concurrency test. It does not claim production capacity or a benchmark result. The demo uses fictional credits.

Regenerate the assets and Remotion video from the repository root:

```powershell
bun marketing/portfolio/generator/linkedin-20261014.mjs
bun marketing/portfolio/generator/compose-linkedin-video.mjs
```

The second command prepares the new assets and renders the composition with the project's pinned Remotion version.
