import { antfu } from '@antfu/eslint-config'

export default antfu({
  type: 'lib',
  rules: { 'style/comma-dangle': ['warn', 'never'] },
  ignores: ['**/dist/**', '**/coverage/**', '.artifacts/**', 'ai-docs/**']
}, {
  files: ['test/**/*.ts'],
  rules: { 'ts/explicit-function-return-type': 'off' }
})
