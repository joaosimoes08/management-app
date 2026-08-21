O meu objetivo é fazer uma app com interface moderna que permita através de SNMP ou depois criar um agente, fazer o seguinte:
1. Gestão de IPs, VLANs e equipamentos de rede. Ou seja, tens uma imagem do switch (modelo que configuramos na app) e clico na porta eth1/1, aquilo mostra-me qual é a VLAN que lá está ou a config da porta tipo "switchport: trunk" "vlans allowed: 10, 12". Depois posso clicar nessas VLANs e ele leva-me para um grupo dessa VLAN onde estão todos os hosts, por ip ou por nome que estão nessa VLAN
2. Ter gestão de bastidores, ou seja, ter o icone do bastidor e meter que tipo de server/switch/router/netapp está, onde está e depois clicando, conseguimos ver o que está a correr no servidor (OS, uptime, etc, até se pode expandir para ver as VMs), ver o espaço em disco nas NetApp, S/N, licenciamento, etc.
3. Autenticação por LDAP
4. Links para Apps importantes do Centro, etc
5. Alguns gráficos que ajudem em estatística
Eu não quero funcionar apenas com network discovery. No entanto, quero ter a possiblidade deatravés de ICMP/TCP, descobrir todos os hosts numa subnet.
