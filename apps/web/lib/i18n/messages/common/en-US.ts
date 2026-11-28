/** Shared UI (dialogs, toasts, data tables, saved views): English, also the fallback of the added languages. */
import type { CommonMessageKey } from './pt-PT';

export const messages: Record<string, string> = {
  'common.ui.close': 'Close',
  'common.ui.time24': 'Time (24 h)',
  'common.ui.toast.error': 'Error',
  'common.ui.toast.warning': 'Warning',
  'common.ui.toast.success': 'Success',
  'common.table.sortAscending': 'ascending order',
  'common.table.sortDescending': 'descending order',
  'common.table.exportCsv': 'Export CSV',
  'common.table.historyNotes': 'Notes',
  'common.savedViews.copyLink': 'Copy link to this view',
  'common.savedViews.linkCopied': 'Link copied',
  'common.savedViews.copyFailed': 'Could not copy the link',
  'common.savedViews.group': 'Saved views',
  'common.savedViews.view': 'View',
  'common.savedViews.apply': 'Apply saved view',
  'common.savedViews.current': 'Current view',
  'common.savedViews.none': 'No saved views',
  'common.savedViews.name': 'View name',
  'common.savedViews.saveName': 'Save',
  'common.savedViews.cancel': 'Cancel',
  'common.savedViews.save': 'Save view',
  'common.savedViews.deleteNamed': 'Delete view {name}',
  'common.savedViews.delete': 'Delete view',
} satisfies Record<CommonMessageKey, string>;
