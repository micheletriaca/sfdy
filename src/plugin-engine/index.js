const { getListOfSrcFiles, getPackageMapping } = require('../utils/package-utils')
const multimatch = require('multimatch')
const _ = require('highland')
const path = require('path')
const fs = require('fs')
const { parseXml, buildXml } = require('../utils/xml-utils')
const pathService = require('../services/path-service')
const nativeRequire = require('../utils/native-require')
const log = require('../services/log-service').getLogger()

const transformations = []

const applyTransformations = async (fileFilter, sfdcConnector) => {
  const packageMapping = await getPackageMapping(sfdcConnector)
  const files = await getListOfSrcFiles(packageMapping, fileFilter && fileFilter.length ? fileFilter : undefined)
  return _(transformations)
    .flatMap(t => multimatch(files, t.pattern).map(pattern => ({ ...t, pattern })))
    .map(async t => {
      const transformedJson = await parseXml(fs.readFileSync(path.resolve(pathService.getBasePath(), pathService.getSrcFolder(), t.pattern)))
      await (t.callback(t.pattern, transformedJson) || transformedJson)
      return {
        transformedJson,
        filename: t.pattern
      }
    })
    .map(x => _(x))
    .sequence()
    .map(x => ({ ...x, transformedXml: buildXml(x.transformedJson) + '\n' }))
}

module.exports = {
  addTransformation: transformation => {
    transformations.push(transformation)
  },
  helpers: {
    xmlTransformer: (pattern, callback) => {
      module.exports.addTransformation({
        pattern,
        callback
      })
    }
  },
  applyTransformationsAndWriteBack: async (fileFilter, sfdcConnector) => {
    return (await applyTransformations(fileFilter, sfdcConnector))
      .map(t => fs.writeFileSync(path.resolve(pathService.getBasePath(), pathService.getSrcFolder(), t.filename), t.transformedXml))
      .collect()
      .toPromise(Promise)
  },
  applyTransformations: async (fileFilter, sfdcConnector) => {
    return (await applyTransformations(fileFilter, sfdcConnector))
      .collect()
      .toPromise(Promise)
  },
  registerPlugins: async (plugins, sfdcConnector, username, pkgJson) => {
    transformations.length = 0
    await _(plugins || [])
      .map(x => nativeRequire(path.resolve(pathService.getBasePath(), x)))
      .map(x => x({
        querySfdc: sfdcConnector.query,
        environment: process.env.environment,
        username,
        log,
        pkg: pkgJson
      }, module.exports.helpers))
      .map(x => _(x))
      .sequence()
      .collect()
      .toPromise(Promise)
  }
}
