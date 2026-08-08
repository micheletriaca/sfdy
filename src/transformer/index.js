const pluginEngine = require('../plugin-engine')
const stdRenderers = require('../renderers')
const Sfdc = require('../utils/sfdc-utils')
const { expandDirectoryPatterns, getListOfSrcFiles, getPackageXml, getPackageMapping } = require('../utils/package-utils')
const _ = require('lodash')
// const standardPlugins = require('../plugins')
const pathService = require('../services/path-service')
const logger = require('../services/log-service')
const { readFiles } = require('../services/file-service')
const path = require('path')
const nativeRequire = require('../utils/native-require')
const memoize = require('lodash').memoize
const util = require('util')
const fs = require('fs')
const getFolderName = (fileName) => fileName.substring(0, fileName.lastIndexOf('/'))
const { getAdapter } = require('../format-adapters')
const globby = require('globby')

const getApiVersion = async loginOpts => loginOpts.apiVersion || pathService.getApiVersion()

const cleanFormattedFiles = async files => {
  const sourceFolder = pathService.getSrcFolder(true)
  await Promise.all(files.map(fileName => {
    const target = path.resolve(sourceFolder, fileName)
    const relativeTarget = path.relative(sourceFolder, target)
    if (relativeTarget.startsWith('..') || path.isAbsolute(relativeTarget)) {
      throw new Error(`Refusing to clean a path outside the source folder: ${fileName}`)
    }
    return fs.promises.rm(target, { recursive: true, force: true })
  }))
}

module.exports = {
  transform: async ({
    loginOpts,
    basePath,
    logger: _logger,
    files,
    srcFolder,
    sourceFormat,
    config = {}
  }) => {
    const makeDir = folder => fs.promises.mkdir(folder, { recursive: true })
    const mMakeDir = memoize(makeDir)
    const wf = util.promisify(fs.writeFile)
    pathService.configureProject({ basePath, srcFolder, sourceFormat, config })
    if (_logger) logger.setLogger(_logger)

    let formatAdapter = getAdapter(config, sourceFormat)
    const apiVersion = await getApiVersion(loginOpts)
    if (!apiVersion) throw new Error('Missing API version for source-format transformation')
    const sfdcConnector = await Sfdc.newInstance({
      sessionId: loginOpts.sessionId,
      instanceHostname: loginOpts.instanceHostname,
      username: loginOpts.username,
      password: loginOpts.password,
      isSandbox: !!loginOpts.sandbox,
      serverUrl: loginOpts.serverUrl,
      apiVersion
    })
    if (formatAdapter) formatAdapter = getAdapter(config, sourceFormat, await getPackageMapping(sfdcConnector))

    const plugins = [
      //      ...standardPlugins,
      //      ...(config.postRetrievePlugins || []),
      ...(formatAdapter ? [] : stdRenderers.map(x => x.transform)),
      ...((config.renderers || []).map(x => nativeRequire(path.resolve(pathService.getBasePath(), x)).transform))
    ]

    const pkg = formatAdapter
      ? await getPackageXml({ specificMeta: [], apiVersion })
      : await getPackageXml({
        specificFiles: files.map(file => file.fileName),
        sfdcConnector,
        skipParseGlobPatterns: true,
        apiVersion
      })
    await pluginEngine.registerPlugins(plugins, sfdcConnector, sfdcConnector.username, pkg, config)
    await pluginEngine.applyTransformations(files)
    await pluginEngine.applyCleans()
    const filteredFiles = files.filter(pluginEngine.applyFilters())
    const existingFiles = formatAdapter
      ? await globby(['**/*'], { cwd: pathService.getSrcFolder(true) })
      : []
    const formatted = formatAdapter
      ? await formatAdapter.toSource(filteredFiles, { existingFiles })
      : { upserts: filteredFiles, deletes: [] }
    await cleanFormattedFiles(formatted.deletes)
    await Promise.all(formatted.upserts
      .map(async y => {
        await mMakeDir(path.resolve(pathService.getSrcFolder(true), getFolderName(y.fileName)))
        await wf(path.resolve(pathService.getSrcFolder(true), y.fileName), y.data)
      }))
  },
  untransform: async ({
    loginOpts,
    basePath,
    logger: _logger,
    files,
    renderers = [],
    srcFolder,
    sourceFormat,
    config = {}
  }) => {
    pathService.configureProject({ basePath, srcFolder, sourceFormat, config })
    if (_logger) logger.setLogger(_logger)

    let formatAdapter = getAdapter(config, sourceFormat)
    const apiVersion = await getApiVersion(loginOpts)
    if (!apiVersion) throw new Error('Missing API version for source-format transformation')
    const sfdcConnector = await Sfdc.newInstance({
      sessionId: loginOpts.sessionId,
      instanceHostname: loginOpts.instanceHostname,
      username: loginOpts.username,
      password: loginOpts.password,
      isSandbox: !!loginOpts.sandbox,
      serverUrl: loginOpts.serverUrl,
      apiVersion
    })
    if (formatAdapter) formatAdapter = getAdapter(config, sourceFormat, await getPackageMapping(sfdcConnector))

    const getFiles = () => files.split(',').map(x => x.trim()) || []
    let specificFiles = [...new Set([...getFiles()])]

    const plugins = [
      ...(formatAdapter ? [] : stdRenderers.map(x => x.untransform)),
      ...(renderers.map(x => nativeRequire(path.resolve(pathService.getBasePath(), x)).untransform))
    ]
    let targetFiles
    let pkg
    if (formatAdapter) {
      const selectedFiles = await globby(expandDirectoryPatterns(specificFiles), { cwd: pathService.getSrcFolder(true) })
      const availableFiles = await globby(['**/*'], { cwd: pathService.getSrcFolder(true) })
      const sourceFiles = formatAdapter.getCompanionPaths(selectedFiles, availableFiles)
      const converted = await formatAdapter.toMetadata(readFiles(pathService.getSrcFolder(true), sourceFiles))
      targetFiles = converted.entries
      const components = formatAdapter.getPackageComponents(converted.components)
      pkg = await getPackageXml({
        specificMeta: components.map(x => `${x.type}/${x.fullName}`),
        apiVersion
      })
    } else {
      await pluginEngine.registerPlugins(plugins, sfdcConnector, sfdcConnector.username, await getPackageXml({
        specificFiles,
        sfdcConnector,
        apiVersion
      }), config)
      specificFiles = pluginEngine.applyRemappers(specificFiles)
      const packageMapping = await getPackageMapping(sfdcConnector)
      const filesToRead = await getListOfSrcFiles(packageMapping, specificFiles)
      targetFiles = readFiles(pathService.getSrcFolder(true), filesToRead)
    }
    if (formatAdapter) await pluginEngine.registerPlugins(plugins, sfdcConnector, sfdcConnector.username, pkg, config)
    await pluginEngine.applyTransformations(targetFiles)

    const fileMap = _.keyBy(targetFiles, 'fileName')
    return fileMap
  }
}
