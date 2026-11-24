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
    expect(sharedRule).toMatch(/color:\s*(?:var\(--t-[a-z0-9-]+,\s*)?#20334f/);
    expect(sharedRule).toMatch(/border:\s*1px solid (?:var\(--t-[a-z0-9-]+,\s*)?#dce4ef/);
    expect(sharedRule).toMatch(/height:\s*35px/);
    expect(sharedRule).toMatch(/border-radius:\s*8px/);
    expect(styles).toContain('.schedule-subnet-select select,.schedule-form select');
    expect(styles).toContain('.modal-form input,.modal-form select');
    expect(page).not.toContain('HISTÓRICO');
    expect(schedule).not.toContain('AUTOMAÇÃO');
  });
});

const enrichment = readFileSync(resolve(process.cwd(), 'features/discovery/discovery-snmp-enrichment.tsx'), 'utf8');
/** Every declaration block whose whole selector is `selector`, joined, so a later override counts too. */
const rule = (selector: string) => [...styles.matchAll(new RegExp(`(?:^|\\n|\\})${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{([^}]*)\\}`, 'g'))].map((match) => match[1]).join(';');

describe('Discovery selects stay inside a 360 px viewport', () => {
  it('constrains the SNMP enrichment fieldset, its credential select and lets the hint wrap', () => {
    expect(enrichment).toMatch(/<fieldset className="[^"]*\bdiscovery-snmp-enrichment\b/);
    expect(rule('.discovery-snmp-enrichment')).toMatch(/min-width:\s*0/);
    expect(rule('.discovery-snmp-enrichment')).toMatch(/max-width:\s*100%/);
    expect(rule('.discovery-snmp-enrichment label')).toMatch(/min-width:\s*0/);
    const select = rule('.discovery-snmp-enrichment select');
    expect(select).toMatch(/width:\s*100%/);
    expect(select).toMatch(/min-width:\s*0/);
    expect(select).toMatch(/max-width:\s*100%/);
    expect(rule('.discovery-snmp-enrichment small')).toMatch(/overflow-wrap:\s*anywhere/);
  });

  it('constrains the run comparison select, whose options carry long run names', () => {
    expect(rule('.discovery-compare-select select')).toMatch(/min-width:\s*0/);
    expect(rule('.discovery-compare-select select')).toMatch(/max-width:\s*100%/);
  });
});
