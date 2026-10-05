# Demo Decolagem com N peers

Estado: demo original recuperada do stash em 01/10/2026; integração pública e nova validação em andamento. O gate de 98 testes pertence à implementação anterior; os resultados desta retomada serão registrados separadamente. Fonte financeira: [challenge](../../CHALLENGE.md) e [especificação principal](../001-distributed-wagering/spec.md). Esta extensão é uma demonstração opcional; não muda contratos, estados ou invariantes do processador.

## Objetivo e escolhas

Apresentar o processador distribuído enquanto uma mesa de Decolagem é jogada. O usuário sugeriu reaproveitar `D:/code/betaki/backend-gateway`. Reutilizar a cena Canvas e o sprite próprios; integrar uma interface pequena ao HTTP NestJS deste repositório. O gateway original permanece intacto e não é uma dependência de execução.

Carteiras independentes são o padrão assumido. O modo compartilhado permite N peers disputarem a mesma wallet. N significa jogadores/clientes simulados, sem limite fixo de 24, e não instâncias do coordenador. Os comandos financeiros são distribuídos pelas URLs configuradas; cada resposta mostra qual API foi usada.

## Operação contínua — 04/10/2026

### Participação integral — 05/10/2026

Após observar o teto de 128 apostas, o usuário confirmou **8.000 peers em cada rodada**, aguardando a confirmação financeira antes do voo. Esse perfil substitui o rodízio de 128 descrito abaixo: a população elegível inteira aposta 1.00 BRL por rodada; carteiras sem saldo continuam aguardando e apostas manuais têm prioridade. Os blocos de 32 requisições limitam chamadas simultâneas, sem limitar a participação total da rodada. A preparação não tem um prazo que descarte apostas; os cinco segundos de contagem começam somente depois de todas as intenções terem resultado terminal. Uma falha preserva a chave e interrompe o avanço até retry.

A página apresenta apostas planejadas, confirmadas e aguardando confirmação, distinguindo processamento normal de erro que exige retomada. O tamanho do grupo pode ser atualizado por `/demo/autoplay` com `peersPerRound`, para rodadas futuras, conservando sessão, carteiras, cursor e histórico. O padrão do runtime e de novas sessões é 8.000; a configuração persistida de sessões existentes é preservada até atualização explícita. A pausa após o estouro começa depois da liquidação. DEM-12 comprova participação integral e contagem após confirmação; a duração da preparação depende da capacidade das APIs e deve ser registrada na observação real.

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

| ID     | Cenário verificável                                                                                                      |
| ------ | ------------------------------------------------------------------------------------------------------------------------ |
| DEM-01 | Criar sessão com N peers, independentes ou compartilhados, sem reutilizar wallets de sessões anteriores                  |
| DEM-02 | Uma BET processada debita uma vez; cancelamento integral devolve; saque credita prêmio exato; LOSS não acrescenta débito |
| DEM-03 | Lote de BETs usa as três APIs; modo compartilhado 100.00/80.00 recusa gastos além do saldo                               |
| DEM-04 | Saque depois do estouro é recusado pela mesa, inclusive com estado visual atrasado                                       |
| DEM-05 | Replay mostra resultado histórico e consulta separadamente saldo atual; conflito retorna 409 e não muda saldo            |
| DEM-06 | Journal antecede envio; perda de resposta/reinício conserva chave e impede WIN mais REFUND para a mesma aposta           |
| DEM-07 | Todas as wallets do cenário integrado fecham com saldo calculado igual ao materializado e diferença zero                 |
| DEM-08 | Desktop e retrato permitem apostar/sacar e inspecionar evidências; navegação por teclado e erros visíveis                |

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
