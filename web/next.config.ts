import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  ...(process.env.DIANA_STATIC_EXPORT === '1'
    ? { output: 'export' as const, outputFileTracingRoot: process.cwd() }
    : {}),
};

export default nextConfig;
