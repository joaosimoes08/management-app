# Arquitetura

```text
Docker Compose
├── postgres       PostgreSQL da aplicação
├── keycloak-db    PostgreSQL dedicado do Keycloak
├── keycloak       IAM, realm COCiber e utilizadores locais
└── redis          Filas, locks e cache futuros

## IPAM avançado

O IPAM mantém `Site → VRF/VLAN → Subnet → IP → Host → Service`. `Subnet.version` distingue IPv4 e IPv6. VRFs isolam o espaço de sobreposição: conflitos são impedidos no mesmo Site/VRF, mas o mesmo CIDR pode existir em VRFs diferentes. A capacidade IPv6 é teórica/observada e não é enumerada para prefixos extensos.

Checks manuais e agendados usam BullMQ. Só resultados com ICMP respondido ou uma porta TCP aberta são operacionais; reverse DNS é best effort e apenas para esses candidatos. NAT é documental, e os grupos IPAM preparam scopes para futura integração LDAP/Keycloak.

Processo local
└── NestJS API + Prisma
    ├── AuthModule       OIDC/JWKS, roles e sincronização de utilizadores
    ├── AuditModule      auditoria de autenticação e pedidos HTTP
    ├── HealthModule     health check PostgreSQL
    ├── SetupModule      onboarding inicial multi-organização
    ├── IpamModule       Sites, VLANs, subnets, IPs e discovery ICMP/TCP
    ├── InfrastructureModule Equipamentos, modelos, interfaces e VLANs de portas
    ├── SettingsModule   Organização, integrações e estado da plataforma
    └── DatabaseModule   PrismaClient partilhado
```

## Organização frontend

O frontend (`apps/web`) está organizado por domínio de negócio: `app/` contém apenas routing, layouts e composição; `features/` agrupa o código de cada domínio (infrastructure, ipam, settings, dashboard, audit, discovery, portal, setup, profile) com os seus componentes, tipos e chamadas API tipadas; `components/{ui,layout}` mantém o que é genuinamente partilhado (shell, modais, toasts); `lib/{auth,api,i18n,query}` concentra a infraestrutura transversal. O transporte HTTP (`lib/api/client.ts`) está separado da autenticação (`lib/auth/`), e o server-state usa React Query com query keys por domínio. Detalhes completos em [frontend-refactor.md](frontend-refactor.md).

## Shell frontend e workspace IPAM

Todas as áreas autenticadas usam `apps/web/components/layout/app-shell.tsx` (composto por `app-sidebar`, `app-header`, `user-menu` e `global-search`). O sidebar é ancorado ao viewport, guarda o estado aberto/recolhido no browser, expande por hover sem reflow e transforma-se num drawer em ecrãs pequenos. O conteúdo usa a largura restante da janela.

O IPAM é uma workspace contextual: a árvore seleciona Site, VLAN ou Subnet e a área principal apresenta Resumo, IPs, Hosts e serviços, Discovery ou Detalhes. As chamadas continuam a usar os endpoints IPAM existentes; a seleção é refletida na URL para permitir links partilháveis e refresh sem perder o contexto.

## Fluxo IPAM e discovery

```text
Site → VLAN → Subnet → IP → Host/Serviço
                  │
                  └── DiscoveryJob → DiscoveryResult (PENDING)
                                      ├── APPROVED → IP oficial
                                      └── IGNORED  → histórico
```

O discovery é iniciado pela API contra uma subnet selecionada, com ICMP, TCP e reverse DNS opcional. A API publica o trabalho na fila BullMQ `discovery`; o processo `worker:dev` consome a fila, executa o scan e persiste os resultados.

O inventário físico usa `Device`, `DeviceModel`, `DeviceInterface`, `Rack` e `InterfaceVlan`. A relação `InterfaceVlan` mantém as VLANs permitidas de uma interface sem duplicar VLANs ou subnets.

## Organização

```text
apps/api/                    API NestJS
packages/database/           Prisma schema, migrations e client
infra/keycloak/              Realm exportável
docs/                        Documentação operacional e técnica
docker-compose.yml           Serviços locais
.env.example                 Configuração de referência
```

## Fluxo de autenticação

1. O utilizador autentica-se no Keycloak no realm `COCiber`.
2. O Keycloak emite um access token JWT.
3. A API obtém as chaves públicas do endpoint JWKS.
4. O `AuthGuard` valida assinatura, issuer e audience/azp.
5. As roles de `realm_access.roles` são filtradas pelas roles suportadas.
6. O utilizador é criado ou atualizado em PostgreSQL.
7. O pedido prossegue para os guards e controllers.

O health check é público para permitir probes. Os restantes endpoints são protegidos por defeito.
## Assets e infraestrutura física

Os modelos físicos são mantidos no PostgreSQL e os ficheiros gráficos em `data/assets`. `AssetFile` guarda apenas metadados, licença e chave de armazenamento; a API valida o tipo e tamanho antes de persistir o ficheiro.

`DeviceModel.portLayout` prepara o diagrama visual e `DeviceInterface.portKey` permite associar a configuração real da interface à porta renderizada. Na ausência de imagem ou layout, o frontend usa um diagrama fallback.

`DiscoverySchedule` é uma configuração por subnet. A API cria/remove o scheduler BullMQ e o worker materializa cada execução num `DiscoveryJob`, mantendo os resultados separados do inventário oficial.

## Navegação física

Infraestrutura usa o Site como contexto principal. A API mantém a relação `Site → Building → Room → Rack → Device`, enquanto o frontend apresenta racks como a vista default e inventário/modelos/interfaces como áreas secundárias. O posicionamento U é validado no backend para impedir unidades fora dos limites e sobreposição de equipamentos.

`DeviceModel.supportsNetworkPorts` evita assumir que qualquer servidor ou storage deve ser tratado como switch. Apenas modelos explicitamente configurados apresentam layout e operações de portas de rede.

O fluxo físico da UI é hierárquico: o Site seleciona edifícios e salas, a sala apresenta os bastidores num grid, e o bastidor abre uma vista de zoom com unidades U. O frontend mantém o contexto em `siteId`, `roomId` e `rackId`, enquanto a API valida a pertença e as dependências de cada nível.

O shell mantém o Site selecionado no sidebar e em `localStorage`; páginas contextuais usam o parâmetro explícito da URL quando presente. Assets específicos de racks/equipamentos são overrides opcionais sobre assets de modelo. Discovery é executado pelo worker BullMQ e só materializa candidatos alcançáveis, mantendo métricas agregadas para endereços sem resposta.

O IPAM usa `network-map` como fronteira agregada para derivar VLAN → interface → equipamento a partir das relações Prisma access/native/allowed. O rack visual combina o asset de fundo com overlays posicionados proporcionalmente por U; a precedência gráfica é override específico, asset de modelo e fallback interno.

### Contexto físico da infraestrutura

O frontend mantém a hierarquia Site → Edifício → Sala → Bastidor → Equipamento. Edifícios e salas são carregados por dependência do nível anterior e criados através dos endpoints REST existentes. A posição visual continua a ser calculada pela área útil normalizada do rack e por `rackUnitStart`/`rackUnitSize`.

O zoom do equipamento permanece na mesma rota e recebe callbacks explícitos para edição da ficha e das interfaces. A API devolve interfaces com VLANs access/native/allowed e subnets principais; o frontend aplica ordenação natural por segmentos numéricos.

## Infraestrutura visual e portas

O frontend separa a seleção do equipamento da edição da interface. A tab Interfaces começa pelos equipamentos de rede, carrega as interfaces do equipamento selecionado e mostra as relações access/native/allowed com as subnets principais das VLANs.

`DeviceModel.portLayout` usa coordenadas normalizadas entre 0 e 1, permitindo renderizar hotspots sobre imagens com diferentes dimensões. O upload de imagens é otimizado no browser para reduzir payload e latência; o PostgreSQL guarda apenas metadados e a chave de armazenamento.

O editor de portas usa `DeviceModel.portLayout` como template confirmado pelo administrador. A deteção inicial é uma proposta baseada no número de portas; o frontend permite corrigir label, portKey, tipo e coordenadas antes do PATCH. `DeviceInterface` continua a ser o estado operacional por equipamento, preservando configurações existentes quando interfaces são geradas.

No workspace de infraestrutura, a seleção de Site → Edifício → Sala → Bastidor é explícita. O foco de equipamento permanece montado no `rack-stage` como overlay, com backdrop desfocado. A imagem e os hotspots usam um frame com o aspect ratio declarado pelo template; padding ou transformações fora desse frame não devem alterar as coordenadas.
