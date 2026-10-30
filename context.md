# Contexto do Projeto — Plataforma de Gestão de Infraestrutura e Ciberdefesa

## 1. Visão geral

O objetivo é desenvolver uma aplicação web moderna, modular e segura para centralizar a gestão da infraestrutura tecnológica do Centro. A plataforma deverá combinar funções de IPAM, inventário de equipamentos, gestão de VLANs e interfaces de rede, DCIM/bastidores, inventário de servidores, descoberta de hosts, integração com agentes, ligações para aplicações internas e visualização estatística.

A aplicação não deverá depender exclusivamente de network discovery. Deve permitir registo e gestão manual dos ativos, enriquecidos posteriormente por informação recolhida automaticamente através de SNMP, ICMP, TCP, APIs específicas e agentes instalados nos sistemas.

O princípio central da aplicação é permitir navegar pela relação:

```text
Bastidor → Equipamento → Interface → VLAN → Subnet → IP → Host/Serviço
```

Exemplo de utilização: o operador abre a imagem de um switch, seleciona a porta `Ethernet1/1`, consulta a configuração da interface, seleciona uma VLAN permitida e é encaminhado para a página dessa VLAN, onde pode consultar as subnets, IPs, hosts e equipamentos associados.

## 2. Objetivos funcionais

### 2.1 Gestão de IPs, subnets e VLANs

A aplicação deverá permitir:

- Criar, editar e remover sites, localizações, subnets e VLANs.
- Registar o gateway, finalidade, ambiente e localização de cada subnet.
- Gerir IPs livres, ocupados, reservados, excluídos e desconhecidos.
- Associar IPs a hostnames, MAC addresses, equipamentos, interfaces e serviços.
- Identificar a origem de cada informação: manual, SNMP, agente, ICMP, TCP, DNS, DHCP ou importação.
- Consultar todos os hosts existentes numa VLAN, por IP ou por nome.
- Associar uma VLAN a uma ou mais subnets quando o desenho da infraestrutura o exigir.
- Registar VLAN ID, nome, descrição, localização e equipamentos onde está configurada.

Cada IP deverá guardar, pelo menos:

- Endereço IP e versão IPv4/IPv6.
- Subnet.
- Estado.
- Hostname.
- MAC address.
- Equipamento/interface associados.
- Sistema operativo, quando conhecido.
- Última deteção.
- Método de deteção.
- Observações.

### 2.2 Gestão de switches e portas

Os switches deverão ser apresentados através de modelos visuais configuráveis. Cada modelo deverá definir fabricante, modelo, número e disposição das portas, tipos de interface, imagem frontal e coordenadas das portas na imagem.

Ao selecionar uma porta, a interface deverá apresentar:

- Nome da interface.
- Descrição.
- Estado administrativo e operacional.
- Velocidade e duplex.
- Tipo de porta: access, trunk ou outro.
- VLAN access.
- VLAN nativa.
- VLANs permitidas.
- MAC addresses aprendidos.
- Hosts e equipamentos associados.
- Estatísticas de tráfego.
- Última sincronização.
- Última alteração conhecida.

Exemplo:

```text
Interface: Ethernet1/1
Estado: Up
Tipo: Trunk
VLAN nativa: 10
VLANs permitidas: 10, 12, 20
Velocidade: 10 Gbps
Descrição: Uplink para outro switch
```

SNMP standard poderá fornecer estado, velocidade, uptime, interfaces, tráfego, modelo e informação geral. A configuração completa de uma porta poderá exigir MIBs específicas do fabricante, API REST, NETCONF/RESTCONF, SSH controlado ou importação de configuração. Esta limitação deve ser refletida na arquitetura desde o início.

### 2.3 Gestão de bastidores e ativos físicos

A aplicação deverá representar a hierarquia física:

```text
Site → Edifício → Sala → Bastidor → Unidade U → Equipamento
```

Deverá permitir visualizar a frente e, posteriormente, a traseira do bastidor, com equipamentos posicionados por unidades U. Cada ativo físico poderá conter:

- Tipo: servidor, switch, router, firewall, storage, NetApp, UPS, patch panel, etc.
- Fabricante e modelo.
- Número de série.
- Asset tag.
- Estado.
- Localização e posição no bastidor.
- Firmware.
- Data de aquisição e garantia.
- Responsável.
- Licenciamento.
- Notas.
- Ligações físicas e lógicas.

### 2.4 Servidores, virtualização e agentes

SNMP será usado para informação geral, mas a informação detalhada de servidores deverá ser obtida através de agentes.

O agente deverá poder recolher:

- Sistema operativo e versão.
- Hostname e uptime.
- CPU, memória e discos.
- Interfaces de rede.
- Serviços em execução.
- Processos relevantes.
- Patches instalados.
- Software instalado.
- Número de série.
- Plataforma de virtualização.
- Máquinas virtuais.
- Certificados e respetivas datas de expiração.
- Estado e versão do próprio agente.

Devem existir, inicialmente, agentes para Windows Server e Linux. A comunicação deverá ser iniciada pelo agente para o servidor central, usando TLS e permissões mínimas. O agente não deverá permitir execução arbitrária de comandos por defeito.

### 2.5 NetApp e armazenamento

Para NetApp deverá ser privilegiada a API oficial de gestão. SNMP poderá complementar métricas gerais, mas não deverá ser a única fonte para informação detalhada.

Deverá ser possível consultar clusters, controllers, aggregates, volumes, LUNs, espaço total e disponível, snapshots, deduplicação, thin provisioning, estado dos discos, número de série, firmware, licenciamento, alertas e relações de replicação.

### 2.6 Descoberta de hosts

O módulo de descoberta deverá ser independente do inventário oficial e permitir trabalhos agendados ou manuais por subnet.

Métodos:

- ICMP para detetar hosts que respondem a ping.
- TCP para testar portas configuráveis.
- SNMP para identificar dispositivos de rede.
- DNS/reverse DNS para obter nomes.
- DHCP para consultar leases e reservas.
- APIs ou conectores específicos quando disponíveis.

As portas TCP deverão ser configuráveis por perfil. Exemplos: SSH, DNS, HTTP/HTTPS, RPC, SMB, RDP, SNMP, WinRM e portas de aplicações internas.

Uma descoberta deverá produzir um resultado pendente, não criar automaticamente um ativo definitivo. O operador deverá poder rever, associar, converter, ignorar ou marcar o resultado como falso positivo.

## 3. Integrações e portal interno

A plataforma deverá conter um portal de ligações para aplicações importantes do Centro, com visibilidade controlada por grupos LDAP. As ligações poderão incluir:

- BookStack para documentação.
- Zabbix para monitorização.
- Zammad para incidentes e pedidos.
- Rocket.Chat para comunicação operacional.
- Ansible para automação e orquestração.

Cada ligação deverá ter nome, URL, ícone, descrição, categoria, ordem, grupos autorizados e, opcionalmente, verificação de disponibilidade HTTP.

A nova aplicação deverá funcionar como mapa central da infraestrutura, sem substituir sistemas especializados:

| Sistema | Responsabilidade principal |
|---|---|
| Nova aplicação | Inventário, IPAM, VLANs, portas, bastidores e relações |
| Zabbix | Métricas, disponibilidade, histórico e alertas |
| Ansible | Configuração, recolha e automação |
| BookStack | Documentação detalhada |
| Zammad | Incidentes e pedidos |
| Rocket.Chat | Comunicação operacional |

## 4. Tecnologias open-source recomendadas

### 4.1 Frontend

- Next.js com TypeScript.
- React.
- Tailwind CSS.
- shadcn/ui para componentes acessíveis e consistentes.
- React Query/TanStack Query para cache e sincronização com a API.
- React Hook Form e Zod para formulários e validação.
- Apache ECharts ou Recharts para gráficos.
- SVG e componentes React para switches e bastidores interativos.

### 4.2 Backend

- Node.js com TypeScript.
- NestJS para uma arquitetura modular, ou Fastify com uma organização própria mais leve.
- Recomenda-se NestJS se o projeto crescer para vários módulos, workers e integrações.
- REST API versionada; GraphQL poderá ser considerado mais tarde para consultas complexas.
- OpenAPI/Swagger para documentação da API.
- Pino para logging estruturado.

### 4.3 Base de dados e processamento assíncrono

- PostgreSQL como base de dados principal.
- PostGIS apenas se forem necessárias representações geográficas mais avançadas.
- Redis para filas, locks, cache e estado de trabalhos.
- BullMQ para trabalhos de descoberta e sincronizações periódicas.
- Prisma ou Drizzle ORM; Prisma é recomendado para acelerar o desenvolvimento inicial.

PostgreSQL é preferível a uma base documental porque o domínio tem relações fortes entre equipamentos, interfaces, VLANs, subnets, IPs, bastidores, hosts e serviços.

### 4.4 Autenticação e autorização

Todos os componentes de autenticação deverão ser open-source. A aplicação deverá suportar LDAP sobre TLS (LDAPS) e, quando necessário, LDAP com StartTLS.

Opções recomendadas:

- Keycloak como Identity and Access Management open-source.
- Keycloak federado com Active Directory ou outro servidor LDAP.
- Ligação do Keycloak ao LDAP através de LDAPS.
- OpenID Connect entre o frontend/backend e o Keycloak.
- Mapeamento de grupos LDAP para roles da aplicação.

Esta abordagem evita implementar diretamente no frontend a gestão de passwords e permite futuramente integrar MFA, SSO, certificados e outros identity providers.

O backend deverá validar tokens OIDC, aplicar RBAC e registar auditoria. Roles iniciais:

- Administrador.
- Operador de rede.
- Operador de sistemas.
- Operador de armazenamento.
- Auditor.
- Apenas leitura.

Deverão ser controladas permissões como ver inventário, editar IPs, editar VLANs, executar descobertas, gerir credenciais, alterar dados sensíveis e administrar integrações.

### 4.5 Recolha, agentes e protocolos

- SNMPv3 como opção preferencial.
- SNMPv2c apenas quando tecnicamente necessário e com secrets protegidos.
- ICMP e TCP através de workers controlados.
- NETCONF/RESTCONF, APIs REST e SSH apenas como conectores específicos.
- Agentes Windows e Linux com comunicação outbound sobre HTTPS/TLS.
- API NetApp para storage.
- APIs do Zabbix e Ansible para integrações futuras.

### 4.6 Execução e operação

- Docker ou Podman.
- Docker Compose/Podman Compose para desenvolvimento e primeiro deployment.
- Nginx ou Caddy como reverse proxy TLS.
- Prometheus e Grafana, se for necessário monitorizar a própria plataforma.
- MinIO, caso seja necessário guardar ficheiros, exports ou snapshots localmente.
- Git para controlo de versões.
- CI/CD com ferramentas open-source, como Gitea Actions, GitLab CI ou Jenkins, conforme a infraestrutura disponível.

## 5. Arquitetura lógica

```mermaid
flowchart TD
    UI["Frontend Next.js"] --> API["API NestJS"]
    API --> DB["PostgreSQL"]
    API --> IAM["Keycloak + LDAP/LDAPS"]
    API --> QUEUE["Redis + BullMQ"]
    QUEUE --> DISC["Workers de descoberta"]
    QUEUE --> SNMP["Workers SNMP"]
    QUEUE --> AGENT["Gateway de agentes"]
    API --> EXT["Zabbix / Ansible / NetApp"]
```

Os workers deverão estar separados do processo principal da API. Uma descoberta ou sincronização SNMP nunca deverá bloquear pedidos normais da interface web.

## 6. Modelo de dados inicial

Entidades principais:

- `users`, `roles`, `permissions`, `audit_logs`.
- `sites`, `buildings`, `rooms`, `racks`, `rack_units`.
- `device_models`, `devices`, `device_interfaces`, `device_connections`.
- `vlans`, `subnets`, `ip_addresses`, `mac_addresses`.
- `hosts`, `services`, `virtual_machines`.
- `storage_systems`, `storage_volumes`, `storage_licenses`.
- `agents`, `agent_versions`, `agent_reports`.
- `discovery_jobs`, `discovery_targets`, `discovery_results`.
- `credentials`, `integrations`, `application_links`.

As credenciais de SNMP, SSH, WinRM e APIs nunca deverão ser guardadas em texto simples. Devem ser encriptadas em repouso, protegidas por permissões de backend, auditadas e separadas entre credenciais de leitura e escrita.

## 7. Requisitos de segurança

- LDAPS obrigatório para ambientes de produção.
- Validação rigorosa do certificado do servidor LDAP.
- TLS para frontend, API, agentes e integrações.
- Segredos fora do código-fonte.
- Encriptação de credenciais na base de dados.
- RBAC baseado em grupos LDAP.
- Auditoria de login, alterações, descobertas, sincronizações e ações administrativas.
- Proteção contra CSRF, XSS, SQL injection e brute force.
- Rate limiting na API.
- Validação de todos os inputs com schemas.
- Isolamento dos workers de descoberta.
- Allowlist de destinos e portas quando possível.
- Sem execução arbitrária de comandos através da interface.
- Rotação e revogação de credenciais.
- Backups cifrados da base de dados.
- Separação de ambientes de desenvolvimento, testes e produção.

## 8. Linha cronológica de desenvolvimento

### Fase 0 — Decisões e preparação

1. Confirmar inventário inicial, sites, bastidores, equipamentos e subnets.
2. Definir nomes, estados e tipos oficiais dos ativos.
3. Definir grupos LDAP e roles da aplicação.
4. Definir requisitos de conectividade ao LDAP/LDAPS.
5. Escolher o repositório Git e o método de deployment.
6. Criar o `README`, regras de contribuição, ficheiro `.env.example` e documentação de arquitetura.

### Fase 1 — Esqueleto técnico

1. Criar monorepo ou estrutura organizada de frontend, backend e workers.
2. Configurar Next.js, TypeScript, Tailwind e shadcn/ui.
3. Configurar NestJS, PostgreSQL, Prisma e migrações.
4. Criar Docker Compose com frontend, API, PostgreSQL, Redis e Keycloak.
5. Criar health checks, logging e tratamento de erros.
6. Criar layout autenticado, navegação lateral, cabeçalho, breadcrumbs e tema visual.
7. Criar documentação OpenAPI.

Resultado: aplicação arranca localmente, tem layout moderno, base de dados, API e ambiente de autenticação preparado.

### Fase 2 — Autenticação e segurança base

1. Configurar Keycloak.
2. Configurar ligação do Keycloak ao LDAP através de LDAPS.
3. Validar certificados e cadeia de confiança.
4. Criar realm, client OIDC, grupos e roles.
5. Implementar login, logout, refresh e expiração de sessão.
6. Implementar guards no backend.
7. Criar auditoria e página de administração de permissões.

Resultado: apenas utilizadores LDAP autorizados acedem à aplicação.

### Fase 3 — Dashboard e portal interno

1. Criar dashboard com cards de resumo.
2. Criar gráficos mockados.
3. Criar página de links para BookStack, Zabbix, Zammad, Rocket.Chat e Ansible.
4. Aplicar visibilidade por grupo/role.
5. Criar estados de saúde das integrações.

Resultado: primeira versão navegável e útil mesmo sem discovery.

### Fase 4 — IPAM, subnets e VLANs

1. Implementar CRUD de sites, subnets, VLANs e IPs.
2. Implementar pesquisa, filtros e paginação.
3. Criar cálculo e validação de CIDR.
4. Mostrar utilização da subnet e IPs livres.
5. Associar IPs a hosts, interfaces, MACs e VLANs.
6. Registar fonte, confiança e data de atualização dos dados.
7. Criar importação CSV/JSON controlada.

Resultado: IPAM funcional e independente de descoberta automática.

### Fase 5 — Inventário de equipamentos e switches

1. Implementar tipos, fabricantes, modelos e equipamentos.
2. Criar templates visuais de switches.
3. Criar editor/configurador de portas.
4. Criar vista do switch com portas clicáveis.
5. Associar interfaces a VLANs, IPs, MACs e ligações.
6. Criar histórico de alterações manuais.

Resultado: navegação visual entre switch, porta, VLAN e hosts.

### Fase 6 — Bastidores e infraestrutura física

1. Implementar sites, edifícios, salas e bastidores.
2. Criar vista frontal do bastidor.
3. Posicionar equipamentos por unidade U.
4. Permitir arrastar e editar posições com validação de conflitos.
5. Criar ficha completa de ativo.
6. Adicionar ligações físicas e lógicas.

Resultado: inventário físico e lógico relacionado.

### Fase 7 — Descoberta ICMP e TCP

1. Criar perfis de descoberta por subnet.
2. Criar workers assíncronos.
3. Implementar ICMP.
4. Implementar TCP com portas configuráveis.
5. Integrar reverse DNS.
6. Criar página de progresso e resultados.
7. Permitir aprovar, associar, ignorar ou marcar resultados.
8. Guardar histórico de cada execução.

Resultado: identificação de hosts ativos sem obrigar a que todos sejam automaticamente inventariados.

### Fase 8 — SNMP e sincronização de rede

1. Implementar cofres de credenciais.
2. Suportar SNMPv3 e SNMPv2c quando necessário.
3. Criar perfis por fabricante/modelo.
4. Recolher sysName, sysDescr, uptime, interfaces, estado e tráfego.
5. Recolher MAC address tables e informação de VLAN quando suportado.
6. Criar sincronização manual e agendada.
7. Comparar estado descoberto com estado documentado.
8. Apresentar divergências para aprovação.

Resultado: inventário enriquecido e sincronizado com equipamentos reais.

### Fase 9 — Agentes Windows/Linux

1. Definir protocolo e formato de relatório.
2. Criar registo seguro de agentes.
3. Criar agente Windows.
4. Criar agente Linux.
5. Implementar TLS, heartbeat e atualização de versão.
6. Recolher OS, uptime, hardware, discos, serviços e software.
7. Adicionar virtualização e máquinas virtuais.
8. Criar estado de saúde dos agentes.

Resultado: inventário detalhado dos servidores.

### Fase 10 — NetApp e integrações avançadas

1. Integrar API NetApp.
2. Mostrar clusters, volumes, capacidade, snapshots e licenciamento.
3. Integrar API do Zabbix para links e estado.
4. Integrar Ansible para jobs controlados.
5. Associar incidentes do Zammad aos ativos.
6. Associar documentação BookStack aos equipamentos e serviços.

Resultado: plataforma central integrada com as ferramentas existentes.

### Fase 11 — Estatísticas, qualidade e produção

1. Criar gráficos históricos de utilização, disponibilidade e alterações.
2. Criar indicadores de qualidade do inventário.
3. Detetar IPs duplicados, ativos sem localização e dados desatualizados.
4. Criar exports CSV/JSON/PDF quando necessário.
5. Criar backups e testes de restauro.
6. Executar testes unitários, integração, segurança e carga.
7. Criar pipeline CI/CD.
8. Publicar deployment de produção com reverse proxy, TLS e monitorização.
9. Criar manual de operação e plano de recuperação.

## 9. MVP recomendado

O primeiro MVP deverá incluir:

- Login via Keycloak federado com LDAP/LDAPS.
- Dashboard.
- Gestão manual de equipamentos.
- Gestão de VLANs, subnets e IPs.
- Templates visuais de switches.
- Portas clicáveis.
- Associação porta → VLAN → hosts.
- Descoberta ICMP/TCP.
- Portal de links internos.
- Auditoria básica.

SNMP, bastidores avançados, agentes e NetApp deverão ser implementados depois de o modelo de dados e o fluxo manual estarem estáveis.

## 10. Critérios de conclusão da versão final

A aplicação será considerada funcional quando:

1. Um utilizador LDAP autorizado conseguir iniciar sessão através de LDAPS.
2. Um administrador conseguir criar sites, bastidores, equipamentos, VLANs, subnets e IPs.
3. Um operador conseguir abrir um switch, selecionar uma porta e consultar a configuração associada.
4. A seleção de uma VLAN mostrar os hosts, IPs, interfaces e equipamentos relacionados.
5. Uma subnet puder ser analisada por ICMP e TCP.
6. Os resultados de discovery puderem ser revistos antes de entrarem no inventário oficial.
7. Um equipamento puder ser localizado visualmente num bastidor.
8. Um servidor com agente puder apresentar sistema operativo, uptime, recursos, discos e VMs.
9. Uma NetApp puder apresentar capacidade, volumes, estado e licenciamento através da API apropriada.
10. As ações administrativas ficarem registadas em auditoria.
11. As aplicações internas puderem ser acedidas a partir do portal.
12. A plataforma puder ser instalada e atualizada de forma reprodutível através de containers e documentação técnica.

## 11. Estado atual — componente SNMP

O SNMP foi preparado como componente autónomo em `apps/snmp`, separado da API e executável num container próprio. A API funciona como control plane e publica no BullMQ apenas contratos versionados com UUIDs; polling, traps e SET são executados no data plane SNMP.

Um agente executado diretamente no host publica no PostgreSQL as interfaces IPv4 reais do sistema operativo. Um ADMIN pode selecionar em `Definições → SNMP` escuta em todas as interfaces ou em vários IPs do host; a configuração é auditada e o agente reconcilia os bindings Docker UDP/162 em até 30 segundos. As interfaces internas do namespace do container não são apresentadas. O receiver permanece não-root no container e escuta em UDP/1162 através do ingress publicado pelo Docker.

Funcionalidades implementadas:

- Credenciais exclusivas por equipamento e finalidade (`READ`, `WRITE`, `TRAP`), cifradas por envelope AES-256-GCM com keyring montado como Docker secret.
- SNMPv2c e SNMPv3 `authPriv`, com SHA-256/AES-128 por defeito e SHA-1 apenas por compatibilidade explícita.
- Polling manual e agendado, com leitura de system/IF-MIB/IF-X-MIB, snapshots separados do inventário manual e divergências para revisão.
- Receiver de traps/informs em UDP/1162 interno, publicado como UDP/162, com autorização, associação ao equipamento, retenção de 90 dias, recuperação após falha de Redis e normalização dos eventos standard.
- Templates SET para estado administrativo da porta e `sysName`/`sysLocation`, protegidos por `ADMIN`, credencial de escrita, preflight e verificação posterior.
- Health/readiness, métricas, locks por equipamento, logging com redaction e UI SNMP por equipamento.
- Migração validada de raiz, imagem Docker construída e arrancada sem root, e integração controlada validada para GET/SET/traps/informs SNMPv2c e SNMPv3.

`SNMP_SET_ENABLED` permanece `false`. Não deve ser ativado antes de testes com equipamentos/simuladores controlados e revisão de segurança. A próxima etapa funcional é validar polling e traps em laboratório e, depois, acrescentar BRIDGE-MIB/Q-BRIDGE-MIB e perfis por fabricante.

## 12. Princípios de desenvolvimento

- Desenvolver primeiro o modelo de dados e os contratos da API.
- Manter separadas a informação manual, descoberta e sincronizada.
- Nunca apagar silenciosamente informação obtida anteriormente.
- Guardar histórico de alterações importantes.
- Tornar todos os conectores opcionais e substituíveis.
- Usar jobs assíncronos para discovery e sincronização.
- Garantir funcionamento útil mesmo sem SNMP ou agentes.
- Privilegiar SNMPv3, LDAPS, TLS e princípio do menor privilégio.
- Manter a interface simples para operações frequentes e detalhada para investigação.
- Não transformar a aplicação num substituto integral de Zabbix, Ansible, BookStack ou Zammad.

## 13. Clarificação do objetivo operacional

O objetivo principal da aplicação é ser um mapa operacional moderno da infraestrutura do Centro, permitindo navegar pelas relações físicas e lógicas e não apenas consultar estatísticas.

Os fluxos prioritários são:

1. Abrir um modelo visual de switch, selecionar uma porta como `Ethernet1/1`, consultar a configuração da porta — por exemplo `access/trunk`, VLAN nativa, VLANs permitidas e estado — e navegar para as VLANs associadas.
2. A partir de uma VLAN, consultar os hosts dessa VLAN por endereço IP ou hostname, mantendo as relações entre VLAN, subnet, IP, host, interface e equipamento.
3. Representar sites, edifícios, salas e bastidores visualmente, posicionar servidores, switches, routers, firewalls, storage e NetApp e abrir a ficha técnica de cada ativo.
4. Enriquecer a ficha de servidores através de agentes Windows/Linux com sistema operativo, uptime, recursos, discos, serviços, software e máquinas virtuais.
5. Enriquecer storage NetApp através da API oficial com capacidade, volumes, estado, número de série, firmware, licenciamento e snapshots.
6. Usar SNMP/SNMPv3 e conectores específicos para enriquecer o inventário, sem substituir o registo manual inicial.
7. Permitir discovery ICMP/TCP por subnet como resultado pendente para revisão do operador, nunca como criação automática de ativos oficiais.

O dashboard deve ser um ponto de entrada operacional e apresentar dados reais do inventário e da auditoria. Não deve ser tratado como a funcionalidade central: os fluxos de navegação switch → porta → VLAN → subnet → IP → host e bastidor → equipamento → serviços têm prioridade sobre gráficos decorativos.

O portal de aplicações internas é um catálogo de atalhos para BookStack, Zabbix, Zammad, Rocket.Chat e Ansible. Cada ligação deve abrir num novo separador; a gestão dinâmica por administradores é opcional e não deve desviar o foco dos fluxos de infraestrutura.

## 14. Onboarding inicial multi-organização

Na primeira execução, a aplicação não deve assumir que existe um site ou uma organização pré-definida. Depois do login, um utilizador com a role `ADMIN` deve passar por um walkthrough inicial que:

1. Recolhe o nome, código e fuso horário da organização.
2. Cria pelo menos um site com código único.
3. Permite registar opcionalmente morada, cidade, região, país, edifício, sala e primeiro bastidor.
4. Só permite entrar no dashboard depois de existir organização e pelo menos um site.

O estado deste setup deve ser persistido em `SystemSettings`, auditado e reabrível por um administrador. Não devem ser criados equipamentos, VLANs, subnets ou outros dados fictícios durante o onboarding. A configuração física e o inventário detalhado serão preenchidos nos módulos seguintes.

## 15. Regras da Fase 4 — IPAM e discovery

O IPAM é a primeira funcionalidade operacional central. Os dados oficiais devem seguir a relação `Site → VLAN → Subnet → IP → Host`, permitindo mais tarde navegar da porta de um switch para a VLAN e respetivos hosts.

- Sites, VLANs, subnets e IPs podem ser registados manualmente.
- A primeira implementação valida CIDR IPv4 e limita VLAN IDs ao intervalo 1–4094.
- Discovery ICMP/TCP é sempre lançado contra uma subnet escolhida pelo operador.
- TCP usa portas configuráveis; reverse DNS é uma informação complementar.
- Cada execução fica registada como `DiscoveryJob` e cada host como `DiscoveryResult`.
- Resultados começam em `PENDING`; só `APPROVED` pode criar/atualizar um IP oficial.
- Resultados `IGNORED` permanecem no histórico e não alteram o inventário.
- A descoberta tem limite inicial de 4096 hosts por execução e é processada por workers BullMQ; retries, métricas e agendamento ficam para o próximo incremento.
- SNMP, interfaces de switch e agentes deverão enriquecer estas relações sem substituir o registo manual.

## 16. Registo histórico — estado e backlog

### Implementado na Fase 4 inicial

- CRUD base de Sites, VLANs, Subnets e IPs.
- Validação e normalização de CIDR IPv4.
- Estados de IP e origem dos dados.
- `DiscoveryJob` e `DiscoveryResult` persistentes.
- Discovery ICMP/TCP limitado e configurável por subnet/portas.
- Discovery colocado numa fila BullMQ `discovery` sobre Redis 8, processado por worker separado.
- Reverse DNS best effort.
- Revisão manual com aprovação ou ignorar.
- Aprovação a criar/atualizar o IP oficial.
- Página IPAM em `/ipam`.
- IPAM com paginação, filtros por pesquisa/estado e ações de criação, edição e remoção de IPs.
- Entidades `Host` e `Service`; resultados aprovados promovem IP → Host e portas TCP abertas → Services.
- Sidebar fixo/sticky, recolhível por clique e expansível por hover, com estado persistente no browser.
- Sidebar partilhado nas áreas autenticadas e dropdown de utilizador com acesso a definições, ajuda e logout.
- Menus principais com rotas funcionais para infraestrutura, IPAM, descoberta, auditoria, definições e ajuda.
- Pesquisa do dashboard ligada a Sites, VLANs, Subnets e IPs reais.
- Endpoint e página de auditoria com eventos recentes.

### Atualização UX — workspace IPAM e shell global

- O IPAM usa agora uma workspace contextual com árvore navegável `Site → VLAN → Subnet`.
- A seleção é refletida por breadcrumbs, URL (`siteId`, `vlanId`, `subnetId`, `tab`) e tabs de Resumo, IPs, Hosts e serviços, Discovery e Detalhes.
- Criação e edição de Sites, VLANs e Subnets usam formulários modais; criação/edição de IPs usa o mesmo padrão.
- A tabela de IPs apresenta estado legível, hostname/host, MAC, VLAN, origem, serviços, pesquisa e paginação.
- Discovery tem área própria e distingue inventário oficial de resultados pendentes; resultados podem ser aprovados ou ignorados.
- O dashboard e as páginas internas usam exclusivamente `AppShell`.
- O sidebar é um rail fixo ao viewport, com largura aberta/recolhida persistida, expansão por hover e drawer mobile.
- O conteúdo operacional ocupa a largura disponível sem os limites artificiais anteriores.

### Atualização — menus funcionais e infraestrutura operacional

- O dashboard deixou de usar âncoras sem destino; ações rápidas apontam para Discovery, Infraestrutura, IPAM, Ajuda e Auditoria.
- `/descoberta` passou a ser uma consola operacional com execuções, resultados e revisão manual, mantendo o Discovery contextual no IPAM.
- `/infraestrutura` passou a listar, pesquisar, criar, editar e arquivar equipamentos e a consultar modelos.
- A API passou a expor equipamentos, modelos e interfaces; interfaces suportam VLAN nativa, VLAN de acesso e VLANs permitidas através de relação normalizada.
- `/definicoes` passou a consultar/editar organização para ADMIN, mostrar sessão/roles e estado das integrações.
- `/ajuda` passou a disponibilizar artigos internos para arranque, IPAM, Discovery, equipamentos, operação e troubleshooting.
- LDAP/LDAPS, SNMP, agentes e NetApp continuam planeados. Bastidores visuais, diagramas frontais de switches e configuração manual de portas já têm uma primeira versão operacional.

### Próxima ordem de implementação (histórica)

Esta lista foi executada parcialmente e é substituída pelo roadmap consolidado no final deste documento. Permanecem relevantes a gestão visual de Hosts/Services, o reforço do histórico operacional e a integração SNMP; o suporte IPv6, o CRUD de infraestrutura, o agendamento de discovery e a navegação visual de switches já têm uma base funcional.

### Atualização — catálogo físico, switch visual e discovery periódico

- O Prisma passou a prever `RackModel`, `AssetFile`, assets frontal/traseiro/ícone em `DeviceModel`, `portKey` em interfaces e `DiscoverySchedule` por subnet.
- A API expõe catálogo de assets, modelos de bastidor, bastidores e schedules de discovery.
- Assets manuais são guardados em `data/assets`, com suporte a SVG, PNG e WebP e referência de licença/fonte.
- A infraestrutura permite selecionar um equipamento, carregar as interfaces e abrir um diagrama visual fallback das portas.
- Portas mostram estado, modo, VLAN access/native, VLANs permitidas e links para o IPAM.
- Novas subnets recusam uma segunda associação à mesma VLAN; VLANs sem subnet continuam permitidas durante a configuração.
- O auto-discovery é opt-in, configurado por subnet e agendado a cada 12 horas através de BullMQ.
- Discovery agendado continua a criar resultados pendentes; não promove automaticamente inventário oficial.
- Bastidores visuais completos, edição de layouts de portas, ligação de assets a modelos e CRUD visual de racks permanecem como incrementos seguintes.

### Atualização — infraestrutura centrada em bastidores

- `/infraestrutura` abre agora pela vista física `Site → Bastidores → Equipamentos`.
- Com um único Site, este é selecionado automaticamente; com vários Sites, o utilizador escolhe explicitamente o contexto.
- A vista de bastidores mostra unidades U, equipamentos posicionados, ocupação e localização física.
- Equipamentos podem ser criados diretamente no Site e associados a um bastidor/unidade U.
- A API valida limites U, pertença do rack ao Site e sobreposição de equipamentos.
- `DeviceModel` tem agora `supportsNetworkPorts`, `networkPortCount` e layouts de portas; `DeviceInterface` tem `interfaceType`.
- Switches, routers e firewalls do catálogo são modelos com portas de rede; servidores e storage ficam sem layout por defeito.
- O catálogo base foi importado com 27 modelos de equipamentos e 4 modelos de bastidores.
- O seed pode ser repetido através de `npm.cmd run db:seed` sem criar duplicados.
- A navegação de infraestrutura está organizada em Bastidores, Equipamentos, Modelos, Interfaces e Assets.

Não avançar ainda para agentes, NetApp ou gráficos avançados antes de estabilizar estas relações IPAM e o fluxo de aprovação de discovery.

### Atualização — bastidor visual por U e IPAM orientado a VLANs

- `/infraestrutura` usa `apps/web/public/assets/rack-empty-42u.png` como fallback de rack vazio.
- Overlays respeitam `rackUnitStart` e `rackUnitSize`, com precedência equipamento → modelo → fallback.
- A infraestrutura disponibiliza edição de racks, equipamentos, modelos e associação de assets.
- `/ipam` mostra diretamente as VLANs do Site através de `GET /api/v1/sites/:siteId/network-map`.
- Cada VLAN mostra subnet principal, IPs, equipamentos/interfaces e estado de configuração.
- A subnet principal pode ser criada diretamente no cartão da VLAN; a regra de uma subnet por VLAN mantém-se.

### Atualização — navegação Site → Sala → Bastidores

- A infraestrutura segue `Site → Edifício → Sala → Bastidores → Equipamentos → VLAN/IPAM`.
- Administradores e SYSTEMS_OPERATOR podem criar edifícios e salas em `/infraestrutura`, com auditoria.
- Os bastidores da sala selecionada aparecem lado a lado num grid responsivo.
- Selecionar um bastidor entra numa vista de zoom com unidades U e equipamentos posicionados.
- `Voltar aos bastidores` repõe a grelha da sala; `siteId`, `roomId`, `rackId` e `tab` ficam na URL.
- Um Site sem localização apresenta uma ação guiada para criar primeiro o edifício e depois a sala.
- O Site ativo é selecionado no sidebar através da API, persistido em `localStorage` e sobreposto por `siteId` na URL.
- O sidebar recolhido usa um rail estável com expansão por overlay; username, roles e logout ficam no sidebar.
- Definições usa tabs próprias com `?tab=` e Ajuda usa cartões/artigos com navegação responsiva.
- Racks e equipamentos suportam assets específicos que têm prioridade sobre os assets do modelo.
- Discovery só cria resultados para endereços alcançáveis por ICMP ou com portas TCP abertas; reverse DNS é aplicado apenas nesses candidatos.
- Jobs de discovery registam endereços analisados, alcançáveis, inacessíveis e resultados pendentes.

## Incremento — IPAM completo IPv4/IPv6

Estado: base de dados e API implementadas; UI operacional inicial.

- Subnets suportam IPv4/IPv6, VRF opcional, subnet pai, gateway, validação de sobreposição e uma subnet principal por VLAN.
- IPs guardam estado manual e observado, última verificação, ICMP/TCP, latência, portas abertas e reverse DNS quando disponível.
- Foram adicionados CRUD de VRFs, NAT documental e grupos/permissões IPAM por Site, VRF, VLAN e Subnet.
- A calculadora suporta resumo, contains, overlap e split IPv4 sem enumerar prefixos IPv6 grandes.
- Scanning por subnet é opt-in, usa BullMQ/Redis e intervalo de 12 horas; IPv6 só deve ser verificado para endereços explicitamente conhecidos.
- Importação RIPEstat é manual, com preview, seleção de prefixos, confirmação e histórico persistido em `RipeImport`.
- `/ipam` tem tabs para Mapa, Subnets, IPs, VRFs, NAT, Calculadora, Permissões, Discovery e Importações.

Limitações: a UI ainda precisa de completar drawers de edição de IPs, configuração visual de scanning e seleção multi-prefixo RIPE; o enforcement granular de scopes será reforçado antes de produção.

### Correção UX/IPAM — fluxo mapa → VLAN → subnet → IPs

- `/ipam` abre sempre no Mapa e mostra um estado vazio acionável quando o Site não tem VLANs.
- O Site é escolhido num seletor contextual único, com nome e contadores legíveis.
- A criação de subnet limpa sempre o `vlanId` anterior e permite escolher explicitamente a VLAN atual.
- Calculadora inclui agora prefixo destino para `split` e serializa corretamente capacidade IPv6.
- RIPE tem preview, seleção individual de prefixos e confirmação de importação na interface.
- A tab global de IPs foi removida; os endereços são carregados dentro da subnet selecionada, com máximo inicial de 250 registos.

### Incremento — infraestrutura visual e interfaces operacionais

- `/infraestrutura` usa uma workspace centrada em Site → Sala → Bastidor → Equipamento.
- Os bastidores aparecem lado a lado com imagem frontal real quando existe asset associado; o detalhe usa overlays dimensionados por `rackUnitStart` e `rackUnitSize`.
- O upload raster é comprimido no browser para WebP até 1600px antes do envio; SVG mantém-se vetorial.
- O asset local de referência do Cisco C9300 foi removido para validar o fluxo de upload pelo browser.
- A tab Interfaces seleciona primeiro um equipamento de rede e depois uma interface; a configuração inclui access VLAN, VLAN nativa, VLANs permitidas e subnets derivadas.
- Equipamentos associados a bastidores passam automaticamente a `ACTIVE`, exceto equipamentos `RETIRED`.
- Equipamentos suportam `managementIp` e associação opcional a um registo `IpAddress` através de `managementIpAddressId`.

### Incremento — editor visual de portas e inventário operacional

- A sala mostra bastidores como figuras independentes, sem o antigo container visual; o detalhe mantém overlays posicionados por área útil e unidades U.
- Modelos de rede têm fluxo `Mapear portas`: upload de imagem, proposta de grelha, edição manual de label/portKey/tipo/coordenadas e confirmação explícita.
- A API expõe deteção não persistida, associação de imagem frontal e geração de interfaces em falta.
- A tab Interfaces começa por equipamentos de rede ativos; a configuração de cada porta inclui VLAN access, VLAN native, VLANs permitidas e subnet derivada.
- A tab Equipamentos apresenta o inventário ativo do Site, com pesquisa, localização, IP de gestão e edição rápida.
- Os derivados antigos `c9300.webp` foram removidos; a imagem original autorizada foi guardada como `Cisco-Catalyst-9300-front.png` e associada ao modelo Cisco Catalyst 9300.

### Estado atual — precisão visual de portas e bastidor

- O mapeamento de portas permite mover hotspots por drag com Pointer Events e redimensioná-los através de um handle no canto inferior direito.
- O botão `Mapear portas` está integrado num catálogo com ações em linha e largura responsiva.
- O detalhe do rack usa o asset vazio interno `apps/web/public/assets/rack-empty-42u.png` como fundo de palco completo.
- A visualização dos equipamentos no rack segue a precedência equipamento → modelo → fallback, permitindo ver a face/porta do ativo quando existe imagem associada.

### Estado atual — detalhe operacional no rack

- A confirmação do mapeamento de portas valida e normaliza o template antes do `PATCH`, mantendo o erro visível no próprio modal.
- O hover dos overlays mostra hostname e IP de gestão.
- O clique num equipamento faz zoom lógico para uma ficha ampliada com imagem, marca, modelo, S/N, estado, posição U e portas.
- Uptime permanece explicitamente dependente de SNMP/agente e não é inventado pela aplicação.

### Estado atual — fluxo operacional de infraestrutura

- O contexto de infraestrutura segue Site → Sala → Bastidores, com criação de salas no edifício selecionado.
- A grelha de bastidores usa sempre a imagem default de rack quando não existe asset específico.
- O duplo clique numa tab ativa limpa as seleções e regressa ao estado inicial da tab.
- Interfaces são ordenadas naturalmente por prefixo e números de porta.
- O zoom interno do equipamento mostra imagem, hotspots, configuração de portas, VLAN/subnet, modelo, marca, S/N, asset tag e localização.

### Estado atual — contexto Site → Edifício → Sala

- A infraestrutura apresenta três seletores dependentes: Site, Edifício e Sala.
- Administradores e operadores autorizados podem criar edifícios e salas sem sair da infraestrutura.
- A criação de sala usa um modal dedicado e não abre o editor de modelos.
- Bastidores e equipamentos mantêm o contexto na URL através de `siteId`, `buildingId`, `roomId` e `rackId`.
- Os modos ACCESS, TRUNK e ROUTED controlam quais campos de VLAN aparecem; valores vazios são enviados como `null`.

### Correção de UX — bastidor e zoom de equipamento

- Sem Edifício, Sala ou Bastidor selecionado, a infraestrutura não deve assumir uma localização nem mostrar o conteúdo de um bastidor.
- A área útil visual default do rack deve corresponder à abertura física da imagem, aproximadamente `left=.27`, `top=.14`, `width=.51`, `height=.81`; modelos com viewport própria têm prioridade.
- O clique num equipamento abre um zoom local dentro do palco do bastidor, sem navegação para uma página de interfaces.
- As portas mapeadas aparecem sobre a imagem do dispositivo e mostram a configuração apenas em hover/focus.
- O painel lateral do zoom mostra hostname, IP de gestão e o link para a ficha completa; uptime continua dependente de SNMP/agente.

### Correção — seleção explícita e frame visual de portas

- As salas só são disponibilizadas depois da seleção de um Edifício; sem contexto a vista mostra placeholders e não assume uma sala.
- O zoom de equipamento é um overlay no palco do rack, com o rack desfocado atrás, fecho por clique exterior/Escape e ligação explícita para a ficha completa.
- Os hotspots usam um frame com o mesmo aspect ratio de `imageWidth`/`imageHeight` do `portLayout`, preservando as coordenadas confirmadas.

## 17. Estado consolidado e roadmap histórico — 25 de agosto de 2026

Esta secção regista o estado e as prioridades em 25 de agosto de 2026. Para o estado e prioridades atuais, prevalecem as secções 20 e 21; algumas tarefas aqui descritas foram entretanto concluídas ou substituídas.

### 17.1 Resultado já entregue

- Base técnica: monorepo npm, Next.js, NestJS, PostgreSQL/Prisma, Redis/BullMQ, Keycloak, Swagger, validação global, rate limiting, headers de segurança e auditoria.
- Acesso: login OIDC, refresh/logout, roles da aplicação, sincronização do utilizador autenticado e onboarding inicial de organização/Site.
- IPAM: Sites, VLANs, subnets IPv4/IPv6, IPs, VRFs, NAT documental, calculadora CIDR, importação RIPE assistida, pesquisa/paginação e checks manuais/agendados.
- Discovery: ICMP/TCP, reverse DNS, worker separado, schedules opt-in, métricas de execução e revisão explícita antes de promover resultados para o inventário oficial.
- Infraestrutura: `Site → Edifício → Sala → Bastidor 42U → Equipamento`, validação de ocupação, catálogo de modelos/assets, imagens frontais, zoom local e inventário pesquisável.
- Rede manual: modelos com portas, editor visual de hotspots, geração aditiva de interfaces e configuração ACCESS/TRUNK/ROUTED com VLAN access, native e allowed.
- Portal e operação: links internos por role, dashboard com dados reais, pesquisa global, página de auditoria, ajuda e definições.

### 17.2 Incremento em validação antes de ser considerado concluído

- Nova área de Definições para organização, Sites, utilizadores/roles do Keycloak, defaults de Discovery e política de retenção da auditoria.
- Idioma persistido por organização (`pt-PT`/`en-US`) e infraestrutura inicial de traduções no frontend.
- Client confidencial dedicado do Keycloak, com service account limitada a `manage-users`, para listar utilizadores e alterar apenas roles da aplicação.
- Limpeza diária da auditoria por uma fila BullMQ `maintenance`, respeitando a retenção configurada.
- Defaults de métodos, portas TCP, reverse DNS e intervalo aplicados apenas a novos jobs/schedules, sem alterar silenciosamente configurações existentes.

Critério para fechar este incremento: migração aplicada num ambiente limpo e num ambiente com dados, testes e builds verdes, provisionamento Keycloak validado, e teste manual com ADMIN/AUDITOR/READ_ONLY incluindo perda e recuperação temporária de Redis/Keycloak.

### 17.3 Problema prioritário à data

A plataforma já permite documentar os elementos separadamente, mas o percurso operacional principal ainda não está completamente fechado numa experiência única. Um operador deve conseguir partir de uma porta, abrir a VLAN, ver subnets e IPs, identificar o Host/Service e regressar ao equipamento sem perder o contexto. A próxima entrega deve otimizar este resultado, em vez de acrescentar domínios novos.

### 17.4 Roadmap Now / Next / Later

#### Now — estabilizar e fechar o núcleo manual

1. **Concluir e validar Definições operacionais.** Owner: engenharia. Métrica: migração, testes API e builds API/web verdes; 100% dos fluxos de roles auditados; nenhuma role da aplicação removível ao último ADMIN.
2. **Fechar a navegação porta → VLAN → subnet → IP → Host/Service.** Owner: produto + frontend/backend. Métrica: o percurso completo executa-se sem pesquisa manual paralela e preserva `siteId`, entidade selecionada e ação de retorno.
3. **Ficha operacional de Host e Service.** Incluir CRUD coerente, IPs, portas/serviços, origem, última observação, equipamento/interface relacionados e distinção entre estado manual e observado. Métrica: um resultado aprovado de Discovery fica consultável e editável no mesmo fluxo do IPAM.
4. **Qualidade e segurança do núcleo.** Cobrir RBAC por endpoint e scopes IPAM, validação de destinos de Discovery, erros consistentes, testes de integração dos fluxos críticos e histórico das alterações de interfaces/IPs. Métrica: zero falhas críticas conhecidas e matriz de permissões automatizada antes de piloto.
5. **Piloto com dados reais manuais.** Carregar um Site, uma sala, pelo menos um rack, um switch, VLANs/subnets e uma amostra de hosts. Métrica: cinco tarefas operacionais representativas concluídas por operadores sem intervenção técnica; registar tempo, erros e lacunas.

#### Next — autenticação empresarial e sincronização de rede read-only

1. **Keycloak federado com LDAP/LDAPS.** Definir grupos→roles, truststore/certificados, política de sincronização e conta break-glass local. Métrica: login, remoção de acesso e alteração de grupo refletidos e auditados no ambiente piloto.
2. **Cofre e perfis de credenciais.** Antes de SNMP, implementar encriptação em repouso, rotação, teste de conectividade, separação read/write e auditoria sem exposição de secrets.
3. **SNMPv3 read-only MVP.** Recolher identidade, uptime, interfaces, admin/oper status, velocidade e contadores. A sincronização deve guardar observações separadas dos dados manuais e apresentar diferenças para aprovação. Métrica: sincronização bem-sucedida e repetível nos modelos do piloto, sem sobrescrita silenciosa.
4. **MAC address table e reconciliação.** Relacionar MAC → interface → VLAN → IP/Host com confiança e timestamp. Métrica: localizar um host do piloto a partir do IP ou MAC até à porta física.
5. **Saúde e qualidade do inventário.** Indicadores acionáveis para dados desatualizados, IPs duplicados, ativos sem localização/modelo/IP de gestão e falhas de sincronização; evitar gráficos decorativos sem ação associada.

#### Later — enriquecimento de sistemas e integrações

1. Agente Linux e depois Windows, outbound sobre TLS, começando por identidade, OS, uptime, hardware, discos e heartbeat; serviços/software/VMs entram após estabilizar o contrato.
2. Integração NetApp pela API oficial para clusters, capacidade, volumes, snapshots, estado, firmware e licenciamento.
3. Ligações físicas entre equipamentos, patch panels, cablagem e vista traseira dos bastidores.
4. Integrações contextuais com Zabbix, Ansible, BookStack e Zammad a partir das fichas dos ativos.
5. Exports, backups/restauro testados, observabilidade da própria plataforma, CI/CD, testes de carga e hardening de produção.

### 17.5 Fora de âmbito por agora

- Execução arbitrária de comandos, configuração automática de switches ou escrita SNMP.
- Substituir Zabbix, Ansible, BookStack ou Zammad.
- Agentes, NetApp e gráficos históricos avançados antes de o fluxo manual e o piloto estarem validados.
- Drag-and-drop horizontal livre dentro do rack ou vista traseira antes de existir evidência operacional que justifique a complexidade.

### 17.6 Métrica de produto recomendada

**North Star:** percentagem de ativos ativos com localização física, IP de gestão e relações de rede suficientes para navegar do equipamento até ao Host/Service associado.

Métricas de apoio:

- percentagem de subnets com inventário revisto nos últimos 30 dias;
- percentagem de resultados de Discovery revistos dentro de 48 horas;
- percentagem de interfaces de rede com modo e VLAN documentados;
- número de inconsistências manuais versus observadas por resolver;
- tempo mediano para localizar fisicamente um host a partir de IP, hostname ou MAC;
- taxa de sucesso dos jobs de Discovery e, posteriormente, das sincronizações SNMP.

Os valores de referência devem ser recolhidos no piloto. Não devem ser inventados targets antes de existir uma baseline real.

## 18. Incremento operacional e hardening — 25 de agosto de 2026

Esta secção regista a implementação de 25 de agosto e substituiu então o estado de “Now” da secção 17. As prioridades atuais estão na secção 20.6.

### 18.1 Entregue no backend e na base de dados

- A migração `20260825120000_operational_core_hardening` acrescenta allowlist de Discovery, campos manuais/observados de Host e Service, relação única Device↔Host e garantia PostgreSQL de apenas um job `PENDING`/`RUNNING` por subnet.
- `Host` tem detalhe, filtros, criação/edição, retirada lógica (`RETIRED`) e associação/desassociação explícita de IPs e Device. `Service` tem CRUD auditado e validação de protocolo/porta.
- Aprovar Discovery é transacional, concorrente e idempotente. O processo reutiliza o Host do IP, preserva todos os campos manuais e atualiza apenas observações e `lastSeenAt`.
- `IpamAccessService` centraliza scopes para Sites, VRFs, VLANs, subnets, IPs, Hosts, Services, NAT e Discovery. ADMIN ignora scopes; ausência de permissões scoped conserva o comportamento legado; permissões de grupos formam uma união; escritas em Hosts multi-subnet exigem autorização em todas as subnets.
- Listagens usam filtros Prisma, leituras fora do scope devolvem 404 e mutações fora do scope devolvem 403. A criação/movimentação de subnets valida também a coerência entre Site, VLAN, VRF e subnet pai.
- A API de administração de grupos IPAM permite CRUD, membros locais sincronizados e permissões SITE/VRF/VLAN/SUBNET validadas contra o Site do grupo.
- Discovery só aceita subnets integralmente contidas na allowlist, bloqueia sempre redes especiais, limita 4096 hosts e 64 portas e rejeita enumeração IPv6. O worker recarrega Job, Subnet e política da base e não confia no CIDR da fila.
- Respostas de erro da API são normalizadas como `{ code, message, details? }`; detalhes operacionais de Discovery permanecem nos logs e a base/API guarda apenas um código sanitizado.
- Alterações de roles Keycloak adicionam antes de remover, protegem o último ADMIN, verificam o resultado, compensam falhas, terminam sessões e auditam o diff preservando roles herdadas.

### 18.2 Entregue no frontend

- O percurso visual é `porta → VLAN → subnet → IP → Host → Service`. O popover da porta apresenta VLAN access/native/allowed e respetivas subnets clicáveis.
- O contexto usa `siteId`, `vlanId`, `subnetId`, `hostId`, `fromDeviceId` e `fromInterfaceId`; existe ação explícita para regressar à porta e a infraestrutura restaura Device/interface da URL.
- IPs sem Host oferecem “Criar/associar Host”. A ficha lateral do Host mostra estados manual/observado, origem, último avistamento, SO, MAC, notas, IPs, Sites, VLANs, subnets, Device/localização, interfaces e Services.
- A tab IPAM “Permissões” permite gerir grupos, membros sincronizados e a matriz de scopes/ações.
- Definições permite editar a allowlist de Discovery e mostra o estado sondado de PostgreSQL, Redis/BullMQ e Keycloak. A infraestrutura global de idioma e as traduções da aplicação estão ativas em `pt-PT` e `en-US`, incluindo os módulos operacionais.

### 18.3 Validação executada

- Prisma válido; builds de API e web verdes; testes unitários verdes.
- Migrações aplicadas com sucesso sobre a base local com inventário e, sequencialmente, sobre uma base PostgreSQL temporária vazia. A base temporária foi removida após a validação.
- Client `simoes-settings-admin` provisionado no Keycloak real com service account limitada a `manage-users`.
- Smoke de saúde confirmou API e PostgreSQL operacionais. A matriz manual com ADMIN, NETWORK_OPERATOR scoped/legacy, AUDITOR e READ_ONLY foi concluída posteriormente e está registada na secção 18.4.

### 18.4 Gate concluído — 19 de outubro de 2026

- A matriz manual de permissões foi executada com ADMIN, NETWORK_OPERATOR scoped/legacy, AUDITOR e READ_ONLY.
- Foram acrescentados testes HTTP de integração Nest/Fastify para os fluxos prioritários; a cobertura deve continuar a crescer com cada nova funcionalidade.
- A tradução dos módulos operacionais para `pt-PT` e `en-US` foi concluída.

Estes pontos deixam de bloquear o planeamento funcional. A validação laboratorial SNMP com equipamentos reais permanece um gate próprio do componente SNMP.

## 19. Discovery e onboarding SNMP — 30 de agosto de 2026

- Discovery passa a separar a descoberta ativa ICMP/TCP da descoberta passiva SNMP.
- Um equipamento ainda não inventariado só pode enviar traps através de um pré-registo de 24 horas, limitado a Site, IP exato e credencial TRAP autenticada.
- Apenas ADMIN introduz credenciais; ADMIN e NETWORK_OPERATOR scoped podem converter um candidato num equipamento sem ver o segredo.
- A aceitação cria um equipamento por localizar, associa ou cria o endereço na subnet mais específica do Site e transfere a credencial TRAP sem a duplicar.
- A criação manual de equipamentos pode configurar polling com READ e uma identidade TRAP distinta. WRITE continua fora do onboarding e SET permanece desativado.
- Modelo e imagem passam a ser opcionais; quando não há asset aplicável, a UI usa o ícone genérico do tipo.

O próximo gate permanece a validação laboratorial com equipamentos reais. BRIDGE-MIB, Q-BRIDGE-MIB, MAC/VLAN e perfis de fabricante continuam na segunda etapa.

### 19.1 Autoteste local de traps

- O receiver mantém a associação normal por IP exato. Em desenvolvimento, pode ser ativado um fallback específico para o NAT/hairpin do Docker Desktop através de `SNMP_SELF_TEST_ENABLED` e uma allowlist exata em `SNMP_SELF_TEST_PROXY_SOURCES`.
- O fallback aceita apenas SNMPv3 autenticado, exige um único pré-registo compatível e confirma que o IP esperado é uma interface recente publicada pelo agente do host. O endereço realmente observado pelo container é preservado no evento e o modo permanece desligado por defeito.
- O Docker Desktop pode apresentar a origem local como um IPv4 traduzido não determinístico. A aceitação dessas origens exige `SNMP_SELF_TEST_ALLOW_TRANSLATED_SOURCE=true`, adicional a `SNMP_SELF_TEST_ENABLED`; é exclusiva de desenvolvimento e os eventos ficam marcados como `SELF_TEST`.

## 20. Roadmap funcional recomendado — 19 de outubro de 2026

Esta secção regista o plano antes do incremento da secção 21. O trabalho Now aí previsto foi implementado na branch `joao/feature/operational-dashboard-topology`; o estado atual e as prioridades restantes constam abaixo e na secção 21. Os gates de permissões, testes HTTP iniciais e traduções já não são tratados como funcionalidades pendentes.

### 20.1 Problema de produto que motivou o plano

A plataforma já centraliza inventário, IPAM, discovery, bastidores, relações de rede, auditoria e SNMP. O próximo ganho operacional não vem de adicionar mais um domínio isolado, mas de tornar a informação existente acionável: mostrar o que requer atenção, explicar o impacto e permitir navegar visualmente entre os elementos afetados.

### 20.2 Plano Now original — substituído pela implementação da secção 21

Os itens abaixo registam o âmbito planeado em 19 de outubro. A secção 21 descreve o que foi implementado; a validação manual continua pendente.

1. **Dashboard operacional com alertas em tempo real.** Evoluir os alertas atuais para um centro operacional alimentado por Discovery, SNMP, divergências, serviços internos e qualidade do inventário. Usar SSE para atualização server→browser, com fallback para polling, e suportar severidade, deduplicação, reconhecimento, resolução, silenciamento temporário, filtro por Site e histórico. Cada alerta deve indicar impacto e abrir diretamente a entidade/ação relevante. Não pretende substituir o Zabbix.
   - Métrica: alertas críticos aparecem na interface em menos de 10 segundos e 100% têm origem, Site, entidade afetada e ação recomendada.
   - Primeira entrega: Redis indisponível, Discovery falhado/pendente, traps SNMP relevantes, polling falhado, divergências pendentes e ativos sem dados essenciais.

2. **Dashboard configurável por role e Site.** Substituir estados estáticos por widgets reais de saúde, capacidade e trabalho pendente. Permitir escolher Site, intervalo temporal e widgets visíveis; ADMIN, NETWORK_OPERATOR, SYSTEMS_OPERATOR e AUDITOR devem receber visões coerentes com as respetivas permissões.
   - Métrica: um operador identifica as três ações prioritárias do seu Site sem sair do dashboard.
   - Widgets iniciais: alertas ativos, jobs em execução/falhados, resultados por rever, divergências SNMP, ativos sem localização/IP/modelo e alterações recentes.

3. **Mapa lógico de dispositivos — v1.** Criar uma vista por Site que represente equipamentos e relações já conhecidas, com filtros por tipo, estado, VLAN e localização. O mapa deve abrir a ficha do equipamento e permitir alternar entre camadas lógica e física sem perder contexto.
   - Métrica: localizar um equipamento e navegar para as suas interfaces/VLANs em até três interações.
   - Escopo v1: posições manuais persistidas, agrupamento por sala/rack, ligações documentadas e relações VLAN/subnet; não inferir ligações que a base de dados não conhece.

4. **Fila de qualidade do inventário.** Transformar inconsistências em tarefas operacionais: equipamentos sem localização, modelo ou IP de gestão; interfaces sem modo/VLAN; IPs duplicados; observações desatualizadas; divergências SNMP não revistas.
   - Métrica: cada problema tem entidade, motivo, prioridade, responsável opcional e ação de correção; evolução semanal da dívida de inventário fica mensurável.

### 20.3 Next — topologia observada e automação controlada

1. **Topologia de rede enriquecida por SNMP.** Adicionar LLDP, BRIDGE-MIB e Q-BRIDGE-MIB, tabelas MAC/VLAN e perfis por fabricante. Distinguir sempre ligações documentadas, observadas e confirmadas pelo operador.
   - Métrica: pesquisar um IP ou MAC e chegar ao switch/porta física com confiança e timestamp visíveis.

2. **Reconciliação e aprovação em lote.** Apresentar diferenças entre inventário manual e estado observado, permitindo aceitar, rejeitar ou adiar alterações por entidade e em lote, com preview e auditoria.
   - Métrica: nenhuma observação automática sobrescreve dados oficiais sem política ou aprovação explícita.

3. **Mapas guardados e modos de visualização.** Permitir guardar layouts por Site, sala ou serviço; aplicar filtros e escolher vistas física, L2/VLAN, IP e dependências de serviço. Exportação de imagem/PDF só entra depois de a interação principal estar validada.

4. **Regras de alerta e notificações.** Permitir regras por Site, severidade e tipo de evento, com janelas de manutenção e canais internos. Integrações externas devem começar por webhook/Rocket.Chat ou Zammad e só depois email/SMS, conforme necessidade operacional validada.

5. **Pesquisa operacional expandida.** A pesquisa global deve incluir Host, Service, interface, MAC, rack, eventos e alertas, permitindo partir de IP/hostname/MAC e chegar ao contexto físico e lógico completo.

### 20.4 Later — observabilidade integrada e sistemas

1. Agente Linux e depois Windows para identidade, OS, recursos, discos, heartbeat, serviços, software e VMs.
2. Integração Zabbix para disponibilidade, métricas e deep links, evitando duplicar o motor de monitorização.
3. Integração NetApp pela API oficial e representação de capacidade, volumes, snapshots, estado e licenciamento.
4. Correlação de eventos e dependências para relacionar falhas de equipamento, interfaces, serviços e aplicações afetadas.
5. Ligações físicas completas, patch panels, cablagem e vista traseira dos bastidores.

### 20.5 Fora de âmbito imediato

- Motor próprio de métricas históricas equivalente ao Zabbix.
- Configuração automática de switches ou SNMP SET em produção.
- Topologia inferida apresentada como verdade sem confiança, fonte e confirmação.
- Mapas 3D, animações decorativas ou personalização avançada antes de validar o mapa 2D operacional.
- Alertas sem ação associada ou notificações externas sem deduplicação e controlo de ruído.

### 20.6 Prioridades restantes e dependências

1. **✅ Corrigir os três bloqueios P2 confirmados na revisão de QA/diff.** (a) A falha Redis Pub/Sub já encerra o stream SSE afetado e permite o fallback de polling. (b) A atualização isolada de uma ligação incrementa agora as revisões dos mapas associados. (c) O resumo calcula entidades inválidas pelos dispositivos distintos com findings, sem sobrecontagem por entidade. As três correções estão no commit da branch referido na secção 21.
2. **✅ Executar e registar as verificações automatizadas.** API: 74 testes passaram; web: 5 ficheiros e 13 testes passaram; typecheck passou; lint terminou sem erros, com 21 avisos preexistentes. Build da API, verificação i18n e build integral do monorepo passaram. As verificações direcionadas cobrem os três casos P2. Estes resultados foram reportados para esta atualização documental; não foram reexecutados aqui.
3. **⬜ Concluir browser/manual acceptance do incremento (secção 21.3).** Verificar alertas e reconhecimento, fallback sem Redis, dashboards por workspace/role, mapas e resolução de findings. Continua pendente; o Safari não disponibiliza um endpoint de runtime anexável nesta sessão. Os testes automatizados não substituem estes fluxos manuais.
4. **✅ Rever o diff e abrir o PR #10 para revisão da equipa.** O PR está aberto e pronto para revisão; a aceitação manual permanece pendente antes de merge/piloto. A branch ainda não está integrada em `main`.
5. **Validar SNMP em laboratório com equipamento real.** Gate independente do centro operacional; pré-requisito para confiar em perfis e relações observadas por fabricante.
6. **Só depois da validação SNMP enriquecer topologia observada e reconciliação.** Implementar LLDP/BRIDGE-MIB/Q-BRIDGE-MIB, tabelas MAC/VLAN e aprovação de diferenças com fonte, confiança, timestamp e auditoria. Não converter observações em dados oficiais sem política ou aprovação.
7. **Completar percursos operacionais com evidência do piloto.** A pesquisa global por Host/Service/interface/MAC foi implementada na secção 22. Regras/notificações, racks, eventos/alertas e integrações contextuais continuam por priorizar com operadores; não são assumidos como aprovados.
8. **Manter agentes, LDAP/LDAPS, NetApp, integrações Zabbix/Ansible/BookStack/Zammad e hardening de produção no horizonte posterior.** Validar necessidade e requisitos de credenciais/segurança antes de iniciar cada integração.

As correções P2, verificações automatizadas e revisão final do diff estão concluídas; o PR #10 está aberto e pronto para revisão enquanto a aceitação manual permanece pendente. Browser/manual acceptance, recuperação real com Redis multi-instância e edições concorrentes reais na base de dados continuam por verificar antes de merge/piloto. A validação SNMP é um gate independente e tem de ocorrer antes de confiar em perfis observados ou enriquecer a topologia observada. O que depende do resultado do piloto permanece uma recomendação, não um compromisso de prazo.

## 21. Incremento centro operacional e topologia — 19 de outubro de 2026

Estado: implementação commitada na branch `joao/feature/operational-dashboard-topology` e publicada no PR #10, aberto para revisão. Correções P2, verificações automatizadas e revisão final do diff concluídas; browser/manual acceptance permanece pendente antes de merge/piloto.

### 21.1 Implementado

- Alertas operacionais persistentes com deduplicação, reabertura, reconhecimento, snooze, resolução, leitura individual, filtros e retenção de estados resolvidos.
- Reconciliação de Redis/BullMQ, Discovery, polling/traps SNMP, divergências e findings de qualidade; PostgreSQL é a fonte de verdade e Redis Pub/Sub apenas transporta eventos.
- Stream SSE autenticado por bearer token, snapshots, heartbeat e fallback de polling a cada 30 segundos.
- Dashboard por Site e role, preferência de workspace, layouts partilhados com revisão otimista e grelha configurável de 12 colunas alimentada por dados reais e scoped.
- Mapas nomeados `PHYSICAL`, `NETWORK` e `VLAN_SUBNET` com React Flow, posições persistidas, ligações documentadas, endpoints opcionais por interface e conflitos `409` por revisão.
- Fila atribuível de qualidade do inventário com reconciliação diária e após mutações relevantes, auto-resolução/reabertura e promoção de findings altos/críticos a alertas.
- Scopes aplicados a listagens, SSE, resumos, mutações e payloads de topologia; AUDITOR e READ_ONLY permanecem apenas de leitura.

### 21.2 Validação automatizada registada durante o incremento

- Migração aditiva validada sobre a base local existente e sobre uma base PostgreSQL vazia com as 27 migrações.
- Testes unitários da API, testes HTTP Nest/Fastify, testes Vitest, typecheck, lint, verificação i18n e build integral executados durante o incremento.
- Os testes HTTP cobrem personas ADMIN, NETWORK_OPERATOR scoped/legacy, SYSTEMS_OPERATOR, AUDITOR e READ_ONLY, incluindo isolamento por Site, interfaces de ligações e conflitos de revisão.

O registo original acima descreve verificações executadas durante o incremento. Na revisão posterior, os três bloqueios P2 foram corrigidos: a falha de Pub/Sub termina o stream afetado para permitir polling; atualizar uma ligação incrementa as revisões dos mapas associados; e as contagens de qualidade usam entidades distintas. Verificações reportadas para esta atualização: 74 testes API passaram; web passou em 5 ficheiros/13 testes; typecheck passou; lint sem erros, com 21 avisos preexistentes; build API, verificação i18n e build integral do monorepo passaram. As verificações documentadas não foram reexecutadas nesta atualização documental.

### 21.3 Browser/manual e laboratório ainda por verificar

- Confirmar alerta visível em menos de 10 segundos e propagação do reconhecimento entre dois utilizadores.
- Verificar em execução real a recuperação multi-instância com Redis após interrupção e confirmar polling sem perda do alerta persistido; por verificar. A aceitação no browser está bloqueada porque o Safari não disponibiliza um endpoint de runtime anexável nesta sessão.
- Alternar workspaces de um utilizador multi-role e editar um layout autorizado.
- Criar mapas dos três tipos, arrastar equipamentos, recarregar posições, editar/remover ligações e verificar edições concorrentes reais na base de dados; permanece por verificar.
- Corrigir um problema de inventário e confirmar auto-resolução do finding e do alerta associado.

As correções P2, checks automatizados e revisão final do diff estão concluídos, mas não substituem os fluxos manuais ainda por verificar. O PR #10 está aberto e pronto para revisão; browser/manual acceptance, recuperação real com Redis multi-instância e edições concorrentes reais na base de dados continuam gates antes de merge/piloto. A validação física de SNMP com equipamento real também não foi feita e continua independente; é necessária antes de confiar em perfis observados ou enriquecer a topologia observada. LLDP/BRIDGE-MIB/Q-BRIDGE-MIB, inferência automática de ligações e escrita SNMP continuam fora deste incremento.

## 22. Pesquisa global de ativos — 30 de outubro de 2026

Estado: implementada na branch `joao/feature/global-asset-search`; PR #12 aberto.

- A pesquisa global inclui interfaces por nome, port key, descrição e MAC; Hosts por nome, hostname observado, sistema operativo e MAC; e Services por nome, protocolo, versão e porta.
- Os resultados respeitam os scopes IPAM e de infraestrutura aplicados aos inventários.
- Hosts e Services abrem a ficha do Host no IPAM; interfaces abrem o equipamento selecionado na vista de interfaces.
- Validação registada nesta branch: 75 testes API, build API, build web e verificação i18n.
- Eventos e alertas continuam fora da pesquisa; o gate SNMP de laboratório permanece pendente.
