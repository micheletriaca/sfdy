const fs = require('fs')
const { parseXml } = require('./xml-utils')
const path = require('path')
const glob = require('globby')
const _ = require('lodash')
const os = require('os')

const PACKAGE_PATH = path.resolve(process.cwd(), 'src', 'package.xml')

module.exports = {
  getMembersOf: async pkgName => {
    const packageJson = await parseXml(fs.readFileSync(PACKAGE_PATH))
    const block = packageJson.Package.types.find(x => x.name[0] === pkgName)
    return !block ? [] : block.members
  },
  getTypeList: async () => {
    const packageJson = await parseXml(fs.readFileSync(PACKAGE_PATH))
    return packageJson.Package.types.map(x => x.name[0])
  },
  getProfileOnlyPackage: async () => {
    const packageJson = await parseXml(fs.readFileSync(PACKAGE_PATH))
    packageJson.Package.types = packageJson.Package.types.filter(t => (
      t.name[0] === 'CustomApplication' ||
      t.name[0] === 'ApexClass' ||
      t.name[0] === 'ApexPage' ||
      t.name[0] === 'CustomObject' ||
      t.name[0] === 'CustomTab' ||
      t.name[0] === 'CustomPermission' ||
      t.name[0] === 'Layout' ||
      t.name[0] === 'DataCategoryGroup' ||
      t.name[0] === 'ExternalDataSource' ||
      t.name[0] === 'Profile' ||
      t.name[0] === 'PermissionSet'
    ))
    return packageJson.Package
  },
  getListOfSrcFiles: async (packageMapping = {}, pattern = ['**/*']) => {
    const ignoreDiffs = new Set([
      'package.xml',
      'lwc/.eslintrc.json',
      'lwc/jsconfig.json'
    ])
    const files = _(pattern.map(x => x.replace(/^src\//, '')))
      .map(x => x.replace(/-meta.xml$/, ''))
      .flatMap(x => {
        const key = x.substring(0, x.indexOf('/'))
        const res = [x]
        const pkgEntry = packageMapping[key]
        if (!pkgEntry) return res
        if (pkgEntry.metaFile === 'true') res.push(x + '-meta.xml')
        const subx = x.replace(key + '/', '')
        if (pkgEntry.inFolder !== 'true' && subx.indexOf('/') !== -1) res.push(key + '/' + subx.substring(0, subx.indexOf('/')) + '/**')
        return res
      })
      .uniq()
      .value()
    return (await glob(files, { cwd: process.cwd() + '/src' })).filter(x => !ignoreDiffs.has(x))
  },
  getPackageMapping: async sfdcConnector => {
    const cachePath = path.resolve(os.tmpdir(), 'sftx' + sfdcConnector.sfConn.sessionId)
    const hasCache = fs.existsSync(cachePath)
    if (hasCache) return JSON.parse(fs.readFileSync(cachePath))
    const packageMapping = _.keyBy((await sfdcConnector.describeMetadata()).metadataObjects, 'directoryName')
    fs.writeFileSync(cachePath, JSON.stringify(packageMapping))
    return packageMapping
  },
  getPackageXml: async (opts = {}) => {
    const hasSpecificFiles = opts.specificFiles && opts.specificFiles.length
    const hasSpecificMeta = opts.specificMeta && opts.specificMeta.length
    if ((hasSpecificFiles || hasSpecificMeta) && opts.sfdcConnector) {
      const packageMapping = await module.exports.getPackageMapping(opts.sfdcConnector)
      if (hasSpecificFiles) {
        return module.exports.buildPackageXmlFromFiles(opts.specificFiles, packageMapping)
      } else {
        return module.exports.buildPackageXmlFromMeta(opts.specificMeta)
      }
    }
    return (await parseXml(fs.readFileSync(PACKAGE_PATH))).Package
  },
  buildPackageXmlFromMeta: async (meta) => {
    const packageJson = await parseXml(fs.readFileSync(PACKAGE_PATH))
    const types = _(meta).groupBy(x => x.split('/')[0]).mapValues(x => x.map(y => y.split('/')[1] || '*')).value()
    packageJson.Package.types = Object.entries(types).map(([k, v]) => ({ name: [k], members: v }))
    return packageJson.Package
  },
  buildPackageXmlFromFiles: async (files, packageMapping) => {
    files = await module.exports.getListOfSrcFiles(packageMapping, files)
    const packageJson = await parseXml(fs.readFileSync(PACKAGE_PATH))
    const metaMap = _(files)
      .filter(x => !x.endsWith('/**'))
      .filter(x => !x.endsWith('-meta.xml'))
      .groupBy(f => packageMapping[f.substring(0, f.indexOf('/'))].xmlName)
      .mapValues(x => x.map(y => {
        const key = y.substring(0, y.indexOf('/'))
        y = y.replace(key + '/', '').replace((packageMapping[key].suffix && '.' + packageMapping[key].suffix) || '', '')
        if (packageMapping[key].inFolder !== 'true' && y.indexOf('/') !== -1) y = y.substring(0, y.indexOf('/'))
        return y
      }))
      .value()
    packageJson.Package.types = Object.entries(metaMap).map(x => ({
      members: [...new Set(x[1])],
      name: [x[0]]
    }))
    return packageJson.Package
  }
}
