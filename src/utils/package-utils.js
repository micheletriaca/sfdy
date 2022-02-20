const fs = require('fs')
const { parseXml } = require('./xml-utils')
const path = require('path')
const glob = require('globby')
const _ = require('exstream.js')
const cloneDeep = require('lodash').cloneDeep
const os = require('os')
const pathService = require('../services/path-service')
const crypto = require('crypto')

module.exports = {
  getMeta (packageMapping, filePath, folderName) {
    const meta = packageMapping[folderName]
    if (!meta || !Array.isArray(meta)) return meta
    const hasSuffix = filePath.match(/\.([^.]+)(-meta\.xml)?$/)
    const suffix = (hasSuffix && hasSuffix[1]) || ''
    return meta.find(x => x.suffix === suffix)
  },

  getCompanionsFileList: async (fileList, packageMapping) => {
    const res = { globPatterns: [], companionFileList: [] }

    for (const f of fileList) {
      const firstSlashIdx = f.indexOf('/')
      const folder = f.substring(0, firstSlashIdx)
      const sfdcMeta = module.exports.getMeta(packageMapping, f, folder)

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
      const { xmlName, suffix } = module.exports.getMeta(packageMapping, f, folder)
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
  },
  addTypesToPackageFromMeta (pkgJson, metaGlobPatterns) {
    const pkgClone = cloneDeep(pkgJson)

    const pkgMap = _(pkgClone.Package.types)
      .keyBy('name')
      .mapValues(({ members: m }) => new Set(m))
      .value()

    _(metaGlobPatterns).each(m => {
      const [metaName, metaMember] = m.split('/')
      if (!pkgMap[metaName]) pkgMap[metaName] = new Set()
      pkgMap[metaName].add(metaMember)
    })

    pkgClone.Package.types = _(Object.entries(pkgMap))
      .map(([n, m]) => ({ name: n, members: [...m] }))
      .values()

    return pkgClone
  }
}
