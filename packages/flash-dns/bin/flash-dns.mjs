#!/usr/bin/env node
import process from 'node:process'
import { runCli } from '@flash-dns/cli'

runCli().then((code) => {
  process.exitCode = code
}).catch(() => {
  process.stderr.write('flash-dns: unexpected startup failure\n')
  process.exitCode = 1
})
