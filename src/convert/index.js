const fs = require('fs')
const path = require('path')
const Sfdc = require('../utils/sfdc-utils')
const standardRenderers = require('../renderers')
const logger = require('../services/log-service')
const pathService = require('../services/path-service')
const { DEFAULT_CLIENT_ID } = require('../utils/constants')
const { getOauth2Options } = require('../utils/auth-utils')
const { getPackageMapping, getPackageXml } = require('../utils/package-utils')
const { getAdapter, getFormat } = require('../format-adapters')
const { FileTree } = require('../plugin')
const { runExtensions } = require('../plugin/runtime')
const { prepareExtensions, warnLegacy } = require('../plugin/loader')
const { readProjectEntries, writeProjectEntries } = require('../plugin/project-files')

const TARGET_ALIASES = { mdapi: 'metadata', source: 'sfdx' }

const normalizeTargetFormat = value => {
  const normalized = value && value.toLowerCase()
  const format = TARGET_ALIASES[normalized] || normalized
  if (!['metadata', 'sfdx'].includes(format)) throw new Error(`Unsupported target source format: ${value}`)
  return format
}

const getTargetFormat = (currentFormat, requestedFormat) => {
  const targetFormat = requestedFormat
    ? normalizeTargetFormat(requestedFormat)
    : currentFormat === 'sfdx' ? 'metadata' : 'sfdx'
  if (targetFormat === currentFormat) throw new Error(`Project is already in ${targetFormat} format`)
  return targetFormat
}

const createConnector = async (loginOpts, apiVersion) => Sfdc.newInstance({
  username: loginOpts.username,
  password: loginOpts.password,
  oauth2: getOauth2Options(loginOpts, DEFAULT_CLIENT_ID),
  serverUrl: loginOpts.serverUrl,
  isSandbox: !!loginOpts.sandbox,
  sessionId: loginOpts.sessionId,
  instanceHostname: loginOpts.instanceHostname,
  apiVersion
})

const relativeSourceFolder = (basePath, sourceFolder) => {
  const absolute = path.resolve(basePath, sourceFolder)
  const relative = path.relative(basePath, absolute)
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`Source folder must be inside the project: ${sourceFolder}`)
  }
  return relative.split(path.sep).join('/')
}

const packageDirectoryFor = sourceFolder => sourceFolder.endsWith('/main/default')
  ? sourceFolder.slice(0, -'/main/default'.length)
  : sourceFolder

const writeSfdxProject = async ({ basePath, sourceFolder, apiVersion }) => {
  const projectPath = path.resolve(basePath, 'sfdx-project.json')
  const project = fs.existsSync(projectPath)
    ? JSON.parse(await fs.promises.readFile(projectPath, 'utf8'))
    : { namespace: '' }
  const packagePath = packageDirectoryFor(sourceFolder)
  const packageDirectories = project.packageDirectories || []
  let target = packageDirectories.find(item => item.path === packagePath)
  if (!target) {
    target = { path: packagePath }
    packageDirectories.push(target)
  }
  packageDirectories.forEach(item => { item.default = item === target })
  project.packageDirectories = packageDirectories
  project.sourceApiVersion = apiVersion
  await fs.promises.writeFile(projectPath, `${JSON.stringify(project, null, 2)}\n`)
}

const writeConfig = async ({ basePath, config, sourceFolder, targetFormat, apiVersion }) => {
  const configPath = path.resolve(basePath, '.sfdy.json')
  const persistedConfig = fs.existsSync(configPath)
    ? JSON.parse(await fs.promises.readFile(configPath, 'utf8'))
    : { ...config }
  delete persistedConfig.stored
  const nextConfig = {
    ...persistedConfig,
    sourceFormat: targetFormat,
    sourceFolder,
    apiVersion
  }
  await fs.promises.writeFile(
    configPath,
    `${JSON.stringify(nextConfig, null, 2)}\n`
  )
  return nextConfig
}

const prepareRenderers = ({ config, format, basePath, packageJson, legacyHook }) => prepareExtensions({
  entries: [
    ...(format === 'metadata' ? standardRenderers : []),
    ...(config.renderers || [])
  ],
  basePath,
  packageJson,
  legacyHook
})

const createRunOptions = ({ fileTree, direction, format, sfdcConnector, config }) => ({
  extensions: [],
  fileTree,
  direction,
  format,
  target: { environment: process.env.environment, username: sfdcConnector.username },
  sfdcConnector,
  config
})

const convertProject = async ({
  basePath = process.cwd(),
  config = {},
  logger: configuredLogger,
  loginOpts = {},
  sfdcConnector: configuredConnector,
  sourceFormat,
  srcFolder,
  targetFormat: requestedTargetFormat,
  targetFolder
} = {}) => {
  if (configuredLogger) logger.setLogger(configuredLogger)
  pathService.configureProject({ basePath, srcFolder, sourceFormat, config })

  const currentFormat = getFormat(config, sourceFormat)
  const targetFormat = getTargetFormat(currentFormat, requestedTargetFormat)
  const apiVersion = loginOpts.apiVersion || pathService.getApiVersion()
  if (!apiVersion) throw new Error('Missing API version. Set apiVersion in .sfdy.json or sourceApiVersion in sfdx-project.json')

  const currentFolder = relativeSourceFolder(basePath, pathService.getSrcFolder())
  const nextFolder = relativeSourceFolder(basePath, targetFolder || currentFolder)
  const targetConfig = {
    ...config,
    sourceFormat: targetFormat,
    sourceFolder: nextFolder,
    apiVersion
  }
  const currentRoot = path.resolve(basePath, currentFolder)
  const targetRoot = path.resolve(basePath, nextFolder)
  if (!fs.existsSync(currentRoot)) throw new Error(`Source folder does not exist: ${currentFolder}`)

  if (currentRoot !== targetRoot) {
    const relativeTarget = path.relative(currentRoot, targetRoot)
    const relativeCurrent = path.relative(targetRoot, currentRoot)
    if (!relativeTarget.startsWith('..') || !relativeCurrent.startsWith('..')) {
      throw new Error('Source and target folders must not contain one another')
    }
    if (fs.existsSync(targetRoot) && (await readProjectEntries(targetRoot)).length) {
      throw new Error(`Target source folder is not empty: ${nextFolder}`)
    }
  }

  logger.log(`Converting ${currentFormat} project to ${targetFormat} format...`)
  const sfdcConnector = configuredConnector || await createConnector(loginOpts, apiVersion)
  const packageMapping = await getPackageMapping(sfdcConnector)
  const currentAdapter = getAdapter(config, currentFormat, packageMapping)
  const targetAdapter = getAdapter(config, targetFormat, packageMapping)
  const diskEntries = await readProjectEntries(currentRoot)
  const currentPackage = currentAdapter
    ? await getPackageXml({
      specificMeta: currentAdapter.getPackageComponents(currentAdapter.resolve(
        diskEntries.map(entry => entry.fileName).filter(fileName => currentAdapter.isMetadataPath(fileName))
      )).map(component => `${component.type}/${component.fullName}`),
      sfdcConnector,
      apiVersion
    })
    : await getPackageXml({
      specificFiles: diskEntries.map(entry => entry.fileName),
      sfdcConnector,
      skipParseGlobPatterns: true,
      apiVersion
    })

  const deployRenderers = prepareRenderers({
    config,
    format: currentFormat,
    basePath,
    packageJson: currentPackage,
    legacyHook: 'untransform'
  })
  warnLegacy(deployRenderers.legacy, 'Renderer')
  const currentTree = new FileTree({ diskEntries, files: diskEntries, origin: 'disk' })
  await runExtensions({
    ...createRunOptions({
      fileTree: currentTree,
      direction: 'deploy',
      format: currentFormat,
      sfdcConnector,
      config
    }),
    extensions: deployRenderers.extensions
  })

  let metadataEntries
  if (currentAdapter) {
    metadataEntries = (await currentAdapter.toMetadata(currentTree.entries())).entries
  } else {
    metadataEntries = currentTree.entries().filter(entry => entry.fileName !== 'package.xml')
  }

  const targetDiskEntries = currentRoot === targetRoot
    ? diskEntries
    : fs.existsSync(targetRoot) ? await readProjectEntries(targetRoot) : []
  const formatted = targetAdapter
    ? await targetAdapter.toSource(metadataEntries, {
      existingFiles: targetDiskEntries.map(entry => entry.fileName),
      existingEntries: targetDiskEntries
    })
    : { upserts: metadataEntries, deletes: [] }
  const targetTree = new FileTree({ diskEntries: targetDiskEntries, files: formatted.upserts })
  const targetPaths = new Set(formatted.upserts.map(entry => entry.fileName))
  targetTree.markDeleted([
    ...formatted.deletes,
    ...targetDiskEntries.map(entry => entry.fileName).filter(fileName => !targetPaths.has(fileName))
  ])

  const targetPackage = await getPackageXml({
    specificFiles: metadataEntries.map(entry => entry.fileName),
    sfdcConnector,
    skipParseGlobPatterns: true,
    apiVersion
  })
  const retrieveRenderers = prepareRenderers({
    config: targetConfig,
    format: targetFormat,
    basePath,
    packageJson: targetPackage,
    legacyHook: 'transform'
  })
  warnLegacy(retrieveRenderers.legacy, 'Renderer')
  await runExtensions({
    ...createRunOptions({
      fileTree: targetTree,
      direction: 'retrieve',
      format: targetFormat,
      sfdcConnector,
      config: targetConfig
    }),
    extensions: retrieveRenderers.extensions
  })

  await writeProjectEntries(targetRoot, targetTree.entries(), targetTree.deletedPaths())
  if (currentRoot !== targetRoot) {
    await writeProjectEntries(currentRoot, [], diskEntries.map(entry => entry.fileName))
  }
  if (targetFormat === 'sfdx') {
    await writeSfdxProject({ basePath, sourceFolder: nextFolder, apiVersion })
  }
  const nextConfig = await writeConfig({
    basePath,
    config,
    sourceFolder: nextFolder,
    targetFormat,
    apiVersion
  })
  logger.log(`Project converted to ${targetFormat} format.`)
  return { config: nextConfig, sourceFolder: nextFolder, sourceFormat: targetFormat }
}

module.exports = convertProject
module.exports.getTargetFormat = getTargetFormat
module.exports.normalizeTargetFormat = normalizeTargetFormat
