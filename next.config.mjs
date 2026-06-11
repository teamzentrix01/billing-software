/** @type {import('next').NextConfig} */
const nextConfig = {
  reactCompiler: true,
  experimental: {
    proxyClientMaxBodySize: 35 * 1024 * 1024,
  },
  turbopack: {
    root: process.cwd(),
  },
  async rewrites() {
    const backendUrl = process.env.BACKEND_URL || '';
    const isProduction = process.env.NODE_ENV === 'production' || process.env.VERCEL === '1';

    if (!backendUrl || !isProduction) return [];

    return {
      beforeFiles: [
        {
          source: '/api/:path*',
          destination: `${backendUrl.replace(/\/$/, '')}/api/:path*`,
        },
      ],
    };
  },
  async headers() {
    return [
      {
        source: '/sw.js',
        headers: [
          { key: 'Cache-Control', value: 'no-cache, no-store, must-revalidate' },
        ],
      },
      {
        source: '/manifest.webmanifest',
        headers: [
          { key: 'Cache-Control', value: 'no-cache, no-store, must-revalidate' },
        ],
      },
    ];
  },
};

export default nextConfig;
