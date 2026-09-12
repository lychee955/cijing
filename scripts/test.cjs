const { spawnSync } = require('node:child_process')
const { join } = require('node:path')
// Use the same native-module ABI as the application, including Vitest workers.
const result = spawnSync(require('electron'), [join(__dirname, '../node_modules/vitest/vitest.mjs'), 'run', ...process.argv.slice(2)], {
  stdio: 'inherit', env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }
})
if (result.error) console.error(result.error.message)
process.exit(result.status ?? 1)
