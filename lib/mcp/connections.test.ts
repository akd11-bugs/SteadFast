import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { toolPrefix, proxyTool } from '@/lib/mcp/connections'

// Public answer for treg.to so tests never hit real DNS.
vi.mock('dns/promises', () => ({ default: { lookup: async () => ({ address: '93.184.216.34', family: 4 }) } }))

describe('toolPrefix', () => {
  it('lowercases and replaces non-alphanumeric runs with a single underscore', () => {
    expect(toolPrefix('treg')).toBe('treg')
    expect(toolPrefix('My Connector!')).toBe('my_connector')
    expect(toolPrefix('  Spaced  Out  ')).toBe('spaced_out')
  })

  it('strips leading/trailing underscores produced by punctuation', () => {
    expect(toolPrefix('--treg--')).toBe('treg')
  })

  it('falls back to "connector" for a name with no alphanumeric characters', () => {
    expect(toolPrefix('!!!')).toBe('connector')
    expect(toolPrefix('')).toBe('connector')
  })
})

describe('proxyTool', () => {
  const originalFetch = global.fetch

  beforeEach(() => {
    global.fetch = vi.fn()
  })

  afterEach(() => {
    global.fetch = originalFetch
  })

  it('prefixes the wrapped tool name with the connection name so two connections cannot collide', () => {
    const tool = proxyTool('treg', 'https://treg.to/mcp/', null, { name: 'search', description: 'Search things' })
    expect(tool.name).toBe('treg_search')
    expect(tool.description).toBe('Search things')
  })

  it('forwards run() as a tools/call JSON-RPC request to the remote server with the given args', async () => {
    const mockFetch = global.fetch as ReturnType<typeof vi.fn>
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ jsonrpc: '2.0', id: 1, result: { content: [{ type: 'text', text: 'Found 3 results' }] } }),
    })

    const tool = proxyTool('treg', 'https://treg.to/mcp/', 'secret-token', { name: 'search' })
    const result = await tool.run({ query: 'acme' }, { orgId: 'org-1' })

    expect(result).toBe('Found 3 results')
    expect(mockFetch).toHaveBeenCalledTimes(1)
    const [url, init] = mockFetch.mock.calls[0]
    expect(url).toBe('https://treg.to/mcp/')
    expect(init.method).toBe('POST')
    expect(init.headers.authorization).toBe('Bearer secret-token')
    const body = JSON.parse(init.body)
    expect(body.method).toBe('tools/call')
    expect(body.params).toEqual({ name: 'search', arguments: { query: 'acme' } })
  })

  it('omits the Authorization header entirely when the connection has no token', async () => {
    const mockFetch = global.fetch as ReturnType<typeof vi.fn>
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ jsonrpc: '2.0', id: 1, result: { content: [] } }),
    })

    const tool = proxyTool('treg', 'https://treg.to/mcp/', null, { name: 'search' })
    await tool.run({}, { orgId: 'org-1' })

    const [, init] = mockFetch.mock.calls[0]
    expect('authorization' in init.headers).toBe(false)
  })

  it('falls back to the raw JSON result when the remote response has no text content', async () => {
    const mockFetch = global.fetch as ReturnType<typeof vi.fn>
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ jsonrpc: '2.0', id: 1, result: { structured: true } }),
    })

    const tool = proxyTool('treg', 'https://treg.to/mcp/', null, { name: 'search' })
    const result = await tool.run({}, { orgId: 'org-1' })

    expect(JSON.parse(result)).toEqual({ structured: true })
  })

  it('throws a ConnectionError (not a raw response body) when the remote server errors', async () => {
    const mockFetch = global.fetch as ReturnType<typeof vi.fn>
    mockFetch.mockResolvedValue({ ok: false, status: 404, json: async () => ({}) })

    const tool = proxyTool('treg', 'https://treg.to/mcp/', null, { name: 'search' })
    await expect(tool.run({}, { orgId: 'org-1' })).rejects.toThrow('HTTP 404')
  })

  it('refuses an internal address without calling fetch', async () => {
    const tool = proxyTool('evil', 'http://169.254.169.254/latest/', null, { name: 'x' })
    await expect(tool.run({}, { orgId: 'org-1' })).rejects.toThrow('not allowed')
    expect(global.fetch).not.toHaveBeenCalled()
  })

  it('refuses to follow a redirect', async () => {
    ;(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: false, status: 302, json: async () => ({}) })
    const tool = proxyTool('treg', 'https://treg.to/mcp/', null, { name: 'search' })
    await expect(tool.run({}, { orgId: 'org-1' })).rejects.toThrow('redirect')
    expect((global.fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].redirect).toBe('manual')
  })
})
