'use client';

import { Network } from 'lucide-react';

export function Empty({ title, text }: { title: string; text: string }) {
  return <section className="ipam-card empty-context"><Network size={30} /><strong>{title}</strong><span>{text}</span></section>;
}
