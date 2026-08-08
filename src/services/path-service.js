const path = require('path')
const fs = require('fs')
let basePath = process.cwd()
let srcFolder = 'src'
let apiVersion

const normalizeFormat = value => value && value.toLowerCase() === 'mdapi' ? 'metadata' : value && value.toLowerCase()

const configureProject = ({
  basePath: configuredBasePath,
  srcFolder: configuredSourceFolder,
  sourceFormat,
  config = {}
} = {}) => {
  if (configuredBasePath) basePath = configuredBasePath
  srcFolder = configuredSourceFolder || config.sourceFolder || 'src'
  apiVersion = config.apiVersion

  if (normalizeFormat(sourceFormat || config.sourceFormat) !== 'sfdx') return
  const projectPath = path.resolve(basePath, 'sfdx-project.json')
  if (fs.existsSync(projectPath)) {
    const project = JSON.parse(fs.readFileSync(projectPath, 'utf8'))
    apiVersion = apiVersion || project.sourceApiVersion
    if (!(configuredSourceFolder || config.sourceFolder)) {
      const packageDirectories = project.packageDirectories || []
      const packageDirectory = packageDirectories.find(item => item.default) || packageDirectories[0]
      if (packageDirectory && packageDirectory.path) {
        const conventionalRoot = path.join(packageDirectory.path, 'main', 'default')
        srcFolder = fs.existsSync(path.resolve(basePath, conventionalRoot))
          ? conventionalRoot
          : packageDirectory.path
      }
    }
  }

  const legacyPackagePath = path.resolve(basePath, srcFolder, 'package.xml')
  if (!apiVersion && fs.existsSync(legacyPackagePath)) {
    const version = fs.readFileSync(legacyPackagePath, 'utf8').match(/<version>([^<]+)<\/version>/)
    apiVersion = version && version[1]
  }
}

module.exports = {
  setBasePath: p => (basePath = p),
  setSrcFolder: p => (srcFolder = p),
  configureProject,
  getBasePath: () => basePath,
  getSrcFolder: (absolute = false) => absolute ? path.resolve(basePath, srcFolder) : srcFolder,
  getPackagePath: () => path.resolve(basePath, srcFolder, 'package.xml'),
  getApiVersion: () => apiVersion
}
