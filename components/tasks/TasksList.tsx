'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Plus, Sparkles } from 'lucide-react'
import { formatDate } from '@/lib/utils'
import type { Task } from '@/lib/types'

function startOfDay(d: Date) {
  const x = new Date(d)
  x.setHours(0, 0, 0, 0)
  return x
}

export function TasksList({ initialTasks }: { initialTasks: Task[] }) {
  const router = useRouter()
  const [tasks, setTasks] = useState(initialTasks)
  const [newTitle, setNewTitle] = useState('')
  const [newDueDate, setNewDueDate] = useState('')
  const [adding, setAdding] = useState(false)

  async function addTask() {
    if (!newTitle.trim()) return
    setAdding(true)
    try {
      const res = await fetch('/api/tasks', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title: newTitle.trim(), dueDate: newDueDate || null }),
      })
      if (res.ok) {
        const data = await res.json()
        setTasks((prev) => [...prev, data.task])
        setNewTitle('')
        setNewDueDate('')
        router.refresh()
      }
    } finally {
      setAdding(false)
    }
  }

  async function toggleDone(task: Task) {
    setTasks((prev) => prev.map((t) => (t.id === task.id ? { ...t, done: !t.done } : t)))
    const res = await fetch(`/api/tasks/${task.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ done: !task.done }),
    }).catch(() => null)
    // Roll back the optimistic tick if the save didn't land.
    if (!res?.ok) setTasks((prev) => prev.map((t) => (t.id === task.id ? task : t)))
    router.refresh()
  }

  const buckets = useMemo(() => {
    const today = startOfDay(new Date())
    const tomorrow = new Date(today)
    tomorrow.setDate(tomorrow.getDate() + 1)

    const open = tasks.filter((t) => !t.done)
    const done = tasks.filter((t) => t.done)

    const overdue = open.filter((t) => t.dueDate && startOfDay(new Date(t.dueDate)) < today)
    const dueToday = open.filter((t) => t.dueDate && startOfDay(new Date(t.dueDate)).getTime() === today.getTime())
    const upcoming = open.filter((t) => t.dueDate && startOfDay(new Date(t.dueDate)) >= tomorrow)
    const noDate = open.filter((t) => !t.dueDate)

    return { overdue, dueToday, upcoming, noDate, done }
  }, [tasks])

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="p-3 flex gap-2">
          <Input
            placeholder="New task…"
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && addTask()}
          />
          <Input
            type="date"
            className="w-40"
            value={newDueDate}
            onChange={(e) => setNewDueDate(e.target.value)}
          />
          <Button size="sm" onClick={addTask} disabled={!newTitle.trim() || adding}>
            <Plus className="h-4 w-4" />
            Add
          </Button>
        </CardContent>
      </Card>

      <TaskBucket title="Overdue" tasks={buckets.overdue} tone="text-rose-600" onToggle={toggleDone} />
      <TaskBucket title="Today" tasks={buckets.dueToday} tone="text-amber-600" onToggle={toggleDone} />
      <TaskBucket title="Upcoming" tasks={buckets.upcoming} onToggle={toggleDone} />
      <TaskBucket title="No due date" tasks={buckets.noDate} onToggle={toggleDone} />
      {buckets.done.length > 0 && (
        <TaskBucket title="Done" tasks={buckets.done} muted onToggle={toggleDone} />
      )}

      {tasks.length === 0 && (
        <p className="text-sm text-muted-foreground text-center py-8">
          No tasks yet. Add one above, or create one from a lead.
        </p>
      )}
    </div>
  )
}

function TaskBucket({
  title,
  tasks,
  tone,
  muted,
  onToggle,
}: {
  title: string
  tasks: Task[]
  tone?: string
  muted?: boolean
  onToggle: (task: Task) => void
}) {
  if (tasks.length === 0) return null
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className={`text-sm ${tone ?? ''}`}>
          {title} <span className="text-muted-foreground font-normal">({tasks.length})</span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-1.5">
        {tasks.map((t) => (
          <div
            key={t.id}
            className={`flex items-center gap-3 rounded-md border px-3 py-2 text-sm ${muted ? 'opacity-60' : ''}`}
          >
            <input
              type="checkbox"
              className="h-4 w-4 rounded border-input"
              checked={t.done}
              onChange={() => onToggle(t)}
            />
            <div className="min-w-0 flex-1">
              <p className={t.done ? 'line-through text-muted-foreground' : ''}>{t.title}</p>
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                {t.leadId && t.leadCompany && (
                  <Link href={`/leads/${t.leadId}`} className="hover:underline">
                    {t.leadCompany}
                  </Link>
                )}
                {t.source === 'alert' && (
                  <Badge variant="outline" className="gap-1 text-[10px]">
                    <Sparkles className="h-2.5 w-2.5" /> from alert
                  </Badge>
                )}
              </div>
            </div>
            {t.dueDate && (
              <span className="text-xs text-muted-foreground shrink-0">{formatDate(t.dueDate)}</span>
            )}
          </div>
        ))}
      </CardContent>
    </Card>
  )
}
