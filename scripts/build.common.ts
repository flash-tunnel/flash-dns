import type { BuildConfig } from 'unbuild'
import { defu } from 'defu'

export function mergeDefaultBuildConfig(config: BuildConfig): BuildConfig {
  return defu(config, {
    entries: ['src/index'],
    declaration: true,
    clean: true,
    rollup: {
      esbuild: { target: 'node22' },
      inlineDependencies: false,
      dts: { respectExternal: true }
    }
  })
}
