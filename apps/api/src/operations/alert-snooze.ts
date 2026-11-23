import { BadRequestException } from '@nestjs/common';
import { ALERT_SNOOZE_MAX_HOURS, ALERT_SNOOZE_MIN_HOURS } from './dto';

const HOUR = 60 * 60 * 1000;

/**
 * End of an alert snooze from exactly one of `until` or `durationHours`.
 * The end must be in the future and at most 30 days away.
 */
export function resolveAlertSnoozeUntil(input: { until?: string | null; durationHours?: number | null }, now = new Date()) {
  const hasUntil = input.until !== undefined && input.until !== null && input.until !== '';
  const hasDuration = input.durationHours !== undefined && input.durationHours !== null;
  if (hasUntil === hasDuration) throw new BadRequestException({ code: 'SNOOZE_DURATION_REQUIRED', message: 'Indica a data de fim (until) ou a duração em horas (durationHours), mas não ambas.' });
  if (hasDuration) {
    const hours = Number(input.durationHours);
    if (!Number.isInteger(hours) || hours < ALERT_SNOOZE_MIN_HOURS || hours > ALERT_SNOOZE_MAX_HOURS) throw new BadRequestException({ code: 'SNOOZE_DURATION_OUT_OF_RANGE', message: `A duração tem de estar entre ${ALERT_SNOOZE_MIN_HOURS} hora e ${ALERT_SNOOZE_MAX_HOURS / 24} dias.` });
    return new Date(now.getTime() + hours * HOUR);
  }
  const until = new Date(input.until!);
  if (!Number.isFinite(until.getTime())) throw new BadRequestException({ code: 'SNOOZE_DURATION_OUT_OF_RANGE', message: 'Data de fim inválida.' });
  if (until <= now) throw new BadRequestException({ code: 'SNOOZE_DURATION_OUT_OF_RANGE', message: 'A data de snooze tem de ser futura' });
  if (until.getTime() - now.getTime() > ALERT_SNOOZE_MAX_HOURS * HOUR) throw new BadRequestException({ code: 'SNOOZE_DURATION_OUT_OF_RANGE', message: `O alerta pode ser adiado no máximo ${ALERT_SNOOZE_MAX_HOURS / 24} dias.` });
  return until;
}
