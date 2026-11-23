'use client';

import { useId } from 'react';

type Props<Value extends string> = {
  /** Visible label, e.g. "Vista". */
  label: string;
  value: Value;
  options: ReadonlyArray<readonly [Value, string]>;
  onChange: (value: Value) => void;
};

/**
 * The page's view tabs as a select inside the page body. Shown only at <=780 px (see .narrow-view-switch in
 * globals.css), where the module tabs in the top bar can be pushed off-screen; the active view is always visible.
 */
export function NarrowViewSwitch<Value extends string>({ label, value, options, onChange }: Props<Value>) {
  const id = useId();
  return <div className="narrow-view-switch">
    <label htmlFor={id}>{label}</label>
    <select id={id} value={value} onChange={(event) => onChange(event.target.value as Value)}>
      {options.map(([option, text]) => <option key={option} value={option}>{text}</option>)}
    </select>
  </div>;
}
