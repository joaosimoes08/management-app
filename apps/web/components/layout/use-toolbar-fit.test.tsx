import { act, cleanup, render, screen } from '@testing-library/react';
import { useRef, type ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useToolbarFit } from './use-toolbar-fit';

const fit = vi.hoisted(() => ({ overflows: false }));
vi.mock('./context-toolbar-fit', async (importOriginal) => ({ ...(await importOriginal<typeof import('./context-toolbar-fit')>()), contextToolbarOverflows: () => fit.overflows }));

function Bar({ children }: { children?: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const { compact, controlsOpen, setControlsOpen } = useToolbarFit(ref);
  return <div ref={ref} data-testid="bar">
    <div className="context-toolbar-navigation">{children}</div><div className="context-toolbar-actions" />
    <output>{compact ? 'compact' : 'inline'} {controlsOpen ? 'open' : 'closed'}</output>
    <button onClick={() => setControlsOpen((open) => !open)}>toggle</button>
  </div>;
}

afterEach(() => { cleanup(); fit.overflows = false; });

describe('useToolbarFit', () => {
  it('stays inline when the bar has no page controls, even if it would overflow', () => {
    fit.overflows = true;
    render(<Bar />);
    expect(screen.getByRole('status')).toHaveTextContent('inline closed');
    expect(screen.getByTestId('bar')).not.toHaveAttribute('data-compact');
  });

  it('stays inline when the controls fit', () => {
    render(<Bar><button>Filtrar</button></Bar>);
    expect(screen.getByRole('status')).toHaveTextContent('inline');
    expect(screen.getByTestId('bar')).not.toHaveAttribute('data-compact');
  });

  it('goes compact before paint, and marks the bar, when the controls do not fit', () => {
    fit.overflows = true;
    render(<Bar><button>Filtrar</button></Bar>);
    expect(screen.getByRole('status')).toHaveTextContent('compact closed');
    expect(screen.getByTestId('bar')).toHaveAttribute('data-compact', '');
  });

  it('lets the shell open and close the Controlos panel', () => {
    fit.overflows = true;
    render(<Bar><button>Filtrar</button></Bar>);
    act(() => { screen.getByRole('button', { name: 'toggle' }).click(); });
    expect(screen.getByRole('status')).toHaveTextContent('compact open');
  });
});
