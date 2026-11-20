import { expect } from "bun:test"
import { mkdir, writeFile } from "node:fs/promises"
import path from "node:path"
import { Session } from "@opencode/schema/session"
import { Effect, Schema } from "effect"
import { tmpdirScoped } from "../../core/test/fixture/tmpdir"
import { it } from "../../core/test/lib/effect"
import { ServerFetch } from "../src/fetch"

const SessionResponse = Schema.Struct({ data: Schema.toEncoded(Session.Info) })

it.live("lists command names from the session environment and rejects non-name prefixes", () =>
  Effect.gen(function* () {
    const tmp = yield* tmpdirScoped()
    const bin = path.join(tmp.path, "bin")
    const suffix = process.platform === "win32" ? ".exe" : ""
    yield* Effect.promise(async () => {
      await mkdir(bin)
      await writeFile(path.join(bin, "git" + suffix), "", { mode: 0o755 })
      await writeFile(path.join(bin, "gitk" + suffix), "", { mode: 0o755 })
      await writeFile(path.join(bin, "other" + suffix), "", { mode: 0o755 })
    })

    const handler = yield* ServerFetch.make({
      app: { version: "test" },
      database: { path: ":memory:" },
      fs: { filewatcher: false },
      models: { fetch: false },
    })
    const request = (route: string, method = "GET", body?: unknown) =>
      Effect.promise(() =>
        handler(
          new Request(`http://opencode.local${route}`, {
            method,
            headers: { "content-type": "application/json" },
            body: body === undefined ? undefined : JSON.stringify(body),
          }),
        ),
      )
    const created = yield* request("/api/session", "POST", { location: { directory: tmp.path } })
    expect(created.status).toBe(200)
    const { data: session } = Schema.decodeUnknownSync(SessionResponse)(yield* Effect.promise(() => created.json()))
    const environment = yield* request(`/api/session/${session.id}/environment`, "PUT", {
      variables: { PATH: bin, PATHEXT: ".EXE" },
    })
    expect(environment.status).toBe(204)

    const endpoint = `/api/experimental/session/${session.id}/shell/completions`
    const completed = yield* request(endpoint + "?prefix=gi")
    expect(completed.status).toBe(200)
    expect(yield* Effect.promise(() => completed.json())).toEqual({ data: ["git", "gitk"] })

    const invalid = yield* request(endpoint + "?prefix=" + encodeURIComponent("./gi"))
    expect(invalid.status).toBe(400)
  }).pipe(Effect.scoped),
)
