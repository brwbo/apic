#!/usr/bin/env node
/**
 * cli.js - `apic compile`. The pipeline itself lives in compile.js so that
 * src/server.js can run the identical thing in-process.
 */
import { compile } from './compile.js'
import { config } from './config.js'

const argv = process.argv.slice(2)
const flag = (name, fallback) => {
  const i = argv.indexOf(`--${name}`)
  return i === -1 ? fallback : argv[i + 1]
}

try {
  await compile({
    url: flag('url', config.target.url),
    goal: flag('goal', ''),
    app: flag('app', null),
    headless: !argv.includes('--headed'),
    onLog: (line) => console.log(line),
  })
} catch (err) {
  console.error(`\n  \x1b[31mcompile failed\x1b[0m ${err.message}\n`)
  process.exitCode = 1
}
