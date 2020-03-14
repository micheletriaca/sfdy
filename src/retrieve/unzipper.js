const _ = require('highland')
const fs = require('fs')
const yauzl = require('yauzl')
const util = require('util')
const makeDir = require('make-dir')
const getStream = require('get-stream')
const memoize = require('lodash').memoize
const path = require('path')
const multimatch = require('multimatch')
const pathService = require('../services/path-service')
const pluginEngine = require('../plugin-engine')
const { getPackageMapping } = require('../utils/package-utils')

const getFolderName = (fileName) => fileName.substring(0, fileName.lastIndexOf('/'))

module.exports = async (zipBuffer, sfdcConnector, pkgJson) => {
  console.time('unzipper')
  const packageMapping = await getPackageMapping(sfdcConnector)
  const packageTypesToKeep = pkgJson.types.flatMap(t => t.members.map(m => t.name[0] + '/' + m))
  return new Promise(resolve => {
    yauzl.fromBuffer(zipBuffer, { lazyEntries: false }, (err, zipFile) => {
      const wf = util.promisify(fs.writeFile)
      const mMakeDir = memoize(makeDir)
      if (err) return console.error(err)
      const openStream = util.promisify(zipFile.openReadStream.bind(zipFile))
      const flow = _('entry', zipFile)
      zipFile.on('end', () => { flow.end() })
      flow.map(x => { x.type = x.fileName.endsWith('/') ? 'directory' : 'file'; return x })
        .filter(x => x.type === 'file' && x.fileName !== 'package.xml')
        .filter(pluginEngine.applyFilters())
        .filter(x => {
          const idx = x.fileName.indexOf('/')
          const folderName = x.fileName.substring(0, idx)
          const metaInfo = packageMapping[folderName]
          if (!metaInfo) return false
          let metaName = x.fileName.substring(idx + 1).replace('-meta.xml', '')
          if (metaInfo.inFolder === 'false' && metaName.indexOf('/') !== -1) {
            metaName = metaName.substring(0, metaName.indexOf('/'))
          }
          const finalMeta = metaInfo.xmlName + '/' + metaName.replace(new RegExp('.' + metaInfo.suffix + '$'), '')
          return multimatch(finalMeta, packageTypesToKeep).length > 0
        })
        .map(async x => { x.data = await getStream.buffer(await openStream(x)); return x })
        .map(x => _(x))
        .parallel(20)
        .toArray(async entries => {
          await pluginEngine.applyTransformations(entries, sfdcConnector)
          await Promise.all(entries.map(async y => {
            await mMakeDir(path.resolve(pathService.getBasePath(), 'src', getFolderName(y.fileName)))
            await wf(path.resolve(pathService.getBasePath(), 'src', y.fileName), y.data)
          }))
          console.timeEnd('unzipper')
          resolve()
        })
    })
  })
}
