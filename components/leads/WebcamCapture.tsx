'use client'

import { useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Camera, X } from 'lucide-react'

interface WebcamCaptureProps {
  onCapture: (file: File) => void
  disabled?: boolean
  // Opens the camera stream immediately on mount instead of waiting for the
  // "Use webcam" click — for the TopBar's scan toggle (see NewLeadDialog's
  // autoTriggerScan), which wants the dialog to land straight in scan mode.
  autoStart?: boolean
}

// Desktop counterpart to NewLeadDialog's mobile file-input capture path.
// Mobile delegates to the OS camera app via <input capture="environment">,
// which has no live-preview equivalent on desktop browsers (capture="" is
// effectively ignored there, falling back to a plain file picker) — so this
// opens an in-page getUserMedia() stream instead, inline rather than in a
// nested Dialog (Radix doesn't compose two Dialog.Root focus traps cleanly).
// Needs next.config.mjs's Permissions-Policy to allow camera=(self).
export function WebcamCapture({ onCapture, disabled, autoStart }: WebcamCaptureProps) {
  const [active, setActive] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)

  async function start() {
    setError(null)
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        // 'environment' (rear/outward-facing camera) — this is for pointing
        // the camera AT a business card, not a selfie. Falls back to
        // whatever camera the device has on a laptop with only one.
        video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } },
      })
      streamRef.current = stream
      setActive(true)
    } catch {
      setError('Could not access the camera. Check your browser\'s camera permission for this site.')
    }
  }

  function stop() {
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
    setActive(false)
  }

  // Attach the stream once the <video> element exists (it doesn't while `active` is false).
  useEffect(() => {
    if (active && videoRef.current && streamRef.current) {
      videoRef.current.srcObject = streamRef.current
    }
  }, [active])

  // eslint-disable-next-line react-hooks/exhaustive-deps -- fire once on mount only, not on every `start` identity change
  useEffect(() => {
    if (autoStart) start()
  }, [])

  // Stop the camera if the dialog/component unmounts while active — a live
  // stream left running after the user navigates away is a real privacy
  // smell, not just a resource leak.
  useEffect(() => stop, [])

  function capture() {
    const video = videoRef.current
    if (!video) return
    const canvas = document.createElement('canvas')
    canvas.width = video.videoWidth
    canvas.height = video.videoHeight
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.drawImage(video, 0, 0)
    canvas.toBlob(
      (blob) => {
        if (blob) onCapture(new File([blob], 'card.jpg', { type: 'image/jpeg' }))
        stop()
      },
      'image/jpeg',
      0.92,
    )
  }

  if (!active) {
    return (
      <div className="flex flex-col gap-1">
        <Button type="button" size="sm" variant="outline" disabled={disabled} onClick={start}>
          <Camera className="h-3.5 w-3.5" />
          Use webcam
        </Button>
        {error ? <p className="text-xs text-destructive">{error}</p> : null}
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-1.5">
      <div className="relative overflow-hidden rounded-md border bg-black">
        {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
        <video ref={videoRef} autoPlay playsInline muted className="aspect-video w-full" />
      </div>
      <div className="flex items-center gap-2">
        <Button type="button" size="sm" onClick={capture} disabled={disabled}>
          <Camera className="h-3.5 w-3.5" />
          Capture
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={stop}>
          <X className="h-3.5 w-3.5" />
          Cancel
        </Button>
      </div>
    </div>
  )
}
