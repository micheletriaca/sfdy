const fs = require('fs')
const { parseXml } = require('./xml-utils')
const path = require('path')
const glob = require('globby')
const _ = require('exstream.js')
const os = require('os')
const pathService = require('../services/path-service')
const crypto = require('crypto')

_.extend('mapValues', function (fn) {
  return this
    .map(Object.entries)
    .flatten()
    .map(([k, v]) => [k, fn(v)])
    .collect()
    .map(Object.fromEntries)
})

module.exports = {
  getMeta (packageMapping, filePath, folderName) {
    const hasSuffix = filePath.match(/\.([^.]+)(-meta.xml)?$/)
    const suffix = (hasSuffix && hasSuffix[1]) || ''
    const meta = packageMapping[folderName]
    if (!meta || !Array.isArray(meta)) return meta
    else return meta.find(x => x.suffix === suffix)
  },

  getCompanionsFileList: async (fileList, packageMapping) => {
    // TODO -> IGNORE DIFFS
    /* const ignoreDiffs = new Set([
      'package.xml',
      'lwc/.eslintrc.json',
      'lwc/jsconfig.json'
    ]) */

    const res = { globPatterns: [], companionFileList: [] }

    for (const f of fileList) {
      const firstSlashIdx = f.indexOf('/')
      const folder = f.substring(0, firstSlashIdx)
      const sfdcMeta = packageMapping[folder]

      // If this file needs a metafile, I add it
      if (sfdcMeta.metaFile === 'true') {
        if (f.endsWith('-meta.xml')) res.globPatterns.push(f.replace('-meta.xml', ''))
        else res.globPatterns.push(f + '-meta.xml')
      }
      // If this file is in a bundle, I add all the items of the bundle
      if (sfdcMeta.xmlName.endsWith('Bundle')) {
        const componentName = f.substring(firstSlashIdx + 1, f.indexOf('/', firstSlashIdx + 1))
        res.globPatterns.push(folder + '/' + componentName + '/**/*')
      }
    }

    res.companionFileList = await glob(res.globPatterns, { cwd: pathService.getSrcFolder(true) })
    return res
  },
  getPackageMapping: async sfdcConnector => {
    const cacheKey = crypto.createHash('md5').update(sfdcConnector.sessionId).digest('hex')
    const cachePath = path.resolve(os.tmpdir(), 'sfdy_v2.0.0_' + cacheKey)
    const hasCache = fs.existsSync(cachePath)
    if (hasCache) return JSON.parse(fs.readFileSync(cachePath))
    const packageMapping = await _(sfdcConnector.describeMetadata())
      .flatMap(x => x.metadataObjects)
      .groupBy(x => x.directoryName)
      .mapValues(v => v.length === 1 ? v[0] : v)
      .value()
    fs.writeFileSync(cachePath, JSON.stringify(packageMapping))
    return packageMapping
  },
  buildPackageXmlFromMeta: async (meta) => {
    const packageJson = await parseXml(fs.readFileSync(pathService.getPackagePath()))
    const types = _(meta)
      .groupBy(x => x.split('/')[0])
      .mapValues(v => v.map(y => y.substring(y.indexOf('/') + 1) || '*'))
      .value()
    packageJson.Package.types = Object.entries(types).map(([k, v]) => ({ name: [k], members: v }))
    return packageJson.Package
  },
  buildPackageXmlFromFiles: (fileList, packageMapping, apiVersion) => {
    const types = {}
    for (const f of fileList) {
      const firstSlashIdx = f.indexOf('/')
      const folder = f.substring(0, firstSlashIdx)
      const { xmlName, suffix } = packageMapping[folder]
      const suffixRegexp = new RegExp('(\\.' + suffix + ')?(-meta.xml)?$', '')
      const componentNameEndIdx = xmlName.endsWith('Bundle') ? f.indexOf('/', firstSlashIdx + 1) : undefined
      const componentName = f.substring(firstSlashIdx + 1, componentNameEndIdx).replace(suffixRegexp, '')
      types[xmlName] = types[xmlName] || new Set()
      types[xmlName].add(componentName)
    }
    return {
      Package: {
        $: { xmlns: 'http://soap.sforce.com/2006/04/metadata' },
        types: Object.entries(types).map(([name, membersSet]) => ({
          members: [...membersSet],
          name
        })),
        version: apiVersion
      }
    }
  }
}
