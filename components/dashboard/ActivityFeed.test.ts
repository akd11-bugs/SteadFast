import { describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { ActivityFeedView } from '@/components/dashboard/ActivityFeed'

const render = (props: Parameters<typeof ActivityFeedView>[0]) => renderToStaticMarkup(createElement(ActivityFeedView, props))

describe('ActivityFeedView', () => {
  it('says it could not load, instead of a fake empty state, when the fetch failed', () => {
    const html = render({ items: [], failed: true })
    expect(html).toContain('load activity')
    expect(html).not.toContain('No activity yet')
  })

  it('shows the real empty state when the fetch succeeded with nothing', () => {
    expect(render({ items: [] })).toContain('No activity yet')
  })
})
