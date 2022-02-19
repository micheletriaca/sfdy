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
  }
}
