let basePath = process.cwd()

module.exports = {
  setBasePath (p) {
    basePath = p
  },
  getBasePath () {
    return basePath
  }
}
