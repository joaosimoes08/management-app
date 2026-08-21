import { Worker, Job } from 'bullmq';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { reverse } from 'node:dns/promises';
import * as net from 'node:net';
import { PrismaClient } from '@simoes/database';

const execFileAsync = promisify(execFile);
const MAX_DISCOVERY_HOSTS = 4096;
const prisma = new PrismaClient();
const redisUrl = new URL(process.env.REDIS_URL ?? 'redis://localhost:6379');
const connection = { host: redisUrl.hostname, port: Number(redisUrl.port || 6379), ...(redisUrl.password ? { password: redisUrl.password } : {}) };

function ipv4ToNumber(ip: string) { return ip.split('.').reduce((value, part) => (value * 256) + Number(part), 0) >>> 0; }
function numberToIpv4(value: number) { return [value >>> 24, (value >>> 16) & 255, (value >>> 8) & 255, value & 255].join('.'); }
function hostsFor(cidr: string) { const [address, bitsText] = cidr.split('/'); const bits = Number(bitsText); if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(address) || !Number.isInteger(bits) || bits < 0 || bits > 32) throw new Error('CIDR IPv4 inválido'); const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0; const network = ipv4ToNumber(address) & mask; const broadcast = (network | (~mask >>> 0)) >>> 0; const first = bits >= 31 ? network : network + 1; const last = bits >= 31 ? broadcast : broadcast - 1; const count = last >= first ? last - first + 1 : 0; if (count > MAX_DISCOVERY_HOSTS) throw new Error(`Discovery limitado a ${MAX_DISCOVERY_HOSTS} hosts`); return Array.from({ length: count }, (_, index) => numberToIpv4(first + index)); }
async function ping(address: string) { const started = Date.now(); try { const args = process.platform === 'win32' ? ['-n', '1', '-w', '800', address] : ['-c', '1', '-W', '1', address]; await execFileAsync(process.platform === 'win32' ? 'ping.exe' : 'ping', args, { timeout: 1500, windowsHide: true }); return { reachable: true, responseMs: Date.now() - started }; } catch { return { reachable: false, responseMs: undefined }; } }
function testPort(address: string, port: number) { return new Promise<boolean>((resolve) => { const socket = net.createConnection({ host: address, port, timeout: 800 }); const done = (result: boolean) => { socket.destroy(); resolve(result); }; socket.once('connect', () => done(true)); socket.once('timeout', () => done(false)); socket.once('error', () => done(false)); }); }

type DiscoveryData = { jobId?: string; subnetId?: string; cidr?: string; methods?: string[]; tcpPorts?: number[] };
async function processJob(job: Job<DiscoveryData>) {
  let { jobId, cidr, methods, tcpPorts } = job.data;
  if (!jobId && job.data.subnetId) {
    const schedule = await prisma.discoverySchedule.findUnique({ where: { subnetId: job.data.subnetId }, include: { subnet: true } });
    if (!schedule || !schedule.enabled) return;
    methods = Array.isArray(schedule.methods) ? schedule.methods.filter((value): value is string => typeof value === 'string') : ['ICMP'];
    tcpPorts = Array.isArray(schedule.tcpPorts) ? schedule.tcpPorts.filter((value): value is number => typeof value === 'number') : [];
    cidr = schedule.subnet.cidr;
    const created = await prisma.discoveryJob.create({ data: { name: `Discovery agendado · ${new Date().toISOString()}`, subnetId: schedule.subnetId, methods, tcpPorts } });
    jobId = created.id;
    await prisma.discoverySchedule.update({ where: { id: schedule.id }, data: { lastRunAt: new Date(), nextRunAt: new Date(Date.now() + schedule.intervalHours * 60 * 60 * 1000), lastStatus: 'RUNNING', lastError: null } });
  }
  if (!jobId || !cidr || !methods || !tcpPorts) throw new Error('Dados de discovery incompletos');
  await prisma.discoveryJob.update({ where: { id: jobId }, data: { status: 'RUNNING', startedAt: new Date(), errorMessage: null } });
  try {
    const results: { jobId: string; address: string; hostname?: string; icmpReachable: boolean; responseMs?: number; openPorts: number[] }[] = [];
    let icmpReachableCount = 0; let tcpReachableCount = 0;
    const addresses = hostsFor(cidr);
    for (let index = 0; index < addresses.length; index += 32) {
      const batch = addresses.slice(index, index + 32);
      const batchResults = await Promise.all(batch.map(async (address) => {
        const icmp = methods.includes('ICMP') ? await ping(address) : { reachable: false, responseMs: undefined };
        const openPorts = methods.includes('TCP') ? (await Promise.all(tcpPorts.map(async (port) => (await testPort(address, port)) ? port : null))).filter((port): port is number => port !== null) : [];
        return { address, icmp, openPorts };
      }));
      for (const item of batchResults) { if (item.icmp.reachable) icmpReachableCount++; if (item.openPorts.length) tcpReachableCount++; if (!item.icmp.reachable && !item.openPorts.length) continue; let hostname: string | undefined; try { hostname = (await reverse(item.address))[0]; } catch { /* reverse DNS is best effort */ } results.push({ jobId, address: item.address, hostname, icmpReachable: item.icmp.reachable, responseMs: item.icmp.responseMs, openPorts: item.openPorts }); }
    }
    if (results.length) await prisma.discoveryResult.createMany({ data: results.map((result) => ({ ...result, openPorts: result.openPorts })) });
    await prisma.discoveryJob.update({ where: { id: jobId }, data: { scannedCount: addresses.length, icmpReachableCount, tcpReachableCount, reachableCount: results.length, unreachableCount: addresses.length - results.length, resultCount: results.length } });
    if (job.data.subnetId) await prisma.discoverySchedule.updateMany({ where: { subnetId: job.data.subnetId }, data: { lastStatus: 'COMPLETED', lastError: null } });
    return prisma.discoveryJob.update({ where: { id: jobId }, data: { status: 'COMPLETED', completedAt: new Date() } });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Erro desconhecido';
    if (job.data.subnetId) await prisma.discoverySchedule.updateMany({ where: { subnetId: job.data.subnetId }, data: { lastStatus: 'FAILED', lastError: message } });
    await prisma.discoveryJob.update({ where: { id: jobId }, data: { status: 'FAILED', completedAt: new Date(), errorMessage: message } });
    throw error;
  }
}

const worker = new Worker<DiscoveryData>('discovery', processJob, { connection, concurrency: 2 });
worker.on('completed', (job) => console.info(`[discovery-worker] concluído ${job.id}`));
worker.on('failed', (job, error) => console.error(`[discovery-worker] falhou ${job?.id}:`, error.message));
console.info('[discovery-worker] à escuta na fila discovery');

async function shutdown() { await worker.close(); await prisma.$disconnect(); process.exit(0); }
process.once('SIGINT', () => void shutdown());
process.once('SIGTERM', () => void shutdown());
