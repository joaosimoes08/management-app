import client from '../packages/database/generated/client/index.js';

const { PrismaClient } = client;
const prisma = new PrismaClient();
const percent = (part, total) => total ? Math.round((part / total) * 10000) / 100 : 0;

async function main() {
  const staleBoundary = new Date(Date.now() - 48 * 60 * 60 * 1000);
  const [activeDevices, locatedDevices, managedDevices, networkInterfaces, configuredInterfaces, pendingDiscovery, stalePendingDiscovery, subnets, reviewedSubnets, duplicateAddresses, missingQuality] = await Promise.all([
    prisma.device.count({ where: { status: 'ACTIVE' } }),
    prisma.device.count({ where: { status: 'ACTIVE', rackId: { not: null } } }),
    prisma.device.count({ where: { status: 'ACTIVE', managementIp: { not: null } } }),
    prisma.deviceInterface.count(),
    prisma.deviceInterface.count({ where: { mode: { not: null }, OR: [{ accessVlanId: { not: null } }, { nativeVlanId: { not: null } }, { allowedVlans: { some: {} } }, { mode: 'ROUTED' }] } }),
    prisma.discoveryResult.count({ where: { status: 'PENDING' } }),
    prisma.discoveryResult.count({ where: { status: 'PENDING', createdAt: { lt: staleBoundary } } }),
    prisma.subnet.count(),
    prisma.subnet.count({ where: { OR: [{ lastScanAt: { gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) } }, { discoveryJobs: { some: { completedAt: { gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) } } } }] } }),
    prisma.ipAddress.groupBy({ by: ['address'], _count: { address: true }, having: { address: { _count: { gt: 1 } } } }),
    prisma.device.count({ where: { status: 'ACTIVE', OR: [{ rackId: null }, { modelId: null }, { managementIp: null }] } }),
  ]);
  const navigableDevices = await prisma.device.count({ where: { status: 'ACTIVE', rackId: { not: null }, managementIp: { not: null }, OR: [{ interfaces: { some: {} } }, { host: { isNot: null } }] } });
  const result = {
    generatedAt: new Date().toISOString(),
    northStar: { activeDevices, navigableDevices, percent: percent(navigableDevices, activeDevices) },
    physicalLocation: { locatedDevices, activeDevices, percent: percent(locatedDevices, activeDevices) },
    managementIp: { managedDevices, activeDevices, percent: percent(managedDevices, activeDevices) },
    interfaceDocumentation: { configuredInterfaces, networkInterfaces, percent: percent(configuredInterfaces, networkInterfaces) },
    discoveryReview: { pending: pendingDiscovery, olderThan48Hours: stalePendingDiscovery },
    subnetReview30Days: { reviewedSubnets, subnets, percent: percent(reviewedSubnets, subnets) },
    quality: { duplicateAddressValues: duplicateAddresses.length, activeDevicesMissingLocationModelOrManagementIp: missingQuality },
  };
  console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => prisma.$disconnect());
