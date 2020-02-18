const { getListOfSrcFiles, getPackageMapping } = require('../utils/package-utils')
const multimatch = require('multimatch')
const _ = require('highland')
const path = require('path')
const fs = require('fs')
const { parseXml, buildXml } = require('../utils/xml-utils')
const pathService = require('../services/path-service')

const transformations = []

const applyTransformations = async (fileFilter, sfdcConnector) => {
  const packageMapping = await getPackageMapping(sfdcConnector)
  const files = await getListOfSrcFiles(packageMapping, fileFilter && fileFilter.length ? fileFilter : undefined)
  return _(transformations)
    .flatMap(t => multimatch(files, t.pattern).map(pattern => ({ ...t, pattern })))
    .map(async t => {
      const transformedJson = await parseXml(fs.readFileSync(path.resolve(pathService.getBasePath(), 'src', t.pattern)))
      return {
        transformedJson: t.callback(t.pattern, transformedJson) || transformedJson,
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
      .map(t => fs.writeFileSync(path.resolve(pathService.getBasePath(), 'src', t.filename), t.transformedXml))
      .collect()
      .toPromise(Promise)
  },
  applyTransformations: async (fileFilter, sfdcConnector) => {
    return (await applyTransformations(fileFilter, sfdcConnector))
      .collect()
      .toPromise(Promise)
  },
  registerPlugins: async (plugins, sfdcConnector, username, pkgJson) => {
    await _(plugins || [])
      .map(x => require(path.resolve(pathService.getBasePath(), x)))
      .map(x => _(x({
        querySfdc: sfdcConnector.query,
        environment: process.env.environment,
        username,
        pkg: pkgJson
      }, module.exports.helpers)))
      .sequence()
      .collect()
      .toPromise(Promise)
  }
}
