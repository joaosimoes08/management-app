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
- `GET/POST /api/v1/ipam/groups`, CRUD `/api/v1/ipam/permissions`
- `POST /api/v1/ipam/ripe/preview`, `POST /api/v1/ipam/ripe/import`, `GET /api/v1/ipam/ripe/imports`

O scanning automático começa desligado e usa intervalo fixo de 12 horas. IPv6 usa capacidade teórica e checks apenas de endereços conhecidos.

### Health

`GET /api/v1/health` é público e verifica a ligação ao PostgreSQL.

### Utilizador autenticado

`GET /api/v1/auth/me` exige `Authorization: Bearer <access-token>` e devolve o utilizador sincronizado e as roles reconhecidas.

### Dashboard

`GET /api/v1/dashboard/summary` devolve contagens reais do inventário (`sites`, `devices`, `vlans`, `subnets`, `ips`) e os últimos eventos de auditoria. A ausência de dados devolve zeros e uma lista vazia; não cria informação fictícia.

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

Uma aprovação cria/atualiza o IP no inventário oficial; a descoberta nunca cria automaticamente ativos definitivos.

### Portal de aplicações

`GET /api/v1/application-links` devolve as ligações autorizadas para o utilizador autenticado. `ADMIN` pode usar `includeInactive=true` para gerir todo o catálogo.

Os endpoints `POST`, `PATCH`, `DELETE` e `POST /:id/check` exigem a role `ADMIN`.

### Auditoria

`GET /api/v1/audit/events?limit=100` devolve eventos recentes com utilizador, entidade, ação e data. Exige `ADMIN` ou `AUDITOR`.

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

- `GET/POST /api/v1/assets` — consulta e upload manual de SVG, PNG ou WebP; apenas ADMIN pode criar.
- `GET /api/v1/assets/:id/file` — serve o ficheiro do asset.
- `DELETE /api/v1/assets/:id` — remove assets não associados; apenas ADMIN.
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
- Racks, devices e modelos aceitam `frontAssetId`; os ícones de devices e modelos são determinados automaticamente pelo tipo.

- `GET /api/v1/device-models/:id/port-layout` — layout visual e asset frontal do modelo.
- `PATCH /api/v1/device-models/:id/port-layout` — atualiza coordenadas normalizadas de portas.
- `POST /api/v1/device-models/:id/port-layout/generate` — gera um layout inicial com base no número de portas.
- Equipamentos aceitam `managementIpAddressId` para associar o IP de gestão ao IPAM; `managementIp` continua disponível como campo rápido.

### Editor visual de portas

- `POST /api/v1/device-models/:id/assets/front` — associa um AssetFile à imagem frontal do modelo.
- `POST /api/v1/device-models/:id/port-layout/detect` — devolve uma proposta não persistida de grelha de portas.
- `PATCH /api/v1/device-models/:id/port-layout` — confirma/atualiza o template com coordenadas normalizadas.
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
