import firewallIcon from '../../../icons/firewall.webp';
import otherIcon from '../../../icons/other.webp';
import routerIcon from '../../../icons/router.webp';
import serverIcon from '../../../icons/server.webp';
import storageIcon from '../../../icons/storage.webp';
import switchIcon from '../../../icons/switch.webp';

const icons = {
  FIREWALL: firewallIcon,
  OTHER: otherIcon,
  ROUTER: routerIcon,
  SERVER: serverIcon,
  STORAGE: storageIcon,
  SWITCH: switchIcon,
} as const;

export function EquipmentTypeIcon({ type, alt = '', className = 'catalog-icon' }: { type?: string; alt?: string; className?: string }) {
  const icon = icons[String(type ?? 'OTHER').toUpperCase() as keyof typeof icons] ?? icons.OTHER;

  return <img src={icon.src} width={512} height={512} alt={alt} className={className} loading="lazy" />;
}
