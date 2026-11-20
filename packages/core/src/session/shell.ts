export * as SessionShell from "./shell.js"

import type { Session } from "@opencode/schema/session"
import { Effect } from "effect"
import { Instance } from "../instance/service.js"
import { Plugin } from "../plugin/service.js"
import { Shell } from "../shell.js"
import { ShellResult } from "../shell/result.js"
import { listPathCommands } from "../shell/completion.js"
import { SessionEnvironment } from "./environment.js"
import { Location } from "../location.js"

export const complete = Effect.fn("SessionShell.complete")(function* (
  prefix: string,
  captured?: SessionEnvironment.Variables,
) {
  const location = yield* Location.Service
  // Workspace commands inherit their worker's own environment. Do not substitute the host PATH.
  if (location.workspaceID !== undefined) return []
  const env = SessionEnvironment.localVariables(captured)
  return yield* Effect.promise((signal) => listPathCommands(prefix, location.directory, env, signal)).pipe(
    Effect.timeoutOrElse({ duration: "2 seconds", orElse: () => Effect.succeed([]) }),
  )
})

export const start = Effect.fn("SessionShell.start")(function* (input: { session: Session.Info; command: string }) {
  const instances = yield* Instance.Service
  const shell = yield* Plugin.awaitActivation.pipe(Effect.andThen(Shell.Service), instances.provide(input.session))
  const info = yield* shell.create({
    command: input.command,
    cwd: input.session.location.directory,
    timeout: 0,
    metadata: { sessionID: input.session.id, background: true },
  })
  // Keep completion tied to the original shell even if the Session moves.
  return {
    info,
    result: shell.result(info),
    output: shell
      .output(info.id, { limit: 1024 * 1024 })
      .pipe(Effect.catchTag("Shell.NotFoundError", () => Effect.succeed(ShellResult.unavailable))),
  }
})
