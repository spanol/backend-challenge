# Demo Decolagem com N peers

Estado: demo original recuperada do stash em 01/10/2026; integração pública e nova validação em andamento. O gate de 98 testes pertence à implementação anterior; os resultados desta retomada serão registrados separadamente. Fonte financeira: [challenge](../../CHALLENGE.md) e [especificação principal](../001-distributed-wagering/spec.md). Esta extensão é uma demonstração opcional; não muda contratos, estados ou invariantes do processador.

## Objetivo e escolhas

Apresentar o processador distribuído enquanto uma mesa de Decolagem é jogada. O usuário sugeriu reaproveitar `D:/code/betaki/backend-gateway`. Reutilizar a cena Canvas e o sprite próprios; integrar uma interface pequena ao HTTP NestJS deste repositório. O gateway original permanece intacto e não é uma dependência de execução.

Carteiras independentes são o padrão assumido. O modo compartilhado permite N peers disputarem a mesma wallet. N significa jogadores/clientes simulados, de 1 a 24, e não instâncias do coordenador. Os comandos financeiros são distribuídos por três URLs configuráveis; cada resposta mostra qual API foi usada. A data da apresentação não foi informada.

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
