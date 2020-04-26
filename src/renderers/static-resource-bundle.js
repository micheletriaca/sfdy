const yauzl = require('yauzl')
const yazl = require('yazl')
const path = require('path')
const _ = require('lodash')
const multimatch = require('multimatch')

module.exports = {
  transform: async ({ config }, helpers) => {
    const filesToFilter = new Set()

    helpers.filterMetadata(fileName => {
      return !filesToFilter.has(fileName)
    })

    helpers.xmlTransformer('staticresources/*-meta.xml', async (filename, xml, requireFiles, addFiles, cleanFiles) => {
      if (xml.contentType[0] === 'application/zip') {
        const resourceName = filename.replace('-meta.xml', '')
        const dir = resourceName.replace('.resource', '')
        cleanFiles(dir)

        if (!multimatch(resourceName, _.get(config, 'staticResources.useBundleRenderer', []).map(x => `staticresources/${x}`)).length) return

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

  untransform: async ({ config }, helpers) => {
    helpers.xmlTransformer('staticresources/*-meta.xml', async (filename, xml, requireFiles, addFiles) => {
      if (xml.contentType[0] === 'application/zip') {
        const resourceName = filename.replace('-meta.xml', '')
        const folder = resourceName.replace('.resource', '')
        if (!multimatch(resourceName, _.get(config, 'staticResources.useBundleRenderer', []).map(x => `staticresources/${x}`)).length) return
        const filesToZip = await requireFiles(`${folder}/**/*`)
        return new Promise(resolve => {
          const zip = new yazl.ZipFile()
          filesToZip.forEach(f => zip.addBuffer(f.data, f.fileName.replace(folder + '/', '')))
          zip.end()
          const bufs = []
          zip.outputStream.on('data', d => bufs.push(d))
          zip.outputStream.on('end', () => {
            addFiles({
              fileName: filename.replace('-meta.xml', ''),
              data: Buffer.concat(bufs)
            })
            resolve()
          })
        })
      }
    })

    helpers.filterMetadata(fileName => {
      return !fileName.match(/^staticresources\/([^/]+)\/.*$/)
    })

    helpers.addRemapper(/^staticresources\/([^/]+)\/.*$/, (filename, regexp) => {
      return `staticresources/${filename.match(regexp)[1]}.resource`
    })
  }
}
