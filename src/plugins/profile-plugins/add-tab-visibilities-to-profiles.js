const multimatch = require('multimatch')
const chalk = require('chalk')
const memoize = require('lodash/memoize')
const _ = require('exstream.js')
const { remapProfileName, retrieveAllTabVisibilities, getVersionedObjects } = require('./utils')
const getExtraTabVisibility = _.makeGetter('profiles.addExtraTabVisibility', [])
const isPluginEnabled = config => !!getExtraTabVisibility(config).length

const getVersionedTabs = memoize((allTabs, versionedTabs, versionedObjects) => {
  return versionedTabs
    .map(x => x.fileName.replace(/^tabs\/(.*)\.tab$/, '$1'))
    .concat(allTabs
      .filter(x => versionedObjects.has(x.SobjectName))
      .map(x => x.Name)
    )
})

const patchProfile = (ctx, extraTabsGlob, getFiles) => async (filename, fJson) => {
  ctx.log(chalk.blue(`----> Processing ${filename}: Adding tabs`))
  const allTabs = [
    ...await ctx.q('SELECT Name, SobjectName FROM TabDefinition WHERE IsCustom = FALSE ORDER BY Name'),
    ...await _(ctx.q('SELECT Id, Type, DeveloperName FROM CustomTab', true))
      .flatten()
      .map(async x => {
        if (x.Type === 'customObject') {
          const y = (await ctx.q(`SELECT FullName FROM CustomTab WHERE Id = '${x.Id}'`, true))[0]
          return { Name: y.FullName, SobjectName: y.FullName }
        } else if (x.DeveloperName) {
          return { Name: x.DeveloperName, SobjectName: '' }
        }
      })
      .resolve(10)
      .values()
  ]

  const versionedObjects = getVersionedObjects(await getFiles('objects/**/*'))
  const versionedTabs = new Set(getVersionedTabs(allTabs, await getFiles('tabs/**/*'), versionedObjects))
  const realProfileName = await remapProfileName(filename, ctx)
  const visibleTabs = _(await retrieveAllTabVisibilities(realProfileName, ctx)).keyBy('Name').value()
  const tabVisibilities = allTabs
    .filter(b => {
      if (versionedTabs.has(b.Name) || versionedObjects.has(b.SobjectName)) return true
      else return multimatch(b.Name, extraTabsGlob).length > 0
    })

  const finalTabs = {
    ..._(tabVisibilities)
      .map(tab => ({
        tab: [tab.Name],
        visibility: [(!visibleTabs[tab.Name] && 'Hidden') || visibleTabs[tab.Name].Visibility]
      }))
      .keyBy('tab')
      .value(),
    ..._(fJson.tabVisibilities || [])
      .filter(x => versionedTabs.has(x.tab[0]))
      .keyBy(x => x.tab[0])
      .value()
  }

  fJson.tabVisibilities = Object.keys(finalTabs).sort().map(x => finalTabs[x])
  ctx.log(chalk.blue('----> Done'))
}

module.exports = {
  isEnabled: isPluginEnabled,

  afterRetrieve: async (ctx, { xmlTransformer, getFiles }) => {
    const extraTabsGlob = ctx.config.profiles.addExtraTabVisibility
    ctx.q = memoize(ctx.sfdc.query)
    await xmlTransformer('profiles/**/*', patchProfile(ctx, extraTabsGlob, getFiles))
  }
}
