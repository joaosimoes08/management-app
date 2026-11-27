import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { EntityLink } from './entity-link';
import { HistoryBlock } from './history-block';

afterEach(cleanup);

describe('EntityLink', () => {
  it('renders a plain link with the label, or custom content and class', () => {
    render(<><EntityLink kind="device" id="d1" label="Core switch" siteId="s1" /><EntityLink kind="subnet" id="n1" label="10.0.0.0/24" className="secondary-button" aria-label="Abrir subnet 10.0.0.0/24">Abrir</EntityLink></>);
    expect(screen.getByRole('link', { name: 'Core switch' })).toHaveAttribute('href', '/infraestrutura/equipamentos/d1?siteId=s1');
    const custom = screen.getByRole('link', { name: 'Abrir subnet 10.0.0.0/24' });
    expect(custom).toHaveClass('secondary-button');
    expect(custom).toHaveTextContent('Abrir');
  });
});

describe('HistoryBlock', () => {
  it('lists dated events with status, actor, note and actions in the side-panel markup', () => {
    render(<HistoryBlock
      heading="Histórico (2)"
      formatDate={(value) => `fmt:${value.slice(0, 10)}`}
      empty="Sem eventos"
      events={[
        { id: 'e1', title: 'Semana de 16/11', status: <span className="state-badge">Pendente</span>, actions: <button>Confirmar</button> },
        { id: 'e2', title: 'Semana de 09/11', status: <span className="state-badge occupied">Confirmado</span>, at: '2026-11-10T10:00:00.000Z', actor: 'Ana', note: 'Etiqueta corrigida' },
      ]}
    />);
    expect(screen.getByRole('heading', { level: 3, name: 'Histórico (2)' })).toBeInTheDocument();
    const items = document.querySelectorAll('section.host-section article.host-relation');
    expect(items).toHaveLength(2);
    expect(within(items[0] as HTMLElement).getByRole('button', { name: 'Confirmar' })).toBeInTheDocument();
    expect(items[0]).not.toHaveTextContent('·');
    expect(items[1]).toHaveTextContent('Confirmado · fmt:2026-11-10 · Ana');
    expect(items[1].querySelector('time')).toHaveAttribute('dateTime', '2026-11-10T10:00:00.000Z');
    expect(within(items[1] as HTMLElement).getByText('Notas: Etiqueta corrigida')).toBeInTheDocument();
  });

  it('shows the empty text, an actor without a date, and a custom heading level', () => {
    const { rerender } = render(<HistoryBlock heading="Histórico" formatDate={String} empty="Sem eventos" events={[]} headingLevel="h4" />);
    expect(screen.getByRole('heading', { level: 4 })).toBeInTheDocument();
    expect(screen.getByText('Sem eventos')).toHaveClass('panel-description');
    rerender(<HistoryBlock heading="Histórico" formatDate={String} empty="Sem eventos" events={[{ id: 'x', title: 'Evento', actor: 'Sistema' }]} />);
    expect(document.querySelector('.host-relation')).toHaveTextContent('Evento · Sistema');
    expect(screen.queryByText('Sem eventos')).not.toBeInTheDocument();
  });
});
