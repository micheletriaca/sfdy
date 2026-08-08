const path = require('path')
const cloneDeep = require('lodash').cloneDeep
const { parseXml, buildXml } = require('../../utils/xml-utils')
const { XML_NAMESPACE, simpleTypes, object } = require('./definitions')

// The adapter is intentionally I/O-free. Callers apply `deletes` first and then
// persist `upserts`, so a failed conversion cannot leave a half-written project.
const componentKey = component => `${component.type}/${component.fullName}`
const componentPath = (definition, fullName, suffix) => `${definition.directory}/${fullName}.${suffix}`
const entry = (fileName, data) => ({ fileName, data: Buffer.from(data) })
const xmlEntry = (fileName, xml) => entry(fileName, buildXml(cloneDeep(xml)) + '\n')

const uniqueComponents = components => [...new Map(components.map(component => [componentKey(component), component])).values()]

const resolveSimplePath = fileName => {
  for (const definition of simpleTypes) {
    const prefixes = [definition.sourceSuffix, definition.companionSuffix].filter(Boolean)
    for (const suffix of prefixes) {
      const prefix = `${definition.directory}/`
      const ending = `.${suffix}`
      if (fileName.startsWith(prefix) && fileName.endsWith(ending)) {
        return {
          type: definition.type,
          fullName: fileName.slice(prefix.length, -ending.length)
        }
      }
    }
  }
}

const resolveObjectPath = fileName => {
  const parts = fileName.split('/')
  if (parts[0] !== object.directory || parts.length < 3) return

  const objectName = parts[1]
  if (parts.length === 3 && parts[2] === `${objectName}.${object.sourceSuffix}`) {
    return { type: object.type, fullName: objectName }
  }

  for (const child of object.children) {
    const ending = `.${child.suffix}`
    if (parts.length === 4 && parts[2] === child.directory && parts[3].endsWith(ending)) {
      return {
        type: child.type,
        fullName: `${objectName}.${parts[3].slice(0, -ending.length)}`
      }
    }
  }
}

const resolvePath = fileName => resolveObjectPath(fileName) || resolveSimplePath(fileName)

const resolve = fileNames => uniqueComponents(fileNames
  .map(resolvePath)
  .filter(Boolean))

const findSimpleDefinition = fileName => simpleTypes.find(definition => {
  const prefix = `${definition.directory}/`
  return fileName.startsWith(prefix) && (
    fileName.endsWith(`.${definition.sourceSuffix}`) ||
    (definition.companionSuffix && fileName.endsWith(`.${definition.companionSuffix}`))
  )
})

const toMetadataSimple = sourceEntry => {
  const definition = findSimpleDefinition(sourceEntry.fileName)
  if (!definition) return

  const companionEnding = definition.companionSuffix && `.${definition.companionSuffix}`
  if (companionEnding && sourceEntry.fileName.endsWith(companionEnding)) return entry(sourceEntry.fileName, sourceEntry.data)

  const sourceEnding = `.${definition.sourceSuffix}`
  const fullName = sourceEntry.fileName.slice(definition.directory.length + 1, -sourceEnding.length)
  return entry(componentPath(definition, fullName, definition.metadataSuffix), sourceEntry.data)
}

const groupObjectEntries = entries => {
  const groups = new Map()
  entries.forEach(sourceEntry => {
    const component = resolveObjectPath(sourceEntry.fileName)
    if (!component) return
    const objectName = component.fullName.split('.')[0]
    if (!groups.has(objectName)) groups.set(objectName, [])
    groups.get(objectName).push({ component, sourceEntry })
  })
  return groups
}

const composeObject = async (objectName, sourceEntries) => {
  const main = sourceEntries.find(item => item.component.type === object.type)
  const result = main
    ? await parseXml(main.sourceEntry.data)
    : { CustomObject: { $: { xmlns: XML_NAMESPACE } } }

  for (const child of object.children) {
    const children = sourceEntries.filter(item => item.component.type === child.type)
    if (!children.length) continue
    result.CustomObject[child.xmlTag] = []
    for (const item of children) {
      const childXml = await parseXml(item.sourceEntry.data)
      const childValue = cloneDeep(Object.values(childXml)[0])
      delete childValue.$
      result.CustomObject[child.xmlTag].push(childValue)
    }
  }

  return xmlEntry(componentPath(object, objectName, object.metadataSuffix), result)
}

const toMetadata = async sourceEntries => {
  const unsupported = sourceEntries.find(item => !resolvePath(item.fileName))
  if (unsupported) throw new Error(`Unsupported SFDX source path: ${unsupported.fileName}`)

  const components = resolve(sourceEntries.map(item => item.fileName))
  const objectGroups = groupObjectEntries(sourceEntries)
  const objectSourcePaths = new Set([...objectGroups.values()].flat().map(item => item.sourceEntry.fileName))
  const converted = sourceEntries
    .filter(item => !objectSourcePaths.has(item.fileName))
    .map(toMetadataSimple)
    .filter(Boolean)

  for (const [objectName, entries] of objectGroups) converted.push(await composeObject(objectName, entries))
  return { components, entries: converted }
}

const findMetadataSimpleDefinition = fileName => simpleTypes.find(definition => {
  const prefix = `${definition.directory}/`
  return fileName.startsWith(prefix) && (
    fileName.endsWith(`.${definition.metadataSuffix}`) ||
    (definition.companionSuffix && fileName.endsWith(`.${definition.companionSuffix}`))
  )
})

const toSourceSimple = metadataEntry => {
  const definition = findMetadataSimpleDefinition(metadataEntry.fileName)
  if (!definition) return
  if (definition.companionSuffix && metadataEntry.fileName.endsWith(`.${definition.companionSuffix}`)) {
    return entry(metadataEntry.fileName, metadataEntry.data)
  }

  const metadataEnding = `.${definition.metadataSuffix}`
  const fullName = metadataEntry.fileName.slice(definition.directory.length + 1, -metadataEnding.length)
  return entry(componentPath(definition, fullName, definition.sourceSuffix), metadataEntry.data)
}

const childFullName = (objectName, childValue) => `${objectName}.${childValue.fullName[0]}`

const decomposeObject = async (metadataEntry, requested) => {
  const objectName = path.posix.basename(metadataEntry.fileName, `.${object.metadataSuffix}`)
  const parsed = await parseXml(metadataEntry.data)
  const sourceEntries = []
  const fullObjectRequested = !requested || requested.has(`${object.type}/${objectName}`)

  for (const child of object.children) {
    const childValues = parsed.CustomObject[child.xmlTag] || []
    delete parsed.CustomObject[child.xmlTag]
    childValues
      .filter(value => fullObjectRequested || requested.has(`${child.type}/${childFullName(objectName, value)}`))
      .forEach(value => {
        const fullName = value.fullName[0]
        const fileName = `${object.directory}/${objectName}/${child.directory}/${fullName}.${child.suffix}`
        sourceEntries.push(xmlEntry(fileName, {
          [child.type]: {
            $: { xmlns: XML_NAMESPACE },
            ...value
          }
        }))
      })
  }

  if (fullObjectRequested) {
    sourceEntries.unshift(xmlEntry(
      `${object.directory}/${objectName}/${objectName}.${object.sourceSuffix}`,
      parsed
    ))
  }

  return {
    upserts: sourceEntries,
    deletes: fullObjectRequested ? [`${object.directory}/${objectName}`] : []
  }
}

const toSource = async (metadataEntries, options = {}) => {
  const requested = options.components && new Set(options.components.map(componentKey))
  const result = { upserts: [], deletes: [] }

  for (const metadataEntry of metadataEntries) {
    if (metadataEntry.fileName.startsWith(`${object.directory}/`) && metadataEntry.fileName.endsWith(`.${object.metadataSuffix}`)) {
      const objectResult = await decomposeObject(metadataEntry, requested)
      result.upserts.push(...objectResult.upserts)
      result.deletes.push(...objectResult.deletes)
      continue
    }

    const converted = toSourceSimple(metadataEntry)
    if (!converted) throw new Error(`Unsupported Metadata API path: ${metadataEntry.fileName}`)
    result.upserts.push(converted)
  }

  return result
}

module.exports = {
  resolve,
  toMetadata,
  toSource
}
