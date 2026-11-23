# Desenvolvimento local: arranque, utilização e paragem

Este guia é para executar a API e o frontend a partir do código-fonte. Para uma instalação apenas com Docker e imagens publicadas, segue o [guia de deploy no README](../README.md#deploy-com-docker-compose). Aqui o Compose inicia apenas as dependências locais PostgreSQL, Redis e Keycloak; a API e o frontend são iniciados pelos comandos npm abaixo.

## Pré-requisitos

- Docker Desktop com o Docker Engine ativo.
- Node.js LTS e npm.
- PowerShell, macOS Terminal ou shell compatível.

## Primeira instalação

Na raiz do projeto, copiar `.env.example` para `.env` e definir as passwords locais. A `DATABASE_URL` deve usar a mesma password de `POSTGRES_PASSWORD`. Para a API executada no host, definir também `OIDC_BACKCHANNEL_URL=http://localhost:8080/realms/COCiber` em `.env`.

```powershell
docker compose up -d postgres redis keycloak-db keycloak snmp
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
| SNMP health | http://localhost:3002/health |
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

O backend precisa de `KEYCLOAK_ADMIN_URL`, `KEYCLOAK_ADMIN_REALM`, `KEYCLOAK_ADMIN_CLIENT_ID` e `KEYCLOAK_ADMIN_CLIENT_SECRET`. O service account recebe `realm-management/manage-users` e `realm-management/query-users` para gerir roles e proteger o último ADMIN. A configuração LDAP acrescenta `realm-management/manage-realm`, uma permissão ampla necessária pela API administrativa do Keycloak para gerir providers e mapeadores; avalia este impacto antes de ativar a configuração num realm de produção.

Em `/definicoes?tab=directory`, um ADMIN pode configurar LDAPS e mapear nomes exatos de grupos sincronizados para roles da aplicação. O Keycloak tem de confiar no certificado LDAPS e conseguir alcançar o diretório. Reintroduz a credencial de bind para cada teste ou gravação; não é mostrada de volta pela aplicação. A sincronização falha se o grupo ainda não existir no Keycloak ou se o nome não for único.

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

## Componente SNMP

1. Gera o keyring local, que é criado com permissões restritas e nunca é commitado:

   ```bash
   npm run snmp:keyring
   ```

2. Aplica a migração aditiva com `npm run db:migrate`.
3. Por omissão, o container reutiliza `POSTGRES_USER`, `POSTGRES_PASSWORD` e `POSTGRES_DB`. Em produção, aplica `scripts/snmp-database-grants.sql`, associa o utilizador de login ao role `simoes_snmp_runtime` e define `SNMP_DATABASE_URL` com o hostname `postgres`. O role não pode criar schema nem executar migrações.

4. **Engine ID e versões SNMP.** O engine ID SNMPv3 é gerado uma vez por instalação pela aplicação e guardado na base de dados; não precisas de o configurar. `SNMP_ENGINE_ID` é apenas um override explícito: se estiver definido (e não for o valor partilhado antigo), tem prioridade sobre o valor guardado e não o substitui na base de dados. O engine ID em uso aparece na secção **Engine ID da app** de **Configurar o switch**, na vista do equipamento SNMP.
   - **SNMPv3 (authPriv) é o recomendado.** SNMPv1 é sempre recusado.
   - **SNMPv2c** é aceite por omissão (`SNMP_ALLOW_V2C=true`). Envia a community em texto simples e não cifra os dados: usa-o apenas em redes de gestão isoladas. A community tem de ter pelo menos 8 caracteres. Para recusar v2c nesta instalação, define `SNMP_ALLOW_V2C=false`.
5. **Receção de traps.** O serviço `snmp` do `docker-compose.yml` é o único receiver de traps e informs. Arranca com a aplicação (`docker compose up -d`, que inclui `snmp`) e corre na mesma máquina que a API e a web; não é preciso um host Linux nem uma VM separados para traps.
   - O container escuta em `1162/udp` e o Compose publica `${SNMP_TRAP_HOST_IP:-0.0.0.0}:${SNMP_TRAP_HOST_PORT:-162}` → `1162/udp` no host. O valor predefinido publica em todas as interfaces; define `SNMP_TRAP_HOST_IP` com o IP da interface de gestão para limitar o bind. Para mudar a porta do host, define `SNMP_TRAP_HOST_PORT`.
   - **Endereço a configurar nos switches:** o IP do host da aplicação alcançável pela rede de gestão, na porta UDP do passo anterior (162 por omissão). Os switches devem enviar a partir do IP de gestão registado na app (o trap-source).
   - **Onde ver o endereço:** em **Definições → SNMP** aparece a lista "Interfaces de escuta SNMP", e o endereço do recetor é mostrado em **Configurar o switch**. Esta lista só é preenchida pelo agente do host (ver passo opcional abaixo). Sem o agente, a lista fica vazia e o IP do host tem de ser indicado manualmente na configuração do switch.
   - **Firewall:**
     - switch → aplicação: UDP 162 (ou `SNMP_TRAP_HOST_PORT`), apenas a partir da rede de gestão;
     - aplicação → switch: UDP 161 para polling (porta configurável nas definições SNMP; 161 por omissão).
   - **Limitação no macOS (apenas desenvolvimento):** o Docker Desktop pode reescrever o IP de origem das traps. Nesse caso, as traps podem aparecer como desconhecidas porque não associam ao equipamento. A produção corre num host Linux, onde o IP de origem é preservado.
   - O receiver limita linhas de traps não confiáveis a 120 por minuto por omissão; ajusta `SNMP_TRAP_UNTRUSTED_ROWS_PER_MINUTE` se necessário.

   O API e o receiver usam o mesmo secret Compose `snmp_keyring`, proveniente de `SNMP_KEYRING_HOST_FILE` (por omissão `./secrets/snmp-keyring.json`). No host, define `SNMP_KEYRING_FILE` para o caminho do keyring (por omissão `./secrets/snmp-keyring.json`); os containers usam o secret montado em `/run/secrets/snmp_keyring`.

   **Passo opcional: agente do host.** Só é preciso se quiseres escolher IPs específicos do host em vez de `0.0.0.0` e ver a lista de interfaces em Definições → SNMP. O agente não recebe traps: enumera os IPv4 do host e escreve `.runtime/snmp-listeners.compose.yml`, que publica apenas os IPs escolhidos para o mesmo `snmp:1162/udp`. O receiver continua a ser o container. Para o iniciar, constrói a imagem SNMP e corre o agente fora do container:

   ```bash
   docker compose build snmp
   npm run snmp:host-agent
   ```

   Em produção, executa o segundo comando através do gestor de serviços do sistema. Deve existir apenas um agente por projeto Compose e a seleção não pode misturar interfaces de hosts diferentes. O agente cria `.runtime/snmp-listeners.compose.yml` e inicia/reconcilia o container; PostgreSQL e Redis devem estar previamente disponíveis.

6. Em **Definições → SNMP**, um administrador escolhe todas as interfaces IPv4 do host ou vários IPs específicos. O agente atualiza o inventário e aplica a configuração em até 30 segundos. Um endereço removido do host deixa de ser elegível e nunca é aceite apenas por ter permanecido guardado na base de dados.

Com o agente, o Docker publica `162/udp` apenas nos IPs do host selecionados e encaminha para `1162/udp` no container não-root. O agente não recebe o keyring nem lê credenciais SNMP. Em produção, cria um login associado ao role `simoes_snmp_host_agent`, configura `SNMP_HOST_AGENT_DATABASE_URL` e protege a conta que pode executar Docker. `SNMP_SET_ENABLED=false` deve permanecer até à validação laboratorial.

### Autoteste de traps no próprio host

No Docker Desktop, uma trap enviada pelo host para o seu próprio IP pode chegar ao container com um endereço reescrito ou nem atravessar o encaminhamento UDP local. Para o comando interno, define `SNMP_SELF_TEST_ENABLED=true` e `SNMP_SELF_TEST_PROXY_SOURCES=127.0.0.1`. Se também precisares de usar `snmptrap` contra o IP do próprio host e a origem for reescrita, ativa separadamente `SNMP_SELF_TEST_ALLOW_TRANSLATED_SOURCE=true`. Este último modo aceita qualquer IPv4 observado, mas apenas depois de SNMPv3 `authPriv` ter sido validado, exige uma única identidade compatível e confirma que o IP esperado é uma interface recente e selecionada do host. Mantém ambas as flags desligadas em produção.

O utilitário `snmptrap` incluído em versões antigas do macOS interpreta `-a SHA` como SHA-1. Nesse caso, cria o pré-registo com a opção explícita de compatibilidade SHA-1 ou usa um cliente que suporte SHA-256; uma credencial SHA-256 não será aceite por um emissor SHA-1.

Para testar um pré-registo SNMPv3 local sem expor a credencial na shell nem depender da versão de Net-SNMP instalada, executa:

```bash
npm run snmp:test-trap -- <enrollment-id>
```

O comando recusa pré-registos expirados, SNMPv2c e endereços esperados que não sejam uma interface recente e selecionada do próprio host. A trap é emitida dentro do container apenas para o seu loopback, na porta interna `SNMP_TRAP_PORT`; valida autenticação, persistência e associação, mas não substitui um teste externo de reachability à porta UDP 162. O evento fica identificado como `SELF_TEST`. Equipamentos reais continuam a enviar para o IP selecionado do host e porta UDP 162.

Com `SNMP_SELF_TEST_ALLOW_TRANSLATED_SOURCE=true`, o mesmo pacote pode ser enviado a partir do host para validar também o encaminhamento UDP/162, sem colocar a credencial na linha de comandos:

```bash
npm run snmp:test-trap:host -- <enrollment-id>
```
