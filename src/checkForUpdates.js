const chalk = require('chalk')
const useUnicode = require('has-unicode')()

function checkForUpdates(name, version, github) {
  // Don't display updates when running in a CI environment.
  const isCI = require('ci-info').isCI
  if (isCI) return

  // Nothing to do if already on latest version.
  const pkg = { name, version }
  let notifier = require('update-notifier')({ pkg, updateCheckInterval: 0 })
  if (!notifier.update || notifier.update.latest === pkg.version) return

  // Apply color to type of update (major/minor/patch).
  let type = notifier.update.type
  switch (type) {
    case 'major':
      type = chalk.red(type)
      break
    case 'minor':
      type = chalk.yellow(type)
      break
    case 'patch':
      type = chalk.green(type)
      break
  }

  // Display update message, if needed.
  const changelog = `${github}/releases/tag/v${notifier.update.latest}`
  notifier.notify({
    isGlobal: true,
    message: `New ${type} version of ${pkg.name} available! ${
      chalk.red(notifier.update.current)
    } ${useUnicode ? '→' : '->'} ${
      chalk.green(notifier.update.latest)
    }\n` +
    (changelog ?
    `${
      chalk.yellow('Changelog:')
    } ${
      chalk.cyan(changelog)
    }\n` : '') +
    `Run ${
      chalk.green(`npm install -g ${pkg.name}`)
    } to update!`
  })
}

module.exports = {
  checkForUpdates
}
