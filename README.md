# SIMOES Management App

Plataforma de gestão de infraestrutura, IPAM e ciberdefesa.

## Deploy com Docker Compose

A instalação usa imagens publicadas, sem compilar o código na máquina de destino. A versão beta inicial é `beta-1.0.0-release` para API, web e SNMP, publicada para `linux/amd64` e `linux/arm64`. `.env.example` acompanha a última versão estável/release verificada; não use `main` ou `latest` como referência de uma instalação.

### Requisitos

- Docker Engine e Docker Compose v2 atualizados, com acesso ao Docker Hub.
- 4 GB de memória disponível para Docker; espaço adicional para PostgreSQL, Keycloak, Redis e backups.
- Node.js 22+ apenas na primeira instalação, para criar o cofre SNMP; OpenSSL para gerar segredos e certificados.
- PowerShell 7+ no Windows ou Bash 4+ em Linux/macOS.

Descarregue este repositório ou copie `deploy.sh`/`deploy.ps1`, `docker-compose.yml`, `docker-compose.proxy.yml`, `.env.example`, `deploy/` e `nginx/` para uma pasta persistente. Execute o assistente:

```sh
chmod +x deploy.sh
./deploy.sh
```

No Windows, abra PowerShell 7 nessa pasta e execute `./deploy.ps1`. O assistente pergunta se é uma instalação nova ou atualização e permite `install`, `update` ou `check` como argumento. Verifica Docker/Compose, existência da tag nos três repositórios e manifestos AMD64/ARM64, renderiza a configuração antes de aplicar e pede confirmação. Para instalação inicial, copia `.env.example`, gera segredos locais fortes e cria o cofre SNMP. Numa atualização, faz cópia datada de `.env`, preserva valores existentes e acrescenta apenas as novas chaves de configuração. Em instalação e atualização, o alvo predefinido é sempre `beta-1.0.0-release`; numa atualização, o assistente mostra as tags instaladas e configurada antes de pedir o alvo. A regra de transição é explícita: tags anteriores (incluindo `release-2026-11-09`) passam para `beta-1.0.0-release` por omissão; introduza uma tag personalizada para continuar numa versão própria. Só `APP_IMAGE_TAG` muda por esta regra; os restantes valores personalizados de `.env` são preservados. O alvo é apresentado para revisão.

No primeiro arranque, o assistente cria `deploy/realm-cociber.generated.json` com o segredo de cliente que corresponde ao `.env`; o ficheiro é local, ignorado pelo Git e usado para importar o realm numa base Keycloak vazia. Proteja a pasta de deploy e guarde as cópias fora do servidor.

O modo `update` tenta criar cópias SQL da base da aplicação e do Keycloak antes de aplicar uma nova imagem. Se uma cópia falhar, a atualização para. Guarde também os backups fora do host. Não use `docker compose down -v`: isso apaga volumes persistentes.

### HTTPS e proxy reverso opcional

O assistente pergunta se deve ativar nginx e, se sim, se quer HTTPS. Sem HTTPS, o proxy usa HTTP. Com HTTPS, escolha uma CA ou certificado self-signed. Para CA, é gerada uma chave privada local e um CSR com todos os SANs DNS/IP indicados; envie apenas o CSR à CA. Consulte o guia configurável por `CA_GUIDE_URL` (por omissão, esta secção do README), coloque a cadeia assinada em `certificates/fullchain.pem` e mantenha a chave correspondente em `certificates/privkey.pem`. A pasta é montada como somente leitura. O script valida validade, SAN do hostname e correspondência da chave antes de iniciar serviços. Não substitua uma chave/certificado existente sem cópia e revisão.

A opção self-signed gera um certificado de 365 dias com os SANs indicados. Navegadores e clientes não confiarão nele até o certificado ser adicionado ao respetivo trust store. Renovação e instalação de certificados emitidos por CA são operações manuais nesta versão. Configure DNS/firewall para encaminhar apenas o tráfego público necessário ao proxy; as bases de dados e Redis não são expostos à rede.

A configuração nginx atual encaminha a interface, `/api/` e `/realms/`. Se a instalação usar outros hostnames públicos para API ou Keycloak, configure-os no DNS/proxy e ajuste `NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_KEYCLOAK_URL`, `KEYCLOAK_HOSTNAME`, `OIDC_ISSUER_URL` e `CORS_ORIGINS` no `.env`. O hostname/URLs do realm e os redirect URIs do cliente `simoes-web` devem corresponder ao domínio público. A importação de realm só ocorre quando a base Keycloak está vazia.

### Atualizações, migrações e recuperação

Revise as notas da versão e confirme backups recentes/testados antes de mudar `APP_IMAGE_TAG`. A API executa `prisma migrate deploy` ao arrancar; alterações de esquema podem não permitir reverter apenas as imagens. Se a atualização falhar, consulte `docker compose ps` e `docker compose logs --tail=200 api web keycloak`, corrija o problema e restaure backups compatíveis antes de reverter para a versão anterior. O assistente guarda uma cópia datada de `.env`; use-a para recuperar a configuração, mas não restaure uma base sem avaliar a compatibilidade com a versão-alvo. As cópias SQL ficam em `backups/` e devem ser transferidas para armazenamento protegido fora do servidor.

### Operação e resolução de problemas

- Estado: `docker compose ps`.
- Logs: `docker compose logs -f [serviço]`.
- Reiniciar: `docker compose restart [serviço]`.
- Atualizar imagens: `docker compose pull` e depois `docker compose up -d`; faça backup primeiro.
- Parar sem apagar dados: `docker compose down`; os volumes nomeados são preservados.
- Verificação: `curl -fsS http://localhost:3001/api/v1/health` e `curl -fsS http://localhost:3000/ -o /dev/null`.
- Se a API não ficar saudável, veja logs de `api` e `postgres`; confirme também espaço em disco e credenciais de banco.
- Se o login falhar, compare issuer, hostname, URLs públicos, CORS e redirect URIs do realm.
- A porta UDP SNMP predefinida é 162 e pode exigir privilégios ou estar ocupada; escolha outra com `SNMP_TRAP_HOST_PORT` se necessário.

A API, web, PostgreSQL e Redis têm verificações de saúde; o assistente apresenta o estado Compose após aplicar. Keycloak pode demorar a importar o realm na primeira execução. A instalação mantém portas web/API/Keycloak ligadas a localhost por omissão; para acesso público, use o proxy TLS e não exponha PostgreSQL ou Redis.

### Gate de segurança para a beta

Antes de permitir acesso de funcionários, confirme que todas as palavras-passe e segredos foram substituídos, `AUTH_DISABLED=false`, `SNMP_SELF_TEST_ENABLED=false` e `SNMP_SELF_TEST_ALLOW_TRANSLATED_SOURCE=false`. O lockfile atual ainda reporta dependências runtime vulneráveis em `npm audit --omit=dev` (incluindo alertas críticos); faça a atualização e validação dessas dependências antes de expor o serviço.

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
