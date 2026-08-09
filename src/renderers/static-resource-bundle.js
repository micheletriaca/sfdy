const yauzl = require('yauzl')
const yazl = require('yazl')
const path = require('path')
const _ = require('lodash')
const multimatch = require('multimatch')
const { buffer } = require('stream/consumers')
const { defineRenderer } = require('../plugin')

const resourcePattern = /^staticresources\/([^/]+)\/.*$/
const remapResourcePath = filePath => {
  const match = filePath.match(resourcePattern)
  return match ? `staticresources/${match[1]}.resource` : filePath
}

const usesBundleRenderer = (config, resourceName) => multimatch(
  resourceName,
  _.get(config, 'staticResources.useBundleRenderer', []).map(value => `staticresources/${value}`)
).length > 0

const unzip = archive => new Promise((resolve, reject) => {
  yauzl.fromBuffer(archive, { lazyEntries: true, autoClose: true }, (error, zipFile) => {
    if (error) return reject(error)
    const entries = []
    zipFile.on('error', reject)
    zipFile.on('entry', entry => {
      if (entry.fileName.endsWith('/')) return zipFile.readEntry()
      const normalized = path.posix.normalize(entry.fileName)
      if (normalized.startsWith('../') || path.posix.isAbsolute(normalized)) {
        return reject(new Error(`Unsafe path in static resource archive: ${entry.fileName}`))
      }
      zipFile.openReadStream(entry, async (streamError, stream) => {
        if (streamError) return reject(streamError)
        try {
          entries.push({ path: normalized, contents: await buffer(stream) })
          zipFile.readEntry()
        } catch (readError) {
          reject(readError)
        }
      })
    })
    zipFile.on('end', () => resolve(entries))
    zipFile.readEntry()
  })
})

const zip = async (folder, files) => {
  const archive = new yazl.ZipFile()
  for (const file of files) {
    archive.addBuffer(await file.readBytes(), file.path.slice(folder.length + 1))
  }
  archive.end()
  return buffer(archive.outputStream)
}

module.exports = defineRenderer({
  name: 'core-static-resource-bundle',
  formats: ['metadata'],

  resolveSelection ({ selection }) {
    selection.replace(selection.values().map(remapResourcePath))
  },

  async onRetrieve ({ files, project, output, config }) {
    for (const descriptor of files.match('staticresources/*-meta.xml')) {
      const xml = await descriptor.readXml()
      if (xml.contentType?.[0] !== 'application/zip') continue

      const resourceName = descriptor.path.replace('-meta.xml', '')
      const folder = resourceName.replace('.resource', '')
      output.delete(folder)
      if (!usesBundleRenderer(config, resourceName)) continue

      const resource = files.get(resourceName) || project.get(resourceName)
      if (!resource) throw new Error(`Missing static resource archive: ${resourceName}`)
      const entries = await unzip(await resource.readBytes())
      output.delete(resourceName)
      files.get(resourceName)?.exclude()
      for (const entry of entries) {
        const targetPath = path.posix.join(folder, entry.path)
        const existing = files.get(targetPath)
        if (existing) existing.writeBytes(entry.contents)
        else files.create({ path: targetPath, contents: entry.contents })
      }
    }
  },

  async onDeploy ({ files, project, config }) {
    for (const descriptor of files.match('staticresources/*-meta.xml')) {
      const xml = await descriptor.readXml()
      if (xml.contentType?.[0] !== 'application/zip') continue

      const resourceName = descriptor.path.replace('-meta.xml', '')
      if (!usesBundleRenderer(config, resourceName)) continue
      const folder = resourceName.replace('.resource', '')
      const archive = await zip(folder, project.match(`${folder}/**/*`))
      const active = files.get(resourceName)
      const stored = project.get(resourceName)
      if (active) active.writeBytes(archive)
      else if (stored) files.include(stored).writeBytes(archive)
      else files.create({ path: resourceName, contents: archive })
      files.exclude(`${folder}/**/*`)
    }
  }
})
