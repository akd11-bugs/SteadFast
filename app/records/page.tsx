import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Database } from 'lucide-react'
import { prisma } from '@/lib/db'
import { requireUser, isAdmin } from '@/lib/session'
import { engineEnabled } from '@/lib/records/scope'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'

export const dynamic = 'force-dynamic'

export default async function RecordsIndexPage() {
  const user = await requireUser()
  if (!(await engineEnabled(user))) notFound()

  const objects = await prisma.objectType.findMany({
    where: { orgId: { in: user.visibleOrgIds } },
    orderBy: { position: 'asc' },
    select: { id: true, key: true, name: true, _count: { select: { fields: true } } },
  })
  const admin = isAdmin(user)

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Records</h1>
          <p className="text-sm text-muted-foreground">Every kind of record your organisation tracks.</p>
        </div>
        {admin && objects.length > 0 && (
          <Link href="/settings/objects">
            <Button variant="outline" size="sm">
              Manage objects
            </Button>
          </Link>
        )}
      </div>

      {objects.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
            <Database className="h-8 w-8 text-muted-foreground" aria-hidden />
            <p className="font-medium">No objects yet</p>
            <p className="max-w-sm text-sm text-muted-foreground">
              {admin
                ? 'Define what your team tracks — Orders, Shipments, anything — and the fields each one has.'
                : 'An admin needs to set up the objects your team tracks.'}
            </p>
            {admin && (
              <Link href="/settings/objects">
                <Button>Set up objects</Button>
              </Link>
            )}
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {objects.map((o) => (
            <Link key={o.id} href={`/records/${encodeURIComponent(o.key)}`} className="rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              <Card className="h-full transition-colors hover:bg-muted/50">
                <CardContent className="flex items-center gap-3 pt-6">
                  <Database className="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden />
                  <div className="min-w-0">
                    <p className="truncate font-medium">{o.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {o._count.fields} field{o._count.fields === 1 ? '' : 's'}
                    </p>
                  </div>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
