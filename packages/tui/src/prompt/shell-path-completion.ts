import path from "node:path"
import type { FileSystemEntry } from "@opencode/client"
import { Shell } from "@opencode/schema/shell"

const barePosix = /^[\p{L}\p{M}\p{N}_./~:+-]*$/u
const filename = /^[\p{L}\p{M}\p{N}_ .:+-]+$/u
const posixWords =
  /^(?:"[\p{L}\p{M}\p{N}_ ./~:+-]*"|[\p{L}\p{M}\p{N}_./~:+-]+)(?:[ \t]+(?:"[\p{L}\p{M}\p{N}_ ./~:+-]*"|[\p{L}\p{M}\p{N}_./~:+-]+))*$/u

export function isWindowsShellLocation(directory: string) {
  // The location is supplied by the execution server, not the TUI host.
  return /^(?:[a-z]:[\\/]|[\\]{2}[^\\/]+[\\/][^\\/]+)/i.test(directory)
}

function pathSyntax(value: string, windows: boolean) {
  return windows ? value.replaceAll("\\", "/") : value
}

function matchesPrefix(value: string, prefix: string, windows: boolean) {
  return windows ? value.toLowerCase().startsWith(prefix.toLowerCase()) : value.startsWith(prefix)
}

export function shellCommandPrefix(before: string, after: string) {
  if (after && !/^[ \t]/.test(after)) return
  const prefix = before.replace(/^[ \t]+/, "")
  if (!Shell.simpleCommandName.test(prefix)) return
  return { prefix, start: before.length - prefix.length }
}

export function shellCommandOptions(names: readonly string[], prefix: string, windows: boolean) {
  return [...new Set(names)]
    .filter((name) => Shell.simpleCommandName.test(name) && matchesPrefix(name, prefix, windows))
    .slice(0, 100)
    .map((name) => ({ display: name, value: name }))
}

/** Extend only the part all candidates share, retaining the input's spelling and safe quoting. */
export function shellCommonPrefix(token: string, values: readonly string[], windows: boolean) {
  if (values.length < 2) return
  const unquote = (value: string) => (value.startsWith('"') ? value.slice(1).replace(/"$/, "") : value)
  const original = unquote(token)
  const shared = Array.from(unquote(values[0]))
  const equal = (a: string, b: string) => (windows ? a.toLowerCase() === b.toLowerCase() : a === b)
  const length = values.slice(1).reduce((length, value) => {
    const candidate = Array.from(unquote(value))
    const difference = shared
      .slice(0, Math.min(length, candidate.length))
      .findIndex((part, i) => !equal(part, candidate[i]))
    return difference < 0 ? Math.min(length, candidate.length) : difference
  }, shared.length)
  const entered = Array.from(original)
  if (length <= entered.length || entered.some((part, i) => !equal(part, shared[i]))) return
  const extended = original + shared.slice(entered.length, length).join("")
  const quoted = token.startsWith('"') || extended.includes(" ")
  if (!quoted) return extended
  if (extended.startsWith("~")) return
  // An odd number of final backslashes would escape the quote in native Windows arguments.
  if (windows && extended.endsWith("\\")) return
  return '"' + extended + '"'
}

export function shellPathQuery(before: string, after: string, directory: string, home?: string) {
  // Only complete simple shell words. Leave operators, expansions and incomplete
  // escapes unchanged rather than interpreting or running the command line.
  if (/[\r\n]/.test(before) || (after && !/^[ \t]/.test(after))) return
  const token = before.match(/(?:^|[ \t])((?:"[^"\r\n]*"?|[^ \t"\r\n]*))$/)?.[1]
  if (token === undefined) return
  const quoted = token.startsWith('"')
  const value = quoted ? token.slice(1).replace(/"$/, "") : token
  const windows = isWindowsShellLocation(directory)
  if (!barePosix.test(pathSyntax(quoted ? value.replaceAll(" ", "") : value, windows))) return
  if (quoted && value.startsWith("~")) return
  // Do not enumerate an explicit network share, a device path, or a drive-relative token.
  if (windows && (/^[\\/]{2}/.test(value) || /^[a-z]:(?![\\/])/i.test(value))) return
  const start = before.length - token.length
  const previous = before.slice(0, start).trim()
  if (previous && !posixWords.test(pathSyntax(previous, windows))) return

  const separatorIndex = windows ? Math.max(value.lastIndexOf("/"), value.lastIndexOf("\\")) : value.lastIndexOf("/")
  const separator = separatorIndex < 0 ? (windows ? "\\" : "/") : value[separatorIndex]
  const prefix = value === "~" ? "~" + separator : value.slice(0, separatorIndex + 1)
  const query = value === "~" ? "" : value.slice(separatorIndex + 1)
  const fromHome = prefix.startsWith("~/") || (windows && prefix.startsWith("~\\"))
  const root = fromHome ? home : directory
  if (!root) return
  const pathStyle = windows ? path.win32 : path.posix
  return {
    start,
    directory: pathStyle.resolve(root, fromHome ? prefix.slice(2) : prefix),
    prefix,
    query,
    quoted,
    windows,
    separator,
  }
}

export function shellPathOptions(
  entries: readonly FileSystemEntry[],
  search: NonNullable<ReturnType<typeof shellPathQuery>>,
) {
  const pathStyle = search.windows ? path.win32 : path.posix
  return entries
    .flatMap((entry) => {
      const name = pathStyle.basename(entry.path)
      if (!filename.test(name) || (search.windows && name.includes(":"))) return []
      if (!matchesPrefix(name, search.query, search.windows)) return []
      if (search.query === "" && name.startsWith(".")) return []
      const isDirectory = entry.type === "directory"
      const display = name + (isDirectory ? search.separator : "")
      const base = (search.prefix || (name.startsWith("-") ? "." + search.separator : "")) + name
      const quoted = search.quoted || base.includes(" ")
      if (quoted && base.startsWith("~")) return []
      // A trailing backslash directly before a closing double quote can escape it
      // when Windows passes the argument to a native program.
      const suffix = isDirectory && !(quoted && search.separator === "\\") ? search.separator : ""
      return [{ display, value: quoted ? '"' + base + suffix + '"' : base + suffix }]
    })
    .sort((a, b) => a.display.localeCompare(b.display))
}
