# Troubleshooting

## Docker não encontra o Engine

Verificar `docker info`. Se apenas aparecer `Client` e o `Server` falhar, iniciar o Docker Desktop e aguardar pelo Engine.

## Ver logs

Usar `docker compose logs -f postgres`, `docker compose logs -f keycloak` ou `docker compose logs -f redis`.

## `DATABASE_URL` não encontrada

Confirmar que existe `.env` na raiz e contém uma `DATABASE_URL` PostgreSQL com a password correta. Os scripts Prisma usam `dotenv-cli` para carregar o `.env` da raiz através de npm workspaces.

Os scripts usam `-o` para que uma variável `DATABASE_URL` herdada do terminal não substitua a configuração local. Se a API já estiver em execução, pará-la e arrancá-la novamente com `npm run start:dev`.

## Realm não aparece

A importação automática ocorre apenas quando o realm ainda não existe. Confirmar os logs do Keycloak e, se o realm já existir, atualizá-lo pela consola. Não remover volumes sem confirmar os dados existentes.

## API devolve 401

Confirmar `AUTH_DISABLED=false`, `OIDC_ISSUER_URL=http://localhost:8080/realms/COCiber`, token não expirado, realm correto e client `simoes-api`.

## Dependências novas

Depois das alterações desta fase, executar `npm install`, `npm run build` e reiniciar a API.
