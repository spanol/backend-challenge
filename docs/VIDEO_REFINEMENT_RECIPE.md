# Refino de vídeos de produto

Complemento da receita reutilizável de vídeos com branding variável, com subiu.dev como perfil inicial. Fonte: revisão editorial do processador de apostas em 14/10/2026, [roteiro](../marketing/portfolio/videos/processador-masterpiece-linkedin-edit-plan.json) e [gerador](../marketing/portfolio/remotion/README.md).

O produto e suas capacidades definem o roteiro. Branding serve ao enquadramento. Preserve cenas que mostram ação, resultado e conferência: no processador, isso inclui replay, reconciliação antes/depois, ledger, liquidação, recuperação e observabilidade.

Antes de combinar versões, inventarie os trechos úteis e o motion existente. Reutilize componentes, camadas e tempos de entrada. Anime material novo para complementar as provas reais. Ajuste a duração ao fluxo necessário; remover prova pertinente apenas para manter um vídeo curto prejudica a apresentação.

Use uma só geometria para cartões e ligações. Cartões conectados podem entrar por opacidade sem deslocamento; linhas e cartões precisam permanecer no mesmo sistema de coordenadas durante toda a animação.

Confira o enquadramento em cada instante relevante. Rolagem da gravação muda a posição da evidência. O recorte de antes do replay pode não servir à consulta posterior. Preserve números e respostas reais, date capturas históricas e identifique carteiras diferentes em cenas distintas.

Na montagem híbrida, Remotion renderiza as cenas novas e os overlays; trechos já animados entram pela montagem FFmpeg. Normalize fps, time base e timestamps antes de concatenar fontes diferentes. Exporte H.264, confira duração/frames/áudio, decodifique o arquivo inteiro e revise cenas e transições. Verifique datas, avisos e chamadas sem sobreposições.

Uma capacidade documentada ilustrada num diagrama não equivale a um novo teste gravado. Contagens da sessão ou limites configuráveis não equivalem a vazão sustentada. Mantenha cada afirmação ligada à sua fonte e ao ambiente realmente observado.

Sincronização adicional deste complemento com o Obsidian pendente: o conector recusou a escrita em 14/10/2026 porque exige aprovação de ferramenta e o runtime não permite esse fluxo. A receita já existente no vault permanece preservada.
