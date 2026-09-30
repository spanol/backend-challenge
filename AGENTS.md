# Desenvolvimento do challenge

<!-- CODEGRAPH_START -->

## CodeGraph

In repositories indexed by CodeGraph (a `.codegraph/` directory exists at the repo root), reach for it BEFORE grep/find or reading files when you need to understand or locate code:

- **MCP tool** (when available): `codegraph_explore` answers most code questions in one call — the relevant symbols' verbatim source plus the call paths between them, including dynamic-dispatch hops grep can't follow. Name a file or symbol in the query to read its current line-numbered source. If it's listed but deferred, load it by name via tool search.
- **Shell** (always works): `codegraph explore "<symbol names or question>"` prints the same output.

If there is no `.codegraph/` directory, skip CodeGraph entirely — indexing is the user's decision.
<!-- CODEGRAPH_END -->

## Contratos e comandos

- Fonte funcional: `CHALLENGE.md` e `specs/001-distributed-wagering/spec.md`. Registre mudanças de interpretação antes de implementar; mantenha `CHALLENGE.md` intacto.
- Leia `ARCHITECTURE.md` para alterações financeiras e `docs/DEVELOPMENT.md` para a harness. Use Bun 1.4.2, dependências exatas e `bun install --frozen-lockfile --ignore-scripts`.
- `bun run verify` executa typecheck, lint, formatação e unidade. `bun run verify:full` acrescenta PostgreSQL/SQS e concorrência; exige Docker com a infraestrutura disponível.
- Faça alterações pequenas e execute os checks relevantes. A validação completa é necessária depois de mudar invariantes, locks, migrations, inbox/outbox ou a harness de infraestrutura.
- O domínio permanece puro; aplicação depende de portas. Dinheiro usa `Money`, BigInt e strings decimais, com persistência exata.
- Confirme saldo, ledger, transação, inbox e outbox juntos. Preserve resultados terminais históricos e o ACK após commit. Não substitua provas de concorrência por memória, mocks ou SQLite.
- Integração/concorrência somente pelo runner isolado. Limpeza e rollback de testes atingem exclusivamente recursos gerados pela própria execução. Não reverta o banco principal para testar migrations.
- Nunca edite `bun.lock` manualmente nem desative checks globalmente para obter um gate verde. Exceções de lint devem ser pequenas, justificadas e documentadas.
- Atualize a rastreabilidade e registre comando, ambiente e resultados reais. Logs e relatórios ficam em `test-results/`, ignorado pelo Git.
