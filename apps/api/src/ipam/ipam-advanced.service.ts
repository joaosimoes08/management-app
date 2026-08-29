// @ts-nocheck
import { BadRequestException, ConflictException, Injectable, NotFoundException, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@simoes/database';
import { Queue } from 'bullmq';
import { AuditService } from '../audit/audit.service';
import { AuthenticatedUser } from '../auth/auth.service';
import { IpamAccessService } from './ipam-access.service';
import { assertDiscoveryAllowed, DiscoveryPolicyError } from '../discovery/discovery-policy';
import { CalculatorDto, CreateNatRuleDto, CreateSubnetDto, CreateVrfDto, UpdateNatRuleDto, UpdateSubnetDto, UpdateSubnetScanDto, UpdateVrfDto } from './dto';
import * as net from 'node:net';

function normalizeIpv4(address: string) { const parts = address.split('.').map(Number); if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) throw new BadRequestException('IPv4 inválido'); return parts.join('.'); }
function ipv4Number(address: string) { return normalizeIpv4(address).split('.').reduce((n, part) => n * 256 + Number(part), 0); }
function ipv4Address(value: number) { return [value >>> 24, (value >>> 16) & 255, (value >>> 8) & 255, value & 255].join('.'); }
function ipv4Cidr(cidr: string) { const [address, prefixText] = cidr.trim().split('/'); const prefix = Number(prefixText); if (!Number.isInteger(prefix) || prefix < 0 || prefix > 32) throw new BadRequestException('Prefixo IPv4 inválido'); const value = ipv4Number(address); const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0; const network = (value & mask) >>> 0; const broadcast = (network | (~mask >>> 0)) >>> 0; return { version: 4, prefix, network, broadcast, cidr: `${[network >>> 24, (network >>> 16) & 255, (network >>> 8) & 255, network & 255].join('.')}/${prefix}` }; }
function ipv6Cidr(cidr: string) { const [address, prefixText] = cidr.trim().split('/'); const prefix = Number(prefixText); if (!Number.isInteger(prefix) || prefix < 0 || prefix > 128 || net.isIP(address) !== 6) throw new BadRequestException('CIDR IPv6 inválido'); const expanded = expandIpv6(address); const bits = expanded.replace(/:/g, '').split('').map((x) => parseInt(x, 16).toString(2).padStart(4, '0')).join(''); const networkBits = bits.slice(0, prefix).padEnd(128, '0'); const network = compressIpv6(networkBits.match(/.{16}/g)!.map((chunk) => parseInt(chunk, 2).toString(16).padStart(4, '0')).join(':')); return { version: 6, prefix, network, cidr: `${network}/${prefix}`, total: prefix <= 53 ? 2n ** BigInt(128 - prefix) : null }; }
function expandIpv6(address: string) { const [left, right] = address.split('::'); const leftParts = left ? left.split(':') : []; const rightParts = right ? right.split(':') : []; return [...leftParts, ...Array(8 - leftParts.length - rightParts.length).fill('0'), ...rightParts].map((part) => part.padStart(4, '0')).join(':'); }
function compressIpv6(address: string) { const parts = address.split(':').map((part) => part.replace(/^0+/, '') || '0'); let bestStart = -1; let bestLength = 0; for (let i = 0; i < parts.length;) { if (parts[i] !== '0') { i++; continue; } const start = i; while (i < parts.length && parts[i] === '0') i++; if (i - start > bestLength) { bestStart = start; bestLength = i - start; } } if (bestLength > 1) return `${parts.slice(0, bestStart).join(':')}::${parts.slice(bestStart + bestLength).join(':')}`.replace(/^:/, '::').replace(/:$/, '::'); return parts.join(':'); }
function cidrInfo(cidr: string) { return net.isIP(cidr.split('/')[0]) === 4 ? ipv4Cidr(cidr) : ipv6Cidr(cidr); }
function addressInCidr(address: string, cidr: string) { const info = cidrInfo(cidr); if (net.isIP(address) !== info.version) return false; if (info.version === 4) { const value = ipv4Number(address); return value >= info.network && value <= info.broadcast; } const bits = expandIpv6(address).replace(/:/g, '').split('').map((x) => parseInt(x, 16).toString(2).padStart(4, '0')).join(''); const networkBits = expandIpv6(info.network).replace(/:/g, '').split('').map((x) => parseInt(x, 16).toString(2).padStart(4, '0')).join(''); return bits.slice(0, info.prefix) === networkBits.slice(0, info.prefix); }

@Injectable()
export class IpamAdvancedService implements OnModuleDestroy {
  private readonly queue = new Queue('discovery', { connection: this.redisConnection() });
  constructor(private readonly prisma: PrismaClient, private readonly audit: AuditService, private readonly access: IpamAccessService) {}
  async onModuleDestroy() { await this.queue.disconnect(); }
  private redisConnection() { const url = new URL(process.env.REDIS_URL ?? 'redis://localhost:6379'); return { host: url.hostname, port: Number(url.port || 6379), ...(url.password ? { password: url.password } : {}) }; }
  private async log(user: AuthenticatedUser, action: string, entityType: string, entityId: string, metadata?: unknown) { await this.audit.record({ userId: user.id, action, entityType, entityId, metadata }); }
  async getSubnet(id: string, user?: AuthenticatedUser) { if (user) await this.access.assertSubnet(user, 'READ', id); const item = await this.prisma.subnet.findUnique({ where: { id }, include: { site: true, vlan: true, vrf: true, parentSubnet: true, childSubnets: true, discoverySchedule: true } }); if (!item) throw new NotFoundException('Subnet não encontrada'); return item; }
  async subnetUsage(id: string, user?: AuthenticatedUser) { const subnet = await this.getSubnet(id, user); const counts = await this.prisma.ipAddress.groupBy({ by: ['state'], where: { subnetId: id }, _count: { _all: true } }); const byState = Object.fromEntries(counts.map((item) => [item.state, item._count._all])); const info = cidrInfo(subnet.cidr); const total = info.version === 4 ? info.broadcast - info.network + 1 : info.total; const occupied = (byState.OCCUPIED ?? 0) + (byState.UNKNOWN ?? 0); return { subnet, version: info.version, total, theoreticalCapacity: total, known: Object.values(byState).reduce((a, b) => a + b, 0), occupied, free: info.version === 4 && typeof total === 'number' ? Math.max(0, total - Object.values(byState).reduce((a, b) => a + b, 0)) : null, byState, utilizationPercent: typeof total === 'number' && total > 0 ? Math.round((occupied / total) * 10000) / 100 : null }; }
  async subnetTree(id: string, user?: AuthenticatedUser) { const subnet = await this.getSubnet(id, user); return { root: subnet, children: subnet.childSubnets }; }
  async createSubnet(dto: CreateSubnetDto, user: AuthenticatedUser) {
    await this.access.assertSubnetPlacement(user, 'CREATE', dto);
    const info = cidrInfo(dto.cidr);
    if (dto.gateway && !addressInCidr(dto.gateway, info.cidr)) throw new BadRequestException('O gateway não pertence à subnet');
    if (dto.vlanId && await this.prisma.subnet.findFirst({ where: { vlanId: dto.vlanId } })) throw new ConflictException('A VLAN já tem uma subnet associada');

    // `cidr` is globally unique in the database, independently of Site/VRF.
    // Check it before the scoped overlap query so duplicate requests receive a
    // useful API conflict instead of leaking Prisma's P2002 error.
    if (await this.prisma.subnet.findUnique({ where: { cidr: info.cidr }, select: { id: true } })) {
      throw new ConflictException(`A subnet ${info.cidr} já existe`);
    }

    const conflicts = await this.prisma.subnet.findMany({ where: { siteId: dto.siteId || null, vrfId: dto.vrfId || null }, select: { id: true, cidr: true } });
    const networkAddress = info.version === 4 ? ipv4Address(info.network) : info.network;
    if (conflicts.some((item) => addressInCidr(networkAddress, item.cidr) || addressInCidr(item.cidr.split('/')[0], info.cidr))) throw new ConflictException('A subnet sobrepõe uma subnet existente no mesmo Site/VRF');

    let subnet;
    try {
      subnet = await this.prisma.subnet.create({ data: { cidr: info.cidr, version: info.version, gateway: dto.gateway, purpose: dto.purpose, environment: dto.environment, siteId: dto.siteId || null, vlanId: dto.vlanId || null, vrfId: dto.vrfId || null, parentSubnetId: dto.parentSubnetId || null, scanMethods: ['ICMP'], scanTcpPorts: [22, 80, 443, 3389] } });
    } catch (error) {
      // Preserve a friendly conflict if two create requests race between the
      // preflight check and the database insert.
      if ((error as { code?: string }).code === 'P2002') throw new ConflictException(`A subnet ${info.cidr} já existe`);
      throw error;
    }
    await this.log(user, 'SUBNET_CREATED', 'Subnet', subnet.id, { cidr: subnet.cidr, version: info.version });
    return subnet;
  }
  async updateSubnet(id: string, dto: UpdateSubnetDto, user: AuthenticatedUser) {
    await this.access.assertSubnet(user, 'UPDATE', id);
    const current = await this.prisma.subnet.findUniqueOrThrow({ where: { id } });
    const placement = {
      siteId: dto.siteId === undefined ? current.siteId : dto.siteId,
      vlanId: dto.vlanId === undefined ? current.vlanId : dto.vlanId,
      vrfId: dto.vrfId === undefined ? current.vrfId : dto.vrfId,
      parentSubnetId: dto.parentSubnetId === undefined ? current.parentSubnetId : dto.parentSubnetId,
    };
    const placementChanged = placement.siteId !== current.siteId || placement.vlanId !== current.vlanId || placement.vrfId !== current.vrfId || placement.parentSubnetId !== current.parentSubnetId;
    if (placementChanged) await this.access.assertSubnetPlacement(user, 'UPDATE', placement);
    const info = cidrInfo(dto.cidr ?? current.cidr); if (dto.gateway && !addressInCidr(dto.gateway, info.cidr)) throw new BadRequestException('O gateway não pertence à subnet');
    if (placement.vlanId && placement.vlanId !== current.vlanId && await this.prisma.subnet.findFirst({ where: { vlanId: placement.vlanId, NOT: { id } } })) throw new ConflictException('A VLAN já tem uma subnet associada');
    const conflicts = await this.prisma.subnet.findMany({ where: { id: { not: id }, siteId: placement.siteId || null, vrfId: placement.vrfId || null }, select: { cidr: true } });
    const networkAddress = info.version === 4 ? ipv4Address(info.network) : info.network;
    if (conflicts.some((item) => addressInCidr(networkAddress, item.cidr) || addressInCidr(item.cidr.split('/')[0], info.cidr))) throw new ConflictException('A subnet sobrepõe uma subnet existente no mesmo Site/VRF');
    const item = await this.prisma.subnet.update({ where: { id }, data: { cidr: info.cidr, version: info.version, gateway: dto.gateway, purpose: dto.purpose, environment: dto.environment, ...placement } }).catch(() => { throw new ConflictException('Não foi possível atualizar a subnet.'); });
    await this.log(user, 'SUBNET_UPDATED', 'Subnet', id, { cidr: item.cidr }); return item;
  }
  async updateSubnetScan(id: string, dto: UpdateSubnetScanDto, user: AuthenticatedUser) { await this.access.assertSubnet(user, 'DISCOVER', id); const subnet = await this.getSubnet(id); const defaults = await this.prisma.systemSettings.findFirst(); try { assertDiscoveryAllowed(subnet.cidr, defaults?.discoveryAllowedCidrs); } catch (error) { if (error instanceof DiscoveryPolicyError) throw new BadRequestException({ code: error.code, message: error.message }); throw error; } const methods = [...new Set(dto.methods)]; if (!methods.length || (methods.includes('TCP') && !dto.tcpPorts?.length)) throw new BadRequestException('Configuração de scanning inválida'); const intervalHours = dto.intervalHours ?? defaults?.discoveryDefaultIntervalHours ?? 12; const reverseDns = dto.reverseDns ?? defaults?.discoveryDefaultReverseDns ?? true; const every = intervalHours * 60 * 60 * 1000; const next = dto.enabled ? new Date(Date.now() + every) : null; const item = await this.prisma.subnet.update({ where: { id }, data: { scanEnabled: dto.enabled, scanIntervalHours: intervalHours, scanMethods: methods, scanTcpPorts: dto.tcpPorts ?? [], reverseDnsEnabled: reverseDns, nextScanAt: next } }); if (dto.enabled) await this.queue.upsertJobScheduler(`subnet-${id}`, { every }, { name: 'scheduled-subnet-scan', data: { subnetId: id } }); else await this.queue.removeJobScheduler(`subnet-${id}`); await this.log(user, 'SUBNET_SCAN_CONFIG_UPDATED', 'Subnet', id, { ...dto, intervalHours, reverseDns }); return item; }
  async scanSubnet(id: string, user: AuthenticatedUser) { await this.access.assertSubnet(user, 'DISCOVER', id); const subnet = await this.getSubnet(id); const settings = await this.prisma.systemSettings.findFirst(); try { const target = assertDiscoveryAllowed(subnet.cidr, settings?.discoveryAllowedCidrs); if (target.version !== 4) throw new DiscoveryPolicyError('DISCOVERY_IPV6_UNSUPPORTED', 'A enumeração de subnets IPv6 ainda não é suportada.'); } catch (error) { if (error instanceof DiscoveryPolicyError) throw new BadRequestException({ code: error.code, message: error.message }); throw error; } const methods = Array.isArray(subnet.scanMethods) ? subnet.scanMethods.filter((value): value is string => typeof value === 'string') : ['ICMP']; const tcpPorts = Array.isArray(subnet.scanTcpPorts) ? subnet.scanTcpPorts.filter((value): value is number => typeof value === 'number') : []; const reverseDns = subnet.reverseDnsEnabled; try { const job = await this.prisma.discoveryJob.create({ data: { name: `IPAM check · ${subnet.cidr}`, subnetId: id, methods, tcpPorts, reverseDns } }); await this.queue.add('scan-subnet', { jobId: job.id }, { jobId: job.id, removeOnComplete: 100, removeOnFail: 100 }); await this.log(user, 'SUBNET_SCAN_QUEUED', 'Subnet', id, { jobId: job.id, reverseDns }); return job; } catch { throw new ConflictException({ code: 'DISCOVERY_ALREADY_ACTIVE', message: 'Já existe uma execução ativa para esta subnet.' }); } }
  async getIp(id: string, user?: AuthenticatedUser) { if (user) await this.access.assertIp(user, 'READ', id); const item = await this.prisma.ipAddress.findUnique({ where: { id }, include: { subnet: { include: { vlan: true, vrf: true, site: true } }, host: true, device: true, interface: true } }); if (!item) throw new NotFoundException('IP não encontrado'); return item; }
  async checkIp(id: string, user: AuthenticatedUser) { await this.access.assertIp(user, 'DISCOVER', id); const ip = await this.getIp(id); const settings = await this.prisma.systemSettings.findFirst(); try { assertDiscoveryAllowed(`${ip.address}/${net.isIP(ip.address) === 6 ? 128 : 32}`, settings?.discoveryAllowedCidrs); } catch (error) { if (error instanceof DiscoveryPolicyError) throw new BadRequestException({ code: error.code, message: error.message }); throw error; } const started = Date.now(); const reachable = await new Promise<boolean>((resolve) => { const client = net.createConnection({ host: ip.address, port: 443, timeout: 800 }); client.once('connect', () => { client.destroy(); resolve(true); }); client.once('error', () => resolve(false)); client.once('timeout', () => { client.destroy(); resolve(false); }); }); const updated = await this.prisma.ipAddress.update({ where: { id }, data: { lastCheckAt: new Date(), lastCheckMethod: 'TCP', responseMs: Date.now() - started, observedState: reachable ? 'REACHABLE' : 'UNREACHABLE', icmpReachable: null } }); await this.log(user, 'IP_CHECKED', 'IpAddress', id, { reachable }); return updated; }
  async listVrfs(user: AuthenticatedUser, siteId?: string, search?: string) { const accessWhere = await this.access.whereFor(user, 'READ', 'vrf'); return this.prisma.vrf.findMany({ where: { AND: [accessWhere, { ...(siteId ? { siteId } : {}), ...(search ? { name: { contains: search, mode: 'insensitive' } } : {}) }] }, include: { _count: { select: { subnets: true, natRules: true } } }, orderBy: { name: 'asc' } }); }
  async getVrf(id: string, user?: AuthenticatedUser) { if (user) await this.access.assertVrf(user, 'READ', id); const item = await this.prisma.vrf.findUnique({ where: { id }, include: { site: true, subnets: true, natRules: true } }); if (!item) throw new NotFoundException('VRF não encontrado'); return item; }
  async createVrf(dto: CreateVrfDto, user: AuthenticatedUser) { await this.access.assertSite(user, 'CREATE', dto.siteId); const item = await this.prisma.vrf.create({ data: { ...dto, status: dto.status ?? 'ACTIVE' } }); await this.log(user, 'VRF_CREATED', 'Vrf', item.id); return item; }
  async updateVrf(id: string, dto: UpdateVrfDto, user: AuthenticatedUser) { await this.access.assertVrf(user, 'UPDATE', id); const item = await this.prisma.vrf.update({ where: { id }, data: dto }).catch(() => { throw new NotFoundException('VRF não encontrado'); }); await this.log(user, 'VRF_UPDATED', 'Vrf', id); return item; }
  async deleteVrf(id: string, user: AuthenticatedUser) { await this.access.assertVrf(user, 'DELETE', id); const item = await this.getVrf(id); if (item.subnets.length) throw new ConflictException('Não é possível remover um VRF com subnets'); await this.prisma.vrf.delete({ where: { id } }); await this.log(user, 'VRF_DELETED', 'Vrf', id); return { success: true }; }
  async listNatRules(user: AuthenticatedUser, siteId?: string, vrfId?: string, type?: string, search?: string) { const accessWhere = await this.access.whereFor(user, 'READ', 'nat'); return this.prisma.natRule.findMany({ where: { AND: [accessWhere, { ...(siteId ? { siteId } : {}), ...(vrfId ? { vrfId } : {}), ...(type ? { type: type as never } : {}), ...(search ? { OR: [{ name: { contains: search, mode: 'insensitive' } }, { sourceAddress: { contains: search } }, { translatedAddress: { contains: search } }] } : {}) }] }, include: { sourceSubnet: true, translatedSubnet: true, sourceIp: true, translatedIp: true, device: true, vrf: true }, orderBy: { name: 'asc' } }); }
  async getNatRule(id: string, user?: AuthenticatedUser) { const item = await this.prisma.natRule.findUnique({ where: { id }, include: { sourceSubnet: true, translatedSubnet: true, sourceIp: true, translatedIp: true, device: true, vrf: true } }); if (!item) throw new NotFoundException('Regra NAT não encontrada'); if (user) { if (item.sourceSubnetId) await this.access.assertSubnet(user, 'READ', item.sourceSubnetId); else if (item.vrfId) await this.access.assertVrf(user, 'READ', item.vrfId); else if (item.siteId) await this.access.assertSite(user, 'READ', item.siteId); } return item; }
  async createNatRule(dto: CreateNatRuleDto, user: AuthenticatedUser) { if (dto.sourceSubnetId) await this.access.assertSubnet(user, 'CREATE', dto.sourceSubnetId); else if (dto.vrfId) await this.access.assertVrf(user, 'CREATE', dto.vrfId); else if (dto.siteId) await this.access.assertSite(user, 'CREATE', dto.siteId); const item = await this.prisma.natRule.create({ data: { ...dto, type: dto.type as never, enabled: dto.enabled ?? true } }); await this.log(user, 'NAT_RULE_CREATED', 'NatRule', item.id); return item; }
  async updateNatRule(id: string, dto: UpdateNatRuleDto, user: AuthenticatedUser) { const current = await this.getNatRule(id, user); if (current.sourceSubnetId) await this.access.assertSubnet(user, 'UPDATE', current.sourceSubnetId); const item = await this.prisma.natRule.update({ where: { id }, data: { ...dto, type: dto.type as never } }).catch(() => { throw new NotFoundException('Regra NAT não encontrada'); }); await this.log(user, 'NAT_RULE_UPDATED', 'NatRule', id); return item; }
  async deleteNatRule(id: string, user: AuthenticatedUser) { const current = await this.getNatRule(id, user); if (current.sourceSubnetId) await this.access.assertSubnet(user, 'DELETE', current.sourceSubnetId); await this.prisma.natRule.delete({ where: { id } }); await this.log(user, 'NAT_RULE_DELETED', 'NatRule', id); return { success: true }; }
  async calculator(dto: CalculatorDto) {
    const requestedCidr = dto.cidr ?? (dto.address ? `${dto.address}/${dto.basePrefix ?? 24}` : '');
    const info = cidrInfo(requestedCidr.includes('/') ? requestedCidr : `${requestedCidr}/24`);
    const networkAddress = info.version === 4 ? ipv4Address(info.network) : info.network;
    if (dto.operation === 'summary') return { ...info, firstUsable: info.version === 4 ? ipv4Address(info.prefix >= 31 ? info.network : info.network + 1) : info.network, lastUsable: info.version === 4 ? ipv4Address(info.prefix >= 31 ? info.broadcast : info.broadcast - 1) : info.network, total: info.version === 4 ? info.broadcast - info.network + 1 : info.total?.toString() };
    if (dto.operation === 'contains') return { cidr: info.cidr, address: dto.address, contains: dto.address ? addressInCidr(dto.address, info.cidr) : false };
    if (dto.operation === 'overlap') return { cidr: info.cidr, overlaps: (dto.cidrs ?? []).filter((cidr) => addressInCidr(cidr.split('/')[0], info.cidr) || addressInCidr(networkAddress, cidr)) };
    if (info.version === 4 && dto.newPrefix !== undefined && dto.newPrefix >= info.prefix) {
      const subnetCount = 2 ** (dto.newPrefix - info.prefix);
      if (subnetCount > 4096) throw new BadRequestException('A divisão geraria demasiadas subnets. Escolhe um prefixo destino maior.');
      const blockSize = 2 ** (32 - dto.newPrefix);
      const subnets = Array.from({ length: subnetCount }, (_, index) => {
        const network = info.network + index * blockSize;
        const broadcast = network + blockSize - 1;
        const firstUsable = dto.newPrefix >= 31 ? network : network + 1;
        const lastUsable = dto.newPrefix >= 31 ? broadcast : broadcast - 1;
        return { number: index + 1, cidr: `${ipv4Address(network)}/${dto.newPrefix}`, network: ipv4Address(network), firstUsable: ipv4Address(firstUsable), lastUsable: ipv4Address(lastUsable), usableRange: `${ipv4Address(firstUsable)} - ${ipv4Address(lastUsable)}`, broadcast: ipv4Address(broadcast), usableIps: dto.newPrefix >= 31 ? blockSize : Math.max(0, blockSize - 2) };
      });
      return { parent: info.cidr, newPrefix: dto.newPrefix, subnetCount, subnets };
    }
    throw new BadRequestException('Escolhe uma netmask destino maior que a máscara da rede base.');
  }
  async ripePreview(dto: { query: string; queryType?: string }, user: AuthenticatedUser) {
    const query = dto.query.trim();
    const queryType = dto.queryType ?? (query.toUpperCase().startsWith('AS') ? 'asn' : net.isIP(query.split('/')[0]) ? 'prefix' : 'organisation');
    const resource = queryType === 'asn' ? query.replace(/^AS/i, '') : query;
    const endpoint = queryType === 'asn' ? `announced-prefixes/data.json?resource=AS${encodeURIComponent(resource)}` : `whois/data.json?resource=${encodeURIComponent(resource)}`;
    const base = process.env.RIPESTAT_BASE_URL ?? 'https://stat.ripe.net/data/';
    const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), 8000);
    try {
      const response = await fetch(`${base.replace(/\/$/, '/')}${endpoint}`, { signal: controller.signal, headers: { accept: 'application/json' } });
      if (!response.ok) throw new Error(`RIPEstat respondeu ${response.status}`);
      const payload: any = await response.json();
      const prefixes = queryType === 'asn' ? (payload.data?.prefixes ?? []) : (payload.data?.records ?? []).map((record: any) => record.prefix).filter(Boolean);
      const unique = [...new Set(prefixes.filter((prefix: unknown): prefix is string => typeof prefix === 'string'))];
      const item = await this.prisma.ripeImport.create({ data: { query, queryType, status: 'PREVIEW', result: { prefixes: unique, source: 'RIPESTAT' }, createdBy: user.id } });
      await this.log(user, 'RIPE_PREVIEW_CREATED', 'RipeImport', item.id, { query, count: unique.length });
      return { id: item.id, query, queryType, prefixes: unique, status: item.status };
    } catch (error) { throw new BadRequestException(error instanceof Error ? `Consulta RIPE falhou: ${error.message}` : 'Consulta RIPE falhou'); } finally { clearTimeout(timer); }
  }
  async listRipeImports(user: AuthenticatedUser) { return this.prisma.ripeImport.findMany({ where: user.roles.includes('ADMIN') ? {} : { createdBy: user.id }, orderBy: { createdAt: 'desc' }, take: 50 }); }
  async getRipeImport(id: string, user: AuthenticatedUser) { const item = await this.prisma.ripeImport.findFirst({ where: { id, ...(user.roles.includes('ADMIN') ? {} : { createdBy: user.id }) } }); if (!item) throw new NotFoundException('Importação RIPE não encontrada'); return item; }
  async importRipe(dto: { importId: string; prefixes: string[]; siteId: string; vrfId?: string; vlanId?: string; purpose?: string; environment?: string }, user: AuthenticatedUser) {
    await this.access.assertSite(user, 'IMPORT', dto.siteId);
    const preview = await this.getRipeImport(dto.importId, user); const available = new Set((preview.result as any)?.prefixes ?? []); const selected = [...new Set(dto.prefixes)].filter((prefix) => available.has(prefix));
    if (!selected.length) throw new BadRequestException('Seleciona prefixos presentes na pré-visualização');
    const created: any[] = []; const skipped: any[] = [];
    for (const cidr of selected) { try { created.push(await this.createSubnet({ cidr, siteId: dto.siteId, vrfId: dto.vrfId, vlanId: dto.vlanId, purpose: dto.purpose, environment: dto.environment }, user)); } catch (error) { skipped.push({ cidr, reason: error instanceof Error ? error.message : 'Não importado' }); } }
    const status = created.length && skipped.length ? 'PARTIAL' : created.length ? 'IMPORTED' : 'FAILED';
    await this.prisma.ripeImport.update({ where: { id: dto.importId }, data: { status, result: { ...(preview.result as any), selected, created: created.map((item) => item.id), skipped } } });
    return { status, created, skipped };
  }
}
