const _ = require('exstream.js')
const chalk = require('chalk')
const logger = require('../services/log-service')

_.extend('asyncMap', function (fn) { return this.map(fn).resolve() })
_.extend('apply', function (fn) { return this.collect().map(fn).values() })
_.extend('applyOne', function (fn) { return this.collect().map(fn).value() })

_.extend('mapValues', function (fn) {
  return this.map(x => Object.fromEntries(Object.entries(x).map(([k, v]) => [k, fn(v, k)])))
})

_.extend('log', function (msg, severity = 'gray') {
  const _msg = typeof msg === 'string' ? () => msg : msg
  return this.tap(x => {
    const logMsg = _msg(x)
    if (!logMsg) return
    logger.log(chalk[severity](logMsg))
  })
})

_.extend('toSet', function () {
  return this
    .collect()
    .map(x => new Set(x))
    .value()
})

_.extend('mapEntry', function (propName, fn) {
  return this.map(x => {
    x[propName] = fn(x[propName], x)
    return x
  })
})

_.extend('wrapStream', function (prefix, suffix) {
  let prefixAdded = false
  return this.consumeSync((err, x, push) => {
    if (err) {
      push(err)
    } else if (x === _.nil) {
      if (suffix) push(null, Buffer.from(suffix))
      push(null, _.nil)
    } else {
      if (!prefixAdded && prefix) {
        push(null, Buffer.from(prefix))
        prefixAdded = true
      }
      push(null, x)
    }
  })
})

module.exports = _
