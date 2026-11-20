import { expect, test } from "bun:test"
import { chmod, mkdir, symlink, writeFile } from "node:fs/promises"
import path from "node:path"
import { Effect } from "effect"
import { listPathCommands } from "../src/shell/completion"
import { SessionShell } from "../src/session/shell"
import { Location } from "../src/location"
import { AbsolutePath } from "../src/schema"
import { Workspace } from "@opencode/schema/workspace"
import { Project } from "@opencode/schema/project"
import { tmpdir } from "./fixture/tmpdir"

const windows = process.platform === "win32"
const extension = windows ? ".exe" : ""

test("enumerates executable names on captured PATH without launching them", async () => {
  await using fixture = await tmpdir()
  const bin = path.join(fixture.path, "bin")
  const other = path.join(fixture.path, "other")
  await mkdir(bin)
  await mkdir(other)
  const candidate = async (directory: string, name: string, executable = true) => {
    const file = path.join(directory, name + (executable ? extension : ""))
    await writeFile(file, "not a runnable binary")
    if (!windows) await chmod(file, executable ? 0o755 : 0o644)
    return file
  }
  const target = await candidate(bin, "git")
  await candidate(other, "git")
  await candidate(other, "gitk")
  await candidate(bin, "gibberish", false)
  await candidate(bin, "git;unsafe")
  await mkdir(path.join(bin, "gitdirectory" + extension))
  if (!windows) await symlink(target, path.join(bin, "git-link"))
  const env = { PATH: ["missing", "bin", "other", "bin"].join(path.delimiter), PATHEXT: ".EXE" }
  expect(await listPathCommands("gi", fixture.path, env)).toEqual(
    windows ? ["git", "gitk"] : ["git", "git-link", "gitk"],
  )
  expect(await listPathCommands("GI", fixture.path, env)).toEqual(windows ? ["git", "gitk"] : [])
  expect(await listPathCommands("gi", fixture.path, {})).toEqual([])
  expect(await listPathCommands("$(git", fixture.path, env)).toEqual([])
})

test("does not use local or captured PATH for a remote workspace", async () => {
  await using fixture = await tmpdir()
  const file = path.join(fixture.path, "git" + extension)
  await writeFile(file, "not a runnable binary")
  if (!windows) await chmod(file, 0o755)
  const directory = AbsolutePath.make(fixture.path)
  const location = { directory, project: { id: Project.ID.make("test"), directory, canonical: directory } }
  const env = { PATH: fixture.path, PATHEXT: ".EXE" }
  expect(
    await Effect.runPromise(SessionShell.complete("gi", env).pipe(Effect.provideService(Location.Service, location))),
  ).toEqual(["git"])
  expect(
    await Effect.runPromise(
      SessionShell.complete("gi", env).pipe(
        Effect.provideService(Location.Service, { ...location, workspaceID: Workspace.ID.ascending() }),
      ),
    ),
  ).toEqual([])
})
