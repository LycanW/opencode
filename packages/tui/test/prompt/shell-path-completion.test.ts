import { expect, test } from "bun:test"
import path from "node:path"
import {
  shellCommandOptions,
  shellCommonPrefix,
  shellPathOptions,
  shellPathQuery,
} from "../../src/prompt/shell-path-completion"

const directory = "/workspace"
const home = "/home/worker"

test("keeps shell-relative paths and targets the directory preceding the prefix", () => {
  const query = shellPathQuery("cat ./src/f", " another", directory, home)
  expect(query).toMatchObject({
    start: 4,
    directory: path.posix.join(directory, "src"),
    prefix: "./src/",
    query: "f",
    quoted: false,
  })
  if (!query) throw new Error("Expected path query")
  expect(
    shellPathOptions(
      [
        { path: "src/foo", type: "directory" },
        { path: "src/file.ts", type: "file" },
        { path: "src/other", type: "file" },
      ],
      query,
    ),
  ).toEqual([
    { display: "file.ts", value: "./src/file.ts" },
    { display: "foo/", value: "./src/foo/" },
  ])
})

test("completes files with spaces without interpreting shell syntax", () => {
  const query = shellPathQuery('cat "./my folder/fi', "", directory, home)
  expect(query?.directory).toBe(path.posix.join(directory, "my folder"))
  if (!query) throw new Error("Expected quoted path query")
  expect(
    shellPathOptions(
      [
        { path: "my folder/file name", type: "file" },
        { path: "my folder/file$other", type: "file" },
      ],
      query,
    ),
  ).toEqual([{ display: "file name", value: '"./my folder/file name"' }])
})

test("resolves an unquoted home prefix and ignores unsafe or mid-word input", () => {
  expect(shellPathQuery("cd ~/pr", "", directory, home)).toMatchObject({ directory: home, prefix: "~/", query: "pr" })
  expect(shellPathQuery("cat fo", "obar", directory, home)).toBeUndefined()
  for (const source of ["cat $VAR", "cat $(git", "cat ; foo", "cat foo\\ b", "cat\nfoo", 'cat "${VAR}']) {
    expect(shellPathQuery(source, "", directory, home)).toBeUndefined()
  }
})

test("does not turn a completed filename into an option", () => {
  const query = shellPathQuery("cat -n", "", directory, home)
  if (!query) throw new Error("Expected path query")
  expect(shellPathOptions([{ path: "-name", type: "file" }], query)).toEqual([{ display: "-name", value: "./-name" }])
})

test("parses forward-slash Windows paths without relying on the client OS", () => {
  const query = shellPathQuery("cd C:/Users/Rep", "", "D:/Work/project")
  expect(query?.directory).toBe("C:\\Users")
  if (!query) throw new Error("Expected path query")
  expect(shellPathOptions([{ path: "Users\\Report", type: "directory" }], query)).toEqual([
    { display: "Report/", value: "C:/Users/Report/" },
  ])
  expect(shellPathQuery("cd ~/x", "", "/remote/project")).toBeUndefined()
})

test("matches Windows backslash drive paths case-insensitively and preserves the listed casing", () => {
  const query = shellPathQuery(String.raw`cd C:\Users\rep`, "", String.raw`D:\Work\Project`)
  expect(query?.directory).toBe(String.raw`C:\Users`)
  if (!query) throw new Error("Expected Windows path query")
  expect(shellPathOptions([{ path: String.raw`..\Report`, type: "directory" }], query)).toEqual([
    { display: "Report\\", value: "C:\\Users\\Report\\" },
  ])
})

test("resolves Windows backslash relative paths and keeps the argument after the cursor", () => {
  const query = shellPathQuery(String.raw`cat .\src\fi`, " more", String.raw`C:\Work\Project`)
  expect(query).toMatchObject({ start: 4, directory: String.raw`C:\Work\Project\src`, query: "fi" })
  if (!query) throw new Error("Expected Windows path query")
  expect(shellPathOptions([{ path: String.raw`src\File.TXT`, type: "file" }], query)).toEqual([
    { display: "File.TXT", value: String.raw`.\src\File.TXT` },
  ])
})

test("quotes Windows backslash paths with spaces without leaving a backslash before the closing quote", () => {
  const query = shellPathQuery(String.raw`cd "C:\Program Files\rep`, "", String.raw`D:\Work\Project`)
  expect(query?.directory).toBe(String.raw`C:\Program Files`)
  if (!query) throw new Error("Expected quoted Windows path query")
  expect(shellPathOptions([{ path: "Report Folder", type: "directory" }], query)).toEqual([
    { display: "Report Folder\\", value: String.raw`"C:\Program Files\Report Folder"` },
  ])
})

test("uses the remote location's POSIX syntax and keeps Linux filename matching case-sensitive", () => {
  const query = shellPathQuery("cat ./src/re", "", "/remote/project")
  if (!query) throw new Error("Expected POSIX path query")
  expect(
    shellPathOptions(
      [
        { path: "src/Report.TXT", type: "file" },
        { path: "src/report.txt", type: "file" },
      ],
      query,
    ),
  ).toEqual([{ display: "report.txt", value: "./src/report.txt" }])
  expect(shellPathQuery(String.raw`cat .\src\re`, "", "/remote/project")).toBeUndefined()
})

test("validates returned command names with the execution location's case rules", () => {
  const names = ["Git", "gitk", "gizmo"]
  expect(shellCommandOptions(names, "gi", true)).toEqual([
    { display: "Git", value: "Git" },
    { display: "gitk", value: "gitk" },
    { display: "gizmo", value: "gizmo" },
  ])
  expect(shellCommandOptions(names, "gi", false)).toEqual([
    { display: "gitk", value: "gitk" },
    { display: "gizmo", value: "gizmo" },
  ])
})

test("does not enumerate explicitly entered network, device, or drive-relative paths", () => {
  const cwd = "D:/Work/Project"
  expect(shellPathQuery(String.raw`cd \\server\share\Rep`, "", cwd)).toBeUndefined()
  expect(shellPathQuery(String.raw`cd \\?\C:\Users\rep`, "", cwd)).toBeUndefined()
  expect(shellPathQuery("cd C:Users/re", "", cwd)).toBeUndefined()
})

test("extends only the common prefix and uses the executing platform's case rules", () => {
  expect(shellCommonPrefix("gi", ["git", "gitk"], false)).toBe("git")
  expect(shellCommonPrefix("gi", ["Git", "gitk"], false)).toBeUndefined()
  expect(shellCommonPrefix("GI", ["git", "Gitk"], true)).toBe("GIt")
  expect(shellCommonPrefix("git", ["git", "gitk"], false)).toBeUndefined()
  expect(shellCommonPrefix("name", ["name𠀀1", "name𠀁2"], false)).toBeUndefined()
})

test("preserves a valid token while previewing spaces or Windows backslashes", () => {
  expect(shellCommonPrefix("re", ['"report one.txt"', '"report two.txt"'], false)).toBe('"report "')
  expect(shellCommonPrefix('"./my folder/re', ['"./my folder/report A"', '"./my folder/report B"'], false)).toBe(
    '"./my folder/report "',
  )
  expect(
    shellCommonPrefix(
      String.raw`"C:\Program Files\re`,
      [String.raw`"C:\Program Files\Report A"`, String.raw`"C:\Program Files\Report B"`],
      true,
    ),
  ).toBe(String.raw`"C:\Program Files\report "`)
  expect(shellCommonPrefix(String.raw`"C:\X`, [String.raw`"C:\X\a"`, String.raw`"C:\X\b"`], true)).toBeUndefined()
  expect(shellCommonPrefix("-", ["./-one", "./-other"], false)).toBeUndefined()
})
