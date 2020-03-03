const { parseXml, buildXml } = require('../utils/xml-utils')
const _ = require('highland')
const fs = require('fs')
const yauzl = require('yauzl')
const util = require('util')
const makeDir = require('make-dir')
const getStream = require('get-stream')
const memoize = require('lodash').memoize
const path = require('path')
const pathService = require('../services/path-service')
const stripEmptyTranslations = require('../prepare/strip-empty-translations')
const stripObjectTranslations = require('../prepare/strip-object-translations')
const stripEmptyStandardValueSetTranslations = require('../prepare/strip-empty-standardvalueset-translations')
const stripUselessFlsInPermissionSets = require('../prepare/strip-useless-fls-in-permission-sets')
const fixObjects = require('../prepare/fix-objects')
const fixProfiles = require('../prepare/fix-profiles')

const getFolderName = (fileName) => {
  return fileName.substring(0, fileName.lastIndexOf('/'))
}

const patchFile = async (file, config, patchesToApply) => {
  const folder = getFolderName(file.fileName)
  const fJson = await parseXml(file.data)
  // console.log(file.fileName)

  // TODO: da modificare
  // if (patchesToApply.patchTranslations && folder === 'translations') await stripEmptyTranslations(fJson, config)
  // if (patchesToApply.patchTranslations && folder === 'objectTranslations') await stripObjectTranslations(fJson, config)
  // if (patchesToApply.patchTranslations && folder === 'standardValueSetTranslations') await stripEmptyStandardValueSetTranslations(fJson, config)
  // if (patchesToApply.patchPermissionSet && folder === 'permissionsets') await stripEmptyStandardValueSetTranslations(fJson, config)
  // if (patchesToApply.patchProfiles && folder === 'profiles') await fixProfiles(fJson, config)
  // if (patchesToApply.patchPartnerRoles && folder === 'roles') await stripPartnerRoles(fJson, config)
  if (patchesToApply.patchObjects && folder === 'objects') await fixObjects(fJson, config)

  // TODO: riportare a byte?
  file.xml = buildXml(fJson) + '\n'
}

module.exports = (zipBuffer, pkgJson, config) => new Promise(resolve => {
  console.time('patcher')
  console.log('patcher!')

  const patchesToApply = {
    patchProfiles: pkgJson.types.some(x => x.name[0] === 'Profile'),
    patchTranslations: pkgJson.types.some(x => x.name[0] === 'CustomObjectTranslation'),
    patchPermissionSet: pkgJson.types.some(x => x.name[0] === 'PermissionSet'),
    patchPartnerRoles: pkgJson.types.some(x => x.name[0] === 'Role'),
    patchObjects: pkgJson.types.some(x => x.name[0] === 'CustomObject')
  }

  yauzl.fromBuffer(zipBuffer, { lazyEntries: false }, (err, zipFile) => {
    const wf = util.promisify(fs.writeFile)
    const mMakeDir = memoize(makeDir)
    if (err) return console.error(err)
    const openStream = util.promisify(zipFile.openReadStream.bind(zipFile))
    const flow = _('entry', zipFile)
    zipFile.on('end', () => { flow.end() })
    flow.map(x => { x.type = x.fileName.endsWith('/') ? 'directory' : 'file'; return x })
      .filter(x => x.type === 'file')
      .map(async x => { x.data = await getStream.buffer(await openStream(x)); return x })
      .map(x => _(x))
      .parallel(20)
      .toArray(async x => {
        await Promise.all(x.map(async y => {
          await patchFile(y, config, patchesToApply)
          await mMakeDir(path.resolve(pathService.getBasePath(), 'src') + '/' + getFolderName(y.fileName))
          await wf(path.resolve(pathService.getBasePath(), 'src') + '/' + y.fileName, y.xml)
        }))
        console.timeEnd('patcher')
        resolve()
      })
  })
})
