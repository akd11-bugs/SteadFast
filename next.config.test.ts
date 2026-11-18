import { describe, expect, it } from 'vitest'
import nextConfig from './next.config.mjs'

// Regression test for a confirmed security finding: Next.js sends
// `X-Powered-By: Next.js` on every response unless poweredByHeader is
// explicitly disabled — free framework-fingerprinting info for an
// attacker, no functional purpose. See next.config.mjs's poweredByHeader.
describe('next.config.mjs security headers', () => {
  it('disables the X-Powered-By header', () => {
    expect(nextConfig.poweredByHeader).toBe(false)
  })

  it('still sets the existing security headers (CSP, frame options, etc.)', async () => {
    const headerGroups = await nextConfig.headers!()
    expect(headerGroups).toHaveLength(1)
    const headerNames = headerGroups[0].headers.map((h) => h.key)
    expect(headerNames).toEqual(
      expect.arrayContaining([
        'Content-Security-Policy',
        'X-Frame-Options',
        'X-Content-Type-Options',
        'Referrer-Policy',
        'Permissions-Policy',
        'Strict-Transport-Security',
      ]),
    )
  })
})
