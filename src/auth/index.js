#!/usr/bin/env node

const fetch = require('node-fetch')
const http = require('http')
const open = require('open')

const get = (url, at) => fetch(url, { headers: { 'authorization': `Bearer ${at}` } }).then(res => res.json())
const post = (url, body, ct = 'application/x-www-form-urlencoded') => fetch(url, {
  method: 'POST', body, headers: { 'content-type': ct }
}).then(res => res.json())

module.exports = async (baseUrl, clientId, clientSecret, callbackPort) => new Promise((resolve, reject) => {
  const server = http.createServer(async (req, res) => {
    const u = new URL('http://localhost' + req.url)
    if (u.pathname !== '/callback' || !u.searchParams.get('code')) return res.writeHead(404) && res.end()

    try {
      const body = new URLSearchParams()
      body.append('grant_type', 'authorization_code')
      body.append('code', u.searchParams.get('code'))
      body.append('client_id', clientId)
      body.append('redirect_uri', `http://localhost:${callbackPort}/callback`)
      if (clientSecret) body.append('client_secret', clientSecret)

      const resOauth2 = await post(`https://${baseUrl}/services/oauth2/token`, body.toString())
      const resUserInfo = await get(resOauth2.id, resOauth2.access_token)

      res.writeHead(200) && res.end('Login completed. You can safely close the browser now')
      resolve({ oauth2: resOauth2, userInfo: resUserInfo })
    } catch (e) {
      res.end('Something went wrong during oauth2 flow')
      reject(e)
    } finally {
      server.close()
    }
  }).listen(3000)

  const authorizeUrl = new URL(`https://${baseUrl}/services/oauth2/authorize`)
  const query = authorizeUrl.searchParams
  query.append('client_id', clientId)
  query.append('response_type', 'code')
  query.append('prompt', 'login consent')
  query.append('redirect_uri', `http://localhost:${callbackPort}/callback`)
  query.append('scope', 'api refresh_token')

  open(authorizeUrl.toString())
})
