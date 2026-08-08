const _ = require('highland')
const fs = require('fs')
const yauzl = require('yauzl')
const util = require('util')
const { buffer } = require('stream/consumers')
const memoize = require('lodash').memoize
const logger = require('../services/log-service')
const path = require('path')
const pathService = require('../services/path-service')
const pluginEngine = require('../plugin-engine')
const { getPackageMapping, getMeta } = require('../utils/package-utils')
const globby = require('globby')
const { getComponentModel } = require('../format-adapters')

const getFolderName = (fileName) => fileName.substring(0, fileName.lastIndexOf('/'))
const cleanFiles = async files => {
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

module.exports = async (zipBuffer, sfdcConnector, pkgJson, formatAdapter, sourceComponents) => {
  logger.time('unzipper')
  const packageMapping = await getPackageMapping(sfdcConnector)
  const componentModel = getComponentModel(packageMapping)
  const requestedComponents = pkgJson.types.flatMap(t => t.members.map(m => ({ type: t.name[0], fullName: m })))
  const selectedComponents = sourceComponents || requestedComponents
  const metadataContainers = componentModel.getMetadataContainers(selectedComponents)
  const packageTypesToKeep = new Set([...requestedComponents, ...metadataContainers].map(x => `${x.type}/${x.fullName}`))
  return new Promise((resolve, reject) => {
    yauzl.fromBuffer(zipBuffer, { lazyEntries: false }, (err, zipFile) => {
      const wf = util.promisify(fs.writeFile)
      const makeDir = folder => fs.promises.mkdir(folder, { recursive: true })
      const mMakeDir = memoize(makeDir)
      if (err) return reject(err)
      const openStream = util.promisify(zipFile.openReadStream.bind(zipFile))
      const flow = _('entry', zipFile)
      zipFile.on('end', () => { flow.end() })
      flow.map(x => { x.type = x.fileName.endsWith('/') ? 'directory' : 'file'; return x })
        .filter(x => x.type === 'file' && x.fileName !== 'package.xml')
        .filter(x => {
          const idx = x.fileName.indexOf('/')
          const folderName = x.fileName.substring(0, idx)
          const metaInfo = getMeta(packageMapping, x.fileName, folderName)
          if (!metaInfo) return false
          if (packageTypesToKeep.has(metaInfo.xmlName + '/*')) return true
          let metaName = x.fileName.substring(idx + 1).replace('-meta.xml', '')
          if (metaInfo.inFolder === 'false' && metaName.indexOf('/') !== -1) {
            // To handle territory metadata that are inside hardcoded subfolders without any reason
            if (metaInfo.subDirectoryName) {
              metaName = metaName.replace('/' + metaInfo.subDirectoryName, '.')
            // To handle digital experience bundles that have crazy folder structure
            } else if (metaInfo.xmlName === 'DigitalExperienceBundle') {
              const firstSlashIdx = metaName.indexOf('/')
              metaName = metaName.substring(0, metaName.indexOf('/', firstSlashIdx + 1))
            } else {
              metaName = metaName.substring(0, metaName.indexOf('/'))
            }
          }
          const finalMeta = metaInfo.xmlName + '/' + metaName.replace(new RegExp('.' + metaInfo.suffix + '$'), '')
          return packageTypesToKeep.has(finalMeta)
        })
        .map(async x => { x.data = await buffer(await openStream(x)); return x })
        .map(x => _(x))
        .parallel(20)
        .toArray(async entries => {
          try {
            logger.timeLog('unzipper')
            await pluginEngine.applyTransformations(entries)
            await pluginEngine.applyCleans()
            const filteredEntries = entries.filter(pluginEngine.applyFilters())
            const existingFiles = await globby(['**/*'], { cwd: pathService.getSrcFolder(true) })
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
            await cleanFiles(formatted.deletes)
            await Promise.all(formatted.upserts
              .map(async y => {
                await mMakeDir(path.resolve(pathService.getSrcFolder(true), getFolderName(y.fileName)))
                await wf(path.resolve(pathService.getSrcFolder(true), y.fileName), y.data)
              }))
            logger.timeEnd('unzipper')
            resolve()
          } catch (error) {
            reject(error)
          }
        })
    })
  })
}
