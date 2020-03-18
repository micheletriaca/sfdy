const { buildXml, parseXmlNoArray } = require('./xml-utils')
const logger = require('../services/log-service')
const chalk = require('chalk')
const fetch = require('node-fetch').default

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

const wsdlMap = {
  partner: {
    urlPath: '/services/Soap/u/',
    namespaces: { 'xmlns': 'urn:partner.soap.sforce.com', 'xmlns:sf': 'urn:sobject.partner.soap.sforce.com' }
  },
  metadata: {
    urlPath: '/services/Soap/m/',
    namespaces: { 'xmlns': 'http://soap.sforce.com/2006/04/metadata' }
  }
}

class SfdcConn {
  async login ({ username, password, isSandbox = true, serverUrl, apiVersion }) {
    this.apiVersion = apiVersion
    this.instanceUrl = 'https://' + ((serverUrl && serverUrl.replace('https://', '')) || `${isSandbox ? 'test' : 'login'}.salesforce.com`)
    const { serverUrl: instanceUrl, sessionId } = await this.metadata('login', { username, password }, 'partner')
    this.instanceUrl = /(https:\/\/.*)\/services/.exec(instanceUrl)[1]
    this.sessionId = sessionId
  }

  async query (q, useTooling = false) {
    const url = `${this.instanceUrl}/services/data/v${this.apiVersion}/${useTooling ? 'tooling/' : ''}query/?q=${encodeURIComponent(q.replace(/\n|\t/g, ''))}`
    return fetch(url, { headers: { 'Authorization': `Bearer ${this.sessionId}` } })
      .then(res => res.json())
      .then(json => json.records)
  }

  async rest (path) {
    const url = this.instanceUrl + `/services/data/v${this.apiVersion}${path}`
    return fetch(url, { headers: { 'Authorization': `Bearer ${this.sessionId}` } }).then(res => res.json())
  }

  async metadata (method, args, wsdl = 'metadata') {
    const res = await fetch(this.instanceUrl + wsdlMap[wsdl].urlPath + this.apiVersion, {
      method: 'post',
      body: buildXml({
        'soapenv:Envelope': {
          $: {
            'xmlns:soapenv': 'http://schemas.xmlsoap.org/soap/envelope/',
            'xmlns:xsd': 'http://www.w3.org/2001/XMLSchema',
            'xmlns:xsi': 'http://www.w3.org/2001/XMLSchema-instance',
            ...wsdlMap[wsdl].namespaces
          },
          'soapenv:Header': { SessionHeader: { sessionId: this.sessionId || '' } },
          'soapenv:Body': { [method]: args }
        }
      }),
      headers: {
        'Content-Type': 'text/xml',
        'SOAPAction': '""'
      }
    })
    const body = (await parseXmlNoArray(await res.text()))['soapenv:Envelope']['soapenv:Body']
    if (res.ok) {
      return body[method + 'Response'].result
    } else {
      const err = new Error()
      err.name = 'SalesforceSoapError'
      err.message = body['soapenv:Fault'].faultstring
      err.detail = body['soapenv:Fault']
      err.response = res
      throw err
    }
  }

  async retrieveMetadata (pkgJson) {
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
        logger.log(chalk.grey('checking retrieve status...', res.status))
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
  newInstance: async ({ username, password, isSandbox = true, serverUrl, apiVersion }) => {
    const res = new SfdcConn()
    await res.login({ username, password, isSandbox, serverUrl, apiVersion })
    res.query = res.query.bind(res)
    return res
  }
}
