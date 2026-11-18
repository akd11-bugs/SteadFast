import { describe, expect, it } from 'vitest'
import { isSafeRedirectTarget } from './publicRoutes'

describe('isSafeRedirectTarget', () => {
  it.each(['/leads', '/leads/abc?tab=notes', '/pipeline#x'])('allows same-origin path %s', (t) => {
    expect(isSafeRedirectTarget(t)).toBe(true)
  })

  it.each([
    'https://evil.com',
    '//evil.com',
    '/\\evil.com', // backslash: browsers treat it like "/"
    '/\t/evil.com', // tab is stripped by the URL parser
    '/login',
    '/signup',
    '/signup?x=/leads',
    'leads',
    undefined,
  ])('rejects %s', (t) => {
    expect(isSafeRedirectTarget(t)).toBe(false)
  })
})
