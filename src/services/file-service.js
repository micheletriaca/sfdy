const pathService = require('./path-service')
const multimatch = require('multimatch')
const minimatch = require('minimatch')
const path = require('path')
const fs = require('fs')

module.exports = {
  readFiles (files, excludeGlob = []) {
    const rootFolder = pathService.getSrcFolder(true)
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
  },
  getDiffList (diffCfg, diffMask) {
    if (!diffCfg) return []
    const diff = require('child_process').spawnSync(
      'git',
      ['diff', '--name-only', '--diff-filter=d', diffCfg],
      { cwd: pathService.getBasePath() }
    )
    if (diff.status !== 0) throw Error(diff.stderr.toString('utf8'))
    const diffOutput = diff.stdout
      .toString('utf8')
      .split('\n')
      .filter(x => x.startsWith(pathService.getSrcFolder() + '/'))
      .map(x => x.replace(pathService.getSrcFolder() + '/', ''))
    return multimatch(diffOutput, diffMask || ['**/*'])
  }
}
