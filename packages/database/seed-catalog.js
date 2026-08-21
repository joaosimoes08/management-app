const { PrismaClient } = require('./generated/client');

const prisma = new PrismaClient();
const devices = [
  ['Cisco','Catalyst 2960-X','SWITCH',24,true,24,'ethernet'], ['Cisco','Catalyst 9200','SWITCH',24,true,24,'ethernet'], ['Cisco','Catalyst 9300','SWITCH',48,true,48,'ethernet'], ['Cisco','Catalyst 9500','SWITCH',24,true,24,'sfp'], ['Cisco','Nexus 9300','SWITCH',48,true,48,'qsfp/sfp'],
  ['Cisco','ISR 4321','ROUTER',3,true,3,'ethernet'], ['Cisco','ISR 4331','ROUTER',3,true,3,'ethernet'], ['Cisco','ISR 4351','ROUTER',3,true,3,'ethernet'], ['Cisco','ISR 4431','ROUTER',4,true,4,'ethernet'], ['Cisco','ISR 4451-X','ROUTER',4,true,4,'ethernet'], ['Cisco','Catalyst 8300','ROUTER',8,true,8,'ethernet'], ['Cisco','ASR 1001-X','ROUTER',6,true,6,'ethernet'],
  ['Dell','PowerEdge R640','SERVER',0,false,null,null], ['Dell','PowerEdge R740','SERVER',0,false,null,null], ['Dell','PowerEdge R740xd','SERVER',0,false,null,null], ['Dell','PowerEdge R750','SERVER',0,false,null,null], ['Dell','PowerEdge R650','SERVER',0,false,null,null],
  ['Lenovo','ThinkSystem SR550','SERVER',0,false,null,null], ['Lenovo','ThinkSystem SR570','SERVER',0,false,null,null], ['Lenovo','ThinkSystem SR630','SERVER',0,false,null,null], ['Lenovo','ThinkSystem SR650','SERVER',0,false,null,null], ['Lenovo','ThinkSystem SR650 V4','SERVER',0,false,null,null],
  ['Cisco','UCS C220 M4','SERVER',0,false,null,null], ['Cisco','UCS C220 M5','SERVER',0,false,null,null], ['Cisco','UCS C220 M6','SERVER',0,false,null,null], ['Cisco','UCS C220 M7','SERVER',0,false,null,null], ['Cisco','UCS C240 M5','SERVER',0,false,null,null], ['Cisco','UCS C240 M6','SERVER',0,false,null,null], ['Cisco','UCS C240 M7','SERVER',0,false,null,null],
  ['NetApp','FAS2720','STORAGE',0,false,null,null], ['NetApp','FAS2750','STORAGE',0,false,null,null], ['NetApp','FAS2820','STORAGE',0,false,null,null], ['NetApp','AFF A250','STORAGE',0,false,null,null], ['NetApp','AFF C250','STORAGE',0,false,null,null], ['NetApp','AFF A400','STORAGE',0,false,null,null], ['NetApp','AFF A700','STORAGE',0,false,null,null], ['NetApp','AFF A900','STORAGE',0,false,null,null],
];
const racks = [['APC/Schneider Electric','NetShelter SX AR3350',42],['APC/Schneider Electric','NetShelter SX AR3300X',42],['Generic','42U Standard Rack',42],['Generic','24U Standard Rack',24]];

async function main() {
  let created = 0; let existing = 0;
  for (const [manufacturer, model, type, portCount, supportsNetworkPorts, networkPortCount, family] of devices) {
    const found = await prisma.deviceModel.findUnique({ where: { manufacturer_model: { manufacturer, model } }, select: { id: true } });
    await prisma.deviceModel.upsert({ where: { manufacturer_model: { manufacturer, model } }, create: { manufacturer, model, type, portCount, supportsNetworkPorts, networkPortCount, portLayout: family ? { family, ports: networkPortCount } : null }, update: { type, portCount, supportsNetworkPorts, networkPortCount, portLayout: family ? { family, ports: networkPortCount } : null } });
    if (found) existing++; else created++;
  }
  for (const [manufacturer, model, units] of racks) await prisma.rackModel.upsert({ where: { manufacturer_model: { manufacturer, model } }, create: { manufacturer, model, units }, update: { units } });
  console.log(JSON.stringify({ created, existing, rackModels: racks.length }));
}
main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => prisma.$disconnect());
