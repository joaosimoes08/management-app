import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import { PrismaClient } from '@simoes/database';
import { AuditService } from '../audit/audit.service';
import { AuthenticatedUser } from '../auth/auth.service';
import { OrganizationDto } from './dto/organization.dto';
import { InitialSiteDto } from './dto/site.dto';

@Injectable()
export class SetupService {
  constructor(private readonly prisma: PrismaClient, private readonly audit: AuditService) {}

  private async settings() {
    const existing = await this.prisma.systemSettings.findFirst();
    return existing ?? this.prisma.systemSettings.create({ data: {} });
  }

  async status() {
    const settings = await this.settings();
    const siteCount = await this.prisma.site.count();
    return { setupCompleted: settings.setupCompleted, organizationName: settings.organizationName, organizationCode: settings.organizationCode, timezone: settings.timezone, siteCount, hasSite: siteCount > 0 };
  }

  async saveOrganization(dto: OrganizationDto, user: AuthenticatedUser) {
    const settings = await this.settings();
    const updated = await this.prisma.systemSettings.update({ where: { id: settings.id }, data: { organizationName: dto.name.trim(), organizationCode: dto.code?.trim().toUpperCase() || null, timezone: dto.timezone ?? settings.timezone, setupCompleted: false } });
    await this.audit.record({ userId: user.id, action: 'INITIAL_SETUP_ORGANIZATION_SAVED', entityType: 'SystemSettings', entityId: updated.id, metadata: { organizationName: updated.organizationName, organizationCode: updated.organizationCode } });
    return updated;
  }

  async createSite(dto: InitialSiteDto, user: AuthenticatedUser) {
    const existing = await this.prisma.site.findUnique({ where: { code: dto.code.trim().toUpperCase() } });
    if (existing) throw new ConflictException('Já existe um site com esse código');
    const site = await this.prisma.$transaction(async (tx) => {
      const created = await tx.site.create({ data: { name: dto.name.trim(), code: dto.code.trim().toUpperCase(), address: dto.address?.trim(), city: dto.city?.trim(), region: dto.region?.trim(), country: dto.country?.trim() } });
      if (!dto.buildingName) return created;
      const building = await tx.building.create({ data: { name: dto.buildingName.trim(), siteId: created.id } });
      if (!dto.roomName) return created;
      const room = await tx.room.create({ data: { name: dto.roomName.trim(), buildingId: building.id } });
      if (dto.rackName) await tx.rack.create({ data: { name: dto.rackName.trim(), roomId: room.id } });
      return created;
    });
    await this.audit.record({ userId: user.id, action: 'INITIAL_SETUP_SITE_CREATED', entityType: 'Site', entityId: site.id, metadata: { name: site.name, code: site.code } });
    return site;
  }

  async complete(user: AuthenticatedUser) {
    const settings = await this.settings();
    const siteCount = await this.prisma.site.count();
    if (!settings.organizationName) throw new BadRequestException('Define primeiro o nome da organização');
    if (!siteCount) throw new BadRequestException('Crie pelo menos um site antes de concluir');
    const updated = await this.prisma.systemSettings.update({ where: { id: settings.id }, data: { setupCompleted: true, setupCompletedAt: new Date(), setupCompletedBy: user.id } });
    await this.audit.record({ userId: user.id, action: 'INITIAL_SETUP_COMPLETED', entityType: 'SystemSettings', entityId: updated.id });
    return this.status();
  }

  async reopen(user: AuthenticatedUser) {
    const settings = await this.settings();
    const updated = await this.prisma.systemSettings.update({ where: { id: settings.id }, data: { setupCompleted: false, setupCompletedAt: null, setupCompletedBy: null } });
    await this.audit.record({ userId: user.id, action: 'INITIAL_SETUP_REOPENED', entityType: 'SystemSettings', entityId: updated.id });
    return this.status();
  }
}
