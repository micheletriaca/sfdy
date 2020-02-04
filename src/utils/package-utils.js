const fs = require('fs')
const { parseXml } = require('./xml-utils')
const path = require('path')

const PACKAGE_PATH = path.resolve(process.cwd(), 'src', 'package.xml')

module.exports = {
  getMembersOf: async pkgName => {
    const packageJson = await parseXml(fs.readFileSync(PACKAGE_PATH))
    const block = packageJson.Package.types.find(x => x.name[0] === pkgName)
    return !block ? [] : block.members
  }
}
