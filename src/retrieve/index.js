
const chalk = require('chalk')
const log = require('../services/log-service').getLogger()
const decompress = require('decompress')
const Sfdc = require('../utils/sfdc-utils')
const logService = require('../services/log-service')
const stripEmptyTranslations = require('../prepare/strip-empty-translations')
const stripUselessFlsInPermissionSets = require('../prepare/strip-useless-fls-in-permission-sets')
const stripPartnerRoles = require('../prepare/strip-partner-roles')
const fixProfiles = require('../prepare/fix-profiles')
const { getMembersOf, getProfileOnlyPackage, getPackageXml } = require('../utils/package-utils')
const { printLogo } = require('../utils/branding-utils')
const multimatch = require('multimatch')
const pluginEngine = require('../plugin-engine')
const path = require('path')
const pathService = require('../services/path-service')
const fs = require('fs-extra')

module.exports = async ({ loginOpts, basePath, logger, profileOnly, files, meta, config }) => {
  if (basePath) pathService.setBasePath(basePath)
  if (logger) logService.setLogger(logger)
  console.time('running time')
  printLogo()
  log(chalk.yellow(`(1/4) Logging in salesforce as ${loginOpts.username}...`))
  const sfdcConnector = await Sfdc.newInstance({
    username: loginOpts.username,
    password: loginOpts.password,
    isSandbox: !!loginOpts.sandbox,
    serverUrl: loginOpts.serverUrl
  })
  log(chalk.green(`Logged in!`))

  await pluginEngine.registerPlugins(config.postRetrievePlugins, sfdcConnector, loginOpts.username)

  log(chalk.yellow(`(2/4) Retrieving metadata...`))
  if (profileOnly) log(chalk.yellow(`--profile-only=true. Retrieving profiles only...`))
  const specificFiles = (files && files.split(',').map(x => x.trim())) || []
  const specificMeta = (meta && meta.split(',').map(x => x.trim())) || []
  if (specificFiles.length) log(chalk.yellow(`--files specified. Retrieving only specific files...`))
  else if (specificMeta.length) log(chalk.yellow(`--meta specified. Retrieving only specific metadata types...`))
  const pkgJson = await (
    profileOnly
      ? getProfileOnlyPackage()
      : getPackageXml({
        specificFiles,
        specificMeta,
        sfdcConnector
      })
  )
  if (specificFiles.length) log(chalk.yellow(`delta package generated`))

  const retrieveJob = await sfdcConnector.retrieveMetadata(pkgJson, config.profiles && config.profiles.addExtraApplications)
  const retrieveResult = await sfdcConnector.pollRetrieveMetadataStatus(retrieveJob.id)
  log(chalk.green(`Retrieve completed!`))
  log(chalk.yellow(`(3/4) Unzipping...`))
  const zipBuffer = Buffer.from(retrieveResult.zipFile, 'base64')
  await decompress(zipBuffer, path.resolve(pathService.getBasePath(), 'src'), {
    filter: f => profileOnly ? f.path.endsWith('.profile') : !/package\.xml$/.test(f.path)
  })
  log(chalk.green(`Unzipped!`))
  log(chalk.yellow(`(4/4) Applying patches...`))
  const patchProfiles = pkgJson.types.some(x => x.name[0] === 'Profile')
  const patchTranslations = pkgJson.types.some(x => x.name[0] === 'CustomObjectTranslation')
  const patchPermissionSet = pkgJson.types.some(x => x.name[0] === 'PermissionSet')
  const patchPartnerRoles = pkgJson.types.some(x => x.name[0] === 'Role')

  await Promise.all([
    patchTranslations ? stripEmptyTranslations(config) : Promise.resolve(),
    patchPermissionSet ? stripUselessFlsInPermissionSets(config) : Promise.resolve(),
    patchProfiles ? fixProfiles(config, sfdcConnector) : Promise.resolve(),
    patchPartnerRoles ? Promise.resolve(stripPartnerRoles(config)) : Promise.resolve()
  ])

  await pluginEngine.applyTransformationsAndWriteBack(specificFiles, sfdcConnector)

  const APPS_PATH = path.resolve(pathService.getBasePath(), 'src', 'applications')
  if (fs.existsSync(APPS_PATH) && pkgJson.types.some(x => x.name[0] === 'Profile')) {
    const versionedApps = (await getMembersOf('CustomApplication')).map(x => x + '.app')
    if (!versionedApps.length) fs.removeSync(APPS_PATH)
    else {
      fs.readdirSync(APPS_PATH).map(f => {
        if (!multimatch(f, versionedApps).length) fs.unlinkSync(path.resolve(APPS_PATH, f))
      })
    }
  }
  log(chalk.green(`Patches applied!`))
  console.timeEnd('running time')
}
