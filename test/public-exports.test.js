const assert = require('node:assert/strict')
const test = require('node:test')

const publicModules = [
  'auth',
  'constants',
  'deploy',
  'package-utils',
  'path-service',
  'plugin',
  'retrieve',
  'sfdc-utils',
  'transformer',
  'xml-utils'
]

test('public subpath exports are loadable', () => {
  const sfdy = require('sfdy')
  assert.equal(typeof sfdy.deploy, 'function')
  assert.equal(typeof sfdy.retrieve, 'function')

  for (const moduleName of publicModules) {
    assert.ok(require(`sfdy/${moduleName}`), `sfdy/${moduleName} should load`)
  }
})
