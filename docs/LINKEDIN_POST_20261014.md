# LinkedIn — processador de apostas (14/10/2026)

Status: mídia e copy atualizadas; a publicação final será registrada aqui após o envio.

## Copy

Enviei a mesma aposta 50 vezes, distribuídas entre três processos. O saldo foi debitado uma única vez.

Esse foi um dos cenários que validei no processador de apostas que desenvolvi com TypeScript, Bun, NestJS, PostgreSQL e SQS. É o projeto que considero minha masterpiece de backend para iGaming — ainda em evolução.

O desafio está em manter saldo e histórico consistentes sob concorrência, mensagens repetidas e falhas durante o processamento. Saldo, transação, ledger, inbox e outbox são confirmados na mesma transação PostgreSQL. Quando uma operação é reenviada, o processador recupera o resultado original sem repetir o débito.

No vídeo, mostro a carteira distribuída, a reconciliação de uma carteira, o replay de uma aposta e o Grafana. Os trechos finais usam a interface atual da demo, com configuração para até 1.500 jogadores por rodada e janela de apostas de cinco segundos.

As 50 entregas são um cenário de teste de concorrência, não um benchmark de capacidade em produção. A demo usa créditos fictícios e não movimenta dinheiro real: https://jungle.subiu.dev

#Backend #SistemasDistribuidos #iGaming

## Mídia

- [Vídeo híbrido de 74 segundos](../marketing/portfolio/videos/processador-masterpiece-linkedin-74s.mp4): vídeo original de 60 segundos da carteira distribuída, precedido pela capa atual e seguido por imagens atuais da interface e da configuração da rodada.
- [Capa](../marketing/portfolio/linkedin/2026-10-14/01-ate-1500-jogadores.png).
- [Interface atual](../marketing/portfolio/linkedin/2026-10-14/02-interface-atual.png).
- [Configuração da rodada](../marketing/portfolio/linkedin/2026-10-14/03-configuracao-da-rodada.png).
- O arquivo original [processador-demo-60s.mp4](../marketing/portfolio/videos/processador-demo-60s.mp4) foi preservado sem alteração.

O vídeo final é H.264, 1920 × 1080, 30 fps, sem áudio. Gere-o com Bun e FFmpeg usando `marketing/portfolio/generator/compose-linkedin-video.mjs`.
