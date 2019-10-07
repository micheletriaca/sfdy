const handleError = e => {
  console.error(typeof (e) === 'string' ? e : e.message)
  process.exit(1)
}

module.exports = () => {
  process.on('uncaughtException', handleError)
  process.on('unhandledRejection', handleError)
}
