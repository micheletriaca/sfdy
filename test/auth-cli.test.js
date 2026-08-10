const assert = require('assert')
const path = require('path')
const { spawnSync } = require('child_process')

const authResult = spawnSync(process.execPath, [path.resolve(__dirname, '../src/sfdy-auth.js'), '--help'], {
  encoding: 'utf8'
})

assert.strictEqual(authResult.status, 0, authResult.stderr)
assert.match(authResult.stdout, /--save/)
assert.doesNotMatch(authResult.stdout, /output-eval-script/)
assert.doesNotMatch(authResult.stdout, /auth -e/)

const communityResult = spawnSync(process.execPath, [
  path.resolve(__dirname, '../src/sfdy.js'),
  'community:publish',
  '--help'
], { encoding: 'utf8' })

assert.strictEqual(communityResult.status, 0, communityResult.stderr)
assert.match(communityResult.stdout, /--community-name/)
console.log('Auth CLI tests passed')
