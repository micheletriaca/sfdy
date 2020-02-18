let log = console.log

module.exports = {
  setLogger: l => (log = l),
  getLogger: () => (...args) => log(...args)
}
