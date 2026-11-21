/** Shared labels for scheduled reports (Definições → Relatórios and Perfil → Notificações). */
export type ReportSection = 'COMPLIANCE' | 'LIFECYCLE' | 'QUALITY' | 'CAPACITY' | 'CHANGES';
export type ReportFrequency = 'WEEKLY' | 'MONTHLY';

export const REPORT_SECTIONS: { value: ReportSection; label: string; description: string }[] = [
  { value: 'COMPLIANCE', label: 'Conformidade das atestações', description: 'Ciclos de atestação de ativos críticos do período e quantos foram registados a tempo.' },
  { value: 'LIFECYCLE', label: 'Datas de ciclo de vida', description: 'Licenças, garantias e suporte que vencem nos próximos 90 dias.' },
  { value: 'QUALITY', label: 'Qualidade do inventário', description: 'Problemas de qualidade em aberto, por severidade.' },
  { value: 'CAPACITY', label: 'Capacidade', description: 'Elementos acima de 80% (aviso) ou 90% (crítico).' },
  { value: 'CHANGES', label: 'Alterações', description: 'Alterações concluídas, falhadas ou revertidas no período.' },
];
export const SECTION_LABEL = Object.fromEntries(REPORT_SECTIONS.map(({ value, label }) => [value, label])) as Record<ReportSection, string>;
export const WEEKDAYS = ['segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado', 'domingo'];

export function scheduleLabel(report: { frequency: ReportFrequency; dayOfWeek: number | null; dayOfMonth: number | null; hour: number; timezone: string }) {
  const hour = `${String(report.hour).padStart(2, '0')}:00`;
  return report.frequency === 'WEEKLY'
    ? `Semanal · ${WEEKDAYS[(report.dayOfWeek ?? 1) - 1]} às ${hour} (${report.timezone})`
    : `Mensal · dia ${report.dayOfMonth ?? 1} às ${hour} (${report.timezone})`;
}

export const reportCsvFilename = (name: string) => `relatorio-${name.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'agendado'}.csv`;
