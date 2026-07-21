/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@chillberry/shared-types', '@chillberry/domain'],
};

export default nextConfig;
