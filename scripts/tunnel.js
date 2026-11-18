import { spawn } from 'node:child_process'

console.log('Starting Cloudflare Tunnel to http://localhost:4000...')

const child = spawn('cloudflared', ['tunnel', '--url', 'http://localhost:4000'], {
  stdio: ['ignore', 'pipe', 'pipe'],
  shell: true,
})

let foundUrl = false

function handleChunk(chunk) {
  const text = chunk.toString()
  const match = text.match(/https:\/\/[a-zA-Z0-9-]+\.trycloudflare\.com/)
  if (match && !foundUrl) {
    foundUrl = true
    const url = match[0]
    console.log('\n============================================================')
    console.log(`Meta Callback URL: ${url}/webhooks/meta`)
    console.log('Verify Token: Use META_VERIFY_TOKEN from your .env or Chat Setup')
    console.log('============================================================\n')
  }
  if (text.includes('not recognized') || text.includes('not found')) {
    console.error('\ncloudflared is not installed.\nTo install it on Windows, run:\nwinget install cloudflare.cloudflared\n')
  }
}

child.stdout.on('data', handleChunk)
child.stderr.on('data', handleChunk)

child.on('error', (err) => {
  if (err.code === 'ENOENT' || err.message?.includes('not found') || err.message?.includes('is not recognized')) {
    console.error('\ncloudflared is not installed.\nTo install it on Windows, run:\nwinget install cloudflare.cloudflared\n')
    process.exit(1)
  }
})

child.on('exit', (code) => {
  if (code !== 0 && !foundUrl) {
    console.error('\ncloudflared is not installed or tunnel failed.\nTo install it on Windows, run:\nwinget install cloudflare.cloudflared\n')
  }
})
