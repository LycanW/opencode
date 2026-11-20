import { expect, test } from "bun:test"
import path from "node:path"
import { takeDraft } from "../src/component/prompt/draft-stash"
import { createAppFixture } from "./fixture/app"
import { directory, json, worktree } from "./fixture/tui-client"

async function shellCompletionFixture() {
  takeDraft(undefined)
  const requests: URL[] = []
  const submitted: URL[] = []
  const location = { directory, project: { id: "proj_test", directory: worktree, canonical: worktree } }
  const setup = await createAppFixture({
    fetch: (url, request) => {
      if (request.method === "POST" && url.pathname.endsWith("/shell")) submitted.push(url)
      if (url.pathname !== "/api/fs/list" || url.searchParams.get("path") !== path.posix.join(directory, "src")) return
      requests.push(url)
      return json({
        location,
        data: [
          { path: "src/regression", type: "directory" },
          { path: "src/report.txt", type: "file" },
        ],
      })
    },
  })
  return { setup, requests, submitted, text: () => setup.renderer.currentFocusedEditor?.plainText }
}

test("plain Tab completes a shell directory at the active location without submitting it", async () => {
  const { setup, requests, submitted, text } = await shellCompletionFixture()
  await using _ = setup
  await setup.ready
  await setup.waitForFrame((frame) => frame.includes("commands"))
  setup.mockInput.pressKey("!")
  await setup.mockInput.typeText("cd src/reg")
  await setup.waitFor(() => text() === "cd src/reg")

  setup.mockInput.pressKey("TAB", { shift: true })
  await setup.renderOnce()
  expect(requests).toHaveLength(0)
  setup.mockInput.pressKey("TAB")
  await setup.waitFor(() => text() === "cd src/regression/")
  expect(requests[0]?.searchParams.get("location[directory]")).toBe(directory)

  setup.mockInput.pressKey("ESCAPE")
  setup.mockInput.pressKey("TAB")
  await setup.renderOnce()
  expect(requests).toHaveLength(1)
  expect(text()).toBe("cd src/regression/")
  expect(submitted).toEqual([])
})

test("shell Tab opens competing paths at their common prefix, Escape restores input, and selection does not submit", async () => {
  const { setup, submitted, text } = await shellCompletionFixture()
  await using _ = setup
  await setup.ready
  await setup.waitForFrame((frame) => frame.includes("commands"))
  setup.mockInput.pressKey("!")
  await setup.mockInput.typeText("cat src/r")
  await setup.waitFor(() => text() === "cat src/r")

  setup.mockInput.pressKey("TAB")
  await setup.waitForFrame((frame) => frame.includes("regression/") && frame.includes("report.txt"))
  expect(text()).toBe("cat src/re")
  setup.mockInput.pressKey("ESCAPE")
  await setup.waitForFrame((frame) => !frame.includes("report.txt"))
  expect(text()).toBe("cat src/r")

  setup.mockInput.pressKey("TAB")
  await setup.waitForFrame((frame) => frame.includes("report.txt"))
  setup.mockInput.pressArrow("down")
  setup.mockInput.pressEnter()
  await setup.waitFor(() => text() === "cat src/report.txt")
  expect(submitted).toEqual([])
})

test("the TUI uses the server location's Windows paths rather than the client's platform", async () => {
  takeDraft(undefined)
  const directory = String.raw`C:\Work\Project`
  const location = { directory, project: { id: "proj_test", directory, canonical: directory } }
  const requests: URL[] = []
  await using setup = await createAppFixture({
    fetch: (url) => {
      if (url.pathname === "/api/location") return json(location)
      if (url.pathname === "/api/vcs") return json({ location, data: { branch: { current: "main", default: "main" } } })
      if (url.pathname !== "/api/fs/list") return
      if (!url.searchParams.has("path")) return json({ location, data: [] })
      requests.push(url)
      return json({ location, data: [{ path: String.raw`src\Report.TXT`, type: "file" }] })
    },
  })
  await setup.ready
  await setup.waitForFrame((frame) => frame.includes("commands"))
  setup.mockInput.pressKey("!")
  await setup.mockInput.typeText(String.raw`cat .\src\rep`)
  setup.mockInput.pressTab()
  await setup.waitFor(() => setup.renderer.currentFocusedEditor?.plainText === String.raw`cat .\src\Report.TXT`)
  expect(requests.map((url) => url.searchParams.get("path"))).toEqual([String.raw`C:\Work\Project\src`])
  expect(requests[0]?.searchParams.get("location[directory]")).toBe(directory)
})
