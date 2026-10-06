# Demo Decolagem com N peers

Estado: demo original recuperada do stash em 01/10/2026; integração pública e nova validação em andamento. O gate de 98 testes pertence à implementação anterior; os resultados desta retomada serão registrados separadamente. Fonte financeira: [challenge](../../CHALLENGE.md) e [especificação principal](../001-distributed-wagering/spec.md). Esta extensão é uma demonstração opcional; não muda contratos, estados ou invariantes do processador.

## Objetivo e escolhas

Apresentar o processador distribuído enquanto uma mesa de Decolagem é jogada. O usuário sugeriu reaproveitar `D:/code/betaki/backend-gateway`. Reutilizar a cena Canvas e o sprite próprios; integrar uma interface pequena ao HTTP NestJS deste repositório. O gateway original permanece intacto e não é uma dependência de execução.

Carteiras independentes são o padrão assumido. O modo compartilhado permite N peers disputarem a mesma wallet. N significa jogadores/clientes simulados, sem limite fixo de 24, e não instâncias do coordenador. Os comandos financeiros são distribuídos pelas URLs configuradas; cada resposta mostra qual API foi usada.

## Operação contínua — 04/10/2026

### Participação integral — 05/10/2026

Após observar o teto de 128 apostas, o usuário confirmou **8.000 peers em cada rodada**, aguardando a confirmação financeira antes do voo. Esse perfil substitui o rodízio de 128 descrito abaixo: a população elegível inteira aposta 1.00 BRL por rodada; carteiras sem saldo continuam aguardando e apostas manuais têm prioridade. Os blocos de 32 requisições limitam chamadas simultâneas, sem limitar a participação total da rodada. A preparação não tem um prazo que descarte apostas; os cinco segundos de contagem começam somente depois de todas as intenções terem resultado terminal. Uma falha preserva a chave e interrompe o avanço até retry.

A página apresenta apostas planejadas, confirmadas e aguardando confirmação, distinguindo processamento normal de erro que exige retomada. O tamanho do grupo pode ser atualizado por `/demo/autoplay` com `peersPerRound`, para rodadas futuras, conservando sessão, carteiras, cursor e histórico. Nesse incremento, o runtime e as novas sessões passaram a usar 8.000; o comparativo abaixo define o perfil final de apresentação. A configuração persistida de sessões existentes é preservada até atualização explícita. A pausa após o estouro começa depois da liquidação. DEM-12 comprova participação integral e contagem após confirmação; a duração da preparação depende da capacidade das APIs e deve ser registrada na observação real.

O perfil publicado mantém os eventos financeiros na SQS. A consulta prévia encontrou cerca de 390 mil eventos e LocalStack próximo de 768 MiB; o override da demo passa a reservar um limite de 2 GiB para essa dependência, com memória disponível no host. A atualização do limite é aplicada ao container existente, sem reinício ou remoção de mensagens. O acúmulo de eventos continua exigindo acompanhamento; o aumento do limite não comprova capacidade contínua ilimitada.

### Comparativo e perfil de apresentação — 05/10/2026

O usuário pediu documentar 8k (já observado), 4k, 2k e 1k apostas por rodada e encerrar a apresentação no perfil mais rápido e eficiente entre 1k e 2k. Neste ensaio, "simultâneas" significa participação na mesma rodada, com o envio existente de até 32 chamadas em voo. Não se oferece uma rajada de milhares de conexões HTTP. O comparativo usa a sessão existente, aposta de 1.00 BRL e três rodadas por novo perfil, cobrindo os três pontos de estouro. O registro anterior de 8k tem uma rodada completa e preparação observada parcialmente; esse limite deve ficar explícito na comparação.

DEM-13 registra participantes confirmados, saques/perdas, tempos aproximados de preparação e liquidação, consumo dos quatro serviços, pendências de outbox e reconciliação SQL das carteiras. A mudança de perfil ocorre depois da liquidação, sem limpar banco, ledger, filas ou journal. Ao final, o runtime e a página sugerem a população escolhida; uma nova sessão de apresentação pode ser criada explicitamente após encerrar a sessão do ensaio, preservando o histórico financeiro anterior no SQL. Os resultados e os commits pertencem à branch `demo-deploy`; `main` permanece em 03/10/2026.

DEM-14 cobre a passagem do instante do estouro durante respostas de WIN: antes de planejar LOSS, a mesa liquida todos os demais alvos elegíveis, conservando a pausa e as identidades em caso de resposta incerta. O primeiro ensaio de 4k mostrou esse defeito do coordenador; seus resultados ficam identificados como tentativa anterior à correção. Não se reescrevem resultados financeiros históricos. O comparativo aprovado exige saques iguais ao número de alvos contratados estritamente abaixo do estouro.

O [comparativo aprovado](../../docs/DEMO-CAPACITY.md) escolheu **1.000 peers por rodada**, com mediana de 25,5 segundos até liquidar, contra 47,8 segundos em 2k. O runtime, Compose e sugestão da página passam a usar 1.000 carteiras independentes e participação integral. O limite configurável permanece em 8.000. A nova sessão de apresentação conserva no PostgreSQL o histórico das carteiras anteriores.

### Cadência da apresentação — 05/10/2026

Após considerar a mesa lenta, o usuário confirmou manter **1.000 apostas em toda rodada**. A redução deve vir de processamento e pausas: confirmação integral antes do voo, contagem de três segundos após os ACKs e exibição do resultado por 1,5 segundo após liquidar. O limite continua em 32 requisições em voo, com reposição de uma vaga assim que sua resposta termina. Uma resposta incerta interrompe novos envios; chamadas já iniciadas terminam e as identidades restantes ficam disponíveis para retry.

DEM-15 cobre esse limite, a reposição de vagas sem esperar a chamada mais lenta do grupo e o bloqueio após falha. As durações são publicadas no dashboard para o observador medir os marcos reais. Os comparativos anteriores conservam seus tempos de cinco segundos e 3,7 segundos, sem reinterpretação retroativa.

DEM-16 cobre um consumidor opcional de auditoria de eventos, habilitado somente no override da demo. Cada lote é confrontado com os envelopes arquivados na outbox e registra recibos duráveis em `event_receipts`; o ACK da SQS ocorre depois do commit. Reentregas conservam um único recibo por consumidor/evento. Falha de validação, SQL ou ACK preserva a possibilidade de reentrega. Esse consumidor não executa novos comandos financeiros nem reescreve eventos históricos. O perfil financeiro padrão mantém essa opção desligada.

Um índice parcial de telemetria sobre `outbox(occurred_at)` mantém a idade e a contagem exatas sem depender de varrer os envelopes publicados. A aplicação da migration em produção será somente `up`, depois de liquidar a mesa; `down` pertence exclusivamente à harness isolada. O override da demo reserva 1,5 CPU e 1 GiB para API e PostgreSQL, com recursos disponíveis no host. A observação deve separar os efeitos desses ajustes, registrar falhas encontradas e auditar todas as 1.000 carteiras.

DEM-17 reduz a revalidação de vínculos financeiros históricos: soma, contagem, versão e cadeia completa do ledger continuam conferidas no commit; checks de transação, snapshot e referência verificam a operação inserida/alterada ou vinculada ao ledger inserido. Transações terminais e ledger históricos permanecem imutáveis. A identidade jogador/moeda da wallet não pode mudar, inclusive por SQL do owner. Um índice parcial não único atende a contagem de OPENINGs. A validação não usa caches, flags de sessão ou contornos de `SET CONSTRAINTS`; a harness deve repetir as provas SQL, concorrência e migrations antes do deploy.

### Continuidade após esgotar carteiras — 05/10/2026

A operação publicada esgotou as 1.000 carteiras: todas ficaram abaixo da aposta de 1.00 BRL e o autoplay passou a produzir rodadas vazias. Para sustentar a apresentação, antes das apostas automáticas o coordenador substitui somente a carteira esgotada do assento por uma nova carteira independente de simulação, aberta pela API com 100.00 BRL fictícios e outro jogador. O assento, sessão e contador de rodadas permanecem; a wallet anterior, seu saldo residual e histórico financeiro permanecem no PostgreSQL. Essa escolha substitui a exclusão permanente de participantes sem saldo descrita no perfil histórico abaixo.

Não se usa WIN, REFUND ou escrita direta de saldo para repor dinheiro. A renovação só ocorre sem aposta da rodada atual daquele assento, depois da liquidação anterior, no modo independente com autoplay ativo. Os comandos de desfecho/reversão de apostas anteriores continuam vinculados à wallet e ao jogador originais. O dashboard informa a quantidade de carteiras renovadas e falhas de provisionamento bloqueiam o avanço até retomada. Aberturas bem sucedidas são persistidas antes de novas apostas; uma abertura com resposta perdida pode deixar uma carteira não utilizada, pois a API de abertura não oferece recuperação por identidade. Não se declara idempotência dessa abertura.

DEM-18 registra o diagnóstico agregado, a renovação, a continuidade de 1.000 BETs por rodada e a preservação dos lançamentos anteriores. Este incremento não altera o contrato financeiro do challenge.

### Inclusão de novos jogadores no auto bet — 06/10/2026

DEM-19: adicionar peers reserva os novos assentos para a rodada seguinte e amplia o grupo automático independente pela quantidade efetivamente provisionada, até o limite configurável de 8.000. A ampliação acontece somente quando os peers pendentes entram na mesa, antes de planejar as apostas da nova rodada, e é persistida junto com essa transição. Uma mesa de 1.000 peers com grupo de 1.000 que recebe mais 100 passa a apostar com 1.100 na rodada seguinte; a rodada em andamento conserva suas apostas.

A ampliação também é preservada quando o autoplay está pausado, para valer após a retomada. O modo compartilhado permanece manual; reservas manuais mantêm prioridade e não geram uma segunda BET automática para o mesmo peer. Quando a população ultrapassa o grupo limitado a 8.000, o cursor continua distribuindo a participação em rodízio. Reiniciar recupera o tamanho persistido do grupo e peers ainda pendentes, sem repetir a ampliação de peers já incorporados.

### Perfil inicial de rodízio — histórico

A configuração inicial da demo passa a ter 8.000 peers independentes. O jogo automático percorre essa população em grupos de até 128 peers por rodada, preservando o cursor no journal e voltando ao início depois de todos terem tido sua vez. Não são 8.000 apostas simultâneas nem uma declaração de capacidade medida. A aposta automática é de 1.00 BRL; jogadores sem saldo suficiente aguardam, sem reposição artificial de dinheiro. Apostas manuais reservadas têm prioridade e não são duplicadas pelo jogador automático.

Cada aposta automática recebe um alvo de saque determinístico, variado entre jogadores e rodadas, ou permanece até o estouro. Um alvo alcançado estritamente antes do ponto de estouro gera WIN pelo valor exato daquele alvo; os demais recebem LOSS. O coordenador verifica alvos vencidos antes de encerrar o voo, inclusive quando um tick atrasado cruza o instante do estouro. Pausar a operação impede novas apostas automáticas; os desfechos das apostas já confirmadas continuam sendo liquidados. O modo compartilhado permanece manual.

As identidades e os alvos são persistidos antes do envio financeiro. Falhas conservam a intenção original e pausam o avanço até retry. Sessões existentes são recuperadas com sua população e configuração, sem recriar carteiras ou ativar apostas silenciosamente. Para operação contínua, o journal retém a rodada atual e a anterior, além de contadores acumulados; a compactação só ocorre após todas as apostas e operações estarem encerradas. O histórico financeiro completo permanece no PostgreSQL e nas consultas de evidência.

A interface mostra a população total, o grupo da rodada, apostas confirmadas, saques, perdas e totais monetários exatos. A operação pode ser iniciada e pausada na página, e uma nova sessão usa 8.000 como quantidade sugerida. Os pontos de estouro continuam explicitamente rotulados como demonstração.

Critérios adicionais: DEM-09 percorre toda a população sem repetir peer no grupo; DEM-10 liquida saques/perdas e conserva a identidade após falha; DEM-11 limita o journal entre rodadas e mantém contagens acumuladas e evidência SQL.

Uma mesa local decide fase, instante de saque e resultado. Rodadas com pontos de estouro predefinidos e identificados como demonstração tornam o ensaio reproduzível; não são um mecanismo de jogo para produção nem uma prova de aleatoriedade. Abertura, voo e encerramento são comandados pela mesa; o navegador só solicita ações e anima o estado recebido.

## Contrato financeiro

| Ação                             | Comando  | Regra                                                                     |
| -------------------------------- | -------- | ------------------------------------------------------------------------- |
| Apostar                          | BET      | Valor positivo decimal, referência externa única por aposta               |
| Sacar                            | WIN      | Referencia a BET; valor integral do prêmio calculado pelo servidor        |
| Perder                           | LOSS     | Zero, mesma rodada; não debita novamente                                  |
| Cancelar antes do voo            | REFUND   | Referencia a BET, mesmo valor integral                                    |
| Reverter saque para demonstração | ROLLBACK | Referencia WIN, mesmo prêmio; insuficiência continua rejeição auditável   |
| Repetir último comando           | Replay   | Mesma chave e payload, saldo histórico distinto do saldo atual consultado |

Valores monetários são strings com duas casas em UI/HTTP e BigInt/Money na aritmética. Multiplicador pode usar number para tempo/animação; seu valor em centésimos vira BigInt antes de calcular `centavosDaAposta * centesimosDoMultiplicador / 100`, truncado explicitamente ao centavo. O navegador não escolhe prêmio nem multiplicador de liquidação.

## Componentes e recuperação

- Servidor Bun separado, ligado a loopback, serve a página e `/demo/*`; chama exclusivamente as APIs financeiras configuradas no ambiente. Não acessa tabelas financeiras diretamente.
- Coordenador único serializa decisões da mesa. O lote de N BETs é enviado em paralelo para que a disputa alcance PostgreSQL e diferentes APIs reais.
- Intenções financeiras com chave/payload estáveis são gravadas em um journal local antes do primeiro envio. Resultado confirmado é registrado depois. Erro de transporte conserva a intenção e bloqueia novas ações até retry; não vira rejeição de negócio.
- Ao reiniciar, reenvia intenções incompletas com as mesmas identidades. Apostas ainda abertas são estornadas antes de liberar uma nova rodada; um WIN já planejado é recuperado como WIN, sem estorno concorrente.
- O journal é exclusivo da demo, em `.tmp/`, e não substitui inbox, outbox ou idempotência SQL. Somente uma instância pode usar o arquivo; a execução recusa lock de outro processo. A demo não limpa saldo nem histórico financeiro.
- Dashboard consulta saldo atual, ledger paginado e reconciliação pelo HTTP. A resposta original de uma operação continua rotulada como saldo histórico.

## Critérios de aceite

| ID     | Cenário verificável                                                                                                                                  |
| ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| DEM-01 | Criar sessão com N peers, independentes ou compartilhados, sem reutilizar wallets de sessões anteriores                                              |
| DEM-02 | Uma BET processada debita uma vez; cancelamento integral devolve; saque credita prêmio exato; LOSS não acrescenta débito                             |
| DEM-03 | Lote de BETs usa as três APIs; modo compartilhado 100.00/80.00 recusa gastos além do saldo                                                           |
| DEM-04 | Saque depois do estouro é recusado pela mesa, inclusive com estado visual atrasado                                                                   |
| DEM-05 | Replay mostra resultado histórico e consulta separadamente saldo atual; conflito retorna 409 e não muda saldo                                        |
| DEM-06 | Journal antecede envio; perda de resposta/reinício conserva chave e impede WIN mais REFUND para a mesma aposta                                       |
| DEM-07 | Todas as wallets do cenário integrado fecham com saldo calculado igual ao materializado e diferença zero                                             |
| DEM-08 | Desktop e retrato permitem apostar/sacar e inspecionar evidências; navegação por teclado e erros visíveis                                            |
| DEM-20 | Sessão compartilhada processa apostas e resultados de vários peers em rodadas sucessivas na mesma wallet/player, com reconciliação zero              |
| DEM-21 | Rodada compartilhada só recusada por saldo insuficiente pausa sem abrir carteiras substitutas, creditar saldo ou iniciar novo voo                    |
| DEM-22 | Cada rodada usa ponto de estouro CSPRNG gerado no servidor e salvo antes das operações; testes podem injetar sequência determinística                |
| DEM-23 | Página pública usa identidade genérica, identifica créditos fictícios, explica peers do mesmo titular e mantém ferramentas de diagnóstico recolhidas |
| DEM-24 | Saldo inicial fictício configurável abre uma carteira reconciliada; crédito não é renovado e a sessão compartilhada pausa quando esgota              |

## Reposicionamento como portfólio — 06/10/2026

A página pública passa a apresentar o sistema como uma demonstração independente de processamento financeiro para jogos, sem identidade visual ou texto específico da Jungle Gaming/challenge. A narrativa central é uma carteira de simulação de um único titular, disputada por vários peers/sessões dentro de um jogo. Os peers não representam titulares distintos: todos os comandos continuam respeitando o vínculo `playerId`/wallet exigido pelo contrato financeiro. A interface deve deixar essa relação clara e marcar saldo e prêmios como créditos fictícios, sem sugerir depósitos, pagamentos reais ou operação com clientes.

Uma nova sessão sugerida usa a carteira compartilhada e apostas automáticas em rodadas sequenciais. Cada BET tenta debitar a mesma carteira; WIN e LOSS seguem as regras financeiras existentes e a reconciliação do saldo/ledger permanece visível como evidência. O saldo não é renovado nem recebe crédito artificial quando acaba. Quando uma rodada automática não consegue confirmar nenhuma aposta por insuficiência de saldo, o autoplay pausa com estado e motivo explícitos; falhas de transporte continuam bloqueando avanço e preservando a identidade para retry. Sessões independentes continuam disponíveis como comparação técnica, sem serem a narrativa principal.

Os pontos de estouro das novas rodadas são sorteados no servidor por fonte criptograficamente segura e persistidos no estado da rodada antes de planejar operações. Testes podem injetar sequência determinística. Isso evita o ciclo visual repetido e mantém decisões fora do navegador, mas não deve ser descrito como prova provably-fair nem como RNG auditável. Esta atualização altera somente a apresentação e o comportamento da mesa de demonstração; não muda `CHALLENGE.md`, contratos financeiros ou invariantes de saldo, ledger, transação, inbox/outbox e ACK após commit.

O primeiro perfil compartilhado abriu a carteira com R$ 100,00, exatamente o volume de 100 apostas de R$ 1,00 por rodada. A observação em produção mostrou que o saldo terminou em duas rodadas e o autoplay pausou corretamente. Para sustentar uma sessão demonstrativa mais longa sem recarga artificial, o valor de abertura passou a ser configurável por `DEMO_INITIAL_BALANCE`; o perfil público usa R$ 10.000,00 fictícios. O valor só é enviado ao criar uma carteira, validado como Money BRL positivo com duas casas e reconciliado no ledger. A exaustão continua terminal para o autoplay compartilhado, sem substituição de carteira.

## Incrementos e validação

1. Porta HTTP e coordenador/journal, com unidade para prêmio exato, estado e recuperação.
2. Página jogável e cena reaproveitada, com controles de N peers e dashboard financeiro.
3. Integração pelo runner isolado: três apps HTTP reais sobre PostgreSQL/SQS, corrida de saldo e reconciliação. Testes de UI e renderização no navegador.
4. Comando de execução, Docker opcional, procedência dos assets, roteiro e resultados reais em VALIDATION.

Gate de prontidão: escopo, contratos, sequência e testes definidos; nenhuma mudança financeira no núcleo. Falhas de dependência são exibidas e preservam retry. Prazo e autenticação de produção não fazem parte deste incremento local.

## Integração pública autorizada em 01/10/2026

- Publicar a demo em `https://jungle.subiu.dev`, usando o BasicAuth existente. A API financeira e os health checks mantêm suas rotas; página, assets e `/demo/*` são encaminhados ao servidor Bun separado.
- A demo chama a API interna do challenge, com uma URL no deploy atual. N peers representam jogadores simulados; não declarar múltiplas instâncias a partir desse único endpoint. As provas de três APIs continuam nos testes isolados.
- Corrigir a adaptação de `id` da abertura para `WalletView.walletId`; reutilizar os enums financeiros atuais e manter erros da demo em taxonomia própria.
- Validar `Origin` contra o domínio HTTPS configurado, sem depender do esquema HTTP entre proxy e container. Journal em volume próprio, processo único e limites de recursos.
- Executar a bateria pelas rotas da demo, com sessões/carteiras próprias, BET/WIN/LOSS/REFUND/ROLLBACK, replay/conflito, disputa de saldo e reconciliação. Coletar Prometheus, logs/traces e janela temporal; observar a saúde das aplicações existentes durante a carga.
