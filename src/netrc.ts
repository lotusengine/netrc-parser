import { execa, execaSync } from 'execa'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import { homedir, platform, tmpdir } from 'node:os'
import { extname, join } from 'node:path'

export function parse(body: string): Machines {
  const lines = body.split('\n')
  let pre: string[] = []
  const machines: MachineToken[] = []
  while (lines.length) {
    const line = lines.shift()!
    const match = line.match(/machine\s+((?:[^#\s]+[\s]*)+)(#.*)?$/)
    if (!match) {
      pre.push(line)
      continue
    }
    const [, body, comment] = match
    const b = body || ''
    const machine: MachineToken = {
      type: 'machine',
      host: b.split(' ')[0] || '',
      pre: pre.join('\n'),
      internalWhitespace: '\n  ',
      props: {},
      comment
    }
    pre = []
    // do not read other machines with same host
    if (!machines.find((m) => m.type === 'machine' && m.host === machine.host))
      machines.push(machine)
    if (b.trim().includes(' ')) {
      // inline machine
      const [host, ...propStrings] = b.split(' ')
      for (let a = 0; a < propStrings.length; a += 2) {
        machine.props[propStrings[a]!] = { value: propStrings[a + 1]! }
      }
      machine.host = String(host)
      machine.internalWhitespace = ' '
    } else {
      // multiline machine
      while (lines.length) {
        const line = lines.shift()!
        const match = line.match(/^(\s+)([\S]+)\s+([\S]+)(\s+#.*)?$/)
        if (!match) {
          lines.unshift(line)
          break
        }
        const [, ws, key, value, comment] = match
        if (key && value) {
          machine.props[key] = { value, comment }
          machine.internalWhitespace = `\n${ws}`
        }
      }
    }
  }
  return proxify([...machines, { type: 'other', content: pre.join('\n') }])
}
export class Netrc {
  file: string
  machines!: Machines

  constructor(file?: string) {
    this.file = file || this.defaultFile
  }

  async load() {
    const decryptFile = async (): Promise<string> => {
      const { exitCode, stdout } = await execa('gpg', this.gpgDecryptArgs, {
        stdio: [0, undefined, undefined]
      })
      if (exitCode !== 0) throw new Error(`gpg exited with code ${exitCode}`)
      return stdout
    }

    let body = ''
    if (extname(this.file) === '.gpg') {
      body = await decryptFile()
    } else {
      body = await new Promise<string>((resolve, reject) => {
        try {
          const data = readFile(this.file, { encoding: 'utf8' })
          resolve(data || '')
        } catch (err) {
          if (err instanceof Error && (err as any).code !== 'ENOENT')
            reject(err)

          resolve('')
        }
      })
    }
    this.machines = parse(body)
  }

  loadSync() {
    const decryptFile = (): string => {
      const { stdout, status } = execaSync('gpg', this.gpgDecryptArgs, {
        stdio: [0, undefined, undefined]
      }) as any
      if (status) throw new Error(`gpg exited with code ${status}`)
      return stdout
    }

    let body = ''
    if (extname(this.file) === '.gpg') {
      body = decryptFile()
    } else {
      try {
        body = readFileSync(this.file, 'utf8')
      } catch (err) {
        if (err instanceof Error && (err as any).code !== 'ENOENT') throw err
      }
    }

    this.machines = parse(body)
  }

  async save() {
    let body = this.output
    if (this.file.endsWith('.gpg')) {
      const { stdout, exitCode } = await execa('gpg', this.gpgEncryptArgs, {
        input: body,
        stdio: [undefined, undefined, undefined]
      })
      if (exitCode) throw new Error(`gpg exited with code ${exitCode}`)
      body = stdout
    }
    return writeFile(this.file, body, { mode: 0o600 })
  }

  saveSync() {
    let body = this.output
    if (this.file.endsWith('.gpg')) {
      const { stdout, code } = execaSync('gpg', this.gpgEncryptArgs, {
        input: body,
        stdio: [undefined, undefined, undefined]
      }) as any
      if (code) throw new Error(`gpg exited with code ${status}`)
      body = stdout
    }
    writeFileSync(this.file, body, { mode: 0o600 })
  }

  private get output(): string {
    const output: string[] = []
    for (const t of this.machines['_tokens'] as any as Token[]) {
      if (t.type === 'other') {
        output.push(t.content)
        continue
      }
      if (t.pre) output.push(t.pre + '\n')
      output.push(`machine ${t.host}`)
      const addProps = (t: MachineToken) => {
        const addProp = (k: string) =>
          output.push(
            `${t.internalWhitespace}${k} ${t.props[k]!.value}${
              t.props[k]!.comment || ''
            }`
          )
        // do login/password first
        if (t.props['login']) addProp('login')
        if (t.props['password']) addProp('password')
        for (const k of Object.keys(t.props).filter(
          (k) => !['login', 'password'].includes(k)
        )) {
          addProp(k)
        }
      }
      const addComment = (t: MachineToken) =>
        t.comment && output.push(' ' + t.comment)
      if (t.internalWhitespace.includes('\n')) {
        addComment(t)
        addProps(t)
        output.push('\n')
      } else {
        addProps(t)
        addComment(t)
        output.push('\n')
      }
    }
    return output.join('')
  }

  private get defaultFile(): string {
    const home =
      (platform() === 'win32' &&
        (process.env['HOME'] ||
          (process.env['HOMEDRIVE'] &&
            process.env['HOMEPATH'] &&
            join(process.env['HOMEDRIVE']!, process.env['HOMEPATH']!)) ||
          process.env['USERPROFILE'])) ||
      homedir() ||
      tmpdir()
    let file = join(home, platform() === 'win32' ? '_netrc' : '.netrc')
    return existsSync(file + '.gpg') ? (file += '.gpg') : file
  }

  private get gpgDecryptArgs() {
    const args = ['--batch', '--quiet', '--decrypt', this.file]
    return args
  }

  private get gpgEncryptArgs() {
    const args = ['-a', '--batch', '--default-recipient-self', '-e']
    return args
  }
}

export default new Netrc()

export type Token = MachineToken | { type: 'other'; content: string }
export type MachineToken = {
  type: 'machine'
  pre?: string
  host: string
  internalWhitespace: string
  props: { [key: string]: { value: string; comment?: string } }
  comment?: string
}

export type Machines = {
  [key: string]: {
    login?: string
    password?: string
    account?: string
    [key: string]: string | undefined
  }
}

// this is somewhat complicated but it takes the array of parsed tokens from parse()
// and it creates ES6 proxy objects to allow them to be easily modified by the consumer of this library
function proxify(tokens: Token[]): Machines {
  const proxifyProps = (t: MachineToken) =>
    new Proxy(t.props as any as { [key: string]: string }, {
      get(_, key: string) {
        if (key === 'host') return t.host
        if (typeof key !== 'string') return t.props[key]
        const prop = t.props[key]
        if (!prop) return
        return prop.value
      },
      set(_, key: string, value: string) {
        if (key === 'host') {
          t.host = value
        } else if (!value) {
          delete t.props[key]
        } else {
          t.props[key] = t.props[key] || (t.props[key] = { value: '' })
          t.props[key]!.value = value
        }
        return true
      }
    })
  const machineTokens = tokens.filter(
    (m): m is MachineToken => m.type === 'machine'
  )
  const machines = machineTokens.map(proxifyProps)
  const getWhitespace = () => {
    if (!machineTokens.length) return ' '
    return machineTokens[machineTokens.length - 1]!.internalWhitespace
  }
  const obj: Machines = {}
  obj['_tokens'] = tokens as any
  for (const m of machines) {
    if (m['host']) obj[m['host']] = m
  }
  return new Proxy(obj, {
    set(obj, host: string, props: { [key: string]: string }) {
      if (!props) {
        delete obj[host]
        const idx = tokens.findIndex(
          (m) => m.type === 'machine' && m.host === host
        )
        if (idx === -1) return true
        tokens.splice(idx, 1)
        return true
      }
      let machine = machines.find((m) => m['host'] === host)
      if (!machine) {
        const token: MachineToken = {
          type: 'machine',
          host,
          internalWhitespace: getWhitespace(),
          props: {}
        }
        tokens.push(token)
        machine = proxifyProps(token)
        machines.push(machine)
        obj[host] = machine
      }
      for (const [k, v] of Object.entries(props)) {
        machine[k] = v
      }
      return true
    },
    deleteProperty(obj, host: string) {
      delete obj[host]
      const idx = tokens.findIndex(
        (m) => m.type === 'machine' && m.host === host
      )
      if (idx === -1) return true
      tokens.splice(idx, 1)
      return true
    },
    ownKeys() {
      return machines.map((m) => m['host'] as string)
    }
  })
}
