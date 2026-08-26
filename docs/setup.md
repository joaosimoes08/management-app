# Arranque, utilização e paragem

## Pré-requisitos

- Docker Desktop com o Docker Engine ativo.
- Node.js LTS e npm.
- PowerShell, macOS Terminal ou shell compatível.

## Primeira instalação

Na raiz do projeto, copiar `.env.example` para `.env` e definir as passwords locais. A `DATABASE_URL` deve usar a mesma password de `POSTGRES_PASSWORD`.

```powershell
docker compose up -d
npm install
npm run db:generate
npm run db:migrate:dev
npm run start:dev
npm run web:dev
```

Para processar discovery ICMP/TCP, abrir um terminal adicional e executar:

```powershell
npm run worker:dev
```

O worker usa as filas `discovery` e `maintenance` no Redis da porta `6379`. A segunda executa diariamente a retenção configurada da auditoria. Se o worker estiver desligado, os jobs ficam pendentes e serão processados quando voltar a arrancar.

Depois do login no Keycloak, o primeiro utilizador com a role `ADMIN` é encaminhado para `/setup`. O walkthrough pede o nome da organização e cria o primeiro site. A localização física (edifício, sala e bastidor) é opcional. Só depois de concluir este passo é que o dashboard fica disponível.

No macOS/Linux, usar `cp .env.example .env` em vez de `Copy-Item`.

## URLs locais

| Serviço | URL |
|---|---|
| API | http://localhost:3001 |
| Swagger | http://localhost:3001/api |
| Health | http://localhost:3001/api/v1/health |
| Keycloak | http://localhost:8080 |
| PostgreSQL | localhost:5432 |
| Redis | localhost:6379 |

O frontend fica disponível em `http://localhost:3000` quando iniciado com `npm run web:dev`. Pode ser necessário criar `apps/web/.env.local` a partir de `apps/web/.env.example`.

O portal é dinâmico e as aplicações são geridas em `http://localhost:3000/portal` por um utilizador `ADMIN`. Cada ligação pode ter URL, descrição, categoria, ordem, roles autorizadas, estado ativo e verificação opcional de disponibilidade.

Depois de concluído o onboarding, o IPAM fica disponível em `http://localhost:3000/ipam`. A sequência inicial recomendada é criar Site, VLAN, Subnet e só depois iniciar um discovery ICMP/TCP. Os resultados devem ser revistos antes de serem aprovados para o inventário.

O sidebar permanece visível durante o scroll. O botão no topo do menu alterna entre modo aberto e recolhido; no modo recolhido, passar o rato por cima expande temporariamente o menu. A preferência fica guardada no browser.

Se o realm `COCiber` já existia antes desta configuração, criar manualmente na consola Keycloak o client público `simoes-web` com:

- Standard flow: ativo.
- Client authentication: desligada.
- Valid redirect URI: `http://localhost:3000/*`.
- Web origin: `http://localhost:3000`.
- PKCE: `S256`.

O frontend inclui `public/silent-check-sso.html`, necessário para o `check-sso` do Keycloak não ficar bloqueado durante a verificação silenciosa da sessão.

## Keycloak local

Abrir `http://localhost:8080/admin`, entrar com `KEYCLOAK_ADMIN_USERNAME` e `KEYCLOAK_ADMIN_PASSWORD`, selecionar o realm `COCiber`, criar utilizadores em `Users` e atribuir roles.

A gestão de roles em `/definicoes?tab=users` usa o client confidencial `simoes-settings-admin`. Em instalações novas, o realm importado já contém esse client. Para provisionar ou atualizar uma instalação existente sem usar a consola, definir `KEYCLOAK_ADMIN_CLIENT_SECRET` e executar:

```powershell
npm run keycloak:provision-settings
```

O backend precisa de `KEYCLOAK_ADMIN_URL`, `KEYCLOAK_ADMIN_REALM`, `KEYCLOAK_ADMIN_CLIENT_ID` e `KEYCLOAK_ADMIN_CLIENT_SECRET`. O service account recebe apenas `realm-management/manage-users` e `realm-management/query-users`; a segunda role permite confirmar quantos administradores permanecem antes de alterar roles. Não são expostas operações de criação, passwords ou eliminação de utilizadores pela aplicação.

## Parar e reiniciar

```powershell
docker compose stop
docker compose down
docker compose up -d
```

`docker compose down` mantém os volumes. Não usar `docker compose down -v` sem confirmar, porque remove os dados PostgreSQL e Redis.

## Reset completo para uma instalação limpa

O reset abaixo apaga os dados locais das bases de dados, incluindo utilizadores/configuração do Keycloak, inventário, auditoria, links e o estado do walkthrough. É equivalente a iniciar o projeto após um clone, mas mantém os ficheiros do código.

```powershell
docker compose down -v --remove-orphans
```

Não é necessário apagar migrações nem `node_modules`. Depois, segue novamente a secção **Primeira instalação**: o `npm run db:migrate:dev` recria o schema e o primeiro login ADMIN inicia o walkthrough.

## Verificação

```powershell
docker compose ps
Invoke-RestMethod http://localhost:3001/api/v1/health
```
