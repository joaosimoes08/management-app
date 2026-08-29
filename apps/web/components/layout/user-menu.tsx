'use client';

import { ChevronDown } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useAuth } from '@/lib/auth';
import { useI18n } from '@/lib/i18n';

/** User dropdown with profile, settings, help and logout actions. */
export function UserMenu({ compact = false }: { compact?: boolean }) {
  const { user, profile, logout, hasRole } = useAuth();
  const { t } = useI18n();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const displayName = profile?.firstName || user?.username || 'Utilizador';
  const roleLabel = user?.roles.includes('ADMIN') ? 'Administrador' : user?.roles[0] ?? 'Utilizador';

  return <div className={`user-menu ${compact ? 'compact' : ''}`}><button className={compact ? 'top-user profile-button' : 'profile-mini profile-button'} onClick={() => setOpen((value) => !value)} aria-expanded={open} aria-haspopup="menu"><div className="profile-avatar">{displayName.charAt(0).toUpperCase()}</div><div className="user-menu-label"><strong>{displayName}</strong><span>{roleLabel}</span></div><ChevronDown size={compact ? 14 : 15} /></button>{open && <div className="user-dropdown" role="menu"><div className="user-dropdown-head"><strong>{displayName}</strong><small>{user?.username}</small></div><button onClick={() => { setOpen(false); router.push('/perfil'); }}>{t('profile.menu')}</button>{(hasRole('ADMIN') || hasRole('AUDITOR')) && <button onClick={() => { setOpen(false); router.push('/definicoes'); }}>{t('nav.settings')}</button>}<button onClick={() => { setOpen(false); router.push('/ajuda'); }}>{t('nav.help')}</button><button className="danger" onClick={() => void logout()}>{t('common.logout', 'Terminar sessão')}</button></div>}</div>;
}
