const _ = require('highland')
const fs = require('fs')
const yauzl = require('yauzl')
const util = require('util')
const makeDir = require('make-dir')
const getStream = require('get-stream')
const memoize = require('lodash').memoize
const path = require('path')
const pathService = require('../services/path-service')
const pluginEngine = require('../plugin-engine')

const getFolderName = (fileName) => fileName.substring(0, fileName.lastIndexOf('/'))

module.exports = (zipBuffer, sfdcConnector) => new Promise(resolve => {
  console.time('unzipper')
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
