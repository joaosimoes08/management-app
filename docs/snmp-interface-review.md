# Revisão de interfaces observadas por SNMP

Este guia destina-se a operadores de rede e administradores que comparam interfaces recolhidas por SNMP com o inventário mantido. As observações e as propostas ficam separadas do inventário até uma proposta elegível ser aplicada.

## Fluxo no frontend

Em **Topologia**, seleciona um site e um equipamento. A página mostra a última recolha concluída, as interfaces observadas e as propostas associadas. Atualiza para voltar a carregar os dados. Cada proposta apresenta origem, confiança, hora da recolha e, quando disponíveis, contexto, valores atuais e valores observados.

As propostas são criadas durante uma recolha SNMP concluída:

- **ADD**: interface observada que ainda não consta do inventário.
- **UPDATE**: valores observados diferem dos valores atuais da interface.
- **REMOVAL_CANDIDATE**: interface do inventário não apareceu na recolha. A ausência não prova que a interface foi removida; a recolha atual não cria propostas de remoção.
- **CONNECTION_ADD**: vizinhança LLDP resolvida que ainda não corresponde a uma ligação no inventário.
- **CONNECTION_UPDATE**: vizinhança LLDP resolvida cujas interfaces diferem da ligação existente entre os mesmos equipamentos.

As observações LLDP são evidência, não ligações de inventário. Ficam guardadas mesmo quando o vizinho não pode ser resolvido. Um vizinho só é associado a um equipamento quando o endereço de gestão LLDP corresponde exatamente a um equipamento no mesmo site. Sem endereço correspondente, sem correspondência ou com mais de uma correspondência, o vizinho permanece por resolver e não gera proposta de ligação.

Uma proposta de ligação exige também correspondência única das duas interfaces: a porta local é encontrada pelo ID LLDP igual ao nome ou `portKey` da interface recolhida; a porta remota é encontrada pelo ID remoto igual ao nome ou `portKey` da interface inventariada. Se algum endpoint não for identificado de forma única, não é criada proposta. O sistema não usa apenas o nome do sistema ou o chassis ID para resolver o vizinho.

As observações e a criação de propostas não escrevem nos equipamentos nem na configuração SNMP. Aplicar uma proposta de ligação altera a ligação de inventário, não os registos dos equipamentos. O fluxo não remove ligações automaticamente.

## Rever propostas

`ADMIN` e `NETWORK_OPERATOR` podem aplicar, rejeitar e reverter propostas. `AUDITOR` e `READ_ONLY` podem consultar; as permissões efetivas de acesso ao equipamento também são verificadas pela API.

Aplicar uma proposta **ADD** cria uma interface de origem SNMP no inventário. Aplicar **UPDATE** atualiza apenas `description`, `macAddress`, `adminUp`, `operUp` e `speedMbps`, e avança `lastSeenAt` para a hora da recolha. Uma atualização é recusada como obsoleta se um destes valores tiver mudado no inventário desde que a proposta foi gerada. Uma proposta aplicada guarda quem reviu e quando; a ação é auditada.

Aplicar **CONNECTION_ADD** cria uma ligação de inventário entre os equipamentos e interfaces resolvidos. **CONNECTION_UPDATE** altera as interfaces da ligação identificada, se a ligação ainda corresponder ao estado anterior guardado. A revisão volta a verificar o acesso aos dois equipamentos, o site e a associação das interfaces; alterações entretanto ocorridas tornam a proposta obsoleta. Reverter **CONNECTION_ADD** remove a ligação criada apenas se continuar igual e não estiver usada em mapas. Reverter **CONNECTION_UPDATE** repõe as interfaces anteriores apenas se a ligação ainda corresponder aos valores aplicados. Estas ações não configuram os equipamentos via SNMP.

Uma proposta **ADD** exige nome observado válido e é recusada se já existir uma interface com esse nome no equipamento. Propostas que já não estão `PENDING` não podem ser aplicadas nem rejeitadas novamente.

Rejeitar altera o estado para `REJECTED`, regista revisor e hora, e audita a ação; não altera a interface do inventário. A API devolve conflito se a proposta já tiver sido revista.

Reverter só está disponível para propostas `APPLIED`. Para **ADD**, remove a interface criada apenas se ainda não tiver endereços IP nem ligações de origem ou destino. Para **UPDATE**, restaura os valores anteriores apenas se os campos editados ainda coincidirem com os valores aplicados; caso contrário, a reversão automática é recusada. A reversão muda o estado para `UNDONE` e é auditada.

**Limitação de remoção:** candidatos `REMOVAL_CANDIDATE` podem ser consultados e rejeitados, mas não podem ser aplicados. A API devolve `TOPOLOGY_REMOVAL_APPLY_FORBIDDEN`; não há remoção automática de interfaces por ausência numa recolha.

## API

Prefixo versionado: `/api/v1`. Todas as rotas abaixo exigem autenticação e acesso ao equipamento no escopo aplicável.

| Método e rota | Roles | Resultado |
| --- | --- | --- |
| `GET /api/v1/snmp/devices/:deviceId` | `ADMIN`, `NETWORK_OPERATOR`, `AUDITOR`, `READ_ONLY` | Devolve a visão SNMP do equipamento, incluindo a última recolha e interfaces observadas. |
| `GET /api/v1/snmp/devices/:deviceId/lldp-observations` | `ADMIN`, `NETWORK_OPERATOR`, `AUDITOR`, `READ_ONLY` | Lista até 500 observações LLDP do equipamento, mais recentes primeiro, incluindo vizinhos resolvidos e por resolver. |
| `GET /api/v1/snmp/devices/:deviceId/topology-proposals` | `ADMIN`, `NETWORK_OPERATOR`, `AUDITOR`, `READ_ONLY` | Lista até 500 propostas do equipamento, mais recentes primeiro. |
| `POST /api/v1/snmp/topology-proposals/:id/apply` | `ADMIN`, `NETWORK_OPERATOR` | Aplica proposta `ADD`, `UPDATE`, `CONNECTION_ADD` ou `CONNECTION_UPDATE` pendente; rejeita candidatos a remoção. |
| `POST /api/v1/snmp/topology-proposals/:id/reject` | `ADMIN`, `NETWORK_OPERATOR` | Marca proposta pendente como rejeitada. |
| `POST /api/v1/snmp/topology-proposals/:id/undo` | `ADMIN`, `NETWORK_OPERATOR` | Reverte proposta aplicada de interface ou ligação, se os dados ainda permitirem uma reversão segura. |

Os endpoints de escrita podem devolver conflito quando a proposta já foi revista, ficou obsoleta, um endpoint desapareceu ou a reversão não é segura. A aplicação de propostas de ligação verifica também que ambos os equipamentos pertencem ao site da proposta e que as interfaces ainda pertencem aos equipamentos indicados. O frontend de topologia disponibiliza aplicar, rejeitar e reverter propostas; para ligações, aplicar fica desativado enquanto o vizinho não estiver resolvido.
