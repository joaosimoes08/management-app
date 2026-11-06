import { DiscoveryPolicyError, normalizeDiscoveryPorts } from './discovery-policy';

export const DISCOVERY_PROFILE_IDS = ['defaults', 'icmp-only', 'web', 'network', 'custom'] as const;
export type DiscoveryProfileId = typeof DISCOVERY_PROFILE_IDS[number];

export type DiscoveryProfile = {
  id: DiscoveryProfileId;
  name: string;
  description: string;
  methods: string[];
  tcpPorts: number[];
  reverseDns: boolean;
};

const FIXED_PROFILES: Record<Exclude<DiscoveryProfileId, 'defaults' | 'custom'>, Omit<DiscoveryProfile, 'id'>> = {
  'icmp-only': { name: 'ICMP apenas', description: 'Uma tentativa ICMP por endereço; sem sondas TCP.', methods: ['ICMP'], tcpPorts: [], reverseDns: true },
  web: { name: 'Serviços web', description: 'Sondas TCP às portas 80 e 443, com ICMP e reverse DNS.', methods: ['ICMP', 'TCP'], tcpPorts: [80, 443], reverseDns: true },
  network: { name: 'Infraestrutura de rede', description: 'Sondas TCP a portas comuns de administração e serviços de rede.', methods: ['ICMP', 'TCP'], tcpPorts: [22, 23, 53, 80, 443, 830, 3389], reverseDns: true },
};

export function discoveryProfiles(defaults: { methods: string[]; tcpPorts: number[]; reverseDns: boolean }): DiscoveryProfile[] {
  return [
    { id: 'defaults', name: 'Predefinição da organização', description: 'Usa os métodos e portas definidos por um administrador.', ...defaults },
    ...Object.entries(FIXED_PROFILES).map(([id, profile]) => ({ id: id as DiscoveryProfileId, ...profile })),
    { id: 'custom', name: 'Personalizado', description: 'Define os métodos, portas e reverse DNS para esta execução.', methods: defaults.methods, tcpPorts: defaults.tcpPorts, reverseDns: defaults.reverseDns },
  ];
}

export function resolveDiscoveryProfile(profileId: string, custom: { methods: string[]; tcpPorts: unknown; reverseDns: boolean }, defaults: { methods: string[]; tcpPorts: number[]; reverseDns: boolean }) {
  if (!DISCOVERY_PROFILE_IDS.includes(profileId as DiscoveryProfileId)) {
    throw new DiscoveryPolicyError('DISCOVERY_PROFILE_INVALID', 'O perfil de Discovery selecionado não é válido.');
  }
  const profile = discoveryProfiles(defaults).find((item) => item.id === profileId)!;
  const useCustom = profileId === 'custom';
  const methods = [...new Set(useCustom ? custom.methods : profile.methods)].filter((method) => method === 'ICMP' || method === 'TCP');
  const tcpPorts = normalizeDiscoveryPorts(useCustom ? custom.tcpPorts : profile.tcpPorts);
  const reverseDns = useCustom ? custom.reverseDns : profile.reverseDns;
  if (!methods.length) throw new DiscoveryPolicyError('DISCOVERY_METHOD_REQUIRED', 'Escolhe pelo menos um método.');
  if (methods.includes('TCP') && !tcpPorts.length) throw new DiscoveryPolicyError('TCP_PORT_REQUIRED', 'Define pelo menos uma porta para Discovery TCP.');
  return { methods, tcpPorts, reverseDns };
}
