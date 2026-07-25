// Metro configuration for a pnpm monorepo.
//
// Two settings are load-bearing; without them Metro cannot resolve @photu/*
// and the failure looks like a missing module rather than a config problem.
const { getDefaultConfig } = require('expo/metro-config')
const path = require('node:path')

const projectRoot = __dirname
const workspaceRoot = path.resolve(projectRoot, '../..')

const config = getDefaultConfig(projectRoot)

// 1. Watch the whole workspace, so editing packages/tokens triggers a reload and
//    Metro is willing to read files from outside apps/mobile at all.
config.watchFolders = [workspaceRoot]

// 2. Resolve from BOTH node_modules trees. With node-linker=hoisted almost
//    everything lives at the root, but the app-local path must come first so an
//    app-specific version wins if one is ever pinned.
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
]

// The workspace packages are consumed as SOURCE (their `main` points at
// src/index.ts) so Metro transpiles them, while apps/web consumes built output.
// See docs/adr/0002.
config.resolver.unstable_enablePackageExports = true

module.exports = config
