/** Shared UI (dialogs, toasts, data tables, saved views): Français. Loaded only when fr-FR is chosen. */
import type { CommonMessageKey } from './pt-PT';

export const messages: Record<string, string> = {
  'common.ui.close': 'Fermer',
  'common.ui.time24': 'Heure (24 h)',
  'common.ui.toast.error': 'Erreur',
  'common.ui.toast.warning': 'Avertissement',
  'common.ui.toast.success': 'Succès',
  'common.table.sortAscending': 'ordre croissant',
  'common.table.sortDescending': 'ordre décroissant',
  'common.table.exportCsv': 'Exporter en CSV',
  'common.table.historyNotes': 'Notes',
  'common.savedViews.copyLink': 'Copier le lien vers cette vue',
  'common.savedViews.linkCopied': 'Lien copié',
  'common.savedViews.copyFailed': 'Impossible de copier le lien',
  'common.savedViews.group': 'Vues enregistrées',
  'common.savedViews.view': 'Vue',
  'common.savedViews.apply': 'Appliquer une vue enregistrée',
  'common.savedViews.current': 'Vue actuelle',
  'common.savedViews.none': 'Aucune vue enregistrée',
  'common.savedViews.name': 'Nom de la vue',
  'common.savedViews.saveName': 'Enregistrer',
  'common.savedViews.cancel': 'Annuler',
  'common.savedViews.save': 'Enregistrer la vue',
  'common.savedViews.deleteNamed': 'Supprimer la vue {name}',
  'common.savedViews.delete': 'Supprimer la vue',
} satisfies Record<CommonMessageKey, string>;
