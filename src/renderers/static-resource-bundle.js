const yauzl = require('yauzl')
const yazl = require('yazl')
const path = require('path')
const _ = require('exstream.js')
const multimatch = require('multimatch')

module.exports = {
  transform: async ({ config }, helpers) => {
    const filesToFilter = new Set()

    helpers.addRemapper(/^staticresources\/([^/]+)\/.*$/, (filename, regexp) => {
      return `staticresources/${filename.match(regexp)[1]}.resource`
    })

    helpers.filterMetadata(fileName => {
      return !filesToFilter.has(fileName)
    })

    helpers.xmlTransformer('staticresources/*-meta.xml', async (filename, xml, requireFiles, addFiles, cleanFiles) => {
      if (xml.contentType[0] === 'application/zip') {
        const resourceName = filename.replace('-meta.xml', '')
        const dir = resourceName.replace('.resource', '')
        cleanFiles(dir)

        const get = _.makeGetter('staticResources.useBundleRenderer', [])
        if (!multimatch(resourceName, get(config).map(x => `staticresources/${x}`)).length) return

        filesToFilter.add(resourceName)
        cleanFiles(resourceName)
        const resource = await requireFiles(resourceName)
        return new Promise(resolve => {
          yauzl.fromBuffer(resource[0].data, { lazyEntries: true, autoClose: true }, function (err, zipfile) {
            if (err) throw err
            zipfile.readEntry()
            zipfile.on('entry', async entry => {
              if (!entry.fileName.endsWith('/')) {
                zipfile.openReadStream(entry, async (err2, s) => {
                  const bufs = []
                  s.on('data', d => bufs.push(d))
                  s.on('end', () => {
                    entry.data = Buffer.concat(bufs)
                    entry.fileName = path.join(dir, entry.fileName)
                    addFiles(entry)
                    zipfile.readEntry()
                  })
                })
              } else zipfile.readEntry()
            })
            zipfile.on('end', resolve)
          })
        })
      }
    })
  },

  untransform: async ({ config }, { filterMetadata, xmlTransformer, applyRemapper }) => {
    await applyRemapper(/^staticresources\/([^/]+)\/.*$/, (filename, matches) => {
      return `staticresources/${matches[1]}.resource-meta.xml`
    })

    await xmlTransformer('staticresources/*-meta.xml', async (filename, xml, { requireFiles, addFiles }) => {
      if (xml.contentType[0] === 'application/zip') {
        const resourceName = filename.replace('-meta.xml', '')
        const folder = resourceName.replace('.resource', '')
        const get = _.makeGetter('staticResources.useBundleRenderer', [])
        if (!multimatch(resourceName, get(config).map(x => `staticresources/${x}`)).length) return
        const zip = new yazl.ZipFile()
        const filesToZip = await requireFiles(`${folder}/**/*`)
        filesToZip.forEach(f => zip.addBuffer(f.data, f.fileName.replace(folder + '/', '')))
        zip.end()
        const bufs = await _(zip.outputStream).values()
        addFiles({
          fileName: filename.replace('-meta.xml', ''),
          data: Buffer.concat(bufs)
        })
      }
    })

    await filterMetadata(fileName => {
      return fileName.match(/^staticresources\/([^/]+)\/.*$/)
    })
  }
}
