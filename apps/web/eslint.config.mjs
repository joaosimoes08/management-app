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
    },
  },
  {
    ignores: ['.next/**', 'node_modules/**', 'next-env.d.ts', 'out/**'],
  },
];
