import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { DateTimeInput } from './date-time-input';

afterEach(cleanup);

describe('DateTimeInput', () => {
  it('validates the 24-hour time and keeps date and time in a single local value', () => {
    function Example() {
      const [value, setValue] = useState('');
      return <>
        <DateTimeInput label="Início" value={value} onChange={setValue} required />
        <output>{value}</output>
      </>;
    }
    render(<Example />);
    const fields = within(screen.getByRole('group', { name: 'Início' }));
    const time = fields.getByRole<HTMLInputElement>('textbox', { name: 'Hora (24 h)' });
    fireEvent.change(time, { target: { value: '24:05' } });
    expect(time).toBeInvalid();
    fireEvent.change(time, { target: { value: '17:05' } });
    fireEvent.change(fields.getByLabelText('Início'), { target: { value: '2026-11-21' } });
    expect(time).toBeValid();
    expect(screen.getByRole('status')).toHaveTextContent('2026-11-21T17:05');
  });
});
