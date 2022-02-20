const path = require('path')
const pathService = require('../services/path-service')

// Isolated in standalone module, it can be skipped by webpack build when used as a library in a webpack application
module.exports = mod => {
  const p = path.resolve(pathService.getBasePath(), mod)
  delete require.cache[require.resolve(p)]
  return require(p)
}
