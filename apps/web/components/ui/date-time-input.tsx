'use client';

import { time24Pattern } from '@/lib/format/date';

interface DateTimeInputProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  required?: boolean;
}

/** Keep the native date picker and use the same 24-hour time field in every browser. */
export function DateTimeInput({ label, value, onChange, required }: DateTimeInputProps) {
  const [date, time = ''] = value.split('T');

  return <div className="date-time-input" role="group" aria-label={label}>
    <label>{label}<input type="date" required={required} value={date} onChange={(event) => onChange(`${event.target.value}T${time}`)} /></label>
    <label>Hora (24 h)<input type="text" required={required} value={time} placeholder="00:00" maxLength={5} pattern={time24Pattern} onChange={(event) => onChange(`${date}T${event.target.value}`)} /></label>
  </div>;
}
