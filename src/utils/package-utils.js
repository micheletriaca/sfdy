const fs = require('fs')
const { parseXml } = require('./xml-utils')
const path = require('path')
const glob = require('globby')
const _ = require('lodash')
const os = require('os')
const pathService = require('../services/path-service')
const crypto = require('crypto')

module.exports = {
  getListOfSrcFiles: async (packageMapping = {}, pattern = ['**/*']) => {
    const ignoreDiffs = new Set([
      'package.xml',
      'lwc/.eslintrc.json',
      'lwc/jsconfig.json'
    ])

    const regex = new RegExp(`^/?${pathService.getSrcFolder()}/`)
    const files = _(pattern.map(x => x.replace(regex, '')))
      .map(x => /((reports)|(dashboards)|(documents)|(email))\/[^/]+-meta.xml/.test(x) ? x : x.replace(/-meta.xml$/, ''))
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

    const globPatterns = files.filter(f => glob.hasMagic(f))
    const rawFiles = files.filter(f => !glob.hasMagic(f))
    const filesFromGlobPatterns = await glob(globPatterns, { cwd: pathService.getSrcFolder(true) })
    const allFiles = new Set([...filesFromGlobPatterns, ...rawFiles])
    return [...allFiles].filter(x => !ignoreDiffs.has(x))
  },
  getPackageMapping: async sfdcConnector => {
    const cacheKey = crypto.createHash('md5').update(sfdcConnector.sessionId).digest('hex')
    const cachePath = path.resolve(os.tmpdir(), 'sfdy' + cacheKey)
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
        return module.exports.buildPackageXmlFromFiles(opts.specificFiles, packageMapping, opts.skipParseGlobPatterns)
      } else {
        return module.exports.buildPackageXmlFromMeta(opts.specificMeta)
      }
    }
    return (await parseXml(fs.readFileSync(pathService.getPackagePath()))).Package
  },
  buildPackageXmlFromMeta: async (meta) => {
    const packageJson = await parseXml(fs.readFileSync(pathService.getPackagePath()))
    const types = _(meta).groupBy(x => x.split('/')[0]).mapValues(x => x.map(y => y.split('/')[1] || '*')).value()
    packageJson.Package.types = Object.entries(types).map(([k, v]) => ({ name: [k], members: v }))
    return packageJson.Package
  },
  buildPackageXmlFromFiles: async (files, packageMapping, skipParseGlobPatterns = false) => {
    if (!skipParseGlobPatterns) files = await module.exports.getListOfSrcFiles(packageMapping, files)
    const packageJson = await parseXml(fs.readFileSync(pathService.getPackagePath()))
    const metaMap = _(files)
      .filter(x => !x.endsWith('/**'))
      .filter(x => /((reports)|(dashboards)|(documents)|(email))\/[^/]+-meta.xml/.test(x) || !x.endsWith('-meta.xml'))
      .groupBy(f => packageMapping[f.substring(0, f.indexOf('/'))].xmlName)
      .mapValues(x => x.map(y => {
        const key = y.substring(0, y.indexOf('/'))
        y = y.replace(key + '/', '').replace((packageMapping[key].suffix && '.' + packageMapping[key].suffix) || '', '')
        if (packageMapping[key].inFolder === 'true') y = y.replace(/-meta.xml$/, '')
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
