/**
 * Step 32 report document and its renderings: plain text and HTML for the e-mail body, CSV for the attachment and
 * download. Pure functions, so the same document always renders the same way.
 */
export const REPORT_SECTIONS = ['COMPLIANCE', 'LIFECYCLE', 'QUALITY', 'CAPACITY', 'CHANGES'] as const;
export type ReportSection = (typeof REPORT_SECTIONS)[number];
export const SECTION_LABELS: Record<ReportSection, string> = {
  COMPLIANCE: 'Conformidade da atestação',
  LIFECYCLE: 'Datas de ciclo de vida (próximos 90 dias)',
  QUALITY: 'Achados de qualidade abertos',
  CAPACITY: 'Capacidade acima do limiar',
  CHANGES: 'Alterações concluídas ou falhadas',
};
export const SEVERITIES = ['CRITICAL', 'HIGH', 'WARNING', 'INFO'] as const;
const STATUS_LABELS: Record<string, string> = { COMPLETED: 'Concluída', FAILED: 'Falhada', ROLLED_BACK: 'Revertida' };
const KIND_LABELS: Record<string, string> = {
  SUBNET: 'Sub-rede', NETAPP_VOLUME: 'Volume NetApp', NETAPP_AGGREGATE: 'Agregado NetApp', RACK_SPACE: 'Espaço em bastidor', RACK_POWER: 'Energia do bastidor', PDU_POWER: 'Energia da PDU',
};
const LIFECYCLE_LABELS: Record<string, string> = { LICENSE: 'Licença', WARRANTY: 'Garantia', SUPPORT: 'Suporte' };

/** A section the recipient may not see is reported as unavailable, never with figures. */
type Unavailable = { available: false };
export type ComplianceGroup = { group: string; expected: number; onTime: number; percent: number | null };
export type ComplianceSection = { available: true; expected: number; onTime: number; percent: number | null; groups: ComplianceGroup[] } | Unavailable;
export type LifecycleItem = { deviceName: string; kind: string; dueDate: string };
export type LifecycleSection = { available: true; from: string; to: string; items: LifecycleItem[] } | Unavailable;
export type QualitySection = { available: true; total: number; bySeverity: Record<string, number> } | Unavailable;
export type CapacityItem = { kind: string; name: string; level: 'warning' | 'critical'; currentPercent: number | null };
export type CapacitySection = { available: true; warningPercent: number; criticalPercent: number; warning: number; critical: number; items: CapacityItem[] } | Unavailable;
export type ChangeItem = { title: string; status: string; plannedStartAt: string };
export type ChangesSection = { available: true; completed: number; failed: number; rolledBack: number; items: ChangeItem[] } | Unavailable;

export type SiteReport = {
  siteId: string;
  siteName: string;
  compliance?: ComplianceSection;
  lifecycle?: LifecycleSection;
  quality?: QualitySection;
  capacity?: CapacitySection;
  changes?: ChangesSection;
};
export type ReportDocument = {
  reportId: string;
  reportName: string;
  frequency: 'WEEKLY' | 'MONTHLY';
  timezone: string;
  /** First and last day included (YYYY-MM-DD, report time zone). */
  periodStart: string;
  periodEnd: string;
  generatedAt: string;
  sections: ReportSection[];
  sites: SiteReport[];
};

const LIST_LIMIT = 10;
const pct = (value: number | null) => (value === null ? '—' : `${value}%`);
const dayPt = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
export const periodLabel = (doc: Pick<ReportDocument, 'periodStart' | 'periodEnd'>) => `${dayPt(doc.periodStart)} a ${dayPt(doc.periodEnd)}`;
export const reportSubject = (doc: ReportDocument) => `Relatório ${doc.frequency === 'WEEKLY' ? 'semanal' : 'mensal'}: ${doc.reportName} (${periodLabel(doc)})`;
const lifecycleLabel = (kind: string) => LIFECYCLE_LABELS[kind] ?? kind;
const kindLabel = (kind: string) => KIND_LABELS[kind] ?? kind;
const levelLabel = (level: string) => (level === 'critical' ? 'Crítico' : 'Aviso');

/** One line per section: the headline figures, used by the text and HTML bodies. */
export function sectionHeadline(section: ReportSection, site: SiteReport): string {
  switch (section) {
    case 'COMPLIANCE': {
      const value = site.compliance;
      if (!value?.available) return 'Sem acesso a esta informação.';
      return value.expected ? `${pct(value.percent)} das revisões no prazo (${value.onTime} de ${value.expected}).` : 'Sem ciclos de revisão abertos no período.';
    }
    case 'LIFECYCLE': {
      const value = site.lifecycle;
      if (!value?.available) return 'Sem acesso a esta informação.';
      return value.items.length ? `${value.items.length} data(s) até ${dayPt(value.to)}.` : `Nenhuma data até ${dayPt(value.to)}.`;
    }
    case 'QUALITY': {
      const value = site.quality;
      if (!value?.available) return 'Sem acesso a esta informação.';
      return value.total ? `${value.total} achado(s) aberto(s): ${SEVERITIES.map((severity) => `${severity} ${value.bySeverity[severity] ?? 0}`).join(' · ')}.` : 'Nenhum achado aberto.';
    }
    case 'CAPACITY': {
      const value = site.capacity;
      if (!value?.available) return 'Sem acesso a esta informação.';
      return value.items.length ? `${value.critical} crítico(s) (≥ ${value.criticalPercent}%) e ${value.warning} em aviso (≥ ${value.warningPercent}%).` : `Nenhum recurso acima de ${value.warningPercent}%.`;
    }
    case 'CHANGES': {
      const value = site.changes;
      if (!value?.available) return 'Sem acesso a esta informação.';
      return value.completed + value.failed + value.rolledBack ? `${value.completed} concluída(s), ${value.failed} falhada(s), ${value.rolledBack} revertida(s).` : 'Nenhuma alteração concluída ou falhada no período.';
    }
  }
}

/** Detail lines under a section (at most 10 in the e-mail body; the CSV has everything). */
function sectionDetails(section: ReportSection, site: SiteReport): string[] {
  if (section === 'COMPLIANCE' && site.compliance?.available) return site.compliance.groups.map((group) => `${group.group}: ${pct(group.percent)} (${group.onTime} de ${group.expected})`);
  if (section === 'LIFECYCLE' && site.lifecycle?.available) return site.lifecycle.items.map((item) => `${dayPt(item.dueDate)} · ${lifecycleLabel(item.kind)} · ${item.deviceName}`);
  if (section === 'CAPACITY' && site.capacity?.available) return site.capacity.items.map((item) => `${levelLabel(item.level)} · ${item.name} (${kindLabel(item.kind)}) · ${pct(item.currentPercent)}`);
  if (section === 'CHANGES' && site.changes?.available) return site.changes.items.map((item) => `${STATUS_LABELS[item.status] ?? item.status} · ${item.title}`);
  return [];
}

export type ReportLinks = { app?: string | null; unsubscribe?: string | null };

function footerLines(links: ReportLinks) {
  return [
    'Recebe este relatório porque um administrador o incluiu na lista de destinatários. Cada destinatário vê apenas os Sites a que tem acesso.',
    links.unsubscribe ? `Cancelar a subscrição: ${links.unsubscribe}` : 'Para deixar de receber este relatório, desative-o em Perfil → Notificações.',
  ];
}

export function reportText(doc: ReportDocument, links: ReportLinks = {}) {
  const lines = [reportSubject(doc), `Gerado em ${doc.generatedAt.slice(0, 16).replace('T', ' ')} UTC · fuso horário ${doc.timezone}`, ''];
  if (!doc.sites.length) lines.push('Não tem acesso a nenhum dos Sites deste relatório.', '');
  for (const site of doc.sites) {
    lines.push(`== ${site.siteName} ==`);
    for (const section of doc.sections) {
      lines.push(`${SECTION_LABELS[section]}: ${sectionHeadline(section, site)}`);
      const details = sectionDetails(section, site);
      for (const line of details.slice(0, LIST_LIMIT)) lines.push(`  - ${line}`);
      if (details.length > LIST_LIMIT) lines.push(`  … e mais ${details.length - LIST_LIMIT} (ver CSV em anexo)`);
    }
    lines.push('');
  }
  if (links.app) lines.push(`Abrir na aplicação: ${links.app}`, '');
  lines.push(...footerLines(links));
  return lines.join('\n');
}

const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);
const safeLink = (url: string | null | undefined) => (url && /^https?:\/\//.test(url) ? url : null);

export function reportHtml(doc: ReportDocument, links: ReportLinks = {}) {
  const app = safeLink(links.app); const unsubscribe = safeLink(links.unsubscribe);
  const parts = [
    '<div style="font-family:Segoe UI,Arial,sans-serif;font-size:14px;color:#1f2937;max-width:720px">',
    `<h2 style="margin:0 0 4px">${escapeHtml(doc.reportName)}</h2>`,
    `<p style="margin:0 0 16px;color:#6b7280">${escapeHtml(`${doc.frequency === 'WEEKLY' ? 'Relatório semanal' : 'Relatório mensal'} · ${periodLabel(doc)} · fuso horário ${doc.timezone}`)}</p>`,
  ];
  if (!doc.sites.length) parts.push('<p>Não tem acesso a nenhum dos Sites deste relatório.</p>');
  for (const site of doc.sites) {
    parts.push(`<h3 style="margin:20px 0 8px;border-bottom:1px solid #e5e7eb;padding-bottom:4px">${escapeHtml(site.siteName)}</h3>`, '<table style="border-collapse:collapse;width:100%">');
    for (const section of doc.sections) {
      const details = sectionDetails(section, site);
      const list = details.length ? `<ul style="margin:4px 0 0;padding-left:18px">${details.slice(0, LIST_LIMIT).map((line) => `<li>${escapeHtml(line)}</li>`).join('')}${details.length > LIST_LIMIT ? `<li>… e mais ${details.length - LIST_LIMIT} (ver CSV em anexo)</li>` : ''}</ul>` : '';
      parts.push(`<tr><td style="vertical-align:top;padding:6px 12px 6px 0;width:38%;font-weight:600">${escapeHtml(SECTION_LABELS[section])}</td><td style="vertical-align:top;padding:6px 0">${escapeHtml(sectionHeadline(section, site))}${list}</td></tr>`);
    }
    parts.push('</table>');
  }
  if (app) parts.push(`<p style="margin:20px 0"><a href="${escapeHtml(app)}">Abrir na aplicação</a></p>`);
  const [why, how] = footerLines(links);
  parts.push(`<p style="margin-top:24px;font-size:12px;color:#6b7280">${escapeHtml(why)}<br>${unsubscribe ? `<a href="${escapeHtml(unsubscribe)}">Cancelar a subscrição</a>` : escapeHtml(how)}</p>`, '</div>');
  return parts.join('');
}

/** Same protection as the other CSV exports: quoted cells, formula prefixes neutralised. */
export function csvCell(value: unknown) {
  let text = value === null || value === undefined ? '' : String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

export const CSV_HEADER = ['Site', 'Secção', 'Indicador', 'Elemento', 'Valor', 'Detalhe'];

/** One row per figure or item. Unavailable sections get one row saying so, without figures. */
export function reportCsvRows(doc: ReportDocument): unknown[][] {
  const rows: unknown[][] = [];
  for (const site of doc.sites) {
    const add = (section: ReportSection, indicator: string, element: unknown, value: unknown, detail: unknown = '') => rows.push([site.siteName, SECTION_LABELS[section], indicator, element, value, detail]);
    for (const section of doc.sections) {
      const key = section.toLowerCase() as 'compliance' | 'lifecycle' | 'quality' | 'capacity' | 'changes';
      if (!site[key]?.available) { add(section, 'Sem acesso', '', ''); continue; }
      if (section === 'COMPLIANCE' && site.compliance?.available) {
        add(section, 'Revisões no prazo (%)', 'Total', site.compliance.percent ?? '', `${site.compliance.onTime}/${site.compliance.expected}`);
        for (const group of site.compliance.groups) add(section, 'Revisões no prazo (%)', group.group, group.percent ?? '', `${group.onTime}/${group.expected}`);
      }
      if (section === 'LIFECYCLE' && site.lifecycle?.available) for (const item of site.lifecycle.items) add(section, lifecycleLabel(item.kind), item.deviceName, item.dueDate);
      if (section === 'QUALITY' && site.quality?.available) {
        add(section, 'Achados abertos', 'Total', site.quality.total);
        for (const severity of SEVERITIES) add(section, 'Achados abertos', severity, site.quality.bySeverity[severity] ?? 0);
      }
      if (section === 'CAPACITY' && site.capacity?.available) for (const item of site.capacity.items) add(section, levelLabel(item.level), item.name, item.currentPercent ?? '', kindLabel(item.kind));
      if (section === 'CHANGES' && site.changes?.available) {
        add(section, 'Concluídas', 'Total', site.changes.completed);
        add(section, 'Falhadas', 'Total', site.changes.failed);
        add(section, 'Revertidas', 'Total', site.changes.rolledBack);
        for (const item of site.changes.items) add(section, STATUS_LABELS[item.status] ?? item.status, item.title, item.plannedStartAt);
      }
    }
  }
  return rows;
}

/** UTF-8 with BOM so spreadsheet apps read the accents; CRLF line ends like the other exports. */
export function reportCsv(doc: ReportDocument) {
  return `﻿${[CSV_HEADER, ...reportCsvRows(doc)].map((row) => row.map(csvCell).join(',')).join('\r\n')}\r\n`;
}

export const csvFilename = (reportName: string, periodStart: string) => `relatorio-${reportName.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'agendado'}-${periodStart}.csv`;
