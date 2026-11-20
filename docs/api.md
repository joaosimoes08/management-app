# API

## Prefixos

A API usa versionamento por URI: `/api/v1/...`.

## Endpoints atuais

## IPAM avançado

- `GET /api/v1/subnets/:id`, `/usage`, `/tree`
- `PATCH /api/v1/subnets/:id/scan-config`, `POST /api/v1/subnets/:id/scan`
- `GET /api/v1/ip-addresses/:id`, `POST /api/v1/ip-addresses/:id/check`
- CRUD `/api/v1/vrfs` e `/api/v1/nat-rules`
- `POST /api/v1/ipam/calculator`
- CRUD de grupos centralizados em `/api/v1/settings/access-groups` e membros em `/api/v1/settings/access-groups/:id/members`
- Grupos globais e associações a Sites em `/api/v1/settings/access-groups`; ações IPAM são configuradas na associação Grupo–Site e ACLs físicas em `/api/v1/infrastructure/permissions`
- `GET /api/v1/access/effective?siteId=...` — capacidades da role, ações IPAM, ACLs físicas efetivas e tabs disponíveis; a autorização continua a ser validada em cada endpoint.
- `POST /api/v1/ipam/ripe/preview`, `POST /api/v1/ipam/ripe/import`, `GET /api/v1/ipam/ripe/imports`

O scanning automático começa desligado e usa intervalo fixo de 12 horas. IPv6 usa capacidade teórica e checks apenas de endereços conhecidos.

### Health

`GET /api/v1/health` é público e verifica a ligação ao PostgreSQL.

### Utilizador autenticado

`GET /api/v1/auth/me` exige `Authorization: Bearer <access-token>` e devolve o utilizador sincronizado e as roles reconhecidas.

### Dashboard

`GET /api/v1/dashboard/summary` devolve apenas contagens do inventário visível ao utilizador (`sites`, `devices`, `vlans`, `subnets`, `ips`) e, para `ADMIN`/`AUDITOR`, os últimos eventos de auditoria.

### Setup inicial

- `GET /api/v1/setup/status` — estado da configuração inicial para qualquer utilizador autenticado.
- `POST /api/v1/setup/organization` — guarda organização, código e fuso horário; exige `ADMIN`.
- `POST /api/v1/setup/site` — cria o primeiro site e, opcionalmente, edifício, sala e bastidor; exige `ADMIN`.
- `POST /api/v1/setup/complete` — valida organização e pelo menos um site; exige `ADMIN`.
- `POST /api/v1/setup/reopen` — reabre o walkthrough para correções; exige `ADMIN`.

O estado é persistido em `SystemSettings` e as alterações são auditadas.

### IPAM

- `GET/POST /api/v1/sites` e `PATCH /api/v1/sites/:id` — sites.
- `GET/POST /api/v1/vlans` e `PATCH /api/v1/vlans/:id` — VLANs, filtráveis por `siteId`.
- `GET/POST /api/v1/subnets` e `PATCH /api/v1/subnets/:id` — subnets IPv4, filtráveis por site/VLAN.
- `GET/POST /api/v1/ip-addresses` e `PATCH /api/v1/ip-addresses/:id` — IPs e estados do IPAM.
- `DELETE /api/v1/sites/:id`, `DELETE /api/v1/vlans/:id`, `DELETE /api/v1/subnets/:id` e `DELETE /api/v1/ip-addresses/:id` — remoção controlada, com auditoria.
- As listagens aceitam `search`, `page` e `pageSize` e devolvem `{ items, page, pageSize, total, totalPages }`.
- `GET /api/v1/ip-addresses` aceita também `source`; `search` procura por endereço, hostname e MAC address.

### Hosts e services

- `GET /api/v1/hosts?search=&page=&pageSize=` — hosts paginados, com IPs e contagem de services.
- `POST/PATCH /api/v1/hosts` — gestão manual de hosts.
- `GET /api/v1/hosts/:id/services` — services de um host.
- `POST /api/v1/services` — registo de service associado a host.

Resultados de discovery aprovados criam/atualizam automaticamente o Host correspondente e criam Services TCP para portas abertas.

As operações de escrita exigem `ADMIN` ou `NETWORK_OPERATOR`. A API normaliza CIDR IPv4 e impede associar um IP fora da subnet.

### Discovery ICMP/TCP

- `POST /api/v1/discovery/jobs` — cria uma execução para uma subnet, com métodos `ICMP`, `TCP` ou ambos.
- `GET /api/v1/discovery/jobs` — lista execuções recentes.
- `GET /api/v1/discovery/jobs/:id/results` — consulta resultados.
- `POST /api/v1/discovery/results/:id/review` — aprova ou ignora um resultado.

Os jobs são colocados na fila BullMQ `discovery` em Redis. A API não executa o scan; é necessário manter o processo `worker:dev` ativo.

`GET /api/v1/settings/discovery` inclui os perfis `defaults`, `icmp-only`, `web`, `network` e `custom`. `POST /api/v1/discovery/jobs` aceita `profileId`; os perfis nomeados resolvem métodos, portas e reverse DNS no servidor. `custom` usa esses campos enviados pelo operador e continua limitado a 64 portas, à allowlist de Discovery, aos scopes de Site e a subnets IPv4 de até 4096 endereços. Os parâmetros usados ficam guardados no job. Uma resposta ICMP ou uma ligação TCP aceite é apenas evidência de uma sonda, não uma avaliação da saúde do serviço ou do equipamento.

Uma aprovação cria/atualiza o IP no inventário oficial; a descoberta nunca cria automaticamente ativos definitivos.

### Portal de aplicações

`GET /api/v1/application-links` devolve as ligações autorizadas para o utilizador autenticado. `ADMIN` pode usar `includeInactive=true` para gerir todo o catálogo.

Os endpoints `POST`, `PATCH`, `DELETE` e `POST /:id/check` exigem a role `ADMIN`.

### Auditoria

`GET /api/v1/audit/events?limit=100` devolve eventos recentes com utilizador, entidade, ação e data. Exige `ADMIN` ou `AUDITOR`.

### Exportações de inventário e estado de backups

- `GET /api/v1/exports/:kind/:format?siteId=...` descarrega `devices`, `subnets`, `vlans` ou `ips` como `csv` ou `json`. Os resultados respeitam os scopes de leitura de IPAM e infraestrutura do utilizador, aceitam `siteId` como filtro adicional e têm limite de 10 000 linhas. Os campos são listas explícitas no serviço de exportação; não incluem dados de configuração ou credenciais SNMP. Cada exportação cria um evento `INVENTORY_EXPORT` com tipo/formato/site/número de linhas, sem guardar os dados exportados.
- `GET /api/v1/exports/ansible?siteId=...` descarrega JSON no formato de inventário estático do Ansible. Reutiliza o scope de leitura de equipamentos, aceita o mesmo filtro opcional por site e limita o resultado a 10 000 equipamentos. `all.children` aponta para grupos `device_type_<slug>` em ordem previsível; cada grupo contém os hosts ordenados e `_meta.hostvars` contém apenas `ansible_host`, `inventory_name`, `asset_tag`, `serial_number`, `device_type`, `device_status` e `site_id`, quando disponíveis. O nome do host vem de hostname, nome do equipamento ou ID; nomes duplicados recebem sufixo do ID. Não são exportados dados SNMP, credenciais, interfaces ou configurações. Cada pedido cria um evento `ANSIBLE_INVENTORY_EXPORT` com site, formato e quantidade, sem guardar o inventário.
- Aceitação manual: entrar com um utilizador que tenha leitura de equipamentos, abrir Definições → Exportar inventário, escolher um Site autorizado (ou todos os sites permitidos) e descarregar o inventário Ansible. Validar o ficheiro com `ansible-inventory -i ansible-inventory.json --list`, confirmar que os grupos e hosts correspondem ao scope do utilizador e procurar chaves/valores de credenciais no JSON; por fim, em Auditoria, confirmar `ANSIBLE_INVENTORY_EXPORT` com o Site e número de registos. Repetir com um Site fora do scope e confirmar que a API não devolve dados desse Site.
- Campos exportados: devices (`id,name,type,serialNumber,assetTag,hostname,managementIp,status,source,siteId,createdAt,updatedAt`); subnets (`id,cidr,version,gateway,purpose,environment,siteId,vlanId,vrfId`); vlans (`id,vlanId,name,description,siteId`); ips (`id,address,state,hostname,macAddress,version,subnetId,deviceId,interfaceId,hostId`). CSV protege valores iniciados por caracteres de fórmula.
- `GET /api/v1/settings/backups` (ADMIN) mostra os últimos registos manuais de backup e teste de restauro. `POST /api/v1/settings/backups/checks` (ADMIN) aceita `kind` (`BACKUP_COMPLETED`, `RESTORE_VERIFIED` ou `RESTORE_FAILED`), `completedAt` ISO-8601 e `reference`/`notes` opcionais. O registo é auditado; não executa backup nem restaura dados.
- A configuração Docker documenta volumes persistentes e um exemplo manual de `pg_dump`; a aplicação não está ligada a um job de backup nem verifica cópias ou restauros automaticamente. Um registo de sucesso é uma declaração do operador, não prova independente da cópia ou do restauro.
### NetApp ONTAP (inventário read-only)

- A página /netapp configura a integração e mostra os snapshots do Site ativo.
- PUT /api/v1/netapp/sites/:siteId/integration — configura o endpoint HTTPS e a conta ONTAP; exige ADMIN. A password é cifrada e nunca é devolvida pela API.
- GET /api/v1/netapp/sites/:siteId — consulta configuração pública, estado da última tentativa e último snapshot. Exige ADMIN, NETWORK_OPERATOR, SYSTEMS_OPERATOR, AUDITOR ou READ_ONLY.
- POST /api/v1/netapp/sites/:siteId/refresh — consulta o ONTAP manualmente; exige ADMIN ou SYSTEMS_OPERATOR. A integração usa apenas pedidos REST GET, regista auditoria e mantém o último snapshot se a consulta falhar.

O snapshot inclui cluster/sistemas, nós, aggregates, volumes, capacidade agregada e saúde. Não há polling agendado nem operações de escrita no ONTAP. A integração usa SNMP_KEYRING_FILE para proteger a credencial; prepara o keyring conforme a secção “Componente SNMP” em docs/setup.md.

Validação feita com respostas mockadas/contratuais. Não havia appliance ONTAP nem credenciais de leitura disponíveis para validação ao vivo. A compatibilidade dos campos REST com a versão ONTAP e permissões da conta de leitura configurada ainda requer confirmação num equipamento de destino. Firmware, licenciamento, snapshots e métricas históricas não fazem parte deste snapshot inicial.

## Swagger

Disponível em `http://localhost:3001/api`.

## Extensões de infraestrutura e definições

- `GET /api/v1/discovery/summary` — estado da fila/worker e resultados pendentes.
- `GET /api/v1/discovery/jobs?status=&subnetId=&page=&pageSize=` — execuções paginadas e filtráveis.
- `GET /api/v1/discovery/jobs/:id` — detalhe de uma execução.
- `GET/POST /api/v1/device-models` e `GET/PATCH/DELETE /api/v1/device-models/:id` — catálogo de modelos.
- `GET /api/v1/devices` — equipamentos paginados, filtráveis por pesquisa, tipo e site.
- `GET /api/v1/devices/:id`, `POST /api/v1/devices`, `PATCH/DELETE /api/v1/devices/:id` — detalhe e gestão de equipamentos; DELETE arquiva como `RETIRED`.
- `GET /api/v1/interfaces` e `GET /api/v1/interfaces/:id` — pesquisa e detalhe de interfaces.
- `POST /api/v1/devices/:id/interfaces`, `PATCH/DELETE /api/v1/interfaces/:id` — gestão de interfaces e VLANs permitidas.
- `GET/PATCH /api/v1/settings/organization` — organização; edição exige `ADMIN`.
- `GET /api/v1/settings/integrations` e `GET /api/v1/settings/system` — estado de integrações e plataforma.

As escritas de infraestrutura e definições são auditadas e protegidas por roles.

## Teste

Obter um access token no endpoint OIDC do realm `COCiber` e chamar `/api/v1/auth/me` com o header Bearer. O exemplo PowerShell completo está no README principal e pode ser executado com o utilizador local `joao`.
## Catálogo físico e discovery periódico

- `GET/POST /api/v1/assets` — consulta e upload manual de SVG, PNG ou WebP; requer `ADMIN`, `NETWORK_OPERATOR` ou `SYSTEMS_OPERATOR`.
- `GET /api/v1/assets/:id/file` — serve o ficheiro do asset.
- `DELETE /api/v1/assets/:id` — remove assets não associados; requer `ADMIN`, `NETWORK_OPERATOR` ou `SYSTEMS_OPERATOR`.
- `GET/POST/PATCH/DELETE /api/v1/rack-models` — catálogo histórico de modelos de bastidor; já não pode ser associado a bastidores operacionais.
- `GET/POST/PATCH /api/v1/racks` — consulta e gestão de bastidores associados a salas. `POST` e `PATCH` aceitam apenas `name` e `roomId`; a capacidade é sempre 42U e a imagem/modelo são fixos pela aplicação.
- `GET /api/v1/interfaces?deviceId=` — interfaces de um equipamento, incluindo VLANs permitidas e IPs.
- `GET /api/v1/subnets/:id/discovery-schedule` — configuração atual ou defaults desligados.
- `PATCH /api/v1/subnets/:id/discovery-schedule` — ativa/desativa o schedule de 12 horas.
- `POST /api/v1/subnets/:id/discovery-schedule/run` — executa manualmente um schedule ativo.

Uma VLAN só pode receber uma subnet associada. Discovery agendado cria `DiscoveryJob` e `DiscoveryResult` pendentes, sem alteração automática do inventário oficial.

## Infraestrutura centrada em bastidores

- `GET /api/v1/sites/:siteId/racks` — bastidores e equipamentos posicionados de um Site.
- `GET /api/v1/sites/:siteId/locations` — edifícios e salas disponíveis para criação de bastidores.
- `GET /api/v1/racks/:id` — detalhe do bastidor padrão de 42U com os equipamentos posicionados.
- `POST/PATCH/DELETE /api/v1/racks` — gestão de bastidores, com roles `ADMIN`/`SYSTEMS_OPERATOR`; os payloads de criação/edição contêm apenas `name` e `roomId`.
- `GET /api/v1/device-models?type=&supportsNetworkPorts=true` — catálogo filtrável.
- `POST /api/v1/device-models/seed` — seed idempotente do catálogo base, apenas `ADMIN`.

Ao criar ou editar um equipamento com rack, a API valida o Site, a unidade inicial, o tamanho U e conflitos de sobreposição.

## Edifícios e salas

- `GET /api/v1/sites/:siteId/buildings` — lista edifícios e salas.
- `POST /api/v1/sites/:siteId/buildings` — cria edifício; `ADMIN`/`SYSTEMS_OPERATOR`.
- `PATCH/DELETE /api/v1/buildings/:id` — edita ou remove edifício vazio.
- `GET /api/v1/buildings/:buildingId/rooms` — lista salas.
- `POST /api/v1/buildings/:buildingId/rooms` — cria sala; `ADMIN`/`SYSTEMS_OPERATOR`.
- `PATCH/DELETE /api/v1/rooms/:id` — edita ou remove sala sem bastidores.

Remoções com dependências são recusadas para preservar a hierarquia física e os dados existentes.

## Assets visuais e métricas de discovery

- `POST /api/v1/assets` — upload administrativo de SVG, PNG ou WebP.
- `GET /api/v1/assets/:id/file` — preview/ficheiro do asset.
- Equipamentos aceitam `frontAssetId`; o ícone do equipamento é determinado automaticamente pelo respetivo tipo.
- O bastidor usa sempre o asset interno `rack-empty-42u.png`. Nos equipamentos, a precedência visual continua a ser override do equipamento, asset do modelo e fallback interno.
- `DiscoveryJob` devolve `scannedCount`, `icmpReachableCount`, `tcpReachableCount`, `reachableCount`, `unreachableCount` e `resultCount`.
- `DiscoveryResult` só é criado quando ICMP responde ou pelo menos uma porta TCP abre; reverse DNS é best effort nesses resultados.

## Mapa IPAM por Site

- `GET /api/v1/sites/:siteId/network-map` — devolve VLANs, subnet principal, equipamentos e interfaces associadas.
- Estados de VLAN: `CONFIGURED`, `MISSING_SUBNET` e `NO_EQUIPMENT`.
- Racks, devices e modelos aceitam `frontAssetId`; devices e modelos aceitam também `backAssetId` (vista traseira). Os ícones de devices e modelos são determinados automaticamente pelo tipo.
- Criar um modelo exige `frontAssetId` (`400 FRONT_IMAGE_REQUIRED`); editar não pode remover uma imagem frontal existente.
- Criar equipamentos ou mudar-lhes o modelo (manual, edição, importação CSV, alteração de modelo em lote, onboarding SNMP) exige que todas as portas de rede do modelo estejam mapeadas entre as faces (`400 PORT_LAYOUT_INCOMPLETE`, com `expected`, `mapped`, `partialFaces`, `byFace`).

- `GET /api/v1/device-models/:id/port-layout?face=front|rear` — layout v2 do modelo, a face pedida (`faceLayout`), a imagem dessa face (`asset`) e o estado do mapeamento (`mapping`). `face` por omissão: `rear`. Inclui `revision` (token de concorrência).
- `PUT /api/v1/device-models/:id/port-layout?face=front|rear` — substitui só essa face (`imageWidth`, `imageHeight`, `viewport?`, `ports[]`, `assetId?`). Rejeita portas incompletas, `portKey` duplicado entre faces e mais portas do que o modelo tem.
- `PATCH /api/v1/device-models/:id/port-layout?face=` — alias legado: funde os campos enviados na face. PUT e PATCH por face aceitam `revision` opcional (409 `PORT_LAYOUT_CONFLICT` se estiver desatualizada).
- `PUT /api/v1/device-models/:id/port-layout/faces` — **gravação atómica das duas faces** (usada pelo editor). Ver contrato abaixo.
- Regra de contagem de portas: `expected = supportsNetworkPorts ? (networkPortCount ?? portCount ?? 0) : 0`; um 0 explícito significa sem portas. Só portas completamente mapeadas (`portKey`, `x`, `y`, `width > 0`, `height > 0`) contam.

#### `PUT /api/v1/device-models/:id/port-layout/faces`

Pedido:

```json
{
  "revision": "9f2c4e1a0b7d3c55",
  "faces": {
    "front": { "imageWidth": 1000, "imageHeight": 300, "viewport": { "left": 0, "top": 0, "width": 1, "height": 1 }, "assetId": "<uuid opcional>", "ports": [ { "portKey": "ethernet1/1", "label": "1", "interfaceType": "RJ45", "x": 0.1, "y": 0.2, "width": 0.02, "height": 0.1 } ] },
    "rear": null
  }
}
```

- `revision` (obrigatório): o valor do último `GET port-layout` (ou da última gravação).
- `faces.front` / `faces.rear`: um objeto **substitui** essa face (`ports` obrigatório; `imageWidth`, `imageHeight`, `viewport` opcionais); `assetId` opcional define a imagem dessa face (`frontAssetId` / `backAssetId`) na mesma transação; `null` **remove o mapa** dessa face (a imagem mantém-se); chave ausente deixa a face como está. Pelo menos uma face.
- Validação conjunta das duas faces: nenhuma porta meio mapeada, nenhum `portKey` repetido entre faces (sem distinção de maiúsculas), total de portas mapeadas ≤ `expected`. O mapeamento completo (total = `expected`) não é exigido aqui; é exigido ao criar equipamentos.
- Ambas as faces e imagens são gravadas numa única transação, com a linha do modelo bloqueada (`SELECT … FOR UPDATE`).

Resposta `200`: `{ id, model, frontAssetId, backAssetId, frontAsset, backAsset, networkPortCount, portCount, supportsNetworkPorts, portLayout, revision, mapping }`, onde `portLayout` é o layout v2 normalizado, `revision` é a nova revisão e `mapping` é `{ required, expected, mapped, partialFaces, complete, byFace }`.

Erros:

| Estado | `code` | Quando |
|---|---|---|
| 400 | `PORT_LAYOUT_REVISION_REQUIRED` | falta `revision` |
| 400 | `PORT_LAYOUT_FACES_REQUIRED` | falta `faces` ou está vazio |
| 400 | `PORT_LAYOUT_FACE_INVALID` | face diferente de `front`/`rear`, ou face que não é objeto nem `null` |
| 400 | `PORT_LAYOUT_PORTS_REQUIRED` | face sem lista `ports` |
| 400 | `PORT_LAYOUT_INCOMPLETE` | porta meio mapeada (`face`, `partialPorts`) |
| 400 | `PORT_LAYOUT_DUPLICATE_PORT` | `portKey` repetido (`portKey`) |
| 400 | `PORT_LAYOUT_TOO_MANY_PORTS` | mais portas do que `expected` (`expected`, `mapped`) |
| 400 | `ASSET_ID_REQUIRED` / `ASSET_NOT_IMAGE` | `assetId` vazio / asset que não é imagem |
| 404 | — | modelo ou imagem inexistente |
| 409 | `PORT_LAYOUT_CONFLICT` | `revision` desatualizada; a resposta traz a `revision` atual. Recarregar com GET e reaplicar. |

A `revision` é um hash do layout normalizado e das duas imagens do modelo: qualquer gravação, por qualquer endpoint, muda-a.

- `POST /api/v1/device-models/:id/port-layout/generate?face=` — gera a grelha das portas ainda não mapeadas noutra face.
- Formato v2 de `portLayout`: `{ version: 2, family?, faces: { front?, rear? } }`; cada face é `{ imageWidth, imageHeight, viewport?, ports[] }`. Layouts antigos (v1) são lidos como `faces.rear`. Migração de dados: `docs/rack-front-rear-migration.md`.
- Equipamentos aceitam `managementIpAddressId` para associar o IP de gestão ao IPAM; `managementIp` continua disponível como campo rápido.

### Editor visual de portas

- `POST /api/v1/device-models/:id/assets/front` — associa um AssetFile à imagem frontal do modelo.
- `POST /api/v1/device-models/:id/assets/rear` — associa um AssetFile à imagem traseira do modelo. Ambos exigem um asset de imagem (`400 ASSET_NOT_IMAGE`).
- `GET /api/v1/assets/:id/file` — serve o ficheiro com `Content-Security-Policy: …; sandbox` e `nosniff`, para que um SVG aberto diretamente não execute scripts.
- `POST /api/v1/device-models/:id/port-layout/detect?face=` — devolve uma proposta não persistida de grelha de portas.
- `PUT /api/v1/device-models/:id/port-layout/faces` — confirma as duas faces de uma vez (recomendado); `PUT …/port-layout?face=` grava só uma face.
- `POST /api/v1/devices/:deviceId/interfaces/generate` — cria apenas interfaces que ainda não existem.
- `POST /api/v1/assets/cleanup-legacy` — limpeza administrativa idempotente dos assets legados pedidos.
- `DELETE /api/v1/assets/:id` — elimina o asset depois de desassociar referências visuais, com auditoria.

### Infraestrutura contextual

- `GET /api/v1/sites/:siteId/buildings` — lista edifícios e salas do Site.
- `POST /api/v1/sites/:siteId/buildings` — cria um edifício para o Site.
- `GET /api/v1/buildings/:buildingId/rooms` — lista salas do edifício.
- `POST /api/v1/buildings/:buildingId/rooms` — cria uma sala.
- `GET /api/v1/devices/:id` — devolve localização, assets, interfaces, VLANs, subnets e IPs associados; as interfaces são ordenadas naturalmente.
- `PATCH /api/v1/interfaces/:id` — atualiza a configuração da interface; ACCESS usa access, TRUNK usa native/allowed e ROUTED não usa VLANs.
