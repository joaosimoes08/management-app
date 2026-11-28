/** Shared UI (dialogs, toasts, data tables, saved views): Portuguese, the source language. Every other locale file has exactly these keys. */
export const messages = {
  'common.ui.close': 'Fechar',
  'common.ui.time24': 'Hora (24 h)',
  'common.ui.toast.error': 'Erro',
  'common.ui.toast.warning': 'Atenção',
  'common.ui.toast.success': 'Sucesso',
  'common.table.sortAscending': 'ordem crescente',
  'common.table.sortDescending': 'ordem decrescente',
  'common.table.exportCsv': 'Exportar CSV',
  'common.table.historyNotes': 'Notas',
  'common.savedViews.copyLink': 'Copiar ligação desta vista',
  'common.savedViews.linkCopied': 'Ligação copiada',
  'common.savedViews.copyFailed': 'Não foi possível copiar a ligação',
  'common.savedViews.group': 'Vistas guardadas',
  'common.savedViews.view': 'Vista',
  'common.savedViews.apply': 'Aplicar vista guardada',
  'common.savedViews.current': 'Vista atual',
  'common.savedViews.none': 'Sem vistas guardadas',
  'common.savedViews.name': 'Nome da vista',
  'common.savedViews.saveName': 'Guardar',
  'common.savedViews.cancel': 'Cancelar',
  'common.savedViews.save': 'Guardar vista',
  'common.savedViews.deleteNamed': 'Apagar vista {name}',
  'common.savedViews.delete': 'Apagar vista',
} as const satisfies Record<string, string>;

export type CommonMessageKey = keyof typeof messages;
