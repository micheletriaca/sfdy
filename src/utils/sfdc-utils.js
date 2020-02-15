const SfdcConnection = require('node-salesforce-connection')
const log = console.log
const chalk = require('chalk')

const sleep = async ms => new Promise((resolve) => setTimeout(resolve, ms))
const incrementalSleep = (level0, count1, level1, count2, level2) => {
  let count = 0
  return () => {
    ++count
    if (count <= count1) return sleep(level0)
    else if (count <= count2) return sleep(level1)
    else return sleep(level2)
  }
}

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

  async retrieveMetadata (pkgJson, fetchCustomApplications = false) {
    // It seems that there's no other way to retrieve custom application visibility in profiles
    if (fetchCustomApplications && pkgJson.types.some(x => x.name[0] === 'Profile')) {
      pkgJson.types = pkgJson.types.filter(x => x.name[0] !== 'CustomApplication')
      pkgJson.types.push({
        members: ['*'],
        name: ['CustomApplication']
      })
    }

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
    const iSleep = incrementalSleep(500, 2, 1000, 5, 5000)
    while (true) {
      await iSleep()
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

  async describeMetadata () {
    return this.metadata('describeMetadata', {
      asOfVersion: this.apiVersion
    })
  }

  async listMetadata (types) {
    return this.metadata('listMetadata', {
      queries: types.map(type => ({ type })),
      asOfVersion: this.apiVersion
    })
  }

  async deployMetadata (base64Content, opts) {
    return this.metadata('deploy', {
      ZipFile: base64Content,
      DeployOptions: opts
    })
  }

  async pollDeployMetadataStatus (deployMetadataId, includeDetails, progressCallback, pollInterval = 10000) {
    const iSleep = incrementalSleep(1000, 2, 2000, 5, 5000)
    while (true) {
      await iSleep()
      const res = await this.metadata('checkDeployStatus', {
        asyncProcessId: deployMetadataId,
        includeDetails: false
      })
      if (progressCallback) progressCallback(res)
      if (res.done === 'true') {
        return !includeDetails && res.status === 'Succeeded' ? res : this.metadata('checkDeployStatus', {
          asyncProcessId: deployMetadataId,
          includeDetails: true
        })
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
