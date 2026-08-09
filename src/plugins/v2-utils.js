const transformXml = async (files, patterns, transform) => {
  for (const file of files.match(patterns)) {
    try {
      const xml = await file.readXml()
      await transform(xml, file)
      await file.writeXml(xml)
    } catch (error) {
      error.message = `Failed to transform ${file.path}: ${error.message}`
      throw error
    }
  }
}

module.exports = { transformXml }
