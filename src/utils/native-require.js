// Isolated in standalone module, it can be skipped by webpack build when used as a library in a webpack application
module.exports = mod => {
  delete require.cache[require.resolve(mod)]
  return require(mod)
}
