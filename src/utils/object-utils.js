const path = require('path')
const fs = require('fs')
const _ = require('highland')
const memoize = require('lodash').memoize
const { parseXml } = require('./xml-utils')
const { getMembersOf } = require('./package-utils')
const pathService = require('../services/path-service')

const res = {
  getFieldMap: memoize(() => _(fs.readdirSync(pathService.getObjectPath()))
    .map(async x => ({
      content: await parseXml(fs.readFileSync(path.resolve(pathService.getObjectPath(), x), 'utf8')),
      obj: x.replace('.object', '')
    }))
    .map(x => _(x))
    .sequence()
    .flatMap(objData => (objData.content.CustomObject.fields || []).map(x => `${objData.obj}.${x.fullName[0]}`))
    .flatMap(field => {
      const res = [field]
      if (field.startsWith('Activity.')) {
        res.push(field.replace('Activity.', 'Event.'))
        res.push(field.replace('Activity.', 'Task.'))
      }
      return res
    })
    .collect()
    .map(x => new Set(x))
    .toPromise(Promise)),
  getVersionedObjects: memoize(() => fs.readdirSync(pathService.getObjectPath()).map(x => x.replace('.object', ''))),
  getVersionedApplications: memoize(async () => getMembersOf('CustomApplication')),
  getVersionedTabs: memoize((allTabs) => {
    if (!fs.existsSync(pathService.getTabsPath())) return []
    const versionedTabs = new Set(fs.readdirSync(pathService.getTabsPath()).map(x => x.replace('.tab', '')))
    const versionedObjects = new Set(res.getVersionedObjects())
    return allTabs.filter(x => versionedTabs.has(x.Name) || versionedObjects.has(x.SobjectName)).map(x => x.Name)
  })
}

module.exports = res
