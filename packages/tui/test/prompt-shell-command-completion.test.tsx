import { expect, test } from "bun:test"
import { createAppFixture } from "./fixture/app"
import { agent, model, session } from "./fixture/local"
import { directory, json, worktree } from "./fixture/tui-client"

async function commandCompletionFixture(candidates: readonly string[]) {
  const sessionID = `ses_shell_completion_${crypto.randomUUID()}`
  const location = { directory, project: { id: "proj_test", directory: worktree, canonical: worktree } }
  const commandQueries: URL[] = []
  const pathQueries: URL[] = []
  const submitted: URL[] = []
  const setup = await createAppFixture({
    args: { sessionID },
    fetch: (url, request) => {
      if (url.pathname === "/api/agent") return json({ location, data: [agent("build"), agent("plan")] })
      if (url.pathname === "/api/model") return json({ location, data: [model("Completion Model")] })
      if (url.pathname === `/api/session/${sessionID}`) return json({ data: session(sessionID) })
      if (url.pathname.endsWith("/message") || url.pathname.endsWith("/inbox")) return json({ data: [], cursor: {} })
      if (url.pathname === `/api/experimental/session/${sessionID}/shell/completions`) {
        expect(request.method).toBe("GET")
        commandQueries.push(url)
        return json({ data: candidates })
      }
      if (request.method === "POST" && url.pathname === `/api/session/${sessionID}/shell`) {
        submitted.push(url)
        return json({ message: "Unexpected shell submission" }, { status: 400 })
      }
      if (url.pathname !== "/api/fs/list" || url.searchParams.get("path") !== directory) return
      pathQueries.push(url)
      return json({ location, data: [{ path: "gift.txt", type: "file" }] })
    },
  })
  await setup.ready
  await setup.waitForFrame((frame) => frame.includes("Completion Model"))
  return { setup, commandQueries, pathQueries, submitted, text: () => setup.renderer.currentFocusedEditor?.plainText }
}

test("shell Tab completes the command name before an existing argument without submitting it", async () => {
  const { setup, commandQueries, pathQueries, submitted, text } = await commandCompletionFixture(["git"])
  await using _ = setup
  setup.mockInput.pressKey("!")
  await setup.mockInput.typeText("gi log")
  for (let i = 0; i < " log".length; i++) setup.mockInput.pressArrow("left")
  setup.mockInput.pressTab()
  await setup.waitFor(() => text() === "git log")
  expect(commandQueries.map((url) => url.searchParams.get("prefix"))).toEqual(["gi"])
  expect(pathQueries).toHaveLength(0)
  expect(submitted).toEqual([])
})

test.each([
  ["forward after wrap", [false, false, false, false], "git-beta"],
  ["backward from the first item wraps", [true], "git-zeta"],
] as const)("shell pager Tab navigation %s", async (_mode, keys, selected) => {
  const { setup, commandQueries, pathQueries, submitted, text } = await commandCompletionFixture([
    "git-alpha",
    "git-beta",
    "git-zeta",
  ])
  await using _ = setup
  setup.mockInput.pressKey("!")
  await setup.mockInput.typeText("gi log")
  for (let i = 0; i < " log".length; i++) setup.mockInput.pressArrow("left")

  setup.mockInput.pressTab()
  await setup.waitForFrame((frame) => frame.includes("git-zeta"))
  expect(text()).toBe("git- log")
  expect(setup.renderer.currentFocusedEditor?.cursorOffset).toBe("git-".length)
  for (const shift of keys) {
    setup.mockInput.pressTab({ shift })
    await setup.renderOnce()
    expect(text()).toBe("git- log")
  }

  setup.mockInput.pressEnter()
  await setup.waitFor(() => text() === selected + " log")
  await setup.waitForFrame((frame) => !frame.includes("git-alpha"))
  expect(setup.renderer.currentFocusedEditor?.cursorOffset).toBe(selected.length)
  expect(commandQueries.map((url) => url.searchParams.get("prefix"))).toEqual(["gi"])
  expect(pathQueries).toHaveLength(0)
  expect(submitted).toEqual([])
})

test("Escape restores the original shell token before a second Escape exits shell mode", async () => {
  const { setup, commandQueries, pathQueries, submitted, text } = await commandCompletionFixture(["git", "gitk"])
  await using _ = setup
  setup.mockInput.pressKey("!")
  await setup.mockInput.typeText("gi log")
  for (let i = 0; i < " log".length; i++) setup.mockInput.pressArrow("left")
  setup.mockInput.pressTab()
  await setup.waitForFrame((frame) => frame.includes("gitk"))
  expect(text()).toBe("git log")

  setup.mockInput.pressEscape()
  await setup.waitForFrame((frame) => !frame.includes("gitk") && frame.includes("exit shell mode"))
  expect(text()).toBe("gi log")
  expect(setup.renderer.currentFocusedEditor?.cursorOffset).toBe("gi".length)

  setup.mockInput.pressEscape()
  await setup.waitForFrame((frame) => !frame.includes("exit shell mode"))
  setup.mockInput.pressTab()
  setup.mockInput.pressTab({ shift: true })
  await setup.waitForFrame((frame) => frame.includes("Plan"))
  expect(text()).toBe("gi log")
  expect(commandQueries).toHaveLength(1)
  expect(pathQueries).toHaveLength(0)
  expect(submitted).toEqual([])
})

test.each([
  ["./gi", "./gift.txt"],
  ["cat gi", "cat gift.txt"],
])("shell Tab still uses path completion for %s", async (before, after) => {
  const { setup, commandQueries, pathQueries, submitted, text } = await commandCompletionFixture(["git"])
  await using _ = setup
  setup.mockInput.pressKey("!")
  await setup.mockInput.typeText(before)
  setup.mockInput.pressTab()
  await setup.waitFor(() => text() === after)
  expect(commandQueries).toHaveLength(0)
  expect(pathQueries).toHaveLength(1)
  expect(submitted).toEqual([])
})
