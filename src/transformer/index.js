const pluginEngine = require('../plugin-engine')
const stdRenderers = require('../renderers')
const Sfdc = require('../utils/sfdc-utils')
const { getListOfSrcFiles, getPackageXml, getPackageMapping } = require('../utils/package-utils')
const _ = require('lodash')
// const standardPlugins = require('../plugins')
const pathService = require('../services/path-service')
const logger = require('../services/log-service')
const { readFiles } = require('../services/file-service')
const path = require('path')
const nativeRequire = require('../utils/native-require')
const makeDir = require('make-dir')
const memoize = require('lodash').memoize
const util = require('util')
const fs = require('fs')
const getFolderName = (fileName) => fileName.substring(0, fileName.lastIndexOf('/'))

module.exports = {
  transform: async ({
    loginOpts,
    basePath,
    logger: _logger,
    files,
    srcFolder,
    config
  }) => {
    const mMakeDir = memoize(makeDir)
    const wf = util.promisify(fs.writeFile)
    if (basePath) pathService.setBasePath(basePath)
    if (srcFolder) pathService.setSrcFolder(srcFolder)
    if (_logger) logger.setLogger(_logger)

    const pkgXml = await getPackageXml()
    const sfdcConnector = await Sfdc.newInstance({
      sessionId: loginOpts.sessionId,
      instanceHostname: loginOpts.instanceHostname,
      username: loginOpts.username,
      password: loginOpts.password,
      isSandbox: !!loginOpts.sandbox,
      serverUrl: loginOpts.serverUrl,
      apiVersion: loginOpts.apiVersion || pkgXml.version[0]
    })

    const plugins = [
      //      ...standardPlugins,
      //      ...(config.postRetrievePlugins || []),
      ...stdRenderers.map(x => x.transform),
      ...((config.renderers || []).map(x => nativeRequire(x).transform))
    ]

    await pluginEngine.registerPlugins(plugins, sfdcConnector, loginOpts.username, await getPackageXml(), config)
    await pluginEngine.applyTransformations(files)
    await pluginEngine.applyCleans()
    await Promise.all(files
      .filter(pluginEngine.applyFilters())
      .map(async y => {
        await mMakeDir(path.resolve(pathService.getSrcFolder(), getFolderName(y.fileName)))
        await wf(path.resolve(pathService.getSrcFolder(), y.fileName), y.data)
      }))
  },
  untransform: async ({
    loginOpts,
    basePath,
    logger: _logger,
    files,
    renderers = [],
    srcFolder,
    config
  }) => {
    if (basePath) pathService.setBasePath(basePath)
    if (srcFolder) pathService.setSrcFolder(srcFolder)
    if (_logger) logger.setLogger(_logger)

    const sfdcConnector = await Sfdc.newInstance({
      sessionId: loginOpts.sessionId,
      instanceHostname: loginOpts.instanceHostname,
      username: loginOpts.username,
      password: loginOpts.password,
      isSandbox: !!loginOpts.sandbox,
      serverUrl: loginOpts.serverUrl,
      apiVersion: loginOpts.apiVersion || (await getPackageXml()).version[0]
    })

    const getFiles = () => files.split(',').map(x => x.trim()) || []
    let specificFiles = [...new Set([...getFiles()])]

    const plugins = [
      ...(stdRenderers.map(x => x.untransform)),
      ...(renderers.map(x => nativeRequire(x).untransform))
    ]
    await pluginEngine.registerPlugins(plugins, sfdcConnector, loginOpts.username, await getPackageXml({ specificFiles, sfdcConnector }), config)

    specificFiles = pluginEngine.applyRemappers(specificFiles)

    const packageMapping = await getPackageMapping(sfdcConnector)
    const filesToRead = await getListOfSrcFiles(packageMapping, specificFiles)
    const targetFiles = readFiles(pathService.getSrcFolder(true), filesToRead)
    await pluginEngine.applyTransformations(targetFiles)

    const fileMap = _.keyBy(targetFiles, 'fileName')
    return fileMap
  }
}
