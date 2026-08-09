const readline = require('node:readline/promises')

const ask = async (question, { input = process.stdin, output = process.stdout } = {}) => {
  const prompt = readline.createInterface({ input, output })
  try {
    return await prompt.question(question)
  } finally {
    prompt.close()
  }
}

const confirm = async (question, options) => {
  const answer = (await ask(`${question} [Y/n] `, options)).trim().toLowerCase()
  return answer === '' || answer === 'y' || answer === 'yes'
}

const askRequired = async (question, {
  input = process.stdin,
  output = process.stdout,
  ask: prompt = ask
} = {}) => {
  while (true) {
    const answer = (await prompt(question, { input, output })).trim()
    if (answer) return answer
    output.write('A value is required.\n')
  }
}

module.exports = { ask, askRequired, confirm }
