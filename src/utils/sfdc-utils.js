const { buildXml, parseXmlNoArray } = require('./xml-utils')
const logger = require('../services/log-service')
const chalk = require('chalk')
const fetch = require('node-fetch').default
const { Base64Encode } = require('base64-stream')
const _ = require('highland')

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

const wrapStream = (prefix, suffix) => source => {
  let prefixAdded = false

  return source.consume((err, x, push, next) => {
    if (err) {
      push(err)
      next()
    } else if (x === _.nil) {
      if (suffix) {
        push(null, Buffer.from(suffix))
      }
      push(null, _.nil)
    } else {
      if (!prefixAdded && prefix) {
        push(null, Buffer.from(prefix))
        prefixAdded = true
      }
      push(null, x)
      next()
    }
  })
}

const wsdlMap = {
  partner: {
    urlPath: '/services/Soap/u/',
    namespaces: { xmlns: 'urn:partner.soap.sforce.com', 'xmlns:sf': 'urn:sobject.partner.soap.sforce.com' }
  },
  metadata: {
    urlPath: '/services/Soap/m/',
    namespaces: { xmlns: 'http://soap.sforce.com/2006/04/metadata' }
  }
}

class SfdcConn {
  async login ({ username, password, isSandbox = true, serverUrl, oauth2, apiVersion, sessionId, instanceHostname }) {
    this.apiVersion = apiVersion
    this.username = username
    if (oauth2) await this.oauth2Login(oauth2)
    else await this.soapLogin({ username, password, isSandbox, serverUrl, sessionId, instanceHostname })
  }

  async oauth2Login (oauth2) {
    if (oauth2.grantType === 'client_credentials') return this.oauth2ClientCredentials(oauth2)
    return this.oauth2Refresh(oauth2)
  }

  async oauth2TokenRequest (url, body) {
    const response = await fetch(url, {
      method: 'POST', body, headers: { 'content-type': 'application/x-www-form-urlencoded' }
    })
    const result = await response.json()
    if (!response.ok) {
      const error = new Error(result.error_description || result.error || `OAuth token request failed (${response.status})`)
      error.name = 'SalesforceOAuthError'
      error.detail = result
      throw error
    }
    return result
  }

  async setOauth2Session (oauth2Response) {
    this.instanceUrl = oauth2Response.instance_url
    this.sessionId = oauth2Response.access_token
    if (!this.username) {
      const userInfoUrl = oauth2Response.id || `${this.instanceUrl}/services/oauth2/userinfo`
      const response = await fetch(userInfoUrl, { headers: { authorization: `Bearer ${this.sessionId}` } })
      const userInfo = await response.json()
      if (!response.ok) throw new Error(userInfo.error_description || userInfo.error || 'Unable to retrieve the authenticated Salesforce user')
      this.username = userInfo.username || userInfo.preferred_username || userInfo.email
    }
  }

  async oauth2Refresh ({ instanceUrl, refreshToken, clientId, clientSecret }) {
    const body = new URLSearchParams()
    body.append('grant_type', 'refresh_token')
    body.append('refresh_token', refreshToken)
    body.append('client_id', clientId)
    if (clientSecret) body.append('client_secret', clientSecret)

    const resOauth2 = await this.oauth2TokenRequest(`${instanceUrl.replace(/\/$/, '')}/services/oauth2/token`, body.toString())
    await this.setOauth2Session(resOauth2)
  }

  async oauth2ClientCredentials ({ loginUrl, clientId, clientSecret }) {
    if (!loginUrl) throw new Error('Client credentials authentication requires a Salesforce My Domain login URL')
    const body = new URLSearchParams()
    body.append('grant_type', 'client_credentials')
    body.append('client_id', clientId)
    body.append('client_secret', clientSecret)

    const resOauth2 = await this.oauth2TokenRequest(`${loginUrl.replace(/\/$/, '')}/services/oauth2/token`, body.toString())
    await this.setOauth2Session(resOauth2)
  }

  async soapLogin ({ username, password, isSandbox = true, serverUrl, sessionId, instanceHostname }) {
    if (!sessionId || !instanceHostname) {
      this.instanceUrl = 'https://' + ((serverUrl && serverUrl.replace('https://', '')) || `${isSandbox ? 'test' : 'login'}.salesforce.com`)
      const { serverUrl: instanceUrl, sessionId } = await this.metadata('login', { username, password }, { wsdl: 'partner' })
      this.instanceUrl = /(https:\/\/.*)\/services/.exec(instanceUrl)[1]
      this.sessionId = sessionId
    } else {
      this.sessionId = sessionId
      this.instanceUrl = 'https://' + instanceHostname
    }
  }

  async query (q, useTooling = false) {
    const url = `${this.instanceUrl}/services/data/v${this.apiVersion}/${useTooling ? 'tooling/' : ''}query/?q=${encodeURIComponent(q.replace(/\n|\t/g, ''))}`
    return fetch(url, { headers: { Authorization: `Bearer ${this.sessionId}` } })
      .then(res => res.json())
      .then(json => json.records)
  }

  async rest (path) {
    const url = this.instanceUrl + `/services/data/v${this.apiVersion}${path}`
    return fetch(url, { headers: { Authorization: `Bearer ${this.sessionId}` } }).then(res => res.json())
  }

  async publishCommunity (communityId) {
    const url = this.instanceUrl + `/services/data/v${this.apiVersion}/connect/communities/${communityId}/publish`
    return fetch(url, { headers: { Authorization: `Bearer ${this.sessionId}` }, method: 'POST' }).then(res => res.json())
  }

  buildMetadataBody (method, args, wsdl = 'metadata') {
    return buildXml({
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
    })
  }

  async metadata (method, args, { wsdl = 'metadata', rawBody = false, rawResponse = false } = {}) {
    const res = await fetch(this.instanceUrl + wsdlMap[wsdl].urlPath + this.apiVersion, {
      method: 'post',
      body: rawBody ? args : this.buildMetadataBody(method, args, wsdl),
      headers: {
        'Content-Type': 'text/xml',
        SOAPAction: '""'
      }
    })
    if (rawResponse) {
      if (res.ok) return res
      else {
        const err = new Error('SalesforceSoapError')
        err.name = 'SalesforceSoapError'
        err.response = res
        throw err
      }
    } else {
      const body = (await parseXmlNoArray(await res.text()))['soapenv:Envelope']['soapenv:Body']
      if (res.ok) return body[method + 'Response'].result
      else {
        const err = new Error()
        err.name = 'SalesforceSoapError'
        err.message = body['soapenv:Fault'].faultstring
        err.detail = body['soapenv:Fault']
        err.response = res
        throw err
      }
    }
  }

  async retrieveMetadata (pkgJson) {
    delete pkgJson.$
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

  async deployMetadata (contentStream, opts) {
    const [preBody, postBody] = this.buildMetadataBody('deploy', {
      ZipFile: '$$ZIPFILE$$',
      DeployOptions: opts
    }).split('$$ZIPFILE$$')

    const bodyStream = _(contentStream.pipe(new Base64Encode()))
      .through(wrapStream(preBody, postBody))
      .toNodeStream()

    return this.metadata('deploy', bodyStream, { rawBody: true })
  }

  async quickDeployMetadata (deploymentId) {
    const res = await this.metadata('deployRecentValidation', {
      validationId: deploymentId
    })
    return { id: res }
  }

  async pollDeployMetadataStatus (deployMetadataId, includeDetails, progressCallback) {
    const iSleep = incrementalSleep(1000, 2, 2000, 5, 5000)
    while (true) {
      await iSleep()
      const res = await this.metadata('checkDeployStatus', {
        asyncProcessId: deployMetadataId,
        includeDetails: false
      })
      if (progressCallback) progressCallback(res)
      if (res.done === 'true') {
        return !includeDetails && res.status === 'Succeeded'
          ? res
          : this.metadata('checkDeployStatus', {
            asyncProcessId: deployMetadataId,
            includeDetails: true
          })
      }
    }
  }
}

module.exports = {
  newInstance: async ({ username, password, isSandbox = true, serverUrl, oauth2, apiVersion, sessionId, instanceHostname }) => {
    const res = new SfdcConn()
    await res.login({ username, password, isSandbox, oauth2, serverUrl, apiVersion, sessionId, instanceHostname })
    res.query = res.query.bind(res)
    return res
  }
}
