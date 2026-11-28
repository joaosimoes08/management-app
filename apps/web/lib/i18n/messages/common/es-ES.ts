/** Shared UI (dialogs, toasts, data tables, saved views): Español. Loaded only when es-ES is chosen. */
import type { CommonMessageKey } from './pt-PT';

export const messages: Record<string, string> = {
  'common.ui.close': 'Cerrar',
  'common.ui.time24': 'Hora (24 h)',
  'common.ui.toast.error': 'Error',
  'common.ui.toast.warning': 'Atención',
  'common.ui.toast.success': 'Éxito',
  'common.table.sortAscending': 'orden ascendente',
  'common.table.sortDescending': 'orden descendente',
  'common.table.exportCsv': 'Exportar CSV',
  'common.table.historyNotes': 'Notas',
  'common.savedViews.copyLink': 'Copiar enlace a esta vista',
  'common.savedViews.linkCopied': 'Enlace copiado',
  'common.savedViews.copyFailed': 'No se ha podido copiar el enlace',
  'common.savedViews.group': 'Vistas guardadas',
  'common.savedViews.view': 'Vista',
  'common.savedViews.apply': 'Aplicar vista guardada',
  'common.savedViews.current': 'Vista actual',
  'common.savedViews.none': 'Sin vistas guardadas',
  'common.savedViews.name': 'Nombre de la vista',
  'common.savedViews.saveName': 'Guardar',
  'common.savedViews.cancel': 'Cancelar',
  'common.savedViews.save': 'Guardar vista',
  'common.savedViews.deleteNamed': 'Eliminar vista {name}',
  'common.savedViews.delete': 'Eliminar vista',
} satisfies Record<CommonMessageKey, string>;
