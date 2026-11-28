/** Shared UI (dialogs, toasts, data tables, saved views): Italiano. Loaded only when it-IT is chosen. */
import type { CommonMessageKey } from './pt-PT';

export const messages: Record<string, string> = {
  'common.ui.close': 'Chiudi',
  'common.ui.time24': 'Ora (24 h)',
  'common.ui.toast.error': 'Errore',
  'common.ui.toast.warning': 'Attenzione',
  'common.ui.toast.success': 'Successo',
  'common.table.sortAscending': 'ordine crescente',
  'common.table.sortDescending': 'ordine decrescente',
  'common.table.exportCsv': 'Esporta CSV',
  'common.table.historyNotes': 'Note',
  'common.savedViews.copyLink': 'Copia link a questa vista',
  'common.savedViews.linkCopied': 'Link copiato',
  'common.savedViews.copyFailed': 'Impossibile copiare il link',
  'common.savedViews.group': 'Viste salvate',
  'common.savedViews.view': 'Vista',
  'common.savedViews.apply': 'Applica vista salvata',
  'common.savedViews.current': 'Vista corrente',
  'common.savedViews.none': 'Nessuna vista salvata',
  'common.savedViews.name': 'Nome della vista',
  'common.savedViews.saveName': 'Salva',
  'common.savedViews.cancel': 'Annulla',
  'common.savedViews.save': 'Salva vista',
  'common.savedViews.deleteNamed': 'Elimina vista {name}',
  'common.savedViews.delete': 'Elimina vista',
} satisfies Record<CommonMessageKey, string>;
