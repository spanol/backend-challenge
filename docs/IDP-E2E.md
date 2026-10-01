# E2E com Keycloak real

`compose.idp.yaml` cria uma stack descartável com PostgreSQL, SQS/LocalStack e Keycloak exclusivos, sem portas publicadas. Dois realms de teste são importados; as credenciais nos fixtures são somente de desenvolvimento. O teste sobe o adapter HTTP NestJS, obtém tokens por `client_credentials` e valida as chamadas contra JWKS reais. Banco e filas são gerados e removidos por `scripts/test-suite.ts idp`.

```sh
docker compose -f compose.idp.yaml -p jungle-idp-e2e run --build --rm idp-test
```

Preserve `test-results/idp.junit.xml` e `resources-idp.json` montando uma pasta gravável em `/app/test-results`, como no gate completo. Depois de copiar os relatórios, remova somente a stack criada por essa execução:

```sh
docker compose -f compose.idp.yaml -p jungle-idp-e2e --profile idp down -v
```

Não combine este arquivo com a stack principal. Não use esse comando de limpeza com o projeto `jungle-server` ou com qualquer projeto que contenha dados persistentes da demo. Cada execução deve usar um nome de projeto próprio quando houver outras execuções em andamento.

## Cenários

- Discovery, issuer, audience, expiração e `azp` emitidos pelo Keycloak; segredo de cliente incorreto recusado pelo IDP.
- Health público; rotas de wallet, métricas e transação por provedor recusam credenciais ausentes.
- Authorization malformado, assinatura adulterada, audience incorreta, provedor reservado e token de outro realm recusados.
- Token real de três segundos expira; nova emissão restaura acesso autenticado.
- Abertura de wallet, BET, replay idempotente, leitura pelo provedor correto e reconciliação exata.
- Outro provedor é bloqueado no corpo e na rota; reutilizar a chave global com outro payload gera conflito, mantendo um único efeito SQL.

Esta suíte é complementar a `verify:full`, porque depende do IDP real. O gate completo mantém seus testes de JWT/JWKS, e `test:idp` registra seu próprio JUnit e limpeza. O startup a frio do Keycloak sob quota pode levar minutos; a espera tem deadline e não repete testes que falharam. O fluxo exercitado é entre serviços; o realm de teste não habilita login interativo de usuário ou password grant.
