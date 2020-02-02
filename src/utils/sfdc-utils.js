const SfdcConnection = require('node-salesforce-connection')

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
}

module.exports = {
  newInstance: async ({ username, password, isSandbox = true }) => {
    const res = new SfdcConn()
    await res.login({ username, password, isSandbox })
    console.log(`Logged in salesforce as ${username}`)
    return res
  }
}
