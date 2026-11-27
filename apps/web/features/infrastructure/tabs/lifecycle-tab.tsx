'use client';

import { LifecycleDates } from '../components/lifecycle-dates';
import { useInfrastructureWorkspace } from '../workspace-context';

/** Ciclo de vida: warranty and end-of-life dates of the Site's devices. */
export function LifecycleTab() {
  const { siteId, devices, access } = useInfrastructureWorkspace();
  return <LifecycleDates siteId={siteId} devices={devices} canEdit={access.canUpdateDevice} />;
}
