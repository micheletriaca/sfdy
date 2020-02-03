const SfdcConnection = require('node-salesforce-connection')
const { parseXml } = require('./xml-utils')
const fs = require('fs')
const log = console.log
const chalk = require('chalk')

const sleep = async ms => new Promise((resolve) => setTimeout(resolve, ms))

class SfdcConn {
  constructor (apiVersion = '47.0') {
    this.apiVersion = apiVersion
    this.sfConn = new SfdcConnection()
    this.isLoggedIn = false
  }

  async login ({ username, password, isSandbox = true }) {
    await this.sfConn.soapLogin({
      hostname: `${isSandbox ? 'test' : 'login'}.salesforce.com`,
      apiVersion: this.apiVersion,
      username: username,
      password: password
    })
    this.isLoggedIn = true
  }

  async query (q, useTooling = false) {
    if (!this.isLoggedIn) throw Error('not logged in')
    return (await this.sfConn.rest(`/services/data/v${this.apiVersion}/${useTooling ? 'tooling/' : ''}query/?q=${encodeURIComponent(q.replace(/\n|\t/g, ''))}`)).records
  }

  async rest (path) {
    return this.sfConn.rest(`/services/data/v${this.apiVersion}${path}`)
  }

  async metadata (method, args, wsdl = 'Metadata', headers = {}) {
    const metadataWsdl = this.sfConn.wsdl(this.apiVersion, wsdl)
    return this.sfConn.soap(metadataWsdl, method, args, headers)
  }

  async retrieveMetadata (packageXmlPath) {
    const pkg = fs.readFileSync(packageXmlPath, 'utf8')
    const pkgJson = (await parseXml(pkg)).Package
    delete pkgJson['$']
    return this.metadata('retrieve', {
      RetrieveRequest: {
        apiVersion: this.apiVersion,
        unpackaged: pkgJson,
        singlePackage: true
      }
    })
  }

  async pollRetrieveMetadataStatus (retrieveMetadataId) {
    while (true) {
      await sleep(5000)
      const res = await this.metadata('checkRetrieveStatus', {
        id: retrieveMetadataId,
        includeZip: true
      })
      if (res.done === 'true') {
        return res
      } else {
        log(chalk.grey('checking retrieve status...', res.status))
      }
    }
  }
}

module.exports = {
  newInstance: async ({ username, password, isSandbox = true }) => {
    const res = new SfdcConn()
    await res.login({ username, password, isSandbox })
    return res
  }
}
