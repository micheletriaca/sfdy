const path = require('path')
let basePath = process.cwd()
let srcFolder = 'src'

module.exports = {
  setBasePath: p => (basePath = p),
  setSrcFolder: p => (srcFolder = p),
  getBasePath: () => basePath,
  getSrcFolder: (absolute = false) => absolute ? path.resolve(basePath, srcFolder) : srcFolder,
  getPackagePath: () => path.resolve(basePath, srcFolder, 'package.xml')
}
