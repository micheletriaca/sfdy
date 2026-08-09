const logger = require('../services/log-service')

const createLogger = () => ({
  debug: (...args) => logger.debug(...args),
  info: (...args) => logger.log(...args),
  warn: (...args) => logger.log(...args),
  error: (...args) => logger.log(...args)
})

const createBaseContext = ({
  direction,
  format,
  target = {},
  sfdcConnector,
  config = {}
}) => ({
  direction,
  format,
  target,
  salesforce: sfdcConnector,
  config,
  log: createLogger()
})

const executeHook = async (extension, hookName, context) => {
  if (!extension[hookName]) return
  try {
    await extension[hookName](context)
  } catch (error) {
    error.message = `Extension ${extension.name || '<anonymous>'} failed in ${hookName}: ${error.message}`
    throw error
  }
}

const appliesTo = (extension, { stage = 'project', format }) =>
  (extension.stage || 'project') === stage &&
  (!extension.formats || extension.formats.includes(format))

const planExtensions = async ({ extensions, selection, inventory, ...options }) => {
  const context = { ...createBaseContext(options), selection, inventory }
  for (const extension of extensions) {
    if (extension.formats && !extension.formats.includes(options.format)) continue
    await executeHook(extension, 'plan', context)
  }
}

const runExtensions = async ({ extensions, fileTree, ...options }) => {
  const context = {
    ...createBaseContext(options),
    files: fileTree.files,
    project: fileTree.project,
    disk: fileTree.disk,
    output: fileTree.output,
    checkOnly: !!options.checkOnly,
    destructive: !!options.destructive
  }
  for (const extension of extensions) {
    if (!appliesTo(extension, options)) continue
    await executeHook(extension, 'run', context)
    await executeHook(extension, options.direction === 'retrieve' ? 'onRetrieve' : 'onDeploy', context)
  }
}

const resolveSelections = async ({ extensions, selection, project, ...options }) => {
  const context = { ...createBaseContext(options), selection, project }
  for (const extension of extensions) {
    if (!appliesTo(extension, options)) continue
    await executeHook(extension, 'resolveSelection', context)
  }
}

module.exports = {
  planExtensions,
  runExtensions,
  resolveSelections
}
