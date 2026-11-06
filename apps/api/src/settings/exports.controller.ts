import { Controller, Get, Param, Query, Req, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthenticatedUser } from '../auth/auth.service';
import { ExportsService } from './exports.service';
import { Roles } from '../auth/roles.decorator';

@ApiTags('exports') @ApiBearerAuth() @Controller({ path: 'exports', version: '1' })
export class ExportsController {
  constructor(private readonly service: ExportsService) {}
  @Get('ansible') @Roles('ADMIN', 'NETWORK_OPERATOR', 'SYSTEMS_OPERATOR', 'AUDITOR', 'READ_ONLY') async ansible(@Query('siteId') siteId: string | undefined, @Req() req: { user: AuthenticatedUser }, @Res({ passthrough: true }) reply: any) {
    const inventory = await this.service.ansibleInventory(siteId, req.user);
    reply.type('application/json; charset=utf-8');
    reply.header('Content-Disposition', 'attachment; filename="ansible-inventory.json"');
    return JSON.stringify(inventory, null, 2);
  }
  @Get(':kind/:format') @Roles('ADMIN', 'NETWORK_OPERATOR', 'SYSTEMS_OPERATOR', 'AUDITOR', 'READ_ONLY') async export(@Param('kind') kind: string, @Param('format') format: string, @Query('siteId') siteId: string | undefined, @Req() req: { user: AuthenticatedUser }, @Res({ passthrough: true }) reply: any) {
    const result = await this.service.export(kind, format, siteId, req.user);
    const rows = result.rows.map((row) => Object.fromEntries(result.fields.map((field) => [field, row[field] ?? null])));
    const body = format === 'json' ? JSON.stringify(rows, null, 2) : [result.fields.join(','), ...rows.map((row) => result.fields.map((field) => csvCell(row[field])).join(','))].join('\r\n');
    reply.type(format === 'json' ? 'application/json; charset=utf-8' : 'text/csv; charset=utf-8');
    reply.header('Content-Disposition', `attachment; filename="${kind}-export.${format}"`);
    return body;
  }
}
function csvCell(value: unknown) {
  let text = value instanceof Date ? value.toISOString() : typeof value === 'object' && value !== null ? JSON.stringify(value) : String(value ?? '');
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}
