// Visual check harness for agent loops. Zero deps beyond the repo's own devDependencies
// (vite) plus playwright, which the loops install with `npm i --no-save playwright`.
//
//   node tools/visual-check.mjs --tag before          # build, serve, capture
//   node tools/visual-check.mjs --tag iter3 --no-build
//
// Output: /tmp/visual-check/<tag>-{hub,hub-degraded,hub-camp,hub-camp-degraded,mobile,horizon,horizon-degraded,horizon-x}.png
// Captures the solo default layout at its campfire plus the `?view=` debug views. Exit code 1
// on any page error so a loop can treat a crashed client as a failed iteration.

import { spawn, execSync } from "node:child_process"
import { mkdirSync } from "node:fs"
import { setTimeout as sleep } from "node:timers/promises"

const args = new Set(process.argv.slice(2))
const tag = (() => { const i = process.argv.indexOf("--tag"); return i > -1 ? process.argv[i + 1] : "check" })()
const port = 4173
const out = "/tmp/visual-check"
mkdirSync(out, { recursive: true })

if (!args.has("--no-build")) execSync("npx vite build", { stdio: "inherit" })

const server = spawn("npx", ["vite", "preview", "--port", String(port), "--strictPort"], { stdio: "ignore" })
await sleep(1500)

let exitCode = 0
try {
  const { chromium } = await import("playwright")
  const executablePath = process.env.CHROMIUM_PATH
  const browser = await chromium.launch({ executablePath, args: ["--use-gl=swiftshader", "--enable-unsafe-swiftshader"] })
  const shoot = async (name, { width, height, query = "" }) => {
    const ctx = await browser.newContext({ viewport: { width, height } })
    const page = await ctx.newPage()
    page.on("pageerror", (e) => { console.error(`[${name}] PAGEERROR ${e.message}`); exitCode = 1 })
    await page.goto(`http://127.0.0.1:${port}/${query}`, { waitUntil: "networkidle" })
    await sleep(3000) // let assets stream in and the hub settle
    await page.evaluate(() => { document.getElementById("intro")?.classList.add("closed"); document.getElementById("hud").style.visibility = "hidden"; document.querySelector(".wallet-dock")?.setAttribute("hidden", "") })
    await sleep(400)
    const path = `${out}/${tag}-${name}.png`
    await page.screenshot({ path })
    console.log(path)
    await ctx.close()
  }
  await shoot("hub", { width: 1440, height: 900 })
  await shoot("hub-degraded", { width: 1440, height: 900, query: "?render=degraded" })
  await shoot("hub-camp", { width: 1440, height: 900, query: "?view=hub" })
  await shoot("hub-camp-degraded", { width: 1440, height: 900, query: "?view=hub&render=degraded" })
  await shoot("mobile", { width: 390, height: 844 })
  await shoot("horizon", { width: 1440, height: 900, query: "?view=horizon" })
  await shoot("horizon-degraded", { width: 1440, height: 900, query: "?view=horizon&render=degraded" })
  await shoot("horizon-x", { width: 1440, height: 900, query: "?view=horizon-x" })
  await browser.close()
} catch (error) {
  console.error(error)
  exitCode = 1
} finally {
  server.kill()
}
process.exit(exitCode)
