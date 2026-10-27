# SIMOES Management App

Plataforma de gestão de infraestrutura, IPAM e ciberdefesa.

## Deploy com Docker Compose

O Compose inicia a interface web, a API, PostgreSQL, Redis, Keycloak e o serviço SNMP (worker e listener de traps). PostgreSQL, Redis, Keycloak e ficheiros carregados pela aplicação usam volumes persistentes. A API aplica as migrações Prisma pendentes antes de iniciar. As migrações não apagam dados.

### Pré-requisitos

- Docker Engine com o plugin Docker Compose v2.
- Pelo menos 4 GB de memória disponível para Docker.
- Node.js 22+ e npm, apenas para criar o cofre SNMP local a partir do checkout do projeto.

### Preparar a configuração

Na pasta de deploy, obtenha o `docker-compose.yml`, `.env.example` e `infra/keycloak/realm-cociber.json` do projeto e execute:

```sh
cp .env.example .env
npm run snmp:keyring
```

O Compose descarrega as imagens publicadas em Docker Hub: `joaosimoes08/mgmt-app-api`, `joaosimoes08/mgmt-app-web` e `joaosimoes08/mgmt-app-snmp`. A tag publicada para esta beta é `beta-joao-feature-operational-dashboard-topology`. `DOCKERHUB_NAMESPACE` seleciona a conta/organização e `APP_IMAGE_TAG` seleciona a mesma versão para os três serviços; ambos podem ser alterados em `.env` para usar outra publicação compatível. A instalação não precisa do código-fonte nem compila imagens localmente.

Edite `.env` e substitua as palavras-passe de exemplo por valores privados e fortes, em especial `POSTGRES_PASSWORD`, `KEYCLOAK_DB_PASSWORD` e `KEYCLOAK_ADMIN_PASSWORD`. Atualize também o segredo do cliente `simoes-settings-admin` em `KEYCLOAK_ADMIN_CLIENT_SECRET` e no campo `secret` correspondente em `infra/keycloak/realm-cociber.json`; os dois valores têm de coincidir. Para criar o cofre SNMP execute `npm run snmp:keyring` a partir do checkout do projeto. Não publique `.env` nem `secrets/snmp-keyring.json`.

As portas web, API e Keycloak ficam ligadas a `127.0.0.1` por omissão. Para uma beta usada por funcionários, coloque um proxy reverso com TLS à frente da aplicação e exponha apenas esse proxy na rede/VPN. Configure `WEB_HOST`, `API_HOST` e `KEYCLOAK_HOST` como `127.0.0.1` para manter os serviços limitados ao próprio host; o proxy pode encaminhar para as portas 3000, 3001 e 8080. Não exponha PostgreSQL nem Redis à rede.

Cada instalação escolhe o seu próprio hostname e termina TLS no proxy reverso. Configure os URLs públicos que o navegador usa em `.env` (`NEXT_PUBLIC_API_URL` e `NEXT_PUBLIC_KEYCLOAK_URL`) e configure o hostname público do Keycloak em `KEYCLOAK_HOSTNAME`. Estes valores são lidos quando o container web inicia; não é necessário reconstruir a imagem. Configure ainda:

- `CORS_ORIGINS` em `.env` para a origem pública da interface;
- `OIDC_ISSUER_URL` com o endereço público do realm; mantenha `OIDC_BACKCHANNEL_URL=http://keycloak:8080/realms/COCiber` para comunicação interna entre containers;
- os `redirectUris`, `webOrigins` e URLs de logout do cliente `simoes-web` em `infra/keycloak/realm-cociber.json`, incluindo o hostname escolhido. O ficheiro é importado apenas na inicialização de uma base Keycloak vazia.

`NEXT_PUBLIC_API_URL` e `NEXT_PUBLIC_KEYCLOAK_URL` devem ser acessíveis pelo navegador dos utilizadores; use os URLs HTTPS do proxy quando o hostname for público. Ajuste `CORS_ORIGINS` para a origem web correspondente. Os URLs específicos do cliente são públicos e são servidos pelo container web em runtime.

### Iniciar e verificar

```sh
docker compose pull
docker compose up -d
docker compose ps
```

Esta instalação usa as imagens publicadas; não precisa do código-fonte para iniciar. Para atualizar, altere `APP_IMAGE_TAG` em `.env`, depois execute `docker compose pull && docker compose up -d`.

Abra <http://localhost:3000>. A consola Keycloak está em <http://localhost:8080>; a conta inicial usa `KEYCLOAK_ADMIN_USERNAME` e `KEYCLOAK_ADMIN_PASSWORD`. Crie os utilizadores da equipa no realm `COCiber` e atribua-lhes os papéis adequados. O endpoint de saúde público da API é <http://localhost:3001/api/v1/health> e o Swagger é <http://localhost:3001/api>.

Verificações rápidas:

```sh
docker compose ps
curl -fsS http://localhost:3001/api/v1/health
curl -fsS http://localhost:3000/ -o /dev/null
curl -fsS http://localhost:8080/realms/COCiber/.well-known/openid-configuration -o /dev/null
```

`api` e `web` devem aparecer como `healthy`; PostgreSQL e Redis também têm health checks. Keycloak pode levar mais tempo a importar o realm na primeira execução. Consulte os logs com `docker compose logs -f api web keycloak`.

### SNMP

O serviço SNMP partilha PostgreSQL, Redis e o cofre local `secrets/snmp-keyring.json` com a API. O listener recebe traps UDP na porta do host definida por `SNMP_TRAP_HOST_PORT` (por omissão 162) e expõe o health check apenas no host na porta 3002. A porta UDP 162 pode exigir permissões de administrador ou já estar ocupada; escolha uma porta livre (por exemplo 1162) e configure os equipamentos para a usar. O host agent de descoberta de interfaces continua a ser executado no host, pois depende das interfaces e do socket Docker do host; consulte a documentação SNMP em `docs/`.

### Operação e resolução de problemas

- Ver todos os serviços e estado: `docker compose ps`.
- Ver logs: `docker compose logs -f [serviço]`.
- Aplicar alterações de `.env`: `docker compose up -d`.
- Atualizar as imagens: altere `APP_IMAGE_TAG`, execute `docker compose pull && docker compose up -d`; a API executa `prisma migrate deploy` antes de arrancar.
- Parar sem apagar dados: `docker compose down`.
- As bases de dados e assets persistem em volumes Docker. **Não use `docker compose down -v`** numa instalação com dados que queira manter.
- Faça e teste backups de PostgreSQL e da base Keycloak antes de atualizar a aplicação. Exemplo de cópia SQL local: `mkdir -p backups && chmod 700 backups && docker compose exec -T postgres sh -c 'pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB"' > "backups/app-$(date +%F-%H%M%S).sql"`; repita com `keycloak-db` para guardar as contas e configuração de identidade. Guarde as cópias fora do host de execução.
- Se uma porta já estiver ocupada, altere a porta correspondente no `.env` (`WEB_PORT`, `API_PORT_HOST`, `KEYCLOAK_PORT`, `SNMP_HEALTH_HOST_PORT` ou `SNMP_TRAP_HOST_PORT`).
- Se a API não ficar saudável, veja `docker compose logs api postgres`; erros de migração normalmente indicam credenciais inválidas, PostgreSQL ainda indisponível ou uma migration incompleta.
- Se o login falhar atrás de um hostname próprio, confirme issuer, hostname do Keycloak, URL pública, CORS e redirect URI do cliente `simoes-web` no realm importado.

### Gate de segurança para a beta

Antes de permitir acesso de funcionários, confirme que todas as palavras-passe e segredos de exemplo foram substituídos, `AUTH_DISABLED=false`, `SNMP_SELF_TEST_ENABLED=false` e `SNMP_SELF_TEST_ALLOW_TRANSLATED_SOURCE=false`. O lockfile atual ainda reporta dependências runtime vulneráveis em `npm audit --omit=dev` (incluindo alertas críticos); faça a atualização e validação dessas dependências antes de expor o serviço.

## Desenvolvimento local sem containers de aplicação

Para executar API e frontend no host, mantendo PostgreSQL, Redis e Keycloak no Docker:

```sh
cp .env.example .env
docker compose up -d postgres redis keycloak-db keycloak
npm install
npm run db:generate
npm run db:migrate
npm run start:dev
```

Noutro terminal, execute `npm run web:dev`. Para a arquitetura, endpoints, segurança e restantes tarefas operacionais, consulte [docs/README.md](docs/README.md).
