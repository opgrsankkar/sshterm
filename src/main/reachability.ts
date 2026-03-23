import { spawn } from 'node:child_process'

interface ReachabilityTarget {
  alias: string
  target: string
}

interface ReachabilityResult {
  alias: string
  reachable: boolean
}

function pingTarget(target: string): Promise<boolean> {
  return new Promise((resolve) => {
    const child = spawn('ping', ['-c', '5', '-i', '1', target], {
      stdio: ['ignore', 'pipe', 'pipe']
    })

    let output = ''

    child.stdout.on('data', (chunk: Buffer) => {
      output += chunk.toString()
    })

    child.stderr.on('data', (chunk: Buffer) => {
      output += chunk.toString()
    })

    child.once('error', () => {
      resolve(false)
    })

    child.once('close', (code) => {
      const hasSuccessfulReply = /bytes from/i.test(output)
      resolve(hasSuccessfulReply || code === 0)
    })
  })
}

export async function checkHostsReachability(
  hosts: ReachabilityTarget[]
): Promise<ReachabilityResult[]> {
  const checks = hosts.map(async (host) => ({
    alias: host.alias,
    reachable: await pingTarget(host.target)
  }))

  return Promise.all(checks)
}
