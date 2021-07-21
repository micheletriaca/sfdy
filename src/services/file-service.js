const fs = require('fs')
const path = require('path')
const minimatch = require('minimatch')

module.exports = {
  readFiles (rootFolder, files, excludeGlob = []) {
    return files
      .filter(f => fs.existsSync(path.join(rootFolder, f)))
      .filter(f => excludeGlob.every(gl => !minimatch(f, gl)))
      .map(f => ({
        fileName: f,
        data: fs.readFileSync(path.join(rootFolder, f))
      }))
  },
  readAllFilesInFolder (rootFolder, folder) {
    const realPath = path.join(rootFolder, folder || '')
    return fs.readdirSync(realPath).flatMap(file => {
      const fRelativePath = path.join(folder || '', file)
      const fAbsolutePath = path.join(rootFolder, fRelativePath)
      if (fs.lstatSync(fAbsolutePath).isDirectory()) {
        return module.exports.readAllFilesInFolder(rootFolder, fRelativePath)
      } else {
        return {
          fileName: fRelativePath,
          data: fs.readFileSync(fAbsolutePath)
        }
      }
    })
  }
}
