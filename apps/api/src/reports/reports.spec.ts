import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { emailContent, emailExtras } from '../notifications/delivery/email-sender';
import { csvCell, csvFilename, reportCsv, reportCsvRows, ReportDocument, reportHtml, reportSubject, reportText } from './report-content';
import { compliance } from './report-generator.service';
import { nextRunAt, reportPeriod } from './report-schedule';

const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

test('weekly schedule: next local send day and hour, strictly after now, across DST', () => {
  const weekly = { frequency: 'WEEKLY' as const, dayOfWeek: 1, dayOfMonth: null, hour: 8, timezone: 'Europe/Lisbon' };
  // Saturday 21 Nov 2026 (WET, UTC+0): next Monday 23 Nov 08:00 local.
  assert.equal(nextRunAt(weekly, new Date('2026-11-21T10:00:00Z')).toISOString(), '2026-11-23T08:00:00.000Z');
  // Monday at exactly 08:00 is not "after": the following Monday.
  assert.equal(nextRunAt(weekly, new Date('2026-11-23T08:00:00Z')).toISOString(), '2026-11-30T08:00:00.000Z');
  // Summer time (WEST, UTC+1): 08:00 local is 07:00Z.
  assert.equal(nextRunAt(weekly, new Date('2026-06-02T00:00:00Z')).toISOString(), '2026-06-08T07:00:00.000Z');
  // A zone ahead of UTC: Monday 08:00 in Tokyo is Sunday 23:00Z.
  assert.equal(nextRunAt({ ...weekly, timezone: 'Asia/Tokyo' }, new Date('2026-11-22T12:00:00Z')).toISOString(), '2026-11-22T23:00:00.000Z');
});

test('monthly schedule and periods', () => {
  const monthly = { frequency: 'MONTHLY' as const, dayOfWeek: null, dayOfMonth: 1, hour: 6, timezone: 'Europe/Lisbon' };
  assert.equal(nextRunAt(monthly, new Date('2026-11-21T10:00:00Z')).toISOString(), '2026-12-01T06:00:00.000Z');
  assert.deepEqual(reportPeriod('MONTHLY', new Date('2026-12-01T06:00:00Z'), 'Europe/Lisbon'), { start: d('2026-11-01'), end: d('2026-12-01') });
  assert.deepEqual(reportPeriod('MONTHLY', new Date('2027-01-01T06:00:00Z'), 'Europe/Lisbon'), { start: d('2026-12-01'), end: d('2027-01-01') });
  assert.deepEqual(reportPeriod('WEEKLY', new Date('2026-11-23T08:00:00Z'), 'Europe/Lisbon'), { start: d('2026-11-16'), end: d('2026-11-23') });
  // The local date decides: 23:30Z on the 22nd is already the 23rd in Tokyo.
  assert.deepEqual(reportPeriod('WEEKLY', new Date('2026-11-22T23:30:00Z'), 'Asia/Tokyo'), { start: d('2026-11-16'), end: d('2026-11-23') });
});

test('compliance counts cycles opened in the period, on time only before dueAt', () => {
  const at = (week: string, dueAt: string, outcome: string | null, confirmedAt: string | null) => ({ weekStart: week, dueAt, outcome, confirmedAt });
  const assets = [
    { id: 'a', owner: { name: 'Redes' }, attestations: [
      at('2026-11-16', '2026-11-20T17:00:00.000Z', 'OK', '2026-11-18T10:00:00.000Z'), // on time
      at('2026-11-09', '2026-11-13T17:00:00.000Z', 'OK', '2026-11-10T10:00:00.000Z'), // before the period
    ] },
    { id: 'b', owner: { name: 'Redes' }, attestations: [at('2026-11-16', '2026-11-20T17:00:00.000Z', 'OK', '2026-11-21T10:00:00.000Z')] }, // late
    { id: 'c', owner: { name: 'Sistemas' }, attestations: [at('2026-11-16', '2026-11-20T17:00:00.000Z', null, null)] }, // missing
    { id: 'd', owner: null, attestations: [at('2026-11-16', '2026-11-20T17:00:00.000Z', 'OK', '2026-11-17T10:00:00.000Z')] }, // no group
  ];
  const result = compliance(assets, { start: d('2026-11-16'), end: d('2026-11-23') });
  assert.deepEqual(result, { available: true, expected: 3, onTime: 1, percent: 33, groups: [
    { group: 'Redes', expected: 2, onTime: 1, percent: 50 }, { group: 'Sistemas', expected: 1, onTime: 0, percent: 0 },
  ] });
  assert.equal((compliance([], { start: d('2026-11-16'), end: d('2026-11-23') }) as { percent: null }).percent, null);
});

const doc: ReportDocument = {
  reportId: 'r', reportName: 'Operação <semanal>', frequency: 'WEEKLY', timezone: 'Europe/Lisbon', periodStart: '2026-11-16', periodEnd: '2026-11-22',
  generatedAt: '2026-11-23T08:00:00.000Z', sections: ['COMPLIANCE', 'QUALITY', 'CAPACITY', 'CHANGES', 'LIFECYCLE'],
  sites: [{
    siteId: 's', siteName: '=Lisboa',
    compliance: { available: true, expected: 4, onTime: 3, percent: 75, groups: [{ group: 'Redes', expected: 4, onTime: 3, percent: 75 }] },
    quality: { available: true, total: 5, bySeverity: { CRITICAL: 1, WARNING: 4 } },
    capacity: { available: false },
    changes: { available: true, completed: 2, failed: 1, rolledBack: 0, items: [{ title: 'Upgrade core', status: 'FAILED', plannedStartAt: '2026-11-18T21:00:00.000Z' }] },
    lifecycle: { available: true, from: '2026-11-23', to: '2027-02-21', items: [{ deviceName: 'sw-01', kind: 'WARRANTY', dueDate: '2026-12-31' }] },
  }],
};

test('renders subject, text, escaped HTML and footer links', () => {
  assert.equal(reportSubject(doc), 'Relatório semanal: Operação <semanal> (16/11/2026 a 22/11/2026)');
  const links = { app: 'https://mgmt.example/perfil?tab=notifications', unsubscribe: 'https://mgmt.example/relatorios/cancelar-subscricao?token=abc' };
  const text = reportText(doc, links);
  assert.match(text, /=Lisboa/); assert.match(text, /75%/); assert.match(text, /cancelar-subscricao\?token=abc/);
  const html = reportHtml(doc, links);
  assert.ok(html.includes('Operação &lt;semanal&gt;')); assert.ok(!html.includes('<semanal>'));
  assert.ok(html.includes('href="https://mgmt.example/relatorios/cancelar-subscricao?token=abc"'));
});

test('CSV: one row per figure, unavailable sections marked, formula cells neutralised', () => {
  const rows = reportCsvRows(doc);
  assert.ok(rows.some((row) => String(row.join('|')).includes('Sem acesso')));
  const csv = reportCsv(doc);
  assert.ok(csv.startsWith('﻿')); assert.ok(csv.includes('\r\n'));
  assert.ok(csv.includes(`"'=Lisboa"`)); assert.ok(!csv.includes(',"=Lisboa"'));
  assert.equal(csvCell('+cmd'), `"'+cmd"`); assert.equal(csvCell('a"b'), '"a""b"');
  assert.equal(csvFilename('Operação Semanal / Lisboa', '2026-11-16'), 'relatorio-operacao-semanal-lisboa-2026-11-16.csv');
});

test('e-mail extras: attachment, List-Unsubscribe only for http(s), prepared body', () => {
  const base = { title: 'Relatório', message: 'curto', url: null, recipientLabel: null } as never as Parameters<typeof emailExtras>[0];
  assert.deepEqual(emailExtras(base), {});
  const extras = emailExtras({ ...base, attachments: [{ filename: 'a\r\n"b.csv', content: 'x', contentType: 'text/csv' }], unsubscribeUrl: 'https://mgmt.example/u?token=t' });
  assert.equal(extras.attachments?.[0].filename, 'ab.csv');
  assert.deepEqual(extras.headers, { 'List-Unsubscribe': '<https://mgmt.example/u?token=t>' });
  assert.equal(emailExtras({ ...base, unsubscribeUrl: 'javascript:alert(1)' }).headers, undefined);
  assert.deepEqual(emailContent({ ...base, body: { text: 'T', html: '<p>H</p>' } }), { subject: 'Relatório', text: 'T', html: '<p>H</p>' });
});
