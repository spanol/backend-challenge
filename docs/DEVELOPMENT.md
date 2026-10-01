# Harnesses e configurações de desenvolvimento

Use Bun 1.4.2 e instale com `bun install --frozen-lockfile --ignore-scripts`. O runtime, o lockfile e as dependências de qualidade têm versões fixadas. `.editorconfig` e `.gitattributes` padronizam UTF-8, espaços e LF; o enunciado preserva seus bytes originais.

## Gates locais

| Comando                 | Responsabilidade                               | Infraestrutura          |
| ----------------------- | ---------------------------------------------- | ----------------------- |
| `bun run check`         | Typecheck, ESLint e Prettier                   | Nenhuma                 |
| `bun run verify`        | Gate estático e testes de unidade              | Nenhuma                 |
| `bun run verify:full`   | Gate estático e todas as suítes isoladas       | PostgreSQL e LocalStack |
| `bun run lint:fix`      | Correções automáticas disponíveis no ESLint    | Nenhuma                 |
| `bun run format`        | Formatação dos arquivos do projeto             | Nenhuma                 |
| `bun run test:coverage` | Cobertura dos módulos exercitados pela unidade | Nenhuma                 |

`scripts/verify.ts` executa as etapas em sequência, para na primeira falha e devolve um exit code diferente de zero. O relatório `test-results/verify-{static,quick,full}.json` registra versões, horários, resultado e duração de cada etapa. Nenhum comando desse gate instala pacotes ou altera código automaticamente.

O gate completo chama `test:suites` após o typecheck inicial, evitando repetir a análise de tipos. `test:all` continua verificando tipos quando executado sozinho.

Para a harness completa:

```sh
docker compose up -d postgres localstack --wait
bun run verify:full
```

## Regras de código

[ESLint](../eslint.config.mjs) usa análise com tipos do TypeScript: detecta `any` explícito, acesso inseguro, promises abandonadas e usos assíncronos incorretos. Domínio não importa frameworks, infraestrutura, aplicação ou adapters; casos de uso não importam adapters concretos. Logs de produto passam pela observabilidade; `console` fica permitido somente nesse adaptador e em scripts/testes. Prettier cuida da formatação, sem regras de estilo duplicadas no ESLint.

O TypeScript também verifica símbolos não usados, retornos implícitos, overrides, fallthrough e diferenças de caixa em caminhos. As exceções de lint são locais: hooks de migrations MikroORM registram SQL síncrono com contrato assíncrono; os matchers `.rejects` do Bun precisam de `await` em runtime, apesar da tipagem `void` nessa versão. Essas exceções não se estendem ao código financeiro.

Use uma linha em branco entre funções, classes, métodos e getters. Dentro de uma função, separe etapas como preparação, validação, execução e retorno; mantenha declarações relacionadas, campos e propriedades consecutivos. Decorators e comentários de documentação permanecem junto da declaração correspondente. Prettier conserva essas separações e limita sequências de linhas vazias a uma.

## Organização dos contratos TypeScript

Tipos e interfaces ficam em `types/` dentro da camada responsável, separados por domínio: dinheiro, carteira, apostas, eventos e mensagens. Aplicação mantém portas financeiras, execução e identidade do provedor; infraestrutura mantém contratos de SQL, SQS e composição do runtime. HTTP, IPC de teste e relatórios da harness possuem contratos próprios. A estrutura completa está em [ARCHITECTURE](../ARCHITECTURE.md).

Importe tipos diretamente desses arquivos com `import type`. Classes e funções permanecem nos módulos de implementação. `StoredResult` é a definição única do resultado persistido e `LedgerDirection` define a direção do ledger nas entidades de domínio e nas linhas do ORM.

## Testes reproduzíveis

`bun run test` usa somente a unidade, timeout de 30 segundos e relatório JUnit em `test-results/unit.junit.xml`. Integração e concorrência passam por `scripts/test-suite.ts`: recebem banco e filas exclusivos, verificam migrations `up → down → up` e usam timeout de 180 segundos por teste. O runner gera um JUnit por suíte.

`requireTestIsolation` valida `TEST_RESOURCE_ID`, os dois nomes de banco e o prefixo das filas antes de qualquer conexão das suítes. Invocar diretamente uma suíte de infraestrutura sem o runner falha antes de gravar no banco. Não use `bun test` sem filtro para a validação completa; use `bun run verify:full` ou `bun run test:all`.

O runner limpa também filas criadas antes de uma falha parcial no setup e registra `test-results/resources-{suite}.json`. Uma falha na limpeza torna o comando malsucedido e preserva a causa original do teste. SIGINT/SIGTERM interrompem o filho e encaminham o fluxo de limpeza. No modo Docker com `--rm`, os relatórios ficam no container descartável; o CI executa a harness no host e publica seus arquivos como artifacts.

A harness de processos sincroniza preparo e largada via IPC, captura PIDs e sessões PostgreSQL e falha imediatamente se o filho terminar antes do evento esperado. Os cenários financeiros comprovam sobreposição e crashes reais, com failpoints fora do produto. A carga permanece em `scripts/load.ts`, acionada deliberadamente por `bun run test:load`.

A espera controlada de 200 ms ocorre apenas no primeiro commit de cada processo. Os replays seguintes executam sem esse atraso artificial; as assertions continuam exigindo sobreposição real, cinquenta resultados e um único efeito financeiro.

`bunfig.toml` mantém retries de teste desabilitados e configura saída de cobertura em texto/LCOV. Cobertura de unidade mede os módulos importados por essa suíte; processos filhos e garantias distribuídas são comprovados pelos cenários reais, não por esse percentual.

## Editor, agentes e CI

VS Code recebe extensões recomendadas, formatação ao salvar, fixes do ESLint ao salvar explicitamente e tasks para os três gates. As cores existentes foram preservadas. As recomendações não instalam extensões automaticamente.

[AGENTS.md](../AGENTS.md) oferece o contrato para agentes: especificação antes da mudança, invariantes financeiras, isolamento de recursos e comandos de verificação. A orientação CodeGraph fornecida pelo usuário permanece intacta.

[GitHub Actions](../.github/workflows/quality.yml) configura Bun fixado, instalação congelada, infraestrutura real, `verify:full`, upload dos relatórios e coleta de logs mesmo em falhas. Actions são fixados por SHA e o token tem apenas leitura de conteúdo. O workflow será executado ao chegar a um repositório GitHub; sua configuração local não publica nem envia o projeto.

## Ciclo recomendado

1. Escolha o critério da especificação e revise a decisão arquitetural relevante.
2. Faça uma alteração pequena e execute seu teste correspondente.
3. Execute `bun run verify` antes de considerar a alteração pronta para revisão.
4. Para alterações financeiras, migrations, mensageria ou harnesses, execute `bun run verify:full`.
5. Registre somente resultados executados em `docs/VALIDATION.md`; mantenha rastreabilidade e documentação atualizadas.
