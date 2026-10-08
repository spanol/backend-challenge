# Revisão do processador em cinco minutos

A garantia central é verificável: uma operação confirma saldo, transação, ledger, diário contábil, inbox quando aplicável e outbox no mesmo commit PostgreSQL. Entregas repetidas recuperam o resultado persistido da operação original.

## Percurso de avaliação

1. Abra a [demo pública](https://jungle.subiu.dev), que usa créditos fictícios. Selecione um jogador e consulte sua reconciliação. O resultado se refere à carteira selecionada, no momento indicado.
2. Abra **Inspeção técnica** e reenvie uma operação concluída. Compare o saldo histórico retornado com o saldo atual: o replay preserva a resposta original.
3. Provoque um conflito com a mesma chave e valor diferente. A operação retorna 409 e conserva o movimento original.
4. Confira as provas de disputa de saldo e falhas abaixo. Os cenários entre réplicas pertencem à harness isolada; a demo pública utiliza uma API financeira.
5. Leia os limites medidos antes de interpretar vazão ou população como capacidade de produção.

## Garantias e suas provas

| Garantia                                                   | Mecanismo                                                              | Evidência para conferir                                                                    |
| ---------------------------------------------------------- | ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Cinquenta entregas da mesma aposta produzem um débito      | Identidade SQL, comparação do payload e resultado terminal persistido  | `tests/concurrency/distributed.test.ts`: três processos e sessões PostgreSQL independentes |
| Duas apostas de 80 sobre saldo 100 não gastam 160          | Lock por wallet, releitura e saldo não negativo                        | Cenário de débitos concorrentes; uma wallet independente continua progredindo              |
| Crash depois do commit e antes do ACK não duplica dinheiro | Inbox e operação confirmadas juntas; ACK posterior                     | Processo realmente encerrado e mensagem reentregue na suíte distribuída                    |
| Crash depois do envio não perde o evento                   | Outbox durável, lease, token e identidade estável                      | Publisher encerrado depois do send; outro processo recupera; recibo downstream idempotente |
| Escrita financeira incompleta falha no commit              | Constraints e triggers diferidos, ledger e partidas dobradas imutáveis | Integração PostgreSQL e [arquitetura](../ARCHITECTURE.md#schema-e-autoridade-sql)          |
| Centavos permanecem exatos em saldos altos                 | `Money` com BigInt, strings decimais e adaptador SQL exato             | Persistência de `900719925474099.01 + 0.01` e reconciliação real                           |

## Resultados documentados

- Imagem de 06/10/2026: **189 testes, 59.270 assertions, zero falhas e zero skips** em Docker/Linux com Bun 1.4.2, PostgreSQL 17.6 e SQS em LocalStack. [Comandos, ambiente e limites](VALIDATION.md#recuperação-após-reinício-do-host--06102026).
- Ensaio de três réplicas: duplicatas HTTP/SQS, disputa de saldo e SIGKILL durante carga, com reconciliação final. [Metodologia e resultados](DISTRIBUTED-LOAD.md).
- Recuperação da sessão pública após falha do journal: **1.500 carteiras e 288.570 operações terminais** auditadas, sem divergências financeiras. Metadados visuais perdidos foram reconstruídos; a causa física da corrupção não foi comprovada. [Registro do incidente](VALIDATION.md#recuperação-após-reinício-do-host--06102026).

Esses resultados pertencem às versões e aos cenários indicados. Não representam uma nova execução sobre a worktree atual.

## Decisões que precisam ser defendidas

- O auditor SQL verifica o histórico completo da wallet; seu custo cresce com esse histórico. Há evidência de saturação e aumento de latência sob sobrecarga.
- A entrega de eventos é pelo menos uma vez. O consumidor confirma recibo e efeito juntos; FIFO não oferece ordenação global dos commits de vários publishers.
- População de 60 mil carteiras não significa 60 mil conexões simultâneas. A bateria documenta intenções expiradas e fases que não atingiram capacidade.
- A demonstração usa crédito fictício. Liquidação bancária, câmbio, reversões parciais e capacidade AWS não foram demonstrados.

Para seguir uma operação pelo código: [serviço](../src/application/wagering.ts) → [Unit of Work](../src/infrastructure/persistence/unit-of-work.ts) → [workers](../src/infrastructure/messaging/workers.ts). Para a apresentação completa, consulte [PRESENTATION](PRESENTATION.md).
