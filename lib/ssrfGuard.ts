import dns from 'dns/promises'
import net from 'net'

// Loopback, RFC1918 private ranges, and link-local (which covers the
// 169.254.169.254 cloud-metadata address on AWS/GCP/Azure-style platforms)
// — the targets a server-side fetch to a user-supplied URL must never reach.
function isPrivateOrReservedIp(ip: string): boolean {
  const type = net.isIP(ip)
  if (type === 4) {
    const [a, b] = ip.split('.').map(Number)
    if (a === 127) return true // loopback
    if (a === 10) return true // 10.0.0.0/8
    if (a === 172 && b >= 16 && b <= 31) return true // 172.16.0.0/12
    if (a === 192 && b === 168) return true // 192.168.0.0/16
    if (a === 169 && b === 254) return true // link-local, incl. cloud metadata
    if (a === 0) return true // 0.0.0.0/8
    if (a === 100 && b >= 64 && b <= 127) return true // 100.64.0.0/10 carrier-grade NAT
    return false
  }
  if (type === 6) {
    const lower = ip.toLowerCase()
    if (lower === '::1' || lower === '::') return true // loopback; '::' connects to localhost
    if (lower.startsWith('fc') || lower.startsWith('fd')) return true // unique local fc00::/7
    if (/^fe[89ab]/.test(lower)) return true // link-local fe80::/10
    if (lower.startsWith('::ffff:')) {
      const v4 = lower.split(':').pop()!
      if (net.isIP(v4) === 4) return isPrivateOrReservedIp(v4)
      // WHATWG URL rewrites ::ffff:127.0.0.1 to the hex form ::ffff:7f00:1
      const m = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(lower)
      if (m) {
        const hi = parseInt(m[1], 16), lo = parseInt(m[2], 16)
        return isPrivateOrReservedIp(`${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`)
      }
      return true // other mapped forms — fail closed
    }
    return false
  }
  return true // unparseable — fail closed
}

/**
 * Throws unless `rawUrl` is a plain http(s) URL whose hostname resolves to a
 * public IP. Re-resolves DNS on every call rather than caching — a hostname
 * that resolved to a public IP when a workflow rule was saved could be
 * re-pointed at an internal address by the time it actually fires (DNS
 * rebinding), so this must run again immediately before every fetch, not
 * just once at config-save time.
 *
 * Returns the validated address so the caller can pin its outbound
 * connection to this exact IP (see lib/workflow.ts) — otherwise this
 * function's own dns.lookup() and fetch()'s independent internal resolution
 * are two separately-timed lookups against the same attacker-controlled
 * hostname, and a rebinding attacker can answer them differently.
 */
export { isPrivateOrReservedIp }

export async function assertSafeWebhookUrl(rawUrl: string): Promise<string> {
  const url = new URL(rawUrl)
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('URL must be http or https')
  }
  // IPv6 literals come back bracketed ("[::1]"); strip so net.isIP sees them.
  const hostname = url.hostname.toLowerCase().replace(/^\[(.*)\]$/, '$1')
  if (hostname === 'localhost' || hostname === '0.0.0.0') {
    throw new Error('That host is not allowed')
  }
  if (net.isIP(hostname)) {
    if (isPrivateOrReservedIp(hostname)) throw new Error('That host is not allowed')
    return hostname
  }
  const { address } = await dns.lookup(hostname)
  if (isPrivateOrReservedIp(address)) throw new Error('That host is not allowed')
  return address
}
