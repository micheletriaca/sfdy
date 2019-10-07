const util = require('util')
const xml2js = require('xml2js')

const parser = util.promisify(new xml2js.Parser({ explicitArray: true }).parseString)
const builder = new xml2js.Builder({
  renderOpts: {
    'pretty': true,
    'indent': '    ',
    'newline': '\n'
  },
  xmldec: {
    standalone: undefined,
    encoding: 'UTF-8',
    version: '1.0'
  }
})

module.exports = {
  parseXml: parser,
  buildXml: builder.buildObject.bind(builder)
}
