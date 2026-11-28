import type { DomainMessages } from '../types';
import { messages as enUS } from './en-US';
import { messages as ptPT } from './pt-PT';

export const ipam: DomainMessages = {
  'pt-PT': ptPT,
  'en-US': enUS,
  lazy: {
    'es-ES': () => import('./es-ES'),
    'fr-FR': () => import('./fr-FR'),
    'de-DE': () => import('./de-DE'),
    'it-IT': () => import('./it-IT'),
  },
};
