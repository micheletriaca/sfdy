const { unzip, zip } = require('../utils/zip-utils')
const path = require('path')
const _ = require('exstream.js')

const getConfiguredBundles = _.makeGetter('config.staticResources.useBundleRenderer', [])

module.exports = {
  remaps: [
    {
      transformed: 'staticresources/*/**/*',
      normalized: f => {
        const r = f.replace(/^(staticresources\/[^/]+)\/.*$/, '$1') + '.resource'
        return [r, r + '-meta.xml']
      }
    },
    {
      transformed: 'staticresources/*.resource-meta.xml',
      normalized: f => {
        const r = f.replace('-meta.xml', '')
        return [f, r]
      }
    }
  ],

  transform: async (ctx, { xmlTransformer, includeFiles, excludeFilesWhen, getFiles, removeFilesFromFilesystem }) => {
    const patterns = getConfiguredBundles(ctx).map(x => `staticresources/${x}-meta.xml`)

    await xmlTransformer(patterns, async (filename, xml) => {
      if (xml.contentType[0] === 'application/zip') {
        const resourceName = filename.replace('-meta.xml', '')
        const dir = resourceName.replace('.resource', '')

        const resource = await getFiles(resourceName)
        await removeFilesFromFilesystem([dir, resourceName])
        excludeFilesWhen(f => f === resourceName)

        const r = /\/__MACOSX/
        await _(unzip(resource[0].data))
          .flatten()
          .reject(f => r.test(f.fileName))
          .mapEntry('fileName', f => path.join(dir, f))
          .apply(includeFiles)
      }
    })
  },

  normalize: async (ctx, { xmlTransformer, getFiles, includeFiles, excludeFilesWhen }) => {
    const patterns = getConfiguredBundles(ctx).map(x => `staticresources/${x}-meta.xml`)

    await xmlTransformer(patterns, async (filename, xml) => {
      if (xml.contentType[0] === 'application/zip') {
        const resourceName = filename.replace('-meta.xml', '')
        const dir = resourceName.replace('.resource', '')

        const filesToZip = await _(getFiles(`${dir}/**/*`))
          .flatten()
          .mapEntry('fileName', f => f.replace(dir + '/', ''))
          .values()

        const fileList = filesToZip.map(x => x.fileName)
        const zipBuffer = await _(zip(fileList, filesToZip).outputStream).applyOne(Buffer.concat)
        includeFiles([{ fileName: resourceName, data: zipBuffer }])
        excludeFilesWhen(dir + '/**/*')
      }
    })
  }
}
