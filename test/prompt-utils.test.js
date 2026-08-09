const assert = require('assert')
const { askRequired } = require('../src/utils/prompt-utils')

;(async () => {
  const answers = ['  ', 'uat']
  const output = []
  const alias = await askRequired('Credential alias: ', {
    ask: async () => answers.shift(),
    output: { write: value => output.push(value) }
  })

  assert.strictEqual(alias, 'uat')
  assert.deepStrictEqual(output, ['A value is required.\n'])
  console.log('Prompt utility tests passed')
})()
