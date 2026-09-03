# ADR-001: Componente SNMP separado

## Estado

Aceite.

## Contexto

Polling, traps e SNMP SET exigem acesso direto à rede de gestão e a credenciais sensíveis. Executar estas operações na API aumentaria o impacto de uma falha e permitiria que latência ou timeouts SNMP bloqueassem pedidos HTTP.

## Decisão

A API é o control plane: valida identidade, roles, scope e configuração, persiste o pedido e publica no BullMQ apenas a versão do contrato e um UUID. `apps/snmp` é o data plane: recebe traps, consome jobs, desencripta a credencial no limite de utilização e comunica com os equipamentos.

O mesmo artefacto suporta `SNMP_ROLE=all|receiver|worker`. A implantação inicial usa um container em modo `all`; receiver e workers podem ser escalados separadamente depois. O container usa uma ligação PostgreSQL própria e sem privilégios de migração.

As interfaces de escuta configuradas são sempre interfaces IPv4 do host, não interfaces do namespace Docker. Um agente de controlo local enumera as interfaces do sistema operativo, publica apenas nome/IP no PostgreSQL e reconcilia um override Compose gerado. O Docker publica UDP/162 em `0.0.0.0` ou nos IPs selecionados e encaminha para UDP/1162 no container. O receiver continua não-root, escuta apenas o ingress interno do container e conserva o IP de origem apresentado pelo encaminhamento Docker.

O agente do host não monta o keyring nem lê credenciais SNMP. Em produção usa uma role PostgreSQL exclusiva, limitada a `SnmpListenerConfig` e `SnmpListenerInterface`. Como necessita de controlar o serviço Docker, é executado apenas no host SNMP por uma conta operacional dedicada e com ficheiros de configuração administrativamente protegidos.

Credenciais são exclusivas por equipamento e finalidade (`READ`, `WRITE`, `TRAP`). O payload é cifrado com uma DEK AES-256-GCM aleatória; a DEK é envolvida por uma chave do keyring montado como Docker secret. Redis, respostas HTTP, logs e auditoria nunca recebem segredos.

SET é limitado aos templates `INTERFACE_ADMIN_STATUS` e `SYSTEM_IDENTITY`, exige `ADMIN`, credencial `WRITE`, preflight e verificação posterior. A API e o worker recusam execução enquanto `SNMP_SET_ENABLED` não estiver explicitamente ativo.

## Consequências

- Falhas ou carga SNMP ficam isoladas da API.
- API e SNMP partilham schema e contratos versionados, criando acoplamento intencional ao domínio.
- O receiver precisa de UDP/162 publicado, engine ID estável e usernames SNMPv3 de traps únicos quando as chaves diferem.
- Alterar a seleção pode recriar brevemente o container SNMP; o agente do host deve permanecer ativo para atualizar o inventário e aplicar alterações.
- A operação exige gerir um keyring e uma role PostgreSQL dedicada.
- Não há rollback automático de SET; resultados incertos exigem intervenção humana.
