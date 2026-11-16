import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const page = readFileSync(resolve(process.cwd(), 'features/discovery/discovery-page.tsx'), 'utf8');
const schedule = readFileSync(resolve(process.cwd(), 'features/discovery/discovery-schedule-panel.tsx'), 'utf8');
const styles = readFileSync(resolve(process.cwd(), 'app/globals.css'), 'utf8');

describe('Discovery selector styling', () => {
  it('applies the shared selector class to every page, modal, and schedule select', () => {
    const openingTags = [...`${page}\n${schedule}`.matchAll(/<select\b[^>]*>/g)].map(([tag]) => tag);

    expect(openingTags.length).toBeGreaterThan(0);
    expect(openingTags).toEqual(expect.arrayContaining([expect.stringContaining('className="context-toolbar-selector"')]));
    expect(openingTags.every((tag) => /\bclassName="context-toolbar-selector"/.test(tag))).toBe(true);

    const sharedRule = styles.match(/\.app-shell \.context-toolbar-selector\s*\{([^}]*)\}/)?.[1];
    expect(sharedRule).toBeDefined();
    expect(sharedRule).toMatch(/padding:\s*0 12px/);
    expect(sharedRule).toMatch(/color:\s*#20334f/);
    expect(sharedRule).toMatch(/border:\s*1px solid #dce4ef/);
    expect(sharedRule).toMatch(/height:\s*35px/);
    expect(sharedRule).toMatch(/border-radius:\s*8px/);
    expect(styles).toContain('.schedule-subnet-select select,.schedule-form select');
    expect(styles).toContain('.modal-form input,.modal-form select');
    expect(page).not.toContain('HISTÓRICO');
    expect(schedule).not.toContain('AUTOMAÇÃO');
  });
});
