'use client'

import * as React from 'react'
import * as TabsPrimitive from '@radix-ui/react-tabs'
import { cn } from '@/lib/utils'

const Tabs = TabsPrimitive.Root

// Underline-style list with an indicator that slides between triggers.
//
// Built on Radix rather than plain divs so arrow-key navigation, roving
// focus and the tab/tabpanel ARIA wiring keep working — this sits on screens
// people use all day. The indicator is measured from the live DOM (the
// active trigger's offsetLeft/offsetWidth) because trigger widths depend on
// their label text, which is dynamic ("Activity (12)").
const TabsList = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.List>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.List>
>(({ className, children, ...props }, ref) => {
  const innerRef = React.useRef<HTMLDivElement | null>(null)
  const [indicator, setIndicator] = React.useState<{ left: number; width: number } | null>(null)

  // Keep the ref usable by both this component and any forwarded ref.
  const setRefs = React.useCallback(
    (node: HTMLDivElement | null) => {
      innerRef.current = node
      if (typeof ref === 'function') ref(node)
      else if (ref) ref.current = node
    },
    [ref],
  )

  React.useEffect(() => {
    const list = innerRef.current
    if (!list) return

    const measure = () => {
      const active = list.querySelector<HTMLElement>('[role="tab"][data-state="active"]')
      if (!active) return
      setIndicator({ left: active.offsetLeft, width: active.offsetWidth })
    }

    measure()

    // data-state flips on the triggers when the value changes, and label text
    // can change width ("Activity (3)" -> "Activity (4)"), so watch both.
    const mo = new MutationObserver(measure)
    mo.observe(list, { attributes: true, attributeFilter: ['data-state'], subtree: true, childList: true })

    const ro = new ResizeObserver(measure)
    ro.observe(list)
    list.querySelectorAll('[role="tab"]').forEach((el) => ro.observe(el))

    return () => {
      mo.disconnect()
      ro.disconnect()
    }
  }, [children])

  return (
    <TabsPrimitive.List
      ref={setRefs}
      className={cn(
        // max-w-full + overflow-x-auto: a row of tabs scrolls sideways at
        // phone width instead of pushing the page wider than the viewport.
        'relative inline-flex h-10 max-w-full items-center justify-start gap-1 overflow-x-auto overflow-y-hidden border-b border-border text-muted-foreground',
        className,
      )}
      {...props}
    >
      {children}
      {/* Rendered only once measured, so it never flashes at 0,0 on mount. */}
      {indicator && (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute bottom-0 h-[2px] rounded-full bg-foreground transition-[left,width] duration-300 ease-out motion-reduce:transition-none"
          style={{ left: indicator.left, width: indicator.width }}
        />
      )}
    </TabsPrimitive.List>
  )
})
TabsList.displayName = TabsPrimitive.List.displayName

const TabsTrigger = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Trigger
    ref={ref}
    className={cn(
      'relative inline-flex h-9 shrink-0 items-center justify-center whitespace-nowrap rounded-md px-3 text-sm font-medium ring-offset-background transition-colors hover:bg-accent/60 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 data-[state=active]:text-foreground',
      className,
    )}
    {...props}
  />
))
TabsTrigger.displayName = TabsPrimitive.Trigger.displayName

const TabsContent = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Content>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Content
    ref={ref}
    className={cn(
      'mt-2 ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
      className,
    )}
    {...props}
  />
))
TabsContent.displayName = TabsPrimitive.Content.displayName

export { Tabs, TabsList, TabsTrigger, TabsContent }
