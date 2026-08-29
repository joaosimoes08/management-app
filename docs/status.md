# Estado atual

## Refatoração do frontend — arquitetura feature/domain

- `apps/web` reorganizado por domínio de negócio: `features/{infrastructure,ipam,settings,dashboard,audit,discovery,portal,setup,profile}` com componentes, tipos e API tipados por domínio; `app/` reduzido a wrappers de routing.
- God components divididos: `infrastructure-workspace-next.tsx` (560 linhas) em 17 componentes coesos; `app/ipam/page.tsx` em orquestrador + subcomponentes; `app-shell.tsx` em sidebar/header/user-menu/global-search.
- Ficheiro legado `infrastructure-workspace.tsx` e `PermissionsView` morto eliminados; nome temporário `-next` removido.
- `@ts-nocheck`: 0 (antes 4); `any`: 0 (antes ~158). Alias `@/*` adicionado.
- Transporte HTTP separado da autenticação (`lib/api/client.ts`); `useAuth()` já não expõe `apiFetch`.
- React Query adotado para server-state em todos os domínios, com query keys por domínio e invalidação.
- ESLint 9 + scripts `typecheck`/`lint`; gates de typecheck e lint do frontend no CI.
- Rotas, contratos, autenticação, traduções e UI preservados; validado com typecheck, lint, build (14 rotas) e `i18n:check`.
- Detalhes em [frontend-refactor.md](frontend-refactor.md).

## Concluído

- Monorepo npm com `apps/api` e `packages/database`.
- Docker Compose portátil para Windows, macOS e Linux.
- PostgreSQL 18 para a aplicação.
- Redis 8 preparado para filas e cache futuros.
- PostgreSQL dedicado para o Keycloak.
- Keycloak em modo de desenvolvimento local.
- Realm `COCiber`.
- Utilizadores locais no Keycloak; LDAP ainda não está ligado.
- Client OIDC `simoes-api`.
- Validação JWT através de JWKS.
- Validação de issuer e audience/authorized party.
- Sincronização automática de utilizadores e roles no PostgreSQL.
- Roles iniciais do domínio.
- Health check público em `/api/v1/health`.
- Endpoint protegido `/api/v1/auth/me`.
- Validação global de inputs com `ValidationPipe`.
- Swagger/OpenAPI preparado em `/api`.
- CORS configurável por ambiente.
- Rate limiting global preparado.
- Headers de segurança através de Helmet.
- Auditoria de autenticações e pedidos HTTP autenticados.
- Prisma schema e migração inicial.
- Modelo `ApplicationLink` e migração aplicada.
- Página frontend dinâmica de aplicações chave com gestão `ADMIN`.
- Frontend Next.js inicial com dashboard responsivo.
- Dashboard ligado ao endpoint real `/api/v1/dashboard/summary`.
- Verificação visual do estado da API no frontend.
- Modelo `SystemSettings` e migração do setup inicial.
- Walkthrough inicial para organização, primeiro site e localização física opcional.
- Proteção do dashboard até o setup estar concluído.

## Fase 3 concluída / Fase 4 em curso

- Aplicação Next.js criada em `apps/web`.
- Dashboard operacional responsivo criado com dados reais.
- Navegação lateral, estados, métricas, atividade e atalhos implementados.
- Verificação base do health check da API no frontend.
- AuthProvider Keycloak com login, logout, refresh e carregamento de `/api/v1/auth/me`.
- Redirecionamento automático para o onboarding quando a instalação ainda não está configurada.
- Fase 4 inicial: CRUD de sites, VLANs, subnets e IPs.
- Discovery ICMP/TCP com resultados pendentes, reverse DNS e revisão manual.
- Página IPAM em `/ipam` com criação rápida e revisão de resultados.
- IPAM com paginação, pesquisa, filtro por estado e operações de IP.
- Entidades Host/Service e promoção de resultados aprovados.
- Worker BullMQ separado para discovery via Redis.
- Sidebar sticky/recolhível com expansão por hover.
- Migração `20260814113621_ipam_discovery` aplicada.
- Sidebar partilhado nas páginas autenticadas.
- Dropdown de utilizador com definições, ajuda e logout explícito.
- Pesquisa do dashboard para Sites, VLANs, Subnets e IPs.
- Rotas funcionais para Infraestrutura, Descoberta, Auditoria, Definições e Ajuda.
- Endpoint protegido `/api/v1/audit/events` e página de auditoria.

## Atualização UX — remodelação IPAM e shell global

- Dashboard migrado para o `AppShell` partilhado.
- Sidebar convertido em rail fixo ao viewport, recolhível, expansível por hover e responsivo como drawer em mobile.
- IPAM reorganizado como árvore Site → VLAN → Subnet com contexto, breadcrumbs e tabs.
- Formulários de Sites, VLANs, Subnets e IPs passaram de prompts/formulários permanentes para modais contextuais.
- Tabela de IPs apresenta estado, MAC, VLAN, origem, host, serviços, pesquisa e paginação.
- Discovery separado do inventário oficial, com aprovação/ignorância de resultados pendentes.
- Filtros de IP aceitam pesquisa por endereço, hostname ou MAC; a API suporta também filtro por `source`.

## Próximos passos da Fase 4

- Agendamento, retries, métricas e histórico avançado do worker BullMQ.
- Suporte IPv6.
- Navegação VLAN → hosts/IPs com pesquisa operacional.
- Modelo visual de switches, interfaces e configuração de portas.

## Ainda não implementado

- LDAP/LDAPS.
- Gestão administrativa de utilizadores e permissões.
- SNMP, agentes, NetApp e integrações externas.
- Bastidores visuais e posicionamento de equipamentos.
- Gestão visual avançada de hosts/serviços e relações com equipamentos.

## Incremento atual — menus e infraestrutura

### Implementado

- Atalhos do dashboard sem âncoras inválidas.
- Consola `/descoberta` com criação de jobs, consulta de execuções e revisão de resultados.
- Endpoints de resumo e listagem paginada de Discovery.
- CRUD inicial de equipamentos, modelos e interfaces na API.
- Arquivamento de equipamentos através de estado `RETIRED`.
- Associação de equipamentos a Sites e interfaces a VLANs.
- Relação normalizada `InterfaceVlan` para VLANs permitidas.
- `/infraestrutura` com inventário pesquisável e formulário de equipamento.
- `/definicoes` com organização, sessão, roles e estado de integrações.
- `/ajuda` e artigos internos para operação e troubleshooting.

### Parcial

- Interfaces ainda não têm editor completo na UI.
- Bastidores/localizações têm modelo de dados, mas ainda não têm gestão visual.
- Equipamentos ainda não têm ficha detalhada com navegação completa para VLAN/IPAM.
- Perfis de Discovery e métricas avançadas do worker ainda não estão implementados.

### Planeado

- Diagramas visuais de switches e portas.
- SNMP/SNMPv3, LDAP/LDAPS, agentes e NetApp.
- Bastidores visuais e posicionamento gráfico.
## Incremento — catálogo físico e relações operacionais

Estado: parcialmente funcional.

- Prisma: `RackModel`, `AssetFile`, layout/assets de `DeviceModel`, `DeviceInterface.portKey` e `DiscoverySchedule`.
- API: catálogo de assets com upload manual, modelos de bastidor, bastidores, regras VLAN→subnet e schedules de discovery.
- Frontend: seleção de equipamento, interfaces, diagrama fallback de switch, painel de porta e links para VLAN/IPAM.
- Discovery periódico: opt-in por subnet, intervalo fixo de 12 horas, worker BullMQ e resultados pendentes.
- Compose: o armazenamento local esperado é `data/assets`, compatível com execução host em Docker Desktop Windows/macOS.

Limitações atuais:

- Ainda falta CRUD visual completo de racks, buildings/rooms e posicionamento drag-and-drop.
- O layout de portas ainda é fallback sequencial; falta editor visual de coordenadas e associação de assets ao modelo na UI.
- A UI de configuração do schedule por subnet está preparada na API, mas requer acabamento da área Discovery do IPAM.
- A migração `20260814150000_infrastructure_operations` foi aplicada com `npm.cmd run db:migrate`; o `prisma generate` ainda pode falhar ao substituir o DLL do engine se API/frontend/worker estiverem ativos.

Validação deste incremento:

- `prisma validate` passou.
- `npm.cmd run build --workspace=@simoes/api` passou.
- `npm.cmd run web:build` compilou e gerou as páginas Next.js.

## Incremento — infraestrutura centrada em bastidores

Estado: funcional na primeira versão operacional.

- `/infraestrutura` inicia pela seleção de Site e pela vista de bastidores.
- Bastidores mostram edifício, sala, unidades U, ocupação e equipamentos instalados.
- Equipamentos podem ser criados no Site e posicionados num rack com validação de limites e conflitos.
- O menu foi reorganizado em Bastidores, Equipamentos, Modelos, Interfaces e Assets.
- `DeviceModel` suporta `supportsNetworkPorts`, `networkPortCount` e classificação explícita de layouts de rede.
- A API inclui detalhe, criação, edição e remoção controlada de bastidores.
- Seed idempotente criado em `packages/database/seed-catalog.js`.
- Catálogo importado na base atual: 27 modelos de equipamentos e 4 modelos de bastidores.

Limitações restantes:

- O editor visual de coordenadas de portas ainda é uma evolução posterior; os layouts importados usam a definição de família/quantidade.
- A ficha detalhada de equipamento pode ser enriquecida com agentes, SNMP e NetApp.
- Upload e associação de assets a modelos continuam disponíveis, mas o catálogo base usa ícones genéricos locais.

## Incremento — salas e zoom físico

Estado: funcional.

- A API expõe CRUD de edifícios e salas.
- `/infraestrutura` permite criar edifícios e salas no contexto do Site.
- A vista default é `Site → Sala → Bastidores`; os bastidores aparecem lado a lado.
- Selecionar um bastidor abre a vista de unidades U; `Voltar aos bastidores` repõe a grelha.
- O contexto é preservado na URL por `siteId`, `roomId`, `rackId` e `tab`.
- Builds API e frontend passaram.

## Incremento — shell, assets visuais e discovery confiável

Estado: funcional na primeira versão.

- Sidebar com Site real, persistência local, prioridade de `siteId` na URL e rail recolhível estável.
- Barra superior sem utilizador duplicado; username, roles e logout permanecem no sidebar.
- Definições e Ajuda foram separadas dos estilos genéricos e ganharam layouts responsivos próprios.
- `Rack.frontAssetId` e `Device.frontAssetId` permitem overrides de imagem frontal; o ícone do equipamento é fixo por tipo.
- Infraestrutura mostra imagem de rack, overlays clicáveis e fallback em unidades U.
- Upload manual de assets foi disponibilizado para administradores.
- Discovery filtra resultados por alcance ICMP/TCP e executa reverse DNS apenas em hosts alcançáveis.
- `DiscoveryJob` guarda métricas de varredura e inacessibilidade.
- Migrações aplicadas, Prisma Client regenerado e builds API/frontend concluídos.

## Incremento — bastidor visual por U, IPAM por VLAN e edição

Estado: implementado.

- Asset vazio de rack 42U incluído no frontend como fallback portátil.
- Overlays de dispositivos dimensionados por unidades U.
- Edição de racks, equipamentos, modelos e associação de assets disponível na infraestrutura.
- IPAM simplificado para Site → VLAN → subnet → IPs e VLAN → equipamentos/interfaces.
- API `network-map` agregada implementada.
- Builds API e frontend passaram.
- No Windows, `db:generate` pode exigir que processos Node de desenvolvimento sejam parados devido ao lock do query engine.

## Incremento — IPAM IPv4/IPv6

Estado: funcional na API e em evolução na UI.

- Migrações `20260814190000_ipam_complete` e `20260814200000_ripe_imports` aplicadas sem apagar dados.
- VRF, NAT documental, scanning, estado observado de IP, grupos/permissões e calculadora CIDR estão expostos pela API.
- RIPEstat tem preview, confirmação, importação selecionada e histórico persistido.
- `/ipam` apresenta mapa Site→VLAN→Subnet, subnets, IPs, VRFs, NAT, calculadora e permissões.

Pendentes: drawers de edição/check de IPs, configuração visual de scanning, virtualização avançada de prefixos grandes, enforcement granular em todos os endpoints e histórico detalhado dos checks.

Correção de fluxo aplicada:

- mapa definido como vista inicial;
- placeholders de Site sem VLANs/subnets com ações reais;
- criação de VLAN e subnet disponível no contexto do Site;
- IPs movidos para o detalhe da subnet e limitados a 250 por carregamento;
- calculadora e RIPE deixaram de ser placeholders.

## Incremento — infraestrutura visual e portas operacionais

- `/infraestrutura` apresenta a hierarquia Site → Sala → Bastidores e imagens frontais dos racks.
- A vista de rack mantém overlays proporcionais às unidades U e a precedência de assets específicos/modelo/fallback.
- A tab Interfaces mostra equipamentos de rede, interfaces, VLANs e subnets associadas.
- O upload raster é comprimido no browser para WebP antes do envio e as listas usam lazy loading.
- O asset local de referência do C9300 foi removido; o modelo aguarda novo upload pelo browser.
- A API expõe `GET/PATCH /api/v1/device-models/:id/port-layout` e `POST /api/v1/device-models/:id/port-layout/generate`.
- Pendentes: editor visual completo de coordenadas por modelo e cobertura visual dos restantes modelos do catálogo.

## Incremento atual — editor visual e gestão operacional

- Estado: funcional em API/frontend; requer validação visual com imagens reais carregadas pelo administrador.
- Bastidores: figuras sem container, detalhe ampliado, área útil opcional e overlays por U.
- Modelos: editor de template com deteção assistida, correção manual e confirmação.
- Interfaces: seleção de equipamento de rede, geração apenas das interfaces em falta e edição de access/native/trunk/VLANs permitidas.
- Equipamentos: inventário ativo por Site, pesquisa e gestão de imagem/IP/rack/estado.
- Os derivados antigos `c9300.webp` foram removidos; a imagem original autorizada está guardada como `Cisco-Catalyst-9300-front.png`.

### Incremento — assets associados e editor por drag

- Upload exige modelo associado e guarda o nome introduzido pelo administrador, preservando o MIME/formato original.
- O catálogo permite eliminar assets; a API desassocia racks, modelos e equipamentos antes da remoção e audita a operação.
- Hotspots de portas podem ser arrastados sobre o preview; ao largar, as coordenadas normalizadas são atualizadas antes da confirmação do template.

### Incremento — precisão visual de portas e palco de rack

- O editor de portas usa Pointer Events: o hotspot pode ser arrastado livremente dentro da imagem e o canto inferior direito permite redimensionar a zona.
- As alterações de posição e tamanho atualizam imediatamente os valores normalizados do template, mantendo a confirmação manual antes de guardar.
- O catálogo ganhou layout dedicado, com ações `Editar` e `Mapear portas` lado a lado sem esmagar o conteúdo.
- O palco de rack usa um novo asset interno vazio de 42U gerado para ocupar toda a área visual; os overlays continuam a ser dimensionados pela posição U.
- Os overlays do rack usam a imagem específica do equipamento, depois a imagem frontal do modelo e finalmente o fallback por tipo.

### Incremento — detalhe operacional do equipamento

- A confirmação do template normaliza coordenadas/dimensões, apresenta erros dentro do modal e mostra estado de gravação.
- O hover de um equipamento no rack apresenta hostname e IP de gestão sem alterar o layout.
- Clicar num equipamento abre um detalhe ampliado com imagem, marca/modelo, número de série, estado, posição U e interfaces configuradas.
- O uptime é mostrado como não disponível até existir integração SNMP/agente.

### Incremento — fluxo Site → Sala → Rack → Equipamento

- A infraestrutura tem agora seletor contextual de Sala junto ao Site, incluindo criação de sala por edifício.
- Os bastidores sem imagem específica usam sempre `rack-empty-42u.png`; o placeholder `Sem imagem` foi removido da grelha.
- O duplo clique numa tab ativa repõe a vista inicial dessa tab e limpa o contexto selecionado.
- Interfaces são ordenadas naturalmente para evitar a sequência incorreta `eth1`, `eth10`, `eth2`.
- O zoom do equipamento apresenta hotspots sobre a imagem, tooltip de configuração das portas e ficha operacional com modelo, S/N, asset tag, localização e estado.

### Incremento — edifícios, zoom e configuração de VLANs

- A infraestrutura usa Site → Edifício → Sala → Bastidor como contexto explícito.
- É possível criar edifícios e salas através de modais separados.
- O zoom do equipamento recebe callbacks para editar o equipamento e qualquer interface.
- A API e o frontend aplicam ordenação natural às interfaces.
- A edição de interfaces normaliza VLANs vazias e mostra access apenas em ACCESS e native/allowed apenas em TRUNK.

### Incremento — zoom local e alinhamento do rack

- O bastidor não deve abrir conteúdo até existir uma seleção explícita de Edifício, Sala e Bastidor.
- A viewport default foi ajustada à abertura física do rack vazio; assets com viewport configurada mantêm prioridade.
- O clique num equipamento permanece no palco e apresenta um zoom animado com hotspots e tooltips por porta.
- O detalhe lateral mostra hostname, IP de gestão e ações para editar ou abrir a ficha completa.

## Correção — seleção explícita e zoom local

Estado: implementado no frontend.

- Sem Edifício ou Sala selecionados, a vista de Bastidores mostra o placeholder correspondente.
- O detalhe do equipamento é um overlay dentro do palco do rack; não abre uma nova página nem altera a rota ao clicar no ativo.
- O rack permanece visível e desfocado durante o zoom; clique exterior e Escape regressam ao bastidor.
- Os hotspots são renderizados dentro de um frame com a proporção do asset/template.

### Incremento — bastidor padrão fixo de 42U

- Todos os bastidores usam o asset interno `rack-empty-42u.png`, substituído pela imagem de referência numerada de U42 no topo a U1 em baixo.
- A criação e edição aceitam apenas nome e sala; capacidade, imagem e modelo deixam de ser configuráveis na UI e na API.
- Os overlays são calculados de baixo para cima e recortados ao intervalo U configurado, evitando sobreposições visuais em equipamentos com 2U ou mais.
- A migração `20260823120000_fixed_42u_racks` normaliza bastidores existentes e deixa por posicionar equipamentos que excedam U42.
