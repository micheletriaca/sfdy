import {
  definePlugin,
  defineRenderer,
  type MutableFile,
  type ProjectFile
} from 'sfdy/plugin'

type ProjectConfig = {
  namespaces: string[]
}

definePlugin<ProjectConfig>({
  name: 'typed-plugin',
  stage: 'metadata',
  formats: ['metadata', 'sfdx'],

  enabled: ({ config, files }) =>
    config.namespaces.length > 0 && (!files || files.match('classes/**/*').length > 0),

  plan ({ selection, inventory, config }) {
    selection.include(inventory.match(config.namespaces.map(namespace => `CustomField/*.${namespace}__*`)))
  },

  async onDeploy ({ files, project, target, config, checkOnly }) {
    const stored: ProjectFile | undefined = project.get('profiles/Admin.profile-meta.xml')
    if (stored) {
      // Project files are intentionally read-only.
      // @ts-expect-error
      stored.writeText('invalid')
      const editable: MutableFile = files.include(stored)
      const profile = await editable.readXml<{ userPermissions?: Array<{ name: string[] }> }>()
      profile.userPermissions = (profile.userPermissions || [])
        .filter(permission => !config.namespaces.some(namespace => permission.name[0].startsWith(namespace)))
      await editable.writeXml(profile)
    }
    target.environment?.toUpperCase()
    checkOnly.valueOf()
  }
})

definePlugin({
  name: 'typed-salesforce-client',

  async run ({ salesforce, config }) {
    const users = await salesforce.query<{ Id: string }>('SELECT Id FROM User')
    users[0]?.Id.toUpperCase()
    config.projectSpecificValue
  }
})

defineRenderer({
  name: 'typed-renderer',
  formats: ['metadata'],

  resolveSelection ({ selection }) {
    selection.include('staticresources/App/**')
  },

  async onRetrieve ({ files, output }) {
    output.delete('generated/**')
    files.create({ path: 'generated/info.txt', contents: 'generated' })
  }
})
