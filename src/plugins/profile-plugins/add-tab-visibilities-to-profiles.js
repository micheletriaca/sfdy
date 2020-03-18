const multimatch = require('multimatch')
const chalk = require('chalk')
const _ = require('lodash')
const __ = require('highland')
const { remapProfileName, retrieveAllTabVisibilities, getVersionedObjects } = require('./utils')

const getVersionedTabs = _.memoize((allTabs, allFiles, versionedObjects) => {
  const versionedTabs = new Set(allFiles
    .filter(x => x.fileName.startsWith('tabs/'))
    .map(x => x.fileName.replace(/^tabs\/(.*)\.tab$/, '$1')))

  return allTabs
    .filter(x => versionedTabs.has(x.Name) || versionedObjects.has(x.SobjectName))
    .map(x => x.Name)
})

module.exports = async (context, helpers) => {
  const extraTabsGlob = _.get(context, 'config.profiles.addExtraTabVisibility', [])
  if (!extraTabsGlob.length) return
  context.q = _.memoize(context.sfdcConnector.query)

  helpers.xmlTransformer('profiles/**/*', async (filename, fJson, requireFiles) => {
    context.log(chalk.blue(`----> Processing ${filename}: Adding tabs`))
    const allTabs = [
      ...await context.q('SELECT Name, SobjectName FROM TabDefinition ORDER BY Name'),
      ...await __(await context.q('SELECT Id, Type, DeveloperName FROM CustomTab', true))
        .map(async x => {
          if (x.Type === 'customObject') {
            const y = (await context.q(`SELECT FullName FROM CustomTab WHERE Id = '${x.Id}'`, true))[0]
            return { Name: y.FullName, SobjectName: y.FullName }
          } else if (x.DeveloperName) {
            return { Name: x.DeveloperName, SobjectName: '' }
          }
        })
        .map(x => __(x))
        .parallel(10)
        .collect()
        .toPromise(Promise)
    ]
    const versionedObjects = getVersionedObjects(await requireFiles('objects/**/*'))
    const versionedTabs = new Set(getVersionedTabs(allTabs, await requireFiles('tabs/**/*'), versionedObjects))
    const realProfileName = await remapProfileName(filename, context)
    const visibleTabs = _.keyBy(await retrieveAllTabVisibilities(realProfileName, context), 'Name')
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
        .filter(x => versionedTabs.has(x['tab'][0]))
        .keyBy(x => x['tab'][0])
        .value()
    }

    fJson.tabVisibilities = Object.keys(finalTabs).sort().map(x => finalTabs[x])
    context.log(chalk.blue('----> Done'))
  })
}
