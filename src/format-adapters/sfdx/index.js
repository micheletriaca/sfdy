const path = require('path')
const cloneDeep = require('lodash').cloneDeep
const yazl = require('yazl')
const yauzl = require('yauzl')
const mime = require('mime')
const { buffer } = require('stream/consumers')
const { parseXml, buildXml } = require('../../utils/xml-utils')
const { XML_NAMESPACE, simpleTypes, folderTypes, decomposedTypes, aggregateTypes } = require('./definitions')

// The adapter is intentionally I/O-free. Callers apply `deletes` first and then
// persist `upserts`, so a failed conversion cannot leave a half-written project.
const componentKey = component => `${component.type}/${component.fullName}`
const componentPath = (definition, fullName, suffix) => `${definition.directory}/${fullName}.${suffix}`
const entry = (fileName, data) => ({ fileName, data: Buffer.from(data) })
const xmlEntry = (fileName, xml) => entry(fileName, buildXml(cloneDeep(xml)) + '\n')
const asArray = value => Array.isArray(value) ? value : value ? [value] : []
const isTrue = value => value === true || value === 'true'
const isFolderType = definition => definition && definition.type.endsWith('Folder')

const fallbackDefinitions = simpleTypes.map(definition => ({
  type: definition.type,
  directory: definition.directory,
  suffix: definition.metadataSuffix,
  metaFile: !!definition.companionSuffix
}))

const normalizeMappingDefinition = definition => ({
  type: definition.xmlName,
  directory: definition.directoryName,
  suffix: definition.suffix || (definition.xmlName === 'Document' ? 'document' : undefined),
  metaFile: isTrue(definition.metaFile),
  inFolder: isTrue(definition.inFolder),
  subDirectoryName: definition.subDirectoryName
})

const mappingDefinitions = packageMapping => {
  const discovered = packageMapping
    ? Object.values(packageMapping).flatMap(asArray).map(normalizeMappingDefinition)
    : fallbackDefinitions
  const discoveredTypes = new Set(discovered.map(definition => definition.type))
  return [
    ...discovered,
    ...folderTypes.filter(definition => !discoveredTypes.has(definition.type))
  ]
}

const pathSuffix = fileName => {
  const match = path.posix.basename(fileName).match(/\.([^.]+?)(?:-meta\.xml)?$/)
  return match && match[1]
}

const findDefinition = (fileName, packageMapping, format = 'source') => {
  const directory = fileName.split('/')[0]
  const candidates = mappingDefinitions(packageMapping).filter(definition => definition.directory === directory)
  if (!candidates.length) return
  if (candidates.length === 1) return candidates[0]

  const suffix = pathSuffix(fileName)
  const exact = candidates.find(definition => definition.suffix === suffix)
  if (exact) return exact

  if (format === 'metadata' && fileName.endsWith('-meta.xml')) {
    const folder = candidates.find(isFolderType)
    if (folder && !stripEnding(path.posix.basename(fileName), '-meta.xml').includes('.')) return folder
    const document = candidates.find(definition => definition.type === 'Document')
    if (document) return document
  }

  if (!fileName.endsWith('-meta.xml')) {
    const content = candidates.find(definition => definition.metaFile && !isFolderType(definition))
    if (content) return content
  }

  return candidates.find(definition => !definition.suffix)
}

const stripEnding = (value, ending) => value.endsWith(ending) ? value.slice(0, -ending.length) : value

const genericFullName = (fileName, definition, format) => {
  let relative = fileName.slice(definition.directory.length + 1)
  if (definition.type === 'StaticResource') {
    if (relative.includes('/')) return relative.split('/')[0]
    relative = stripEnding(relative, `.${definition.suffix}-meta.xml`)
    relative = stripEnding(relative, `.${definition.suffix}`)
    const extension = path.posix.extname(relative)
    return extension ? stripEnding(relative, extension) : relative
  }
  if (definition.subDirectoryName) {
    relative = stripEnding(relative, `.${definition.suffix}-meta.xml`)
    relative = stripEnding(relative, `.${definition.suffix}`)
    return relative.replace(`/${definition.subDirectoryName}`, '.')
  }
  if (definition.type === 'ExperienceBundle') {
    return stripEnding(relative, '.site-meta.xml').split('/')[0]
  }
  if (!definition.suffix) {
    const parts = relative.split('/')
    return definition.type === 'DigitalExperienceBundle'
      ? parts.slice(0, 2).join('/')
      : parts[0]
  }

  if (definition.type === 'Document') {
    if (format === 'source' && relative.endsWith(`.${definition.suffix}-meta.xml`)) {
      return stripEnding(relative, `.${definition.suffix}-meta.xml`)
    }
    if (format === 'metadata') relative = stripEnding(relative, '-meta.xml')
    return relative.slice(0, relative.lastIndexOf('.'))
  }

  if (isFolderType(definition)) {
    return format === 'source'
      ? stripEnding(relative, `.${definition.suffix}-meta.xml`)
      : stripEnding(relative, '-meta.xml')
  }

  relative = stripEnding(relative, `.${definition.suffix}-meta.xml`)
  relative = stripEnding(relative, `.${definition.suffix}`)
  return relative
}

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

const resolveDecomposedInfo = fileName => {
  const parts = fileName.split('/')
  for (const definition of decomposedTypes) {
    if (parts[0] !== definition.directory || parts.length < 3) continue
    const parentName = parts[1]
    if (parts.length === 3 && parts[2] === `${parentName}.${definition.sourceSuffix}`) {
      return {
        definition,
        component: { type: definition.type, fullName: parentName }
      }
    }

    for (const child of definition.children) {
      const ending = `.${child.suffix}`
      const childFile = definition.decomposition === 'folderPerType' ? parts[3] : parts[2]
      const pathMatches = definition.decomposition === 'folderPerType'
        ? parts.length === 4 && parts[2] === child.directory
        : parts.length === 3
      if (pathMatches && childFile.endsWith(ending)) {
        return {
          definition,
          child,
          component: {
            type: child.type,
            fullName: `${parentName}.${childFile.slice(0, -ending.length)}`
          }
        }
      }
    }
  }
}

const resolveDecomposedPath = fileName => {
  const info = resolveDecomposedInfo(fileName)
  return info && info.component
}

const resolveGenericPath = (fileName, packageMapping, format = 'source') => {
  const definition = findDefinition(fileName, packageMapping, format)
  if (!definition) return
  return {
    type: definition.type,
    fullName: genericFullName(fileName, definition, format)
  }
}

const resolvePath = (fileName, packageMapping, format = 'source') =>
  resolveDecomposedPath(fileName) || resolveSimplePath(fileName) || resolveGenericPath(fileName, packageMapping, format)

const resolve = (fileNames, packageMapping, format = 'source') => uniqueComponents(fileNames
  .map(fileName => resolvePath(fileName, packageMapping, format))
  .filter(Boolean))

const getCompanionPaths = (fileNames, availableFiles, packageMapping) => {
  const selected = new Set(resolve(fileNames, packageMapping).map(componentKey))
  const matchingFiles = (availableFiles || fileNames).filter(fileName => {
    const component = resolvePath(fileName, packageMapping)
    return component && selected.has(componentKey(component))
  })
  const legacyCompanions = uniqueComponents(fileNames
    .map(resolveSimplePath)
    .filter(Boolean))
    .flatMap(component => {
      const definition = simpleTypes.find(item => item.type === component.type)
      if (!definition || !definition.companionSuffix) return []
      return [
        componentPath(definition, component.fullName, definition.sourceSuffix),
        componentPath(definition, component.fullName, definition.companionSuffix)
      ]
    })
  return [...new Set([...matchingFiles, ...legacyCompanions])]
}

const containerTypes = [...decomposedTypes, ...aggregateTypes]

const getContainerParent = component => {
  const definition = containerTypes.find(item => item.children.some(child => child.type === component.type))
  if (!definition) return
  return {
    definition,
    component: {
      type: definition.type,
      fullName: definition.fullName || component.fullName.split('.')[0]
    }
  }
}

const getMetadataContainers = components => uniqueComponents(components
  .map(getContainerParent)
  .filter(Boolean)
  .map(item => item.component))

const getPackageComponents = components => {
  const selected = new Set(components.map(componentKey))
  return uniqueComponents(components.flatMap(component => {
    const parent = getContainerParent(component)
    if (!parent) return component
    if (selected.has(componentKey(parent.component))) return []
    const child = parent.definition.children.find(item => item.type === component.type)
    return child.addressable === false ? parent.component : component
  }))
}

const getMergePaths = components => components.some(component =>
  component.type === 'CustomLabel' && component.fullName !== '*')
  ? ['labels/CustomLabels.labels-meta.xml']
  : []

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

const findDocumentContent = (fileName, entries) => {
  const prefix = stripEnding(fileName, '.document-meta.xml')
  return entries.find(item => item.fileName.startsWith(`${prefix}.`) && !item.fileName.endsWith('-meta.xml'))
}

const zipEntries = entries => new Promise((resolve, reject) => {
  const zip = new yazl.ZipFile()
  entries.forEach(item => zip.addBuffer(item.data, item.fileName))
  zip.outputStream.on('error', reject)
  buffer(zip.outputStream).then(resolve, reject)
  zip.end()
})

const unzipEntries = data => new Promise((resolve, reject) => {
  yauzl.fromBuffer(data, { lazyEntries: false }, (error, zipFile) => {
    if (error) return reject(error)
    const reads = []
    zipFile.on('entry', zipEntry => {
      if (zipEntry.fileName.endsWith('/')) return
      const normalized = path.posix.normalize(zipEntry.fileName)
      if (normalized.startsWith('../') || normalized.startsWith('/') || normalized !== zipEntry.fileName) {
        reads.push(Promise.reject(new Error(`Unsafe path in static resource archive: ${zipEntry.fileName}`)))
        return
      }
      reads.push(new Promise((resolve, reject) => {
        zipFile.openReadStream(zipEntry, async (streamError, stream) => {
          if (streamError) return reject(streamError)
          try {
            resolve(entry(zipEntry.fileName, await buffer(stream)))
          } catch (readError) {
            reject(readError)
          }
        })
      }))
    })
    zipFile.on('error', reject)
    zipFile.on('end', () => Promise.all(reads).then(resolve, reject))
  })
})

const groupStaticResources = (entries, packageMapping, format = 'source') => {
  const groups = new Map()
  entries.forEach(sourceEntry => {
    const definition = findDefinition(sourceEntry.fileName, packageMapping, format)
    if (!definition || definition.type !== 'StaticResource') return
    const fullName = genericFullName(sourceEntry.fileName, definition, format)
    if (!groups.has(fullName)) groups.set(fullName, { definition, fullName, entries: [] })
    groups.get(fullName).entries.push(sourceEntry)
  })
  return groups
}

const composeStaticResource = async ({ definition, fullName, entries }) => {
  const descriptor = entries.find(item => item.fileName.endsWith(`.${definition.suffix}-meta.xml`))
  const content = entries.filter(item => item !== descriptor)
  if (!descriptor) throw new Error(`Missing descriptor for SFDX static resource: ${fullName}`)
  if (!content.length) throw new Error(`Missing content for SFDX static resource: ${fullName}`)

  const expandedPrefix = `${definition.directory}/${fullName}/`
  const expanded = content.every(item => item.fileName.startsWith(expandedPrefix))
  if (!expanded && content.length !== 1) throw new Error(`Ambiguous content for SFDX static resource: ${fullName}`)
  const contentData = expanded
    ? await zipEntries(content.map(item => entry(item.fileName.slice(expandedPrefix.length), item.data)))
    : content[0].data

  return [
    entry(`${definition.directory}/${fullName}.${definition.suffix}`, contentData),
    entry(`${definition.directory}/${fullName}.${definition.suffix}-meta.xml`, descriptor.data)
  ]
}

const toMetadataGeneric = (sourceEntry, sourceEntries, packageMapping) => {
  const definition = findDefinition(sourceEntry.fileName, packageMapping)
  if (!definition) return entry(sourceEntry.fileName, sourceEntry.data)

  if (definition.type === 'Document' && sourceEntry.fileName.endsWith('.document-meta.xml')) {
    const content = findDocumentContent(sourceEntry.fileName, sourceEntries)
    if (!content) throw new Error(`Missing content file for SFDX document: ${sourceEntry.fileName}`)
    return entry(`${content.fileName}-meta.xml`, sourceEntry.data)
  }

  if (isFolderType(definition) && sourceEntry.fileName.endsWith(`.${definition.suffix}-meta.xml`)) {
    return entry(sourceEntry.fileName.replace(`.${definition.suffix}-meta.xml`, '-meta.xml'), sourceEntry.data)
  }

  if (!definition.metaFile && definition.suffix && sourceEntry.fileName.endsWith(`.${definition.suffix}-meta.xml`)) {
    return entry(stripEnding(sourceEntry.fileName, '-meta.xml'), sourceEntry.data)
  }

  return entry(sourceEntry.fileName, sourceEntry.data)
}

const groupDecomposedEntries = entries => {
  const groups = new Map()
  entries.forEach(sourceEntry => {
    const info = resolveDecomposedInfo(sourceEntry.fileName)
    if (!info) return
    const parentName = info.component.fullName.split('.')[0]
    const key = `${info.definition.type}/${parentName}`
    if (!groups.has(key)) groups.set(key, { definition: info.definition, parentName, entries: [] })
    groups.get(key).entries.push({ ...info, sourceEntry })
  })
  return groups
}

const composeDecomposed = async ({ definition, parentName, entries: sourceEntries }) => {
  const main = sourceEntries.find(item => item.component.type === definition.type)
  const result = main
    ? await parseXml(main.sourceEntry.data)
    : { [definition.type]: { $: { xmlns: XML_NAMESPACE } } }

  for (const child of definition.children) {
    const children = sourceEntries.filter(item => item.component.type === child.type)
    if (!children.length) continue
    result[definition.type][child.xmlTag] = []
    for (const item of children) {
      const childXml = await parseXml(item.sourceEntry.data)
      const childValue = cloneDeep(Object.values(childXml)[0])
      delete childValue.$
      result[definition.type][child.xmlTag].push(childValue)
    }
  }

  return xmlEntry(componentPath(definition, parentName, definition.metadataSuffix), result)
}

const toMetadata = async (sourceEntries, packageMapping) => {
  const components = resolve(sourceEntries.map(item => item.fileName), packageMapping)
  const decomposedGroups = groupDecomposedEntries(sourceEntries)
  const staticResourceGroups = groupStaticResources(sourceEntries, packageMapping)
  const decomposedSourcePaths = new Set([...decomposedGroups.values()]
    .flatMap(group => group.entries)
    .map(item => item.sourceEntry.fileName))
  const staticResourcePaths = new Set([...staticResourceGroups.values()]
    .flatMap(group => group.entries)
    .map(item => item.fileName))
  const converted = sourceEntries
    .filter(item => !decomposedSourcePaths.has(item.fileName) && !staticResourcePaths.has(item.fileName))
    .map(item => toMetadataSimple(item) || toMetadataGeneric(item, sourceEntries, packageMapping))
    .filter(Boolean)

  for (const group of decomposedGroups.values()) converted.push(await composeDecomposed(group))
  for (const group of staticResourceGroups.values()) converted.push(...await composeStaticResource(group))
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

const toSourceGeneric = (metadataEntry, packageMapping) => {
  const definition = findDefinition(metadataEntry.fileName, packageMapping, 'metadata')
  if (!definition) return entry(metadataEntry.fileName, metadataEntry.data)

  if (definition.type === 'Document' && metadataEntry.fileName.endsWith('-meta.xml')) {
    const contentPath = stripEnding(metadataEntry.fileName, '-meta.xml')
    const extension = path.posix.extname(contentPath)
    return entry(`${stripEnding(contentPath, extension)}.${definition.suffix}-meta.xml`, metadataEntry.data)
  }

  if (isFolderType(definition) && metadataEntry.fileName.endsWith('-meta.xml')) {
    return entry(metadataEntry.fileName.replace('-meta.xml', `.${definition.suffix}-meta.xml`), metadataEntry.data)
  }

  if (!definition.metaFile && definition.suffix && metadataEntry.fileName.endsWith(`.${definition.suffix}`)) {
    return entry(`${metadataEntry.fileName}-meta.xml`, metadataEntry.data)
  }

  return entry(metadataEntry.fileName, metadataEntry.data)
}

const childName = (child, childValue) => childValue[child.uniqueIdElement || 'fullName'][0]
const childFullName = (parentName, child, childValue) => `${parentName}.${childName(child, childValue)}`
const isRequested = (requested, type, fullName) => !requested || requested.has(`${type}/*`) || requested.has(`${type}/${fullName}`)

const decomposeMetadata = async (metadataEntry, definition, requested) => {
  const parentName = path.posix.basename(metadataEntry.fileName, `.${definition.metadataSuffix}`)
  const parsed = await parseXml(metadataEntry.data)
  const sourceEntries = []
  const fullParentRequested = isRequested(requested, definition.type, parentName)

  for (const child of definition.children) {
    const childValues = parsed[definition.type][child.xmlTag] || []
    delete parsed[definition.type][child.xmlTag]
    childValues
      .filter(value => fullParentRequested || isRequested(requested, child.type, childFullName(parentName, child, value)))
      .forEach(value => {
        const fullName = childName(child, value)
        const childPath = definition.decomposition === 'folderPerType'
          ? `${child.directory}/${fullName}.${child.suffix}`
          : `${fullName}.${child.suffix}`
        const fileName = `${definition.directory}/${parentName}/${childPath}`
        sourceEntries.push(xmlEntry(fileName, {
          [child.type]: {
            $: { xmlns: XML_NAMESPACE },
            ...value
          }
        }))
      })
  }

  if (fullParentRequested) {
    sourceEntries.unshift(xmlEntry(
      `${definition.directory}/${parentName}/${parentName}.${definition.sourceSuffix}`,
      parsed
    ))
  }

  return {
    upserts: sourceEntries,
    deletes: fullParentRequested ? [`${definition.directory}/${parentName}`] : []
  }
}

const findDecomposedMetadataDefinition = fileName => decomposedTypes.find(definition =>
  fileName.startsWith(`${definition.directory}/`) && fileName.endsWith(`.${definition.metadataSuffix}`))

const findAggregateMetadataDefinition = fileName => aggregateTypes.find(definition =>
  fileName === `${definition.directory}/CustomLabels.${definition.metadataSuffix}`)

const mergeAggregateMetadata = async (metadataEntry, definition, existingEntry) => {
  const incoming = await parseXml(metadataEntry.data)
  if (!existingEntry) {
    return xmlEntry(`${definition.directory}/CustomLabels.${definition.sourceSuffix}`, incoming)
  }

  const existing = await parseXml(existingEntry.data)
  const child = definition.children[0]
  const incomingChildren = incoming[definition.type][child.xmlTag] || []
  const incomingByName = new Map(incomingChildren.map(value => [value[child.uniqueIdElement][0], value]))
  const existingChildren = existing[definition.type][child.xmlTag] || []
  const existingNames = new Set(existingChildren.map(value => value[child.uniqueIdElement][0]))
  existing[definition.type][child.xmlTag] = existingChildren.map(value =>
    incomingByName.get(value[child.uniqueIdElement][0]) || value)
  existing[definition.type][child.xmlTag].push(...incomingChildren.filter(value =>
    !existingNames.has(value[child.uniqueIdElement][0])))
  return xmlEntry(`${definition.directory}/CustomLabels.${definition.sourceSuffix}`, existing)
}

const staticResourceContentType = async descriptor => {
  const parsed = await parseXml(descriptor.data)
  const root = Object.values(parsed)[0]
  return root.contentType && root.contentType[0] ? root.contentType[0] : 'application/octet-stream'
}

const decomposeStaticResource = async ({ definition, fullName, entries }, existingFiles) => {
  const descriptor = entries.find(item => item.fileName.endsWith(`.${definition.suffix}-meta.xml`))
  const content = entries.find(item => item.fileName.endsWith(`.${definition.suffix}`))
  if (!descriptor || !content) throw new Error(`Incomplete Metadata API static resource: ${fullName}`)

  const existingContent = existingFiles.filter(fileName => {
    const component = resolveGenericPath(fileName, {
      [definition.directory]: {
        directoryName: definition.directory,
        inFolder: 'false',
        metaFile: 'true',
        suffix: definition.suffix,
        xmlName: definition.type
      }
    })
    return component && component.fullName === fullName && !fileName.endsWith(`.${definition.suffix}-meta.xml`)
  })
  const expandedPrefix = `${definition.directory}/${fullName}/`
  const existingExpanded = existingContent.some(fileName => fileName.startsWith(expandedPrefix))
  const contentType = await staticResourceContentType(descriptor)
  const isArchive = ['application/zip', 'application/x-zip-compressed', 'application/jar'].includes(contentType)
  const upserts = [entry(`${definition.directory}/${fullName}.${definition.suffix}-meta.xml`, descriptor.data)]

  if (isArchive && (existingExpanded || !existingContent.length)) {
    const archiveEntries = await unzipEntries(content.data)
    upserts.push(...archiveEntries.map(item => entry(`${expandedPrefix}${item.fileName}`, item.data)))
  } else {
    const existingFile = existingContent.find(fileName => !fileName.startsWith(expandedPrefix))
    const extension = mime.getExtension(contentType) || definition.suffix
    upserts.unshift(entry(existingFile || `${definition.directory}/${fullName}.${extension}`, content.data))
  }

  const deletes = existingExpanded
    ? [`${definition.directory}/${fullName}`]
    : existingContent.filter(fileName => !upserts.some(item => item.fileName === fileName))
  return { upserts, deletes }
}

const toSource = async (metadataEntries, options = {}, packageMapping) => {
  const requested = options.components && new Set(options.components.map(componentKey))
  const result = { upserts: [], deletes: [] }
  const staticResourceGroups = groupStaticResources(metadataEntries, packageMapping, 'metadata')
  const staticResourcePaths = new Set([...staticResourceGroups.values()]
    .flatMap(group => group.entries)
    .map(item => item.fileName))

  for (const group of staticResourceGroups.values()) {
    const staticResult = await decomposeStaticResource(group, options.existingFiles || [])
    result.upserts.push(...staticResult.upserts)
    result.deletes.push(...staticResult.deletes)
  }

  for (const metadataEntry of metadataEntries) {
    if (staticResourcePaths.has(metadataEntry.fileName)) continue
    const aggregateDefinition = findAggregateMetadataDefinition(metadataEntry.fileName)
    const partialAggregate = aggregateDefinition && options.components && options.components.some(component =>
      component.type === aggregateDefinition.children[0].type && component.fullName !== '*')
    if (partialAggregate) {
      const sourcePath = `${aggregateDefinition.directory}/CustomLabels.${aggregateDefinition.sourceSuffix}`
      const existingEntry = (options.existingEntries || []).find(item => item.fileName === sourcePath)
      result.upserts.push(await mergeAggregateMetadata(metadataEntry, aggregateDefinition, existingEntry))
      continue
    }
    const decomposedDefinition = findDecomposedMetadataDefinition(metadataEntry.fileName)
    if (decomposedDefinition) {
      const decomposedResult = await decomposeMetadata(metadataEntry, decomposedDefinition, requested)
      result.upserts.push(...decomposedResult.upserts)
      result.deletes.push(...decomposedResult.deletes)
      continue
    }

    result.upserts.push(toSourceSimple(metadataEntry) || toSourceGeneric(metadataEntry, packageMapping))
  }

  return result
}

const createAdapter = packageMapping => ({
  getCompanionPaths: (fileNames, availableFiles) => getCompanionPaths(fileNames, availableFiles, packageMapping),
  getMergePaths,
  getMetadataContainers,
  getPackageComponents,
  isMetadataPath: fileName => !!resolvePath(fileName, packageMapping),
  resolve: fileNames => resolve(fileNames, packageMapping),
  toMetadata: sourceEntries => toMetadata(sourceEntries, packageMapping),
  toSource: (metadataEntries, options) => toSource(metadataEntries, options, packageMapping)
})

const defaultAdapter = createAdapter()
defaultAdapter.create = createAdapter

module.exports = defaultAdapter
