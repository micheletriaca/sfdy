module.exports = async (fJson, config) => {
  if (!config.stripManagedPackageFields) return true

  if (fJson.CustomObject.fields) {
    fJson.CustomObject.fields = fJson.CustomObject.fields.filter(x => {
      return !config.stripManagedPackageFields.some(mp => {
        return new RegExp(`${mp}__.*`).test(x.fullName[0])
      })
    })
  }

  if (fJson.CustomObject.recordTypes) {
    fJson.CustomObject.recordTypes.forEach(v => {
      if (!v.picklistValues) return
      v.picklistValues = v.picklistValues.filter(x => {
        return !config.stripManagedPackageFields.some(mp => {
          return new RegExp(`${mp}__.*`).test(x.picklist[0])
        })
      })
    })
  }

  if (fJson.CustomObject.webLinks) {
    fJson.CustomObject.webLinks = fJson.CustomObject.webLinks.filter(x => {
      return !config.stripManagedPackageFields.some(mp => {
        return new RegExp(`${mp}__.*`).test(x.fullName[0])
      })
    })
  }
}
