const _ = require('exstream.js')
const yauzl = require('yauzl')
const yazl = require('yazl')
const util = require('util')
const { buildXml } = require('./xml-utils')

module.exports = {
  zip: (fileList, buffers, pkgJson, isForDestructive = false) => {
    const zip = new yazl.ZipFile()
    const fileSet = new Set(fileList)
    const pkgBuffer = pkgJson ? Buffer.from(buildXml(pkgJson) + '\n') : null
    if (isForDestructive) {
      zip.addBuffer(pkgBuffer, 'destructiveChanges.xml')
      zip.addBuffer(buildXml({ Package: { version: pkgJson.Package.version } }) + '\n', 'package.xml')
    } else {
      for (const f of buffers.filter(b => fileSet.has(b.fileName))) zip.addBuffer(f.data, f.fileName)
      if (pkgBuffer) zip.addBuffer(pkgBuffer, 'package.xml')
    }
    zip.end()
    return zip
  },
  unzip: async zipBuffer => {
    const s = _()
    const unzip = util.promisify(yauzl.fromBuffer)
    const zipFile = await unzip(zipBuffer, { lazyEntries: false })
    const openStream = util.promisify(zipFile.openReadStream.bind(zipFile))
    const streamToBuffer = f => _(openStream(f)).map(_).merge().applyOne(Buffer.concat)
    zipFile.on('entry', s.write.bind(s))
    zipFile.on('end', s.end.bind(s))
    return s
      .reject(f => f.fileName.endsWith('/')) // exclude directories
      .map(async f => ({ fileName: f.fileName, data: await streamToBuffer(f) }))
      .resolve(20, false)
      .values()
  }
}
