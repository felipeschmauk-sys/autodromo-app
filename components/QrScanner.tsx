'use client'
import { useEffect, useRef, useState } from 'react'

interface Props {
  onResult: (text: string) => void
}

export default function QrScanner({ onResult }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [error, setError] = useState('')
  const streamRef = useRef<MediaStream | null>(null)
  const animRef = useRef<number>(0)

  useEffect(() => {
    let active = true

    async function start() {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } }
        })
        if (!active) { stream.getTracks().forEach(t => t.stop()); return }
        streamRef.current = stream
        if (videoRef.current) {
          videoRef.current.srcObject = stream
          await videoRef.current.play()
        }

        const { BrowserQRCodeReader } = await import('@zxing/browser')
        const reader = new BrowserQRCodeReader()
        const canvas = document.createElement('canvas')
        const ctx = canvas.getContext('2d', { willReadFrequently: true })!

        function tick() {
          if (!active) return
          const v = videoRef.current
          if (v && v.readyState >= 2 && v.videoWidth > 0) {
            canvas.width = v.videoWidth
            canvas.height = v.videoHeight
            ctx.drawImage(v, 0, 0)
            try {
              const img = new Image()
              img.src = canvas.toDataURL()
              img.onload = () => {
                reader.decodeFromImageElement(img)
                  .then(r => { if (active && r) { active = false; onResult(r.getText()) } })
                  .catch(() => {})
              }
            } catch {}
          }
          animRef.current = window.setTimeout(tick, 300)
        }
        tick()
      } catch (e: any) {
        setError('No se pudo acceder a la cámara. Verifica los permisos.')
      }
    }

    start()

    return () => {
      active = false
      clearTimeout(animRef.current)
      streamRef.current?.getTracks().forEach(t => t.stop())
    }
  }, [onResult])

  if (error) {
    return (
      <div className="text-red-500 text-sm bg-red-50 border border-red-200 rounded-xl px-4 py-6 text-center">
        {error}
      </div>
    )
  }

  return (
    <video
      ref={videoRef}
      className="w-full rounded-xl"
      style={{ maxHeight: '300px', objectFit: 'cover' }}
      playsInline
      muted
      autoPlay
    />
  )
}