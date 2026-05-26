'use client'
import { useEffect, useRef, useState } from 'react'
import { BrowserQRCodeReader, IScannerControls } from '@zxing/browser'

interface Props {
  onResult: (text: string) => void
}

export default function QrScanner({ onResult }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const controlsRef = useRef<IScannerControls | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    const reader = new BrowserQRCodeReader()

    reader.decodeFromVideoDevice(
      undefined,
      videoRef.current!,
      (result, err, controls) => {
        controlsRef.current = controls
        if (result) {
          controls.stop()
          onResult(result.getText())
        }
        if (err && !err.message.includes('No MultiFormat')) {
          setError('Error de cámara. Verifica los permisos.')
        }
      }
    ).catch(() => setError('No se pudo acceder a la cámara. Verifica los permisos del navegador.'))

    return () => {
      controlsRef.current?.stop()
    }
  }, [onResult])

  if (error) {
    return (
      <div className="text-red-400 text-sm bg-red-950/30 border border-red-800 rounded-xl px-4 py-6 text-center">
        {error}
      </div>
    )
  }

  return (
    <video
      ref={videoRef}
      className="w-full rounded-xl"
      style={{ maxHeight: '300px', objectFit: 'cover' }}
    />
  )
}