const { FileTree } = require('./file-tree')
const { FileSelection, MetadataCollection, MetadataSelection } = require('./selection')

const API_VERSION = 2

const definePlugin = plugin => ({ ...plugin, apiVersion: API_VERSION })
const defineRenderer = renderer => ({ ...renderer, apiVersion: API_VERSION })
const isV2Extension = extension => !!extension && extension.apiVersion === API_VERSION

module.exports = {
  API_VERSION,
  FileTree,
  FileSelection,
  MetadataCollection,
  MetadataSelection,
  definePlugin,
  defineRenderer,
  isV2Extension
}
