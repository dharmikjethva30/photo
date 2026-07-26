/** @type {import('next').NextConfig} */
const nextConfig = {
  // The design tokens are a workspace package consumed as SOURCE (its `main` points at
  // src/index.ts, same as the mobile app), so Next has to transpile it rather than
  // expect pre-built JS. Without this the first import throws "Unexpected token".
  transpilePackages: ['@photu/tokens'],
  // Belt-and-braces: the app is small and mostly static, and a stray `any` in a fast
  // iteration should not block a deploy — types are still checked in CI via `typecheck`.
  eslint: { ignoreDuringBuilds: true },
}

export default nextConfig
