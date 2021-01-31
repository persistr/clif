const colors = require('colors')
const columnify = require('columnify')
const { EventEmitter } = require('events')
const path = require('path')
const getOpts = require('get-options')
const { checkForUpdates } = require('./checkForUpdates')
const { vsprintf } = require('printj')
const prompts = require('prompts')

let log = (msg) => {
  process.stdout.write(msg)
}

let config = {
  console: {
    log: (fmt, ...args) => {
      if (!fmt) fmt = ''
      const msg = vsprintf.call(null, `${fmt}\n`, args)
      log(msg)
    }
  },
  manifest: {},
  toolbox: {}
}

class CLI extends EventEmitter {
  constructor(pkgname, execname) {
    super()
    this.prerun = []
    this.postrun = []
    config.pkgname = pkgname
    config.execname = execname
  }

  plugins(plugins) {
    for (const plugin of plugins) {
      const hooks = plugin.initialize(config.toolbox)
      if (hooks && hooks.prerun) Array.isArray(hooks.prerun) ? this.prerun.push(...hooks.prerun) : this.prerun.push(hooks.prerun)
      if (hooks && hooks.postrun) Array.isArray(hooks.postrun) ? this.prerun.push(...hooks.postrun) : this.postrun.push(hooks.postrun)
    }
    return this
  }

  output(cb) {
    log = cb
    return this
  }

  version(version, options) {
    config.version = version
    return this
  }

  description(description) {
    config.description = description
    return this
  }

  commands(manifest) {
    if (!manifest) manifest = {}
    config.manifest = manifest
    return this
  }

  done() {
    return this
  }

  checkForUpdates() {
    checkForUpdates(config.pkgname, config.version)
    return this
  }

  async run(argv) {
    // Display help.
    if (!argv) argv = process.argv.slice(2)
    if (!argv || argv.length <= 0) return help()
    if (argv.length === 1 && argv[0] === 'help') return help()
    if (argv.length === 2 && argv[0] === 'help') return help(argv[1])

    // Parse command.
    const command = argv[0].endsWith(':') ? argv[0].slice(0, -1) : argv[0]
    const cmd = config.manifest[command]

    try {
      // If command is unknown or not executable, display help.
      if (!cmd) throw new Error(`Unknown command "${command}"`)
      if (!cmd.run) return help(command)

      // Parse command-line options.
      const manifest = {}
      for (const { name, short, long, type, required } of config.manifest[command]?.options ?? []) {
        let options = []
        if (short) options.push(`-${short}`)
        if (long) options.push(`-${long}`)
        manifest[options.join(', ')] = (type && type === 'string') ? `${name}` : ''
      }
      const result = getOpts(argv, manifest)

      // Collect command options.
      const opts = {}
      for (const { name, short, long, required } of config.manifest[command]?.options ?? []) {
        if (result.options[short]) opts[name] = result.options[short]
        else if (result.options[long]) opts[name] = result.options[long]
        if (required && !opts[name]) throw new Error(`Missing required option "-${short} ${name}, --${long}=${name}"`)
      }

      // Collect command arguments.
      const args = {}
      let i = 1
      for (const [ arg, value ] of Object.entries(config.manifest[command]?.args ?? {})) {
        if (i < result.argv.length) args[arg] = result.argv[i++]
        const optional = value?.optional
        if (!optional && !args[arg]) throw new Error(`Missing required parameter "${arg}"`)
        value?.validate(args[arg])
      }

      // Run the command.
      const toolbox = { colors, log: config.console.log, prompts, ...config.toolbox }
      const params = { ...opts, ...args }
      for (let prerun of this.prerun) await prerun(toolbox, cmd, params)
      await cmd.run(toolbox, params)
      for (let postrun of this.postrun) await postrun(toolbox, cmd, params)
    }
    catch (error) {
      // Display help page for the command.
      if (cmd) {
        help(command)
      }

      // Display error message.
      config.console.log('%s %s', 'ERROR:'.brightRed, error.message)
    }
  }
}

/**
 * Help sections include:
 *   version
 *   usage
 *   arguments
 *   options
 *   description
 *   example or examples
 *   commands
 */
function help(command) {
  // Show info about CLI.
  if (!command) {
    config.console.log(config.description)
    config.console.log()
  }

  // Display CLI version.
  if (!command) {
    config.console.log('VERSION'.bold)
    config.console.log(`  ${config.pkgname}@${config.version} ${process?.platform}-${process?.arch} ${process?.release?.name}-${process?.version}`)
    config.console.log()
  }

  // Show command usage.
  usage(command)
}

function usage(command) {
  const cmd = config.manifest[command]
  if (command && !cmd) throw new Error(`Unknown command "${command}"`)

  const subcommands = Object.entries(config.manifest)
    .filter(([ cmd, value ]) => {
      if (command && `${cmd}`.startsWith(`${command}:`)) return true
      return false
    })
    .map(([ cmd, value ]) => {
      return { cmd, desc: value?.summary ?? value }
    })

  // Show info about the command.
  if (command) {
    const summary = config.manifest[command]?.summary ?? config.manifest[command] ?? ''
    if (summary) {
      config.console.log(summary)
      config.console.log()
    }
  }

  const options = config.manifest[command]?.options
  const args = config.manifest[command]?.args
  const examples = config.manifest[command]?.examples

  if (cmd) {
    config.console.log('USAGE'.bold)
    let usage = `  $ ${execname()} `
    if (command) {
      usage += `${command}`
      if (subcommands.length > 0) usage += `:COMMAND`
      if (options) usage += options.some(option => option.required) ? ' OPTIONS' : ' [OPTIONS]'
      if (args) usage += ' ' + Object.keys(args).map(key => args[key].optional ? `[${key}]` : key).join(' ')
    }
    else {
      usage += `COMMAND`
    }
    config.console.log(`${usage}\n`)
  }

  if (options) {
    config.console.log('OPTIONS'.bold)
    const params = options
      .map(({ name, short, long, description, type, required }) => {
        if (!type) type = 'bool'
        if (type === 'bool') return { option: `-${short}, --${long}`, desc: `${required ? '(required)'.grey : '(optional)'.grey} ${description}` }
        return { option: `-${short} ${name}, --${long}=${name}`, desc: `${required ? '(required)'.grey : '(optional)'.grey} ${description}` }
      })
    const descriptions = columnify(params, {
      columns: ['_', 'option', 'desc'],
      columnSplitter: '  ',
      showHeaders: false
    })
    config.console.log(descriptions)
    config.console.log()
  }

  if (args) {
    config.console.log('PARAMETERS'.bold)
    const params = Object.entries(args)
      .map(([ param, value ]) => {
        return { param, desc: value?.description ?? value, optional: value?.optional }
      })
      .map(({ param, desc, optional }) => {
        return { param, desc: `${optional ? '(optional)'.grey : '(required)'.grey} ${desc}` }
      })
    const descriptions = columnify(params, {
      columns: ['_', 'param', 'desc'],
      columnSplitter: '  ',
      showHeaders: false
    })
    config.console.log(descriptions)
    config.console.log()
  }

  if (config.manifest[command]?.description) {
    config.console.log('DESCRIPTION'.bold)
    config.console.log(config.manifest[command]?.description.trim().replace(/^[ \f\t\v\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]*/gm, '  '))
    config.console.log()
  }

  if (examples) {
    config.console.log('EXAMPLES'.bold)
    config.console.log(examples.map(example => '  ' + example).join('\n'))
    config.console.log()
  }

  if (command && subcommands.length > 0 || !command) {
    config.console.log('COMMANDS'.bold)
    const commands = Object.entries(config.manifest)
      .filter(([ cmd, value ]) => {
        if (command && `${cmd}`.startsWith(`${command}:`)) return true
        if (!command && !`${cmd}`.includes(':')) return true
        return false
      })
      .map(([ cmd, value ]) => {
        return { cmd, desc: value?.summary ?? value }
      })
    const descriptions = columnify(commands, {
      columns: ['_', 'cmd', 'desc'],
      columnSplitter: '  ',
      showHeaders: false
    })
    config.console.log(descriptions)
    config.console.log()
  }
}

function execname() {
  if (config.execname) return config.execname
  const file = process.argv.slice(1).shift()
  return path.parse(file).name
}

module.exports = { build: (pkgname, execname) => { return new CLI(pkgname, execname) }}

// In browsers, install a global object.
const isBrowser = typeof window !== 'undefined' && ({}).toString.call(window) === '[object Window]'
if (isBrowser) {
  global.clif = module.exports
}
