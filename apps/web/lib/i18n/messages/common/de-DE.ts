/** Shared UI (dialogs, toasts, data tables, saved views): Deutsch. Loaded only when de-DE is chosen. */
import type { CommonMessageKey } from './pt-PT';

export const messages: Record<string, string> = {
  'common.ui.close': 'Schließen',
  'common.ui.time24': 'Uhrzeit (24 h)',
  'common.ui.toast.error': 'Fehler',
  'common.ui.toast.warning': 'Warnung',
  'common.ui.toast.success': 'Erfolg',
  'common.table.sortAscending': 'aufsteigende Reihenfolge',
  'common.table.sortDescending': 'absteigende Reihenfolge',
  'common.table.exportCsv': 'CSV exportieren',
  'common.table.historyNotes': 'Notizen',
  'common.savedViews.copyLink': 'Link zu dieser Ansicht kopieren',
  'common.savedViews.linkCopied': 'Link kopiert',
  'common.savedViews.copyFailed': 'Der Link konnte nicht kopiert werden',
  'common.savedViews.group': 'Gespeicherte Ansichten',
  'common.savedViews.view': 'Ansicht',
  'common.savedViews.apply': 'Gespeicherte Ansicht anwenden',
  'common.savedViews.current': 'Aktuelle Ansicht',
  'common.savedViews.none': 'Keine gespeicherten Ansichten',
  'common.savedViews.name': 'Name der Ansicht',
  'common.savedViews.saveName': 'Speichern',
  'common.savedViews.cancel': 'Abbrechen',
  'common.savedViews.save': 'Ansicht speichern',
  'common.savedViews.deleteNamed': 'Ansicht {name} löschen',
  'common.savedViews.delete': 'Ansicht löschen',
} satisfies Record<CommonMessageKey, string>;
