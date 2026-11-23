/**
 * PT labels for the raw trap kind (category) and status codes the API returns. The UI is written in PT and the
 * legacy dictionary translates these labels to EN, so a raw code such as VENDOR or PROCESSED never reaches the screen.
 * Unknown codes fall back to the code itself so a new value from the API stays visible.
 */
export const snmpTrapCategoryLabels: Record<string, string> = {
  AUTHENTICATION_FAILURE: 'Falha de autenticação SNMP',
  COLD_START: 'Arranque a frio',
  WARM_START: 'Reinício a quente',
  LINK_DOWN: 'Interface em baixo',
  LINK_UP: 'Interface reposta',
  CONFIG_CHANGE: 'Configuração em execução alterada',
  CONFIG_EVENT: 'Evento de gestão de configuração',
  CPU_THRESHOLD_RISING: 'Utilização de CPU acima do limiar',
  CPU_THRESHOLD_FALLING: 'Utilização de CPU normalizada',
  ENV_FAN: 'Falha de ventoinha',
  ENV_POWER_SUPPLY: 'Falha de fonte de alimentação',
  ENV_SHUTDOWN: 'Encerramento por condição ambiental',
  ENV_TEMPERATURE: 'Temperatura fora dos limites',
  ENV_VOLTAGE: 'Tensão fora dos limites',
  ERR_DISABLE: 'Interface em err-disable',
  FRU_FAN_TRAY: 'Falha do tabuleiro de ventoinhas',
  FRU_INSERTED: 'Componente inserido',
  FRU_MODULE: 'Falha de módulo',
  FRU_POWER: 'Falha de alimentação do componente',
  FRU_PSU_OUTPUT: 'Modo de saída da fonte alterado',
  FRU_REMOVED: 'Componente removido',
  FRU_UNRECOGNIZED: 'Componente não reconhecido',
  MEMORY_BUFFER: 'Novo pico de buffers de memória',
  SENSOR_THRESHOLD: 'Limiar de sensor ultrapassado',
  STACK_MEMBER_REMOVED: 'Membro removido do stack',
  STACK_MISMATCH: 'Membro do stack recusado por incompatibilidade',
  STACK_NEW_MASTER: 'Novo master do stack',
  STACK_NEW_MEMBER: 'Novo membro no stack',
  STACK_PORT: 'Porta de stack em baixo',
  STACK_POWER: 'Evento StackPower',
  STACK_RING: 'Anel do stack sem redundância',
  VENDOR: 'Trap de fabricante',
  SELF_TEST: 'Trap de teste da app',
};

export const snmpTrapStatusLabels: Record<string, string> = {
  PENDING: 'Pendente',
  PROCESSED: 'Processada',
  UNMATCHED: 'Sem correspondência',
  FAILED: 'Falhou',
  DISCOVERED: 'Pré-registada',
  REJECTED: 'Rejeitada',
  IGNORED: 'Ignorada',
};

export const snmpTrapCategoryLabel = (category?: string | null): string | null => (category ? snmpTrapCategoryLabels[category] ?? category : null);
export const snmpTrapStatusLabel = (status: string): string => snmpTrapStatusLabels[status] ?? status;
