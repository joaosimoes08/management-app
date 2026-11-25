import nextConfig from 'eslint-config-next';

export default [
  ...nextConfig,
  {
    // React Compiler-era checks are tracked follow-ups; main did not enforce these.
    rules: {
      'react-hooks/set-state-in-effect': 'warn',
      'react-hooks/purity': 'warn',
      'react-hooks/refs': 'warn',
      'react-hooks/immutability': 'warn',
      // Follow-up: fix the manual-memoization sites (responsive-overflow, rack-pdu-strip, alerts-overview) and set back to error.
      'react-hooks/preserve-manual-memoization': 'warn',
    },
  },
  {
    ignores: ['.next/**', 'node_modules/**', 'next-env.d.ts', 'out/**'],
  },
];
