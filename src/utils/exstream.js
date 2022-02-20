const _ = require('exstream.js')
const chalk = require('chalk')
const logger = require('../services/log-service')

_.extend('asyncMap', function (fn) { return this.map(fn).resolve() })
_.extend('mapValues', function (fn) {
  return this.map(x => Object.fromEntries(Object.entries(x).map(([k, v]) => [k, fn(v)])))
})
_.extend('log', function (msg, severity = 'gray') {
  const _msg = typeof msg === 'string' ? () => msg : msg
  return this.tap((x) => logger.log(chalk[severity](_msg(x))))
})
