# Decisões técnicas

## Assets locais

Os assets de bastidores, switches, routers, servidores e storage são importados manualmente. A aplicação não depende de URLs externos de fabricantes e guarda a licença/fonte associada a cada ficheiro.

## Relação VLAN/subnet

## IPAM IPv4/IPv6

- VRF é opcional para compatibilidade e é a fronteira de sobreposição de subnets.
- A decisão manual de estado de IP não é substituída pelo estado observado do worker.
- Scanning IPv6 não enumera prefixos grandes; só verifica endereços conhecidos.
- RIPEstat exige preview e confirmação; não há importação automática.
- NAT é inventário documental e auditável, sem configuração automática de appliances.

O fluxo operacional considera uma subnet principal por VLAN. A base permite uma VLAN sem subnet durante a configuração, mas impede novas associações múltiplas.

## Discovery periódico

O auto-discovery é opt-in por subnet e usa intervalo fixo de 12 horas. O worker BullMQ cria resultados pendentes para revisão; a aprovação continua a ser uma ação explícita do operador.

## Vista default de infraestrutura

A infraestrutura começa pelo Site e pelos bastidores, não pela tabela global de equipamentos. Esta ordem corresponde à operação física e permite localizar um ativo antes de investigar interfaces, VLANs ou IPAM.

## Portas de rede

A existência de portas é uma propriedade explícita do modelo (`supportsNetworkPorts`). O tipo `SERVER` ou `STORAGE` não implica automaticamente um diagrama de portas; esta separação evita apresentar uma UI de switch para ativos cuja informação será obtida posteriormente por agente, SNMP ou API específica.

## Shell, assets e discovery

- O Site ativo é um contexto global persistente, mas `siteId` na URL tem prioridade para links partilháveis.
- A identidade do utilizador aparece apenas no sidebar, evitando duplicação na barra superior.
- Assets de modelo são defaults; racks e equipamentos podem ter overrides específicos.
- Um resultado de discovery só é operacionalmente relevante quando responde a ICMP ou apresenta uma porta TCP aberta. Endereços sem resposta são contabilizados, mas não são apresentados para aprovação.

## Infraestrutura visual e layouts

- A sala mostra bastidores como imagens frontais reais; o detalhe do bastidor usa overlays U para manter a relação física.
- A imagem específica do equipamento substitui a imagem do modelo apenas quando configurada.
- O mapeamento de portas é por template de modelo e usa coordenadas normalizadas.
- O IP de gestão mantém um campo rápido no equipamento e uma relação opcional ao IPAM.
- A associação a um rack promove o ativo para `ACTIVE`, mas não reativa equipamentos retirados.

- O mapa de portas é confirmado manualmente: deteção automática nunca escreve diretamente no modelo.
- A geração de interfaces é aditiva e nunca substitui configurações existentes.
- A imagem original autorizada do C9300 é preservada sem conversão; derivados WebP antigos são removidos para evitar duplicação/confusão.
- Assets visuais exigem associação a um modelo no upload; o nome definido pelo administrador é persistido e a API rejeita duplicados case-insensitive.
- O editor de portas privilegia drag-and-drop no preview, mantendo os inputs numéricos como fallback preciso.

## Contexto físico e configuração de portas

- A navegação da infraestrutura é dependente: Site → Edifício → Sala → Bastidor.
- O posicionamento visual mantém-se baseado em unidades U e na área útil do asset do rack; não são criadas coordenadas horizontais por equipamento nesta fase.
- O zoom de equipamento fica na mesma rota para preservar contexto e permitir editar portas diretamente.
- O modo da interface determina os campos VLAN visíveis: ACCESS mostra access, TRUNK mostra native/allowed e ROUTED não mostra VLANs.
- A ordenação natural é aplicada na API e repetida no frontend para garantir a sequência operacional das portas.
- Edifício, Sala, Bastidor e Equipamento não são selecionados implicitamente; o estado vazio é parte do fluxo operacional.
- O zoom de equipamento fica na mesma rota e no mesmo palco do rack, fecha por clique exterior/Escape e só abre a ficha completa por ação explícita.
- O aspect ratio do template é o contrato entre a imagem mapeada e as coordenadas normalizadas dos hotspots.
