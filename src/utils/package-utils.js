const fs = require('fs')
const { parseXml } = require('./xml-utils')
const path = require('path')
const glob = require('globby')
const _ = require('lodash')
const os = require('os')
const pathService = require('../services/path-service')
const crypto = require('crypto')
const minimatch = require('minimatch')

module.exports = {
  getMeta (packageMapping, filePath, folderName) {
    const hasSuffix = filePath.match(/\.([^.]+)(-meta.xml)?$/)
    const suffix = (hasSuffix && hasSuffix[1]) || ''
    const meta = packageMapping[folderName]
    if (!meta || !Array.isArray(meta)) return meta
    else return meta.find(x => x.suffix === suffix)
  },

  getListOfSrcFiles: async (packageMapping = {}, pattern = ['**/*'], onlyRealFiles = false) => {
    const ignoreDiffs = new Set([
      'package.xml',
      'lwc/.eslintrc.json',
      'lwc/jsconfig.json'
    ])

    const regex = new RegExp(`^/?${pathService.getSrcFolder()}/`)

    let globPatterns = pattern.filter(f => onlyRealFiles || glob.hasMagic(f)).map(x => x.replace(regex, ''))
    const globFiles = await glob(globPatterns, { cwd: pathService.getSrcFolder(true) })
    const negatedPatterns = globPatterns.filter(x => x.startsWith('!'))
    let rawFiles = [...(onlyRealFiles ? [] : pattern), ...globFiles]
      .filter(f => !glob.hasMagic(f))
      .filter(x => negatedPatterns.every(np => minimatch(x, np)))
      .map(x => x.replace(regex, ''))

    const files = _([...new Set(rawFiles)])
      .map(x => /((reports)|(dashboards)|(documents)|(email))(\/[^/]+)+-meta.xml/.test(x) ? x : x.replace(/-meta.xml$/, ''))
      .flatMap(x => {
        const key = x.substring(0, x.indexOf('/'))
        const res = [x]
        const pkgEntry = module.exports.getMeta(packageMapping, x, key)
        if (!pkgEntry) return res
        if (pkgEntry.metaFile === 'true') res.push(x + '-meta.xml')

        const subx = x.replace(key + '/', '')
        if (pkgEntry.directoryName === 'experiences' && subx.indexOf('/') !== -1) {
          res.push(key + '/' + subx.substring(0, subx.indexOf('/')) + '/**')
          res.push(key + '/' + subx.substring(0, subx.indexOf('/')) + '.site-meta.xml')
        }
        if (pkgEntry.inFolder !== 'true' && subx.indexOf('/') !== -1) res.push(key + '/' + subx.substring(0, subx.indexOf('/')) + '/**')
        return res
      })
      .uniq()
      .value()

    globPatterns = files.filter(f => glob.hasMagic(f))
    rawFiles = files.filter(f => !glob.hasMagic(f))
    if (!globPatterns.length) return rawFiles.filter(x => !ignoreDiffs.has(x))
    else {
      const filesFromGlobPatterns = await glob(files, { cwd: pathService.getSrcFolder(true) })
      return filesFromGlobPatterns.filter(x => !ignoreDiffs.has(x))
    }
  },
  getPackageMapping: async sfdcConnector => {
    const cacheKey = crypto.createHash('md5').update(sfdcConnector.sessionId).digest('hex')
    const cachePath = path.resolve(os.tmpdir(), 'sfdy_v1.4.6_' + cacheKey)
    const hasCache = fs.existsSync(cachePath)
    if (hasCache) return JSON.parse(fs.readFileSync(cachePath))
    const packageMapping = _((await sfdcConnector.describeMetadata()).metadataObjects)
      .groupBy(x => x.directoryName)
      .mapValues(x => x.length === 1 ? x[0] : x)
      .value()
    fs.writeFileSync(cachePath, JSON.stringify(packageMapping))
    return packageMapping
  },
  getPackageXml: async (opts = {}) => {
    const hasSpecificFiles = opts.specificFiles && opts.specificFiles.length
    const hasSpecificMeta = opts.specificMeta && opts.specificMeta.length
    const hasSpecificPackage = opts.specificPackage
    if ((hasSpecificFiles || hasSpecificMeta) && opts.sfdcConnector) {
      const packageMapping = await module.exports.getPackageMapping(opts.sfdcConnector)
      if (hasSpecificFiles) {
        return module.exports.buildPackageXmlFromFiles(opts.specificFiles, packageMapping, opts.skipParseGlobPatterns)
      } else {
        return module.exports.buildPackageXmlFromMeta(opts.specificMeta)
      }
    }
    if (hasSpecificPackage) {
      return (await parseXml(fs.readFileSync(path.resolve(pathService.getBasePath(), opts.specificPackage)))).Package
    } else {
      return (await parseXml(fs.readFileSync(pathService.getPackagePath()))).Package
    }
  },
  buildPackageXmlFromMeta: async (meta) => {
    const packageJson = await parseXml(fs.readFileSync(pathService.getPackagePath()))
    const types = _(meta).groupBy(x => x.split('/')[0]).mapValues(x => x.map(y => {
      const idx = y.indexOf('/')
      return y.substring(idx + 1) || '*'
    })).value()
    packageJson.Package.types = Object.entries(types).map(([k, v]) => ({ name: [k], members: v }))
    return packageJson.Package
  },
  buildPackageXmlFromFiles: async (files, packageMapping, skipParseGlobPatterns = false) => {
    if (!skipParseGlobPatterns) files = await module.exports.getListOfSrcFiles(packageMapping, files)
    const packageJson = await parseXml(fs.readFileSync(pathService.getPackagePath()))
    const metaMap = _(files)
      .filter(x => !x.endsWith('/**'))
      .filter(x => /((reports)|(dashboards)|(documents)|(email))\/[^/]+-meta.xml/.test(x) || !x.endsWith('-meta.xml'))
      .map(x => {
        const key = x.substring(0, x.indexOf('/'))
        const hasSuffix = x.replace('-meta.xml', '').match(/\.([^.]+)$/)
        const suffix = (hasSuffix && hasSuffix[1]) || ''
        return {
          mapping: module.exports.getMeta(packageMapping, x, key),
          name: x.replace(key + '/', '').replace('-meta.xml', '').replace(suffix ? '.' + suffix : '', ''),
          suffix,
          key
        }
      })
      .filter(f => f.mapping)
      .groupBy(f => f.mapping.xmlName)
      .mapValues(x => x.map(y => {
        if (y.mapping.inFolder !== 'true' && y.name.indexOf('/') !== -1) y.name = y.name.substring(0, y.name.indexOf('/'))
        return y.name
      }))
      .value()
    packageJson.Package.types = Object.entries(metaMap).map(x => ({
      members: [...new Set(x[1])],
      name: [x[0]]
    }))
    return packageJson.Package
  }
}
