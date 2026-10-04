const { valid, prerelease } = require('semver')

function releaseConfig(version) {
  if (valid(version) !== version) throw new Error('Release version must be a valid semantic version.')
  const preview = prerelease(version)
  if (preview && !/^snapshot\.\d{8}\.[1-9]\d*$/.test(preview.join('.')))
    throw new Error('Only stable versions and snapshot.YYYYMMDD.N prereleases are supported.')
  const channel = preview ? 'snapshot' : 'latest'
  return { channel, metadataFile: `${channel}.yml`, prerelease: Boolean(preview) }
}

module.exports = { releaseConfig }
