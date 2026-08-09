const assert = require('assert')
const path = require('path')
const { spawnSync } = require('child_process')

const result = spawnSync(process.execPath, [path.resolve(__dirname, '../src/sfdy-auth.js'), '--help'], {
  encoding: 'utf8'
})

assert.strictEqual(result.status, 0, result.stderr)
assert.match(result.stdout, /--save/)
assert.doesNotMatch(result.stdout, /output-eval-script/)
assert.doesNotMatch(result.stdout, /auth -e/)
console.log('Auth CLI tests passed')
