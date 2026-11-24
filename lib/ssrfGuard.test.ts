import { describe, expect, it } from 'vitest'
import { assertSafeWebhookUrl, isPrivateOrReservedIp } from './ssrfGuard'

describe('isPrivateOrReservedIp', () => {
  it.each([
    ['127.0.0.1', true], ['10.1.2.3', true], ['172.16.0.1', true], ['172.32.0.1', false],
    ['192.168.1.1', true], ['169.254.169.254', true], ['0.0.0.0', true],
    ['100.64.0.1', true], ['100.127.255.255', true], ['100.128.0.1', false],
    ['::1', true], ['::', true], ['fd00::1', true], ['fe80::1', true],
    ['::ffff:127.0.0.1', true], ['::ffff:7f00:1', true], ['::ffff:a9fe:a9fe', true], ['::ffff:808:808', false],
    ['8.8.8.8', false], ['2606:4700::1111', false], ['not-an-ip', true],
  ])('%s → %s', (ip, blocked) => expect(isPrivateOrReservedIp(ip)).toBe(blocked))
})

describe('assertSafeWebhookUrl', () => {
  it.each(['http://[::1]/', 'http://[::]/', 'http://[::ffff:127.0.0.1]/', 'http://100.64.0.1/', 'http://localhost/', 'ftp://8.8.8.8/'])(
    'rejects %s',
    async (u) => { await expect(assertSafeWebhookUrl(u)).rejects.toThrow() },
  )
  it('allows a public IP literal', async () => {
    expect(await assertSafeWebhookUrl('https://8.8.8.8/hook')).toBe('8.8.8.8')
  })
})
