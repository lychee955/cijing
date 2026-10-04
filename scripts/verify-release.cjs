const { readFileSync, statSync, createReadStream, writeFileSync } = require('node:fs')
const { resolve, join } = require('node:path')
const { createHash } = require('node:crypto')
const yaml = require('js-yaml')
const { version } = require('../package.json')
const { releaseConfig } = require('./release-config.cjs')
async function hash(path, algorithm, encoding) {
  const digest = createHash(algorithm)
  for await (const chunk of createReadStream(path)) digest.update(chunk)
  return digest.digest(encoding)
}
async function main() {
  if (!process.argv[2]) throw new Error('Pass the exact release output directory to verify.')
  const dir = resolve(process.argv[2])
  const config = releaseConfig(version)
  const installer = `cijing-${version}-win-x64-setup.exe`
  const names = [installer, `${installer}.blockmap`, `cijing-${version}-win-x64-portable.exe`, config.metadataFile]
  const info = yaml.load(readFileSync(join(dir, config.metadataFile), 'utf8'), { schema: yaml.JSON_SCHEMA })
  if (info.version !== version || info.files?.length !== 1 || info.path !== installer || info.files[0].url !== installer
    || info.packages !== undefined || info.stagingPercentage !== undefined) throw new Error('Metadata does not describe this Windows x64 NSIS release.')
  const manifest = []
  for (const name of names) {
    const path = join(dir, name), size = statSync(path).size
    if (!size) throw new Error(`Empty artifact: ${name}`)
    manifest.push({ name, size, sha256: await hash(path, 'sha256', 'hex') })
  }
  const sha512 = await hash(join(dir, installer), 'sha512', 'base64')
  if (info.files[0].size !== manifest[0].size || info.files[0].sha512 !== sha512 || info.sha512 !== sha512)
    throw new Error('Generated size or SHA-512 does not match the installer.')
  writeFileSync(join(dir, 'release-manifest.json'), JSON.stringify({ version, tag: `v${version}`, ...config, artifacts: manifest }, null, 2) + '\n')
  console.log(`Verified ${names.length} release artifacts in ${dir}. Upload only the files listed in release-manifest.json.`)
}
main().catch(error => { console.error(error.message); process.exitCode = 1 })
