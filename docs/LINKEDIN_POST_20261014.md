# LinkedIn: processador de apostas (14/10/2026)

Status: publicação anterior removida pelo usuário. Vídeo completo refinado e validado, pronto para novo envio. Evidências em [validação editorial](LINKEDIN_VIDEO_VALIDATION_20261014.md).

## Copy

A Medida Provisória recente proibiu a exploração de apostas de quota fixa no Brasil, mesmo assim não recuei e criei esse projeto de portfolio para aplicar tudo que eu aprendi nesses dois anos de igaming e 5 anos como desenvolvedor fullstack, com isso saiu esse processador de apostas.

Em um teste de concorrência, enviei a mesma aposta 50 vezes, distribuídas entre três processos. O saldo foi debitado uma única vez. Esse é um dos cenários que validei no processador de apostas que desenvolvi com TypeScript, Bun, NestJS, PostgreSQL e SQS. Considero este projeto minha masterpiece de backend para iGaming, ainda em evolução.

O desafio é manter saldo e histórico consistentes diante de concorrência, reenvios e falhas. Saldo, transação, ledger, inbox e outbox são confirmados na mesma transação PostgreSQL. Quando uma operação é reenviada, o processador recupera o resultado original sem repetir o débito.

No vídeo, mostro o caminho do comando até o commit, o ciclo BET/WIN/LOSS e as reversões. A demonstração inclui o replay de uma BET e a consulta de reconciliação antes e depois do reenvio, além do ledger e da observabilidade no Grafana.

A sessão apresentada tem 1.500 carteiras e usa uma janela de apostas de cinco segundos. As capturas históricas estão identificadas no vídeo.

A demo roda no meu homeserver, o subiu.dev, em um Intel Core i5-4570 de 4 núcleos, com cerca de 11 GiB de RAM disponíveis ao Linux. O servidor também hospeda outros projetos meus.

Na stack Docker, o processador e o PostgreSQL têm limites de 1,5 vCPU e 1 GiB de RAM cada. A demo tem 1 vCPU e 512 MiB; o SQS, via LocalStack, tem 1 vCPU e 2 GiB. Uso pool de 24 conexões no processador e até 64 chamadas financeiras em voo na demo.

A demo usa créditos fictícios e não movimenta dinheiro real: https://jungle.subiu.dev Se sua equipe internacional está construindo backend para iGaming ou sistemas distribuídos de alta concorrência, estou aberto a conversar. #Backend #SistemasDistribuidos #iGaming

## Mídia

- [Vídeo Remotion completo de 107 segundos](../marketing/portfolio/videos/processador-masterpiece-linkedin-remotion.mp4): concorrência, HTTP/SQS, atomicidade, rodada real, reconciliação, replay, consulta posterior, reversões, ledger atual, admissão e Grafana.
- [Capa PAPEL](../marketing/portfolio/covers/01-processador-1920x1080.png).
- [Interface atual](../marketing/portfolio/linkedin/2026-10-14/source-interface-overview.png).
- [Carteira e ledger atuais](../marketing/portfolio/linkedin/2026-10-14/source-wallet-ledger-current.png).
- [Configuração da rodada](../marketing/portfolio/linkedin/2026-10-14/03-configuracao-da-rodada.png).
- [Roteiro e notas de geração](../marketing/portfolio/videos/processador-masterpiece-linkedin-edit-plan.json).
- A gravação anterior [processador-demo-remotion-60s.mp4](../marketing/portfolio/videos/processador-demo-remotion-60s.mp4) foi reutilizada nas provas financeiras e na observabilidade, com sua animação original. A rodada é recortada no jogo, sem o cabeçalho antigo. As provas históricas mostram os painéis como foram gravados em 07/10/2026; não foram redesenhados nem descritos como a interface atual.

O vídeo final é H.264, 1920 × 1080, 30 fps e sem áudio. Gere-o com Bun e Remotion via `marketing/portfolio/generator/compose-linkedin-video.mjs`.

## Fontes conferidas

- A Medida Provisória 1.394/2026 proibiu no Brasil a exploração, a oferta, a intermediação e a publicidade de apostas de quota fixa: [Ministério da Fazenda](https://www.gov.br/fazenda/pt-br/composicao/orgaos/secretaria-de-premios-e-apostas/medida-provisoria-ndeg-1-394-2026-entenda-as-novas-regras-para-as-apostas-de-quota-fixa).
- Os 50 envios entre três processos pertencem a um cenário de teste documentado. Não são apresentados como benchmark de produção.
- Saldo, transação, ledger, inbox e outbox confirmados na mesma transação estão descritos em [ARCHITECTURE](../ARCHITECTURE.md) e cobertos pela suíte financeira.
- Hardware e limites ativos foram reconferidos por SSH somente leitura em 14/10/2026: Intel Core i5-4570, quatro CPUs lógicas, 11,1 GiB de RAM visíveis ao Linux; quotas e configuração por container em [SUBIU](SUBIU.md#recursos-conferidos-para-apresentação-em-14102026). O copy preserva a autoria e as alterações feitas pelo usuário no editor do LinkedIn.
- As operações, os locks por identidade/carteira, ACK após commit, publisher e retries da outbox estão em [ARCHITECTURE](../ARCHITECTURE.md). Os slides dessas capacidades são ilustrações da implementação.
- Replay: gravação complementar de 07/10/2026, mesma BET processada. Reconciliação antes e depois: R$ 32,10, 657 lançamentos, diferença R$ 0,00. Não foi executado conflito por alteração do valor.
- Captura de leitura em 14/10/2026: carteira selecionada reconciliada, R$ 0,89, 1.421 lançamentos e diferença R$ 0,00. É uma carteira distinta da prova histórica. A mesa estava com operação pendente; não foi representada como uma rodada recém-concluída nem alterada durante esta captura.
