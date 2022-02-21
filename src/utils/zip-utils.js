const _ = require('exstream.js')
const yauzl = require('yauzl')
const yazl = require('yazl')
const util = require('util')
const { buildXml } = require('./xml-utils')

module.exports = {
  zip: (fileList, buffers, pkgJson, isForDestructive) => {
    const zip = new yazl.ZipFile()
    const fileSet = new Set(fileList)
    const pkgBuffer = Buffer.from(buildXml(pkgJson) + '\n')
    if (isForDestructive) {
      zip.addBuffer(pkgBuffer, 'destructiveChanges.xml')
      zip.addBuffer(buildXml({ Package: { version: pkgJson.Package.version } }) + '\n', 'package.xml')
    } else {
      for (const f of buffers.filter(b => fileSet.has(b.fileName))) zip.addBuffer(f.data, f.fileName)
      zip.addBuffer(pkgBuffer, 'package.xml')
    }
    zip.end()
    return zip
  },
  unzip: async zipBuffer => {
    const s = _()
    const unzip = util.promisify(yauzl.fromBuffer)
    const zipFile = await unzip(zipBuffer, { lazyEntries: false })
    const openStream = util.promisify(zipFile.openReadStream.bind(zipFile))
    const streamToBuffer = f => _(openStream(f)).map(_).merge().collect().map(Buffer.concat).value()
    zipFile.on('entry', s.write.bind(s))
    zipFile.on('end', s.end.bind(s))
    return s
      .map(async f => ({ fileName: f.fileName, data: await streamToBuffer(f) }))
      .resolve(20, false)
      .reject(x => x.fileName.endsWith('/')) // exclude directories
      .values()
  }
}

/* module.exports = async (zipBuffer, sfdcConnector, pkgJson) => {
  logger.time('unzipper')
  const packageMapping = await getPackageMapping(sfdcConnector)
  const packageTypesToKeep = new Set(pkgJson.types.flatMap(t => t.members.map(m => t.name[0] + '/' + m)))
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
        .filter(x => {
          const idx = x.fileName.indexOf('/')
          const folderName = x.fileName.substring(0, idx)
          const metaInfo = getMeta(packageMapping, x.fileName, folderName)
          if (!metaInfo) return false
          if (packageTypesToKeep.has(metaInfo.xmlName + '/*')) return true
          let metaName = x.fileName.substring(idx + 1).replace('-meta.xml', '')
          if (metaInfo.inFolder === 'false' && metaName.indexOf('/') !== -1) {
            metaName = metaName.substring(0, metaName.indexOf('/'))
          }
          const finalMeta = metaInfo.xmlName + '/' + metaName.replace(new RegExp('.' + metaInfo.suffix + '$'), '')
          return packageTypesToKeep.has(finalMeta)
        })
        .map(async x => { x.data = await getStream.buffer(await openStream(x)); return x })
        .map(x => _(x))
        .parallel(20)
        .toArray(async entries => {
          logger.timeLog('unzipper')
          await pluginEngine.applyTransformations(entries)
          await pluginEngine.applyCleans()
          await Promise.all(entries
            .filter(pluginEngine.applyFilters())
            .map(async y => {
              await mMakeDir(path.resolve(pathService.getBasePath(), 'src', getFolderName(y.fileName)))
              await wf(path.resolve(pathService.getBasePath(), 'src', y.fileName), y.data)
            }))
          logger.timeEnd('unzipper')
          resolve()
        })
    })
  })
}
*/
