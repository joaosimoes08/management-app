'use client';

import { useEffect } from 'react';
import { useAuth } from '@/lib/auth';
import { loadAppearanceForUser, watchSystemMode } from '@/lib/theme/appearance';

/** Applies the signed-in user's saved theme and follows the OS light/dark setting in "system" mode. */
export function AppearanceSync() {
  const { user } = useAuth();
  const userId = user?.id ?? null;
  useEffect(() => { loadAppearanceForUser(userId); }, [userId]);
  useEffect(() => watchSystemMode(), []);
  return null;
}
