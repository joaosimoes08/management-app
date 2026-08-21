# SIMOES Management App

Fundação da plataforma de gestão de infraestrutura, IPAM e ciberdefesa.

## Arranque local

1. Copiar `.env.example` para `.env`.
2. Iniciar o Docker Desktop.
3. Executar `docker compose up -d`.
4. Corrigir/instalar o Node.js e npm, caso necessário, e executar `npm install`.
5. Gerar o cliente Prisma: `npm run db:generate`.
6. Criar e aplicar a migração inicial: `npm run db:migrate:dev`.
7. Iniciar a API: `npm run start:dev`.

O PostgreSQL 18 e Redis 8 são persistidos em volumes Docker. O Compose usa imagens Linux oficiais e é portátil entre Docker Desktop para Windows, macOS e Linux.

O Keycloak fica disponível em `http://localhost:8080`, usa uma base PostgreSQL dedicada e importa o realm local `COCiber`. O utilizador inicial da consola é definido por `KEYCLOAK_ADMIN_USERNAME` e `KEYCLOAK_ADMIN_PASSWORD` no `.env`. Os utilizadores da aplicação devem ser criados na consola do realm `COCiber`; não existe integração LDAP nesta fase.

## API

O health check fica disponível em `GET /api/v1/health`.

O Swagger fica disponível em `http://localhost:3001/api`. O endpoint `GET /api/v1/auth/me` exige um bearer token válido do realm `COCiber`.

`AUTH_DISABLED=false` deve ser usado com o Keycloak ativo. A API valida tokens OIDC através de JWKS e usa o realm `COCiber`.

## Documentação

Consultar a pasta [docs](docs/README.md) para arquitetura, configuração, segurança, endpoints, decisões técnicas e troubleshooting.
