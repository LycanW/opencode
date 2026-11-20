import { constants } from "node:fs"
import { access, opendir, stat } from "node:fs/promises"
import path from "node:path"
import { Shell } from "@opencode/schema/shell"

const limit = 100
const entryLimit = 20_000
const windows = process.platform === "win32"

function variable(env: NodeJS.ProcessEnv, key: string) {
  if (!windows) return env[key]
  const name = Object.keys(env).find((name) => name.toUpperCase() === key)
  return name === undefined ? undefined : env[name]
}

export async function listPathCommands(prefix: string, cwd: string, env: NodeJS.ProcessEnv, signal?: AbortSignal) {
  const value = variable(env, "PATH")
  if (value === undefined || !Shell.simpleCommandName.test(prefix)) return []
  const extensions = new Set(
    (variable(env, "PATHEXT") ?? ".COM;.EXE;.BAT;.CMD").toLowerCase().split(";").filter(Boolean),
  )
  const typedExtension = windows && extensions.has(path.extname(prefix).toLowerCase())
  const key = (name: string) => (windows ? name.toLowerCase() : name)
  const dirs = value
    .split(path.delimiter)
    .map((dir) => path.resolve(cwd, windows ? dir.replace(/^"(.*)"$/, "$1") : dir))
  const names = new Map<string, string>()
  const seen = new Set<string>()
  let scanned = 0
  for (const dir of dirs) {
    if (signal?.aborted) return []
    if (seen.has(key(dir))) continue
    if (seen.size === limit) break
    seen.add(key(dir))
    const entries = await opendir(dir).catch(() => undefined)
    if (!entries) continue
    // Stream directory entries rather than holding every PATH directory in memory.
    // A PATH directory may disappear between opening and reading it.
    try {
      for await (const entry of entries) {
        if (signal?.aborted) return []
        if (scanned++ === entryLimit) return [...names.values()].sort()
        if (!entry.isFile() && !entry.isSymbolicLink()) continue
        const ext = path.extname(entry.name)
        if (windows && !extensions.has(ext.toLowerCase())) continue
        const name = windows && !typedExtension ? entry.name.slice(0, -ext.length) : entry.name
        if (!Shell.simpleCommandName.test(name) || !key(name).startsWith(key(prefix)) || names.has(key(name))) continue
        const target = path.join(dir, entry.name)
        const info = await stat(target).catch(() => undefined)
        if (!info?.isFile()) continue
        if (
          !windows &&
          !(await access(target, constants.X_OK).then(
            () => true,
            () => false,
          ))
        )
          continue
        names.set(key(name), name)
        if (names.size >= limit) return [...names.values()].sort()
      }
    } catch {
      continue
    }
  }
  return [...names.values()].sort()
}
