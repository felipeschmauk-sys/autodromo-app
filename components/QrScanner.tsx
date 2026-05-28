'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { BrowserMultiFormatReader, NotFoundException } from '@zxing/library';

interface QrScannerProps {
  onScan: (result: string) => void;
  onError?: (error: string) => void;
  active: boolean;
}

export default function QrScanner({ onScan, onError, active }: QrScannerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const readerRef = useRef<BrowserMultiFormatReader | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const scanningRef = useRef(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [isReady, setIsReady] = useState(false);

  const stopScanning = useCallback(() => {
    scanningRef.current = false;

    if (readerRef.current) {
      readerRef.current.reset();
      readerRef.current = null;
    }

    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }

    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }

    setIsReady(false);
  }, []);

  const startScanning = useCallback(async () => {
    if (!videoRef.current || scanningRef.current) return;

    setCameraError(null);

    try {
      // Pedir acceso a cámara trasera primero, luego cualquier cámara
      const constraints: MediaStreamConstraints = {
        video: {
          facingMode: { ideal: 'environment' },
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
      };

      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      streamRef.current = stream;
      videoRef.current.srcObject = stream;
      await videoRef.current.play();

      setIsReady(true);
      scanningRef.current = true;

      // Crear reader de zxing
      const reader = new BrowserMultiFormatReader();
      readerRef.current = reader;

      // Loop de escaneo manual — más confiable que decodeFromVideoDevice en Next.js
      const scanLoop = async () => {
        if (!scanningRef.current || !videoRef.current) return;

        try {
          const result = await reader.decodeOnce(videoRef.current);
          if (result && result.getText()) {
            const token = result.getText().trim();
            // Llamar callback con el token escaneado
            onScan(token);
            // Detener después del primer scan exitoso
            stopScanning();
            return;
          }
        } catch (err) {
          // NotFoundException es normal (frame sin QR), continuar
          if (!(err instanceof NotFoundException)) {
            console.warn('QrScanner decode error:', err);
          }
        }

        // Continuar si sigue activo
        if (scanningRef.current) {
          setTimeout(scanLoop, 150);
        }
      };

      scanLoop();
    } catch (err: unknown) {
      const msg =
        err instanceof Error
          ? err.message.includes('Permission')
            ? 'Permiso de cámara denegado. Habilita la cámara en tu navegador.'
            : `Error de cámara: ${err.message}`
          : 'No se pudo acceder a la cámara';
      setCameraError(msg);
      onError?.(msg);
      console.error('QrScanner start error:', err);
    }
  }, [onScan, onError, stopScanning]);

  useEffect(() => {
    if (active) {
      startScanning();
    } else {
      stopScanning();
    }

    return () => {
      stopScanning();
    };
  }, [active, startScanning, stopScanning]);

  if (cameraError) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 p-6 bg-red-950/30 border border-red-500/40 rounded-xl text-center">
        <div className="text-3xl">📷</div>
        <p className="text-red-400 text-sm font-medium">{cameraError}</p>
        <button
          onClick={() => {
            setCameraError(null);
            startScanning();
          }}
          className="px-4 py-2 bg-red-600 hover:bg-red-500 text-white text-sm rounded-lg transition"
        >
          Reintentar
        </button>
      </div>
    );
  }

  return (
    <div className="relative w-full aspect-square max-w-sm mx-auto rounded-xl overflow-hidden bg-black">
      <video
        ref={videoRef}
        className="w-full h-full object-cover"
        playsInline
        muted
        autoPlay
      />

      {/* Overlay con guía de escaneo */}
      <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
        {/* Esquinas del marco */}
        <div className="relative w-48 h-48">
          {/* TL */}
          <div className="absolute top-0 left-0 w-8 h-8 border-t-4 border-l-4 border-green-400 rounded-tl-sm" />
          {/* TR */}
          <div className="absolute top-0 right-0 w-8 h-8 border-t-4 border-r-4 border-green-400 rounded-tr-sm" />
          {/* BL */}
          <div className="absolute bottom-0 left-0 w-8 h-8 border-b-4 border-l-4 border-green-400 rounded-bl-sm" />
          {/* BR */}
          <div className="absolute bottom-0 right-0 w-8 h-8 border-b-4 border-r-4 border-green-400 rounded-br-sm" />

          {/* Línea de scan animada */}
          {isReady && (
            <div
              className="absolute left-2 right-2 h-0.5 bg-green-400/80"
              style={{
                animation: 'scanLine 2s ease-in-out infinite',
                top: '50%',
              }}
            />
          )}
        </div>
      </div>

      {/* Estado de cámara */}
      {!isReady && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/70">
          <div className="flex flex-col items-center gap-2">
            <div className="w-6 h-6 border-2 border-green-400 border-t-transparent rounded-full animate-spin" />
            <span className="text-green-400 text-xs">Iniciando cámara...</span>
          </div>
        </div>
      )}

      <style jsx>{`
        @keyframes scanLine {
          0%   { top: 10%; }
          50%  { top: 90%; }
          100% { top: 10%; }
        }
      `}</style>
    </div>
  );
}
