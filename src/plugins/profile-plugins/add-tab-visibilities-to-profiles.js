const multimatch = require('multimatch')
const chalk = require('chalk')
const _ = require('lodash')
const __ = require('highland')
const { remapProfileName, retrieveAllTabVisibilities, getVersionedObjects } = require('./utils')
const { definePlugin } = require('../../plugin')
const { transformXml } = require('../v2-utils')

const getVersionedTabs = _.memoize((allTabs, versionedTabs, versionedObjects) => {
  return versionedTabs
    .map(x => (x.path || x.fileName).replace(/^tabs\/(.*)\.tab$/, '$1'))
    .concat(allTabs
      .filter(x => versionedObjects.has(x.SobjectName))
      .map(x => x.Name)
    )
})

module.exports = definePlugin({
  name: 'core-add-profile-tab-visibilities',
  stage: 'metadata',

  enabled: ({ files, config }) =>
    _.get(config, 'profiles.addExtraTabVisibility', []).length > 0 &&
    files.match('profiles/**/*').length > 0,

  async onRetrieve ({ files, project, config, salesforce, log }) {
    const extraTabsGlob = _.get(config, 'profiles.addExtraTabVisibility', [])
    const query = _.memoize(salesforce.query.bind(salesforce))
    const services = { query, salesforce }
    const allTabs = [
      ...await query('SELECT Name, SobjectName FROM TabDefinition ORDER BY Name'),
      ...await __(await query('SELECT Id, Type, DeveloperName FROM CustomTab', true))
        .map(async x => {
          if (x.Type === 'customObject') {
            const y = (await query(`SELECT FullName FROM CustomTab WHERE Id = '${x.Id}'`, true))[0]
            return { Name: y.FullName, SobjectName: y.FullName }
          } else if (x.DeveloperName) {
            return { Name: x.DeveloperName, SobjectName: '' }
          }
        })
        .map(x => __(x))
        .parallel(10)
        .collect()
        .toPromise(Promise)
    ].filter(Boolean)
    const versionedObjects = getVersionedObjects(project.match('objects/**/*'))
    const versionedTabs = new Set(getVersionedTabs(allTabs, project.match('tabs/**/*'), versionedObjects))

    await transformXml(files, 'profiles/**/*', async (fJson, file) => {
      log.info(chalk.blue(`----> Processing ${file.path}: Adding tabs`))
      const realProfileName = await remapProfileName(file.path, services)
      const visibleTabs = _.keyBy(await retrieveAllTabVisibilities(realProfileName, services), 'Name')
      const tabVisibilities = allTabs.filter(tab =>
        versionedTabs.has(tab.Name) || versionedObjects.has(tab.SobjectName) ||
        multimatch(tab.Name, extraTabsGlob).length > 0)

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
      log.info(chalk.blue('----> Done'))
    })
  }
})
