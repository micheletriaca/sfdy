let log = console.log

module.exports = {
  setLogger: l => (log = l),
  log: (...args) => log(...args),
  debug: (...args) => process.env.DEBUG === 'true' && log(...args),
  time: (...args) => process.env.DEBUG === 'true' && console.time(...args),
  timeLog: (...args) => process.env.DEBUG === 'true' && console.timeLog(...args),
  timeEnd: (...args) => process.env.DEBUG === 'true' && console.timeEnd(...args)
}
