const fs = require('fs')
const path = require('path')
const globby = require('globby')

const assertInsideRoot = (root, filePath) => {
  const target = path.resolve(root, filePath)
  const relative = path.relative(root, target)
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`Refusing to access a path outside the source folder: ${filePath}`)
  }
  return target
}

const readProjectEntries = async root => {
  const fileNames = await globby(['**/*'], { cwd: root })
  return fileNames.map(fileName => ({
    fileName,
    loadData: () => fs.readFileSync(assertInsideRoot(root, fileName))
  }))
}

const writeProjectEntries = async (root, entries, deletedPaths = []) => {
  await Promise.all(deletedPaths.map(filePath =>
    fs.promises.rm(assertInsideRoot(root, filePath), { recursive: true, force: true })))
  await Promise.all(entries.map(async entry => {
    const target = assertInsideRoot(root, entry.fileName)
    await fs.promises.mkdir(path.dirname(target), { recursive: true })
    await fs.promises.writeFile(target, entry.data)
  }))
}

module.exports = {
  readProjectEntries,
  writeProjectEntries
}
