# Validação do vídeo completo para LinkedIn

Revisão de 14/10/2026, Windows local com Bun 1.4.2, Node 24.16.0, Remotion 4.0.534 e FFmpeg. Alterações editoriais e no gerador; nenhuma mudança nos invariantes financeiros, na infraestrutura ou na produção.

Arquivo: [processador-masterpiece-linkedin-remotion.mp4](../marketing/portfolio/videos/processador-masterpiece-linkedin-remotion.mp4). H.264, 1920 × 1080, 30 fps, 3.210 frames, 107 segundos exatos, 6.017.701 bytes e nenhuma faixa de áudio. SHA-256: `C365A5824C7F3CA3AC3EA2923CE5A121F33106ACE95ADF777D8AD862ED70E412`.

O gerador prepara as camadas originais, renderiza cenas novas e overlay no Remotion e monta os trechos já animados no FFmpeg. Os timestamps são normalizados por índice de frame antes da concatenação. A primeira tentativa de renderizar todos os vídeos históricos no navegador excedeu o timeout; a primeira montagem com stream copy revelou time bases distintas e DTS sobrepostos. Ambos os caminhos foram substituídos. A montagem final terminou com exit code 0.

`bun run verify` passou: typecheck, ESLint sem warnings, Prettier e 107 testes unitários, zero falhas, 26.376 assertions. Após os últimos ajustes do gerador, `bun run check` passou novamente com exit code 0. `git diff --check` passou. A busca por U+2013/U+2014 no copy e nos textos dos slides não encontrou travessões.

`ffprobe` confirmou os metadados acima. A decodificação completa com `ffmpeg -v error -i ... -f null -` terminou com exit code 0 e log vazio, inclusive sem diagnósticos de DTS. Foram inspecionados quadros das 13 cenas, entradas das animações e junções. Os últimos quadros das cenas modificadas confirmaram datas, aviso de créditos fictícios e chamada posterior ao replay sem sobreposição. Logs e imagens ficam em `test-results/linkedin-refine/`, ignorado pelo Git.

O slide de concorrência usa coordenadas compartilhadas para centros de cartões, mensagens e ligações; os cartões conectados entram sem deslocamento. As provas históricas conservam saldo R$ 32,10, 657 lançamentos e diferença R$ 0,00, com confirmação do replay e consulta posterior. O recorte posterior foi ajustado à rolagem realmente observada. Os gráficos, logs e traces do Grafana continuam gravados e datados, sem afirmação de que pertencem ao teste de 50 entregas.

O ledger atual é uma consulta de outra carteira: R$ 0,89, 1.421 lançamentos e diferença R$ 0,00. A captura foi somente leitura; a mesa apresentava operação pendente e não foi retomada durante este trabalho. Diagramas de HTTP/SQS, atomicidade e ciclo financeiro explicam a implementação documentada, sem representar uma nova prova de capacidade em produção. A publicação anterior foi removida pelo usuário; este registro valida o arquivo local, não uma nova postagem.
