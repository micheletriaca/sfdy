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
  parseGlobPatterns (patternString) {
    let hasPar = false
    const res = []
    let item = ''
    for (let i = 0, len = patternString.length; i < len; i++) {
      if (patternString[i] === '{') hasPar = true
      if (patternString[i] === '}') hasPar = false
      if (patternString[i] !== ',' || hasPar) item += patternString[i]
      else if (!hasPar) {
        res.push(item)
        item = ''
      }
    }
    if (item) res.push(item)
    return res.map(x => x.trim())
  }
}
