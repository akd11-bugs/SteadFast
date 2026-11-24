import { prisma } from '@/lib/db'
import { tryDecrypt } from '@/lib/crypto'
import { assertSafeWebhookUrl } from '@/lib/ssrfGuard'
import type { ToolDef } from './protocol'
import type { McpCtx } from './tools'

// Bring-your-own MCP server (e.g. treg.to), not an OAuth-brokered
// integration: the third party owns its own auth entirely — an admin
// pastes that provider's own API key/token, we store it encrypted and
// forward it verbatim on every call. Building a per-provider OAuth client
// would be real, ongoing engineering per connected service for a feature
// nobody has used yet; a shared "paste a URL + token" shape costs nothing
// per new provider and matches the standard pattern every MCP gateway/
// aggregator (Cloudflare's SaaS-MCP docs, agentgateway, etc.) actually uses
// for third-party servers that manage their own identity.
//
// All-or-nothing per connection for v1 (no per-tool enable/disable) —
// simpler to reason about, and nothing has shown tool-list bloat is a real
// problem yet for the handful of connections an org is expected to add.

const HANDSHAKE_TIMEOUT_MS = 8_000

interface RemoteTool {
  name: string
  description?: string
  inputSchema?: Record<string, unknown>
}

export class ConnectionError extends Error {}

// One JSON-RPC call to a remote MCP server — shared by the handshake
// (tools/list, done once at connect time and again whenever Settings shows
// the connection) and the per-call proxy below (tools/call). Never retries;
// a flaky remote server should surface as a visible failure, not a hung
// request silently absorbed by this layer.
async function callRemote(
  serverUrl: string,
  token: string | null,
  method: string,
  params?: Record<string, unknown>,
): Promise<unknown> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), HANDSHAKE_TIMEOUT_MS)
  try {
    // The URL is admin-supplied: refuse internal hosts (and their redirects),
    // or any org admin could make our server probe the private network.
    // Re-checked on every call, so DNS re-pointed after saving is still caught.
    try {
      await assertSafeWebhookUrl(serverUrl)
    } catch {
      throw new ConnectionError('That server address is not allowed')
    }
    const res = await fetch(serverUrl, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'mcp-protocol-version': '2025-06-18',
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
      signal: controller.signal,
      redirect: 'manual',
    })
    if (res.status >= 300 && res.status < 400) throw new ConnectionError('Server tried to redirect; use its final URL')
    if (!res.ok) {
      // Never surface the raw response body — a bad URL commonly 404s into
      // an HTML error page (seen with a misconfigured Google Sheets ID
      // earlier in this same codebase's history), which is exactly the
      // kind of thing that must never reach a client-facing error message.
      throw new ConnectionError(`Server responded with HTTP ${res.status}`)
    }
    const body = (await res.json()) as { result?: unknown; error?: { message?: string } }
    if (body.error) throw new ConnectionError(body.error.message ?? 'Server returned an error')
    return body.result
  } catch (err) {
    if (err instanceof ConnectionError) throw err
    if (err instanceof Error && err.name === 'AbortError') {
      throw new ConnectionError(`No response within ${HANDSHAKE_TIMEOUT_MS / 1000}s`)
    }
    throw new ConnectionError(err instanceof Error ? err.message : 'Could not reach server')
  } finally {
    clearTimeout(timeout)
  }
}

/** Live tools/list handshake — used both to validate a connection when an admin saves it, and to build proxy tools on every MCP request. */
export async function fetchRemoteTools(serverUrl: string, token: string | null): Promise<RemoteTool[]> {
  const result = await callRemote(serverUrl, token, 'tools/list')
  const tools = (result as { tools?: unknown[] } | undefined)?.tools
  if (!Array.isArray(tools)) throw new ConnectionError('Server did not return a tools list')
  return tools.filter(
    (t): t is RemoteTool => typeof t === 'object' && t !== null && typeof (t as RemoteTool).name === 'string',
  )
}

// Wraps one remote tool as a local ToolDef whose run() forwards the call
// verbatim to the remote server — the proxy never interprets the tool's
// arguments or result, so new remote tools need zero code here to work.
// Prefixed name (see buildProxyToolsForOrg) keeps two connections' tools
// from colliding if they happen to both expose e.g. a tool literally named
// "search".
// Exported for lib/mcp/connections.test.ts.
export function proxyTool(connectionName: string, serverUrl: string, token: string | null, remote: RemoteTool): ToolDef<McpCtx> {
  return {
    name: `${connectionName}_${remote.name}`,
    description: remote.description ?? remote.name,
    inputSchema: remote.inputSchema ?? { type: 'object', properties: {} },
    async run(args) {
      const result = await callRemote(serverUrl, token, 'tools/call', { name: remote.name, arguments: args })
      const content = (result as { content?: { type: string; text?: string }[] } | undefined)?.content
      const text = content?.find((c) => c.type === 'text')?.text
      return text ?? JSON.stringify(result ?? {})
    },
  }
}

// Sanitizes a connection's admin-facing name into a safe tool-name prefix —
// MCP tool names are typically expected to be identifier-like; this never
// trusts the raw label an admin typed directly into a prefix a model will
// see and call.
// Exported for lib/mcp/connections.test.ts.
export function toolPrefix(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
  return slug || 'connector'
}

// Called once per MCP request (app/api/agent/mcp/route.ts) — fetches the
// org's enabled connections and live-handshakes each one's tools/list in
// parallel. A connection that fails here is skipped silently for this
// request (its lastError is recorded for Settings to show, but a transient
// outage on one third-party server must never break Steadfast's own
// tools) — see the Promise.allSettled below.
export async function buildProxyToolsForOrg(orgId: string): Promise<ToolDef<McpCtx>[]> {
  const connections = await prisma.orgMcpConnection.findMany({ where: { orgId, enabled: true } })
  if (connections.length === 0) return []

  const results = await Promise.allSettled(
    connections.map(async (conn) => {
      const token = conn.tokenEnc ? tryDecrypt(conn.tokenEnc) : null
      const remoteTools = await fetchRemoteTools(conn.serverUrl, token)
      return remoteTools.map((t) => proxyTool(toolPrefix(conn.name), conn.serverUrl, token, t))
    }),
  )

  return results.flatMap((r) => (r.status === 'fulfilled' ? r.value : []))
}

/** Validates a connection and records the result — called when an admin saves/re-checks a connection from Settings, and nowhere else (never on the hot request path; see buildProxyToolsForOrg for that). */
export async function checkConnection(id: string): Promise<{ ok: boolean; toolCount?: number; error?: string }> {
  const conn = await prisma.orgMcpConnection.findUniqueOrThrow({ where: { id } })
  const token = conn.tokenEnc ? tryDecrypt(conn.tokenEnc) : null
  try {
    const tools = await fetchRemoteTools(conn.serverUrl, token)
    await prisma.orgMcpConnection.update({
      where: { id },
      data: { lastToolCount: tools.length, lastCheckedAt: new Date(), lastError: null },
    })
    return { ok: true, toolCount: tools.length }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Could not connect'
    await prisma.orgMcpConnection.update({
      where: { id },
      data: { lastCheckedAt: new Date(), lastError: message },
    })
    return { ok: false, error: message }
  }
}
