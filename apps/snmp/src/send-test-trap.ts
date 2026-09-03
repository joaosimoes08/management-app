import { isIP } from 'node:net';
import { PrismaClient } from '@simoes/database';
import * as snmp from 'net-snmp';
import { decryptStoredCredential, snmpAuthProtocol, snmpPrivProtocol } from './client';

async function main() {
  const external = process.argv.includes('--external');
  const enrollmentId = process.argv.slice(2).find((value) => !value.startsWith('--'))?.trim();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(enrollmentId ?? '')) {
    throw new Error('Uso: npm run snmp:test-trap -- <enrollment-id>');
  }

  const prisma = new PrismaClient();
  let session: ReturnType<typeof snmp.createV3Session> | undefined;
  let secret: Record<string, string> | undefined;
  try {
    const enrollment = await prisma.snmpTrapEnrollment.findUnique({ where: { id: enrollmentId } });
    if (!enrollment || !['WAITING', 'DISCOVERED'].includes(enrollment.status) || enrollment.expiresAt <= new Date()) {
      throw new Error('SNMP_TEST_ENROLLMENT_UNAVAILABLE');
    }
    if (enrollment.version !== 'V3') throw new Error('SNMP_TEST_REQUIRES_V3');
    if (isIP(enrollment.sourceAddress) !== 4) throw new Error('SNMP_TEST_SOURCE_INVALID');
    const localInterface = await prisma.snmpListenerInterface.findFirst({
      where: {
        instanceId: { startsWith: 'host:' },
        address: enrollment.sourceAddress,
        lastSeenAt: { gte: new Date(Date.now() - 2 * 60_000) },
      },
      select: { id: true },
    });
    if (!localInterface) throw new Error('SNMP_TEST_SOURCE_NOT_LOCAL');

    secret = decryptStoredCredential(enrollment as any);
    const target = external ? enrollment.sourceAddress : '127.0.0.1';
    const port = Number(external ? process.env.SNMP_TRAP_HOST_PORT ?? 162 : process.env.SNMP_TRAP_PORT ?? 1162);
    session = snmp.createV3Session(target, {
      name: secret.username ?? enrollment.username ?? '',
      level: snmp.SecurityLevel.authPriv,
      authProtocol: snmpAuthProtocol(enrollment.authProtocol),
      authKey: secret.authKey,
      privProtocol: snmpPrivProtocol(enrollment.privProtocol),
      privKey: secret.privKey,
    }, {
      port,
      trapPort: port,
      timeout: 1_000,
      retries: 0,
    });
    await new Promise<void>((resolve, reject) => session!.trap('1.3.6.1.4.1.8072.2.3.0.1', [
      { oid: '1.3.6.1.2.1.1.5.0', type: snmp.ObjectType.OctetString, value: 'Teste local MGMT-APP' },
    ], (error) => error ? reject(error) : resolve()));
    console.log(JSON.stringify({ sent: true, enrollmentId: enrollment.id, target: external ? enrollment.sourceAddress : 'container-loopback', expectedSourceAddress: enrollment.sourceAddress, version: enrollment.version, authProtocol: enrollment.authProtocol, privProtocol: enrollment.privProtocol }));
  } finally {
    session?.close();
    if (secret) {
      secret.authKey = '';
      secret.privKey = '';
      secret.username = '';
    }
    await prisma.$disconnect();
  }
}

void main().catch((error) => {
  console.error(JSON.stringify({ sent: false, errorCode: error instanceof Error ? error.message : 'SNMP_TEST_FAILED' }));
  process.exitCode = 1;
});
