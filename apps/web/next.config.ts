import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // TEMPORARY during the architecture refactor: ESLint now exists (previously
  // the repo had none) and legacy `any` usages are still being removed domain
  // by domain. `npm run lint` is the authoritative gate; this flag must be
  // removed in the final cleanup phase so `next build` lints again.
  eslint: { ignoreDuringBuilds: true },
};

export default nextConfig;
