const assert = require('assert')
const { Readable } = require('stream')
const { buffer } = require('stream/consumers')
const Sfdc = require('../src/utils/sfdc-utils')

const responseXml = `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/">
    <soapenv:Body><deployResponse><result><id>0Af-test</id></result></deployResponse></soapenv:Body>
</soapenv:Envelope>`

;(async () => {
  const originalFetch = global.fetch
  let request
  try {
    global.fetch = async (url, options) => {
      request = { url, options, body: await buffer(options.body) }
      return { ok: true, text: async () => responseXml }
    }

    const connection = await Sfdc.newInstance({
      apiVersion: '65.0',
      instanceHostname: 'example.my.salesforce.com',
      sessionId: 'session-id',
      username: 'test@example.com'
    })
    const result = await connection.deployMetadata(Readable.from([Buffer.from('zip-content')]), {})

    assert.strictEqual(result.id, '0Af-test')
    assert.strictEqual(request.options.duplex, 'half')
    assert.match(request.body.toString(), /deploy/)
    assert.match(request.body.toString(), /emlwLWNvbnRlbnQ=/)
    console.log('Streaming deploy transport tests passed')
  } finally {
    global.fetch = originalFetch
  }
})().catch(error => {
  console.error(error)
  process.exitCode = 1
})
