# Plano de implementação e estudo em três dias

Estado: implementação executada autonomamente em 30 de setembro de 2026. As etapas abaixo foram usadas como sequência; o estudo pode ocupar os três dias disponíveis. Resultados reais estão em [VALIDATION](../docs/VALIDATION.md), e a revisão para apresentação está no [roteiro](../docs/PRESENTATION.md). Os pesos da avaliação não são promessa de nota.

A fonte funcional é a [especificação](../specs/001-distributed-wagering/spec.md), vinculada ao [enunciado](../CHALLENGE.md). A [arquitetura](../ARCHITECTURE.md) registra as decisões adotadas. O trabalho segue especificar, decidir, provar e implementar em incrementos pequenos.

## Preparação antes do código

- [x] Ler o enunciado e a distribuição dos 100 pontos.
- [x] Comparar padrões financeiros e testes da Betaki, Subway Pay e ChuteCerto.
- [x] Criar matriz de requisitos, critérios de aceite e arquitetura inicial.
- [x] Resolver/documentar INT-03: REFUND e ROLLBACK diretos sobre a mesma BET.
- [x] Fechar INT-07: estados FAILED, esgotamento e auditoria quando PostgreSQL estiver indisponível.
- [x] Revisar INT-01, INT-02, INT-04 e INT-05 e transformar a política escolhida em exemplos de teste.
- [x] Instalar Bun 1.4.2 no perfil do usuário e configurar o PATH.
- [x] Validar runtime TypeScript/BigInt, instalação de pacote e executor de testes Bun.
- [x] Confirmar Docker daemon 29.5.3 para containers Linux e Docker Compose 5.1.4.
- [x] Validar a integração Bun/NestJS/MikroORM e fixar as versões restantes da stack.

Verificação de ambiente: Bun 1.4.2 em `C:\Users\cspan\.bun\bin\bun.exe`, TypeScript 5.9.3, NestJS 12.1.2, MikroORM 6.6.0, Docker daemon 29.5.3 Linux/x86_64 e Compose 5.1.4. PostgreSQL 17.6 e LocalStack 4.9.2 foram configurados e usados em testes reais. Terminais já abertos precisam ser reabertos para carregar o PATH atualizado. A reversão de migrations foi validada em bancos exclusivos de teste, preservando o banco principal.

## Dia 1 — domínio e primeira garantia financeira

| Ordem | Entrega                                                      | Critério para concluir                                                                        |
| ----: | ------------------------------------------------------------ | --------------------------------------------------------------------------------------------- |
|     1 | Runtime, dependências fixadas, Compose e migrations iniciais | Bun 1.x executa; PostgreSQL/SQS sobem; migration up/down/up funciona em banco descartável     |
|     2 | Money, Wallet, WagerTransaction, LedgerEntry e eventos       | Testes Bun cobrem escala, entradas inválidas, moeda, estados, versões e efeitos das operações |
|     3 | Schema, mappers e transação financeira                       | SQL direto prova UNIQUE, saldo não negativo, ledger imutável e correspondência financeira     |
|     4 | Abertura, BET/WIN/LOSS, idempotência e snapshot              | Uma execução completa grava tudo atomicamente; replay devolve saldo histórico                 |
|     5 | Primeiro teste com três processos                            | Disputa `100.00 / 80.00 + 80.00` e cinquenta duplicatas têm resultado correto                 |

Estudo associado: value object, aggregate root, reidratação, Unit of Work, Identity Map, transação SQL, lock de linha e índice único. Usar a disputa de saldo para explicar cada conceito com código e evidência.

## Dia 2 — reversões, mensageria e falhas

| Ordem | Entrega                                         | Critério para concluir                                                                     |
| ----: | ----------------------------------------------- | ------------------------------------------------------------------------------------------ |
|     6 | REFUND/ROLLBACK e referências pendentes         | Contexto/valor/tipo/estado validados; reversão concorrente e saldo insuficiente auditáveis |
|     7 | Worker de referências com relógio controlável   | Referência anterior/posterior, TTL e reinício testados sem esperar quinze minutos reais    |
|     8 | Consumidor SQS e inbox                          | Mesmo use case do HTTP; commit antes de ack; redelivery e hash conflitante cobertos        |
|     9 | Publisher de outbox e consumidor de comprovação | Dois publishers, leases abandonadas e duplicata de eventId não duplicam efeito             |
|    10 | Retry, DLQ, crash e shutdown                    | Falhas controladas em pontos exatos; recuperação comprovada após morte/reinício            |

Estudo associado: at-least-once, idempotência de negócio versus inbox, transactional outbox, visibilidade, ack, lease, backoff, DLQ e consistência eventual. Explicar a janela entre envio SQS e marcação no banco, sem prometer entrega exatamente uma vez.

## Dia 3 — cobertura completa e apresentação

| Ordem | Entrega                                             | Critério para concluir                                                                             |
| ----: | --------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
|    11 | Consultas, cursor, reconciliação, health e métricas | Endpoints obrigatórios presentes; comparação financeira consistente; diagnóstico reproduzível      |
|    12 | Auditoria da matriz de 100 pontos                   | Cada requisito aponta para decisão e evidência; nenhum item obrigatório depende de um teste pulado |
|    13 | Setup de máquina limpa e documentação final         | Outro leitor consegue subir, migrar e reproduzir todos os cenários obrigatórios                    |
|    14 | Ensaio da apresentação                              | Demonstrar disputa, replay, crash e recuperação; explicar escolhas e limitações                    |
|    15 | Diferencial opcional com tempo remanescente         | Carga com metodologia e métricas honestas; somente depois de a cobertura obrigatória passar        |

Autenticação externa, dashboard e partidas dobradas só entram se as garantias obrigatórias já estiverem demonstradas. O objetivo de pontuação máxima não justifica acrescentar complexidade que comprometa as garantias eliminatórias.

## Como implementar cada incremento

1. Selecionar requisitos e um cenário de aceite da especificação.
2. Confirmar a decisão e as invariantes esperadas; registrar uma interpretação nova antes de codificá-la.
3. Escrever o teste que verifica o comportamento e sua falha relevante. Mocks são aceitáveis para domínio puro, não para comprovar concorrência ou semântica PostgreSQL/SQS.
4. Implementar o menor fluxo completo que satisfaz esse contrato.
5. Executar os testes afetados e examinar saldo, ledger, transação, inbox e outbox conforme o cenário.
6. Atualizar evidências e documentação com o que de fato foi implementado, incluindo limitações encontradas.

Não haverá uma fase de testes apenas no fim. Observabilidade básica começa junto com o primeiro fluxo e é completada no dia 3. O cronograma poderá ser revisto pela evidência de ambiente e integração.

## Critérios de compreensão para a apresentação

| Conceito              | Explicação que precisa sair com suas palavras                                                  | Demonstração                                             |
| --------------------- | ---------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| Dinheiro exato        | Como parsing, soma, persistência e JSON evitam ponto flutuante                                 | `0.10 + 0.20`, moeda divergente e terceira casa recusada |
| Concorrência          | Quem segura a linha, por quanto tempo e por que duas apostas não gastam o mesmo saldo          | Duas apostas de `80.00` sobre `100.00`                   |
| Idempotência          | O que identifica a operação, como payload divergente conflita e onde vive o resultado original | Cinquenta envios; crédito posterior; replay histórico    |
| Ledger                | Por que saldo atual e histórico precisam confirmar juntos e como detectar divergência          | Reconciliação e tentativa SQL de violar invariantes      |
| Inbox e outbox        | Quais falhas cada padrão cobre e quais duplicatas ainda são possíveis                          | Morte antes de ack e após envio de evento                |
| Referências pendentes | Como aceitamos uma dependência fora de ordem sem prender a fila e sem perder responsabilidade  | Estorno antes da aposta e expiração controlada           |
| Recuperação           | Qual estado durável permite outra instância continuar                                          | Reinício com PostgreSQL preservado                       |
| Trade-offs            | Custo de hot wallet, trigger de verificação e escopo de autenticação                           | Métricas, arquitetura e limitações documentadas          |

## Evidências a registrar durante a implementação

Para cada execução importante, registrar comando, versões/ambiente, requisitos cobertos, resultado e limitações. Separar teste planejado, teste executado e teste aprovado. Validar o schema também por SQL direto com o papel da aplicação, e repetir a reconciliação após os cenários de concorrência e recuperação.

Um incremento está pronto quando atende aos critérios, passa nas provas relevantes e pode ser explicado. A entrega final exige todos os requisitos obrigatórios; cumprir somente os 70 pontos centrais não encerra o challenge.
