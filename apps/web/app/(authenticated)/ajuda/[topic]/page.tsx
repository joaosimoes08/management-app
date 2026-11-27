'use client';

import { useParams } from 'next/navigation';
import { HelpArticlePage } from '@/features/help/help-article-page';

export default function HelpTopicRoute() {
  const { topic } = useParams<{ topic: string }>();
  return <HelpArticlePage topic={topic} />;
}
