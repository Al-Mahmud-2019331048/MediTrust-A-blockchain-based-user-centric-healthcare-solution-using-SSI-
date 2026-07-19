const path = require('path');

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // This repo's root package-lock.json makes Next.js infer the monorepo root
  // one level up from apps/web/ by default — pin it explicitly to apps/web/
  // itself so file tracing doesn't walk the whole monorepo.
  outputFileTracingRoot: path.join(__dirname),
  images: {
    // ConnectionSetup.tsx renders a QRCode.toDataURL() data: URL through
    // next/image — Next's built-in optimizer can't process arbitrary data
    // URLs, so optimization is disabled entirely (simplest fix for a local
    // PoC with no CDN/image-hosting concerns anyway).
    unoptimized: true,
  },
};

module.exports = nextConfig;
