import client from '../packages/database/generated/client/index.js';

const { PrismaClient } = client;
const prisma = new PrismaClient();

async function upsertDevice(name, data) {
  const current = await prisma.device.findFirst({ where: { name } });
  return current
    ? prisma.device.update({ where: { id: current.id }, data })
    : prisma.device.create({ data: { name, ...data } });
}

async function main() {
  const site = await prisma.site.upsert({
    where: { code: 'QA-PILOT' },
    create: { name: 'QA Pilot Site', code: 'QA-PILOT', city: 'Lisboa', country: 'Portugal' },
    update: { name: 'QA Pilot Site' },
  });
  const building = await prisma.building.upsert({
    where: { siteId_name: { siteId: site.id, name: 'QA Pilot Building' } },
    create: { siteId: site.id, name: 'QA Pilot Building' },
    update: {},
  });
  const room = await prisma.room.upsert({
    where: { buildingId_name: { buildingId: building.id, name: 'QA Pilot Room' } },
    create: { buildingId: building.id, name: 'QA Pilot Room' },
    update: {},
  });
  const rackModel = await prisma.rackModel.upsert({
    where: { manufacturer_model: { manufacturer: 'Generic', model: '42U Standard Rack' } },
    create: { manufacturer: 'Generic', model: '42U Standard Rack', units: 42 },
    update: { units: 42 },
  });
  const rack = await prisma.rack.upsert({
    where: { roomId_name: { roomId: room.id, name: 'QA-RACK-01' } },
    create: { roomId: room.id, name: 'QA-RACK-01', units: 42, modelId: rackModel.id },
    update: { units: 42, modelId: rackModel.id },
  });
  const switchModel = await prisma.deviceModel.upsert({
    where: { manufacturer_model: { manufacturer: 'Cisco', model: 'Catalyst 9300' } },
    create: { manufacturer: 'Cisco', model: 'Catalyst 9300', type: 'SWITCH', portCount: 48, supportsNetworkPorts: true, networkPortCount: 48, portLayout: { family: 'ethernet', ports: 48 } },
    update: { type: 'SWITCH', supportsNetworkPorts: true, networkPortCount: 48 },
  });
  const serverModel = await prisma.deviceModel.upsert({
    where: { manufacturer_model: { manufacturer: 'Dell', model: 'PowerEdge R640' } },
    create: { manufacturer: 'Dell', model: 'PowerEdge R640', type: 'SERVER', portCount: 0, supportsNetworkPorts: false },
    update: { type: 'SERVER', supportsNetworkPorts: false },
  });
  const switchDevice = await upsertDevice('QA-SW-PILOT-01', { type: 'SWITCH', hostname: 'qa-sw-pilot-01', managementIp: '10.254.250.1', status: 'ACTIVE', source: 'MANUAL', siteId: site.id, rackId: rack.id, rackUnitStart: 42, rackUnitSize: 1, modelId: switchModel.id, notes: 'QA persistent pilot switch' });
  const serverDevice = await upsertDevice('QA-SRV-PILOT-01', { type: 'SERVER', hostname: 'qa-srv-pilot-01', managementIp: '10.254.250.2', status: 'ACTIVE', source: 'MANUAL', siteId: site.id, rackId: rack.id, rackUnitStart: 39, rackUnitSize: 2, modelId: serverModel.id, notes: 'QA persistent pilot server' });
  const vlan = await prisma.vlan.upsert({
    where: { siteId_vlanId: { siteId: site.id, vlanId: 4090 } },
    create: { siteId: site.id, vlanId: 4090, name: 'QA-PILOT-SERVERS', description: 'QA persistent pilot VLAN' },
    update: { name: 'QA-PILOT-SERVERS', description: 'QA persistent pilot VLAN' },
  });
  const subnet = await prisma.subnet.upsert({
    where: { cidr: '10.254.250.0/30' },
    create: { cidr: '10.254.250.0/30', version: 4, gateway: '10.254.250.1', purpose: 'QA pilot services', environment: 'QA', siteId: site.id, vlanId: vlan.id, scanMethods: ['ICMP', 'TCP'], scanTcpPorts: [22, 443], reverseDnsEnabled: true },
    update: { gateway: '10.254.250.1', purpose: 'QA pilot services', environment: 'QA', siteId: site.id, vlanId: vlan.id },
  });
  const port = await prisma.deviceInterface.upsert({
    where: { deviceId_name: { deviceId: switchDevice.id, name: 'GigabitEthernet1/0/1' } },
    create: { deviceId: switchDevice.id, name: 'GigabitEthernet1/0/1', portKey: 'ethernet1/1', interfaceType: 'GIGABIT_ETHERNET', description: 'QA pilot server access', adminUp: true, operUp: true, speedMbps: 1000, mode: 'ACCESS', accessVlanId: vlan.id, source: 'MANUAL' },
    update: { portKey: 'ethernet1/1', description: 'QA pilot server access', adminUp: true, operUp: true, speedMbps: 1000, mode: 'ACCESS', accessVlanId: vlan.id },
  });
  const host = await prisma.host.upsert({
    where: { name: 'QA-HOST-PILOT-01' },
    create: { name: 'QA-HOST-PILOT-01', hostname: 'qa-srv-pilot-01', operatingSystem: 'Linux', macAddress: '02:00:00:00:40:90', status: 'ACTIVE', source: 'MANUAL', deviceId: serverDevice.id, notes: 'QA persistent pilot host' },
    update: { hostname: 'qa-srv-pilot-01', operatingSystem: 'Linux', status: 'ACTIVE', deviceId: serverDevice.id },
  });
  const ip = await prisma.ipAddress.upsert({
    where: { subnetId_address: { subnetId: subnet.id, address: '10.254.250.2' } },
    create: { subnetId: subnet.id, address: '10.254.250.2', version: 4, state: 'OCCUPIED', hostname: 'qa-srv-pilot-01', macAddress: '02:00:00:00:40:90', source: 'MANUAL', hostId: host.id, deviceId: serverDevice.id, interfaceId: port.id, notes: 'QA persistent pilot IP' },
    update: { state: 'OCCUPIED', hostname: 'qa-srv-pilot-01', hostId: host.id, deviceId: serverDevice.id, interfaceId: port.id },
  });
  const service = await prisma.service.upsert({
    where: { hostId_protocol_port: { hostId: host.id, protocol: 'TCP', port: 443 } },
    create: { hostId: host.id, name: 'QA HTTPS', protocol: 'TCP', port: 443, status: 'ACTIVE', version: '1.0', source: 'MANUAL', notes: 'QA persistent pilot service' },
    update: { name: 'QA HTTPS', status: 'ACTIVE', version: '1.0', notes: 'QA persistent pilot service' },
  });
  let job = await prisma.discoveryJob.findFirst({ where: { name: 'QA Pilot Review Evidence', subnetId: subnet.id } });
  if (!job) job = await prisma.discoveryJob.create({ data: { name: 'QA Pilot Review Evidence', subnetId: subnet.id, methods: ['ICMP', 'TCP'], tcpPorts: [22, 443], reverseDns: true, status: 'COMPLETED', scannedCount: 2, reachableCount: 1, unreachableCount: 1, resultCount: 1, completedAt: new Date() } });
  const result = await prisma.discoveryResult.upsert({
    where: { jobId_address: { jobId: job.id, address: ip.address } },
    create: { jobId: job.id, address: ip.address, hostname: host.hostname, icmpReachable: true, responseMs: 2, openPorts: [443], status: 'PENDING' },
    update: {},
  });
  console.log(JSON.stringify({ siteId: site.id, buildingId: building.id, roomId: room.id, rackId: rack.id, switchDeviceId: switchDevice.id, serverDeviceId: serverDevice.id, interfaceId: port.id, vlanId: vlan.id, subnetId: subnet.id, ipId: ip.id, hostId: host.id, serviceId: service.id, discoveryJobId: job.id, discoveryResultId: result.id }, null, 2));
}

main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => prisma.$disconnect());
