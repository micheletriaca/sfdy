const _ = require('highland')
const fs = require('fs')
const yauzl = require('yauzl')
const util = require('util')
const { buffer } = require('stream/consumers')
const logger = require('../services/log-service')
const path = require('path')
const pathService = require('../services/path-service')
const { getPackageMapping, getMeta } = require('../utils/package-utils')
const { getComponentModel } = require('../format-adapters')
const { FileTree } = require('../plugin')
const { runExtensions } = require('../plugin/runtime')
const { readProjectEntries, writeProjectEntries } = require('../plugin/project-files')

const packageComponents = pkg => (pkg.types || [])
  .flatMap(type => (type.members || []).map(fullName => ({ type: type.name[0], fullName })))

const selectionKeys = (components, componentModel) => new Set([
  ...components,
  ...componentModel.getMetadataContainers(components)
].map(component => `${component.type}/${component.fullName}`.replace(/\/$/, '')))

const matchesSelection = (fileName, keys, packageMapping) => {
  const separator = fileName.indexOf('/')
  const folderName = fileName.substring(0, separator)
  const metaInfo = getMeta(packageMapping, fileName, folderName)
  if (!metaInfo) return false
  if (keys.has(`${metaInfo.xmlName}/*`)) return true
  let metaName = fileName.substring(separator + 1).replace('-meta.xml', '')
  if (metaInfo.inFolder === 'false' && metaName.includes('/')) {
    if (metaInfo.subDirectoryName) {
      metaName = metaName.replace('/' + metaInfo.subDirectoryName, '.')
    } else if (metaInfo.xmlName === 'DigitalExperienceBundle') {
      const firstSlash = metaName.indexOf('/')
      metaName = metaName.substring(0, metaName.indexOf('/', firstSlash + 1))
    } else {
      metaName = metaName.substring(0, metaName.indexOf('/'))
    }
  }
  return keys.has(`${metaInfo.xmlName}/${metaName.replace(new RegExp('.' + metaInfo.suffix + '$'), '')}`)
}

module.exports = async (zipBuffer, sfdcConnector, pkgJson, formatAdapter, sourceComponents, extensionPipeline = {}) => {
  logger.time('unzipper')
  const packageMapping = await getPackageMapping(sfdcConnector)
  const componentModel = getComponentModel(packageMapping)
  const requestedComponents = packageComponents(pkgJson)
  const selectedComponents = sourceComponents || requestedComponents
  const outputKeys = selectionKeys([...requestedComponents, ...selectedComponents], componentModel)
  const retrievedComponents = packageComponents(extensionPipeline.retrievePackage || pkgJson)
  const retrieveKeys = selectionKeys(retrievedComponents, componentModel)
  return new Promise((resolve, reject) => {
    yauzl.fromBuffer(zipBuffer, { lazyEntries: false }, (err, zipFile) => {
      if (err) return reject(err)
      const openStream = util.promisify(zipFile.openReadStream.bind(zipFile))
      const flow = _('entry', zipFile)
      zipFile.on('end', () => { flow.end() })
      flow.map(x => { x.type = x.fileName.endsWith('/') ? 'directory' : 'file'; return x })
        .filter(x => x.type === 'file' && x.fileName !== 'package.xml')
        .filter(entry => matchesSelection(entry.fileName, retrieveKeys, packageMapping))
        .map(async x => { x.data = await buffer(await openStream(x)); return x })
        .map(x => _(x))
        .parallel(20)
        .toArray(async entries => {
          try {
            logger.timeLog('unzipper')
            const metadataTree = new FileTree({ files: entries })
            await runExtensions({
              extensions: extensionPipeline.metadataPlugins || [],
              fileTree: metadataTree,
              direction: 'retrieve',
              stage: 'metadata',
              format: formatAdapter ? 'sfdx' : 'metadata',
              target: { environment: process.env.environment, username: sfdcConnector.username },
              sfdcConnector,
              config: extensionPipeline.config || {}
            })
            const filteredEntries = metadataTree.entries()
              .filter(entry => matchesSelection(entry.fileName, outputKeys, packageMapping))
            const sourceFolder = pathService.getSrcFolder(true)
            const diskEntries = extensionPipeline.diskEntries || await readProjectEntries(sourceFolder)
            const existingFiles = diskEntries.map(entry => entry.fileName)
            const configuredMergePaths = formatAdapter
              ? formatAdapter.getMergePaths(selectedComponents)
              : componentModel.getMetadataMergePaths(selectedComponents)
            const retrievedContainerPaths = formatAdapter
              ? []
              : filteredEntries
                .map(metadataEntry => metadataEntry.fileName)
                .filter(componentModel.isMetadataContainerPath)
            const mergePaths = [...new Set([...configuredMergePaths, ...retrievedContainerPaths])]
            const existingEntries = await Promise.all(mergePaths
              .filter(fileName => existingFiles.includes(fileName))
              .map(async fileName => ({
                fileName,
                data: await fs.promises.readFile(path.resolve(pathService.getSrcFolder(true), fileName))
              })))
            const formatted = formatAdapter
              ? await formatAdapter.toSource(filteredEntries, {
                components: selectedComponents,
                existingEntries,
                existingFiles
              })
              : await componentModel.mergeMetadata(filteredEntries, {
                components: selectedComponents,
                existingEntries
              })
            const fileTree = new FileTree({
              diskEntries,
              files: formatted.upserts
            })
            fileTree.markDeleted(formatted.deletes)
            const runOptions = {
              fileTree,
              direction: 'retrieve',
              format: formatAdapter ? 'sfdx' : 'metadata',
              target: { environment: process.env.environment, username: sfdcConnector.username },
              sfdcConnector,
              config: extensionPipeline.config || {}
            }
            await runExtensions({
              ...runOptions,
              extensions: extensionPipeline.plugins || []
            })
            await runExtensions({
              ...runOptions,
              extensions: extensionPipeline.renderers || []
            })
            await writeProjectEntries(sourceFolder, fileTree.entries(), fileTree.deletedPaths())
            logger.timeEnd('unzipper')
            resolve()
          } catch (error) {
            reject(error)
          }
        })
    })
  })
}
