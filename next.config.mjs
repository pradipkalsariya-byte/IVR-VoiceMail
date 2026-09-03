/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Required for the Dockerfile's runner stage (Railway deploy) — traces the minimal
  // node_modules subset the app actually needs into .next/standalone.
  output: 'standalone',
};

export default nextConfig;
