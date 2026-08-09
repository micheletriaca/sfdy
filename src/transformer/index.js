const _ = require('lodash')
const globby = require('globby')
const Sfdc = require('../utils/sfdc-utils')
const stdRenderers = require('../renderers')
const { expandDirectoryPatterns, getListOfSrcFiles, getPackageXml, getPackageMapping } = require('../utils/package-utils')
const pathService = require('../services/path-service')
const logger = require('../services/log-service')
const { readFiles } = require('../services/file-service')
const { getAdapter } = require('../format-adapters')
const { FileSelection, FileTree } = require('../plugin')
const { resolveSelections, runExtensions } = require('../plugin/runtime')
const { prepareExtensions, warnLegacy } = require('../plugin/loader')
const { readProjectEntries, writeProjectEntries } = require('../plugin/project-files')

const getApiVersion = async loginOpts => loginOpts.apiVersion || pathService.getApiVersion()

const createConnector = async (loginOpts, apiVersion) => Sfdc.newInstance({
  sessionId: loginOpts.sessionId,
  instanceHostname: loginOpts.instanceHostname,
  username: loginOpts.username,
  password: loginOpts.password,
  isSandbox: !!loginOpts.sandbox,
  serverUrl: loginOpts.serverUrl,
  apiVersion
})

const createRunOptions = ({ fileTree, direction, formatAdapter, sfdcConnector, config }) => ({
  fileTree,
  direction,
  format: formatAdapter ? 'sfdx' : 'metadata',
  target: { environment: process.env.environment, username: sfdcConnector.username },
  sfdcConnector,
  config
})

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
    pathService.configureProject({ basePath, srcFolder, sourceFormat, config })
    if (_logger) logger.setLogger(_logger)

    let formatAdapter = getAdapter(config, sourceFormat)
    const apiVersion = await getApiVersion(loginOpts)
    if (!apiVersion) throw new Error('Missing API version for source-format transformation')
    const sfdcConnector = await createConnector(loginOpts, apiVersion)
    if (formatAdapter) formatAdapter = getAdapter(config, sourceFormat, await getPackageMapping(sfdcConnector))

    const pkg = formatAdapter
      ? await getPackageXml({ specificMeta: [], apiVersion })
      : await getPackageXml({
        specificFiles: files.map(file => file.fileName),
        sfdcConnector,
        skipParseGlobPatterns: true,
        apiVersion
      })
    const preparedRenderers = prepareExtensions({
      entries: [
        ...(formatAdapter ? [] : stdRenderers),
        ...(config.renderers || [])
      ],
      basePath: pathService.getBasePath(),
      packageJson: pkg,
      legacyHook: 'transform'
    })
    warnLegacy(preparedRenderers.legacy, 'Renderer')

    const sourceFolder = pathService.getSrcFolder(true)
    const diskEntries = await readProjectEntries(sourceFolder)
    const metadataTree = new FileTree({ files })
    await runExtensions({
      ...createRunOptions({
        fileTree: metadataTree,
        direction: 'retrieve',
        formatAdapter,
        sfdcConnector,
        config
      }),
      stage: 'metadata',
      extensions: preparedRenderers.extensions
    })
    const formatted = formatAdapter
      ? await formatAdapter.toSource(metadataTree.entries(), { existingFiles: diskEntries.map(entry => entry.fileName) })
      : { upserts: metadataTree.entries(), deletes: metadataTree.deletedPaths() }
    const projectTree = new FileTree({ diskEntries, files: formatted.upserts })
    projectTree.markDeleted(formatted.deletes)
    await runExtensions({
      ...createRunOptions({
        fileTree: projectTree,
        direction: 'retrieve',
        formatAdapter,
        sfdcConnector,
        config
      }),
      extensions: preparedRenderers.extensions
    })
    await writeProjectEntries(sourceFolder, projectTree.entries(), projectTree.deletedPaths())
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
    const sfdcConnector = await createConnector(loginOpts, apiVersion)
    if (formatAdapter) formatAdapter = getAdapter(config, sourceFormat, await getPackageMapping(sfdcConnector))

    const sourceFolder = pathService.getSrcFolder(true)
    const diskEntries = await readProjectEntries(sourceFolder)
    const availableFiles = diskEntries.map(entry => entry.fileName)
    let selectedFiles = [...new Set(files.split(',').map(file => file.trim()))]
    if (formatAdapter) selectedFiles = await globby(expandDirectoryPatterns(selectedFiles), { cwd: sourceFolder })

    const preliminaryComponents = formatAdapter
      ? formatAdapter.getPackageComponents(formatAdapter.resolve(selectedFiles))
      : []
    const pkg = formatAdapter
      ? await getPackageXml({
        specificMeta: preliminaryComponents.map(component => `${component.type}/${component.fullName}`),
        apiVersion
      })
      : await getPackageXml({ specificFiles: selectedFiles, sfdcConnector, apiVersion })
    const preparedRenderers = prepareExtensions({
      entries: [
        ...(formatAdapter ? [] : stdRenderers),
        ...renderers
      ],
      basePath: pathService.getBasePath(),
      packageJson: pkg,
      legacyHook: 'untransform'
    })
    warnLegacy(preparedRenderers.legacy, 'Renderer')

    const selection = new FileSelection(selectedFiles)
    const diskTree = new FileTree({ diskEntries })
    await resolveSelections({
      extensions: preparedRenderers.extensions,
      selection,
      project: diskTree.project,
      direction: 'deploy',
      format: formatAdapter ? 'sfdx' : 'metadata',
      target: { environment: process.env.environment, username: sfdcConnector.username },
      sfdcConnector,
      config
    })
    selectedFiles = selection.values()

    if (formatAdapter) {
      const expanded = await globby(expandDirectoryPatterns(selectedFiles), { cwd: sourceFolder })
      selectedFiles = formatAdapter.getCompanionPaths(expanded, availableFiles)
        .filter(fileName => formatAdapter.isMetadataPath(fileName))
    } else {
      const packageMapping = await getPackageMapping(sfdcConnector)
      selectedFiles = await getListOfSrcFiles(packageMapping, selectedFiles)
    }

    const fileTree = new FileTree({
      diskEntries,
      files: readFiles(sourceFolder, selectedFiles),
      origin: 'disk'
    })
    await runExtensions({
      ...createRunOptions({
        fileTree,
        direction: 'deploy',
        formatAdapter,
        sfdcConnector,
        config
      }),
      extensions: preparedRenderers.extensions
    })

    let metadataTree = fileTree
    if (formatAdapter) {
      metadataTree = new FileTree({ files: (await formatAdapter.toMetadata(fileTree.entries())).entries })
    }
    await runExtensions({
      ...createRunOptions({
        fileTree: metadataTree,
        direction: 'deploy',
        formatAdapter,
        sfdcConnector,
        config
      }),
      stage: 'metadata',
      extensions: preparedRenderers.extensions
    })
    return _.keyBy(metadataTree.entries(), 'fileName')
  }
}
