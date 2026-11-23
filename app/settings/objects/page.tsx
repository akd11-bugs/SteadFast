import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'
import { prisma } from '@/lib/db'
import { requireUser, isAdmin } from '@/lib/session'
import { engineEnabled } from '@/lib/records/scope'
import { toFieldDTO } from '@/lib/records/client'
import { ObjectsEditor } from '@/components/records/ObjectsEditor'

export const dynamic = 'force-dynamic'

export default async function ObjectsSettingsPage() {
  const user = await requireUser()
  if (!(await engineEnabled(user))) notFound()
  if (!isAdmin(user)) notFound()

  const objects = await prisma.objectType.findMany({
    where: { orgId: user.orgId },
    orderBy: { position: 'asc' },
    include: { fields: { where: { orgId: user.orgId }, orderBy: { position: 'asc' } } },
  })

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <Link href="/settings" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-4 w-4" /> Settings
        </Link>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">Objects</h1>
        <p className="text-sm text-muted-foreground">The kinds of records your team works with, and the fields each one has.</p>
      </div>
      <ObjectsEditor
        initialObjects={objects.map((o) => ({
          id: o.id,
          key: o.key,
          name: o.name,
          icon: o.icon,
          position: o.position,
          restrictToOwner: o.restrictToOwner,
          fields: o.fields.map(toFieldDTO),
        }))}
      />
    </div>
  )
}
