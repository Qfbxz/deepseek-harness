/**
 * Dependency-free MCP server over stdio for the WP7 base-bundle snapshots:
 * newline-delimited JSON-RPC 2.0, echoing the client's requested protocol
 * version, listing one `add` tool, and serving it. Run by the product headless
 * profile through the mounted registry row (path passed via
 * DSH_MCP_FIXTURE_SERVER), exercising the real wire protocol without any
 * package dependency.
 */

import { createInterface } from 'node:readline'

const SERVER_INFO = { name: 'wp7-fixture', version: '1.0.0' }

function reply(id, result) {
  process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id, result })}\n`)
}

function replyError(id, message) {
  process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id, error: { code: -32601, message } })}\n`)
}

const server = createInterface({ input: process.stdin })
server.on('line', (line) => {
  if (line.trim() === '') return
  const message = JSON.parse(line)
  // Notifications carry no id and expect no response.
  if (message.id === undefined || message.id === null) return
  switch (message.method) {
    case 'initialize':
      reply(message.id, {
        protocolVersion: message.params?.protocolVersion,
        capabilities: { tools: {} },
        serverInfo: SERVER_INFO,
      })
      return
    case 'tools/list':
      reply(message.id, {
        tools: [{
          name: 'add',
          title: 'Add',
          description: 'Adds two numbers.',
          inputSchema: {
            type: 'object',
            properties: { a: { type: 'number', description: 'First number' }, b: { type: 'number', description: 'Second number' } },
            required: ['a', 'b'],
          },
        }],
      })
      return
    case 'tools/call': {
      const args = message.params?.arguments ?? {}
      reply(message.id, { content: [{ type: 'text', text: String(args.a + args.b) }] })
      return
    }
    default:
      replyError(message.id, `Method not found: ${message.method}`)
  }
})
