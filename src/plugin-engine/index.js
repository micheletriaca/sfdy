const multimatch = require('multimatch')
const _ = require('highland')
const l = require('lodash')
const path = require('path')
const { parseXml, buildXml } = require('../utils/xml-utils')
const pathService = require('../services/path-service')
const nativeRequire = require('../utils/native-require')
const log = require('../services/log-service').getLogger()

const transformations = []
const filterFns = []

module.exports = {
  helpers: {
    xmlTransformer: (pattern, callback) => {
      transformations.push({
        pattern,
        callback
      })
    },
    filterMetadata: (filterFn) => {
      filterFns.push(filterFn)
    }
  },
  registerPlugins: async (plugins, sfdcConnector, username, pkgJson, config = {}) => {
    transformations.length = 0
    filterFns.length = 0
    await _(plugins || [])
      .map(pluginPath => {
        if (typeof (pluginPath) === 'function') return pluginPath
        return nativeRequire(path.resolve(pathService.getBasePath(), pluginPath))
      })
      .map(plugin => plugin({
        sfdcConnector,
        environment: process.env.environment,
        username,
        log,
        pkg: pkgJson,
        config
      }, module.exports.helpers))
      .map(x => _(x))
      .sequence()
      .collect()
      .toPromise(Promise)
  },
  applyFilters: () => f => {
    for (let i = 0; i < filterFns.length; i++) {
      if (!filterFns[i](f.fileName, f.data)) return false
    }
    return true
  },
  applyTransformations: async (targetFiles, sfdcConnector, fileFilter = []) => {
    const fileMap = await l.keyBy(targetFiles, 'fileName')
    const filePaths = Object.keys(fileMap)
    const targetFilePaths = fileFilter.length ? multimatch(filePaths, fileFilter) : filePaths
    console.time('transformations')
    console.time('parsing+callback')
    await _(transformations)
      .flatMap(t => multimatch(targetFilePaths, t.pattern).map(pattern => ({ ...t, pattern })))
      .map(async t => {
        const transformedJson = fileMap[t.pattern].transformedJson || await parseXml(fileMap[t.pattern].data)
        fileMap[t.pattern].transformedJson = transformedJson
        const rootKey = Object.keys(transformedJson)[0]
        await (t.callback(t.pattern, transformedJson[rootKey], fileMap) || transformedJson[rootKey])
        return t
      })
      .map(x => _(x))
      .sequence()
      .collect()
      .tap(() => console.timeEnd('parsing+callback'))
      .map(tL => {
        console.time('building')
        Object.values(l.keyBy(tL, 'pattern')).forEach(t => {
          fileMap[t.pattern].data = buildXml(fileMap[t.pattern].transformedJson) + '\n'
        })
        console.timeEnd('building')
        return tL
      })
      .collect()
      .toPromise(Promise)
    console.timeEnd('transformations')
  }
}
