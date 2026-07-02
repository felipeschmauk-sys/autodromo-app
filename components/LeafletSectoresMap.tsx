"use client";
/**
 * LeafletSectoresMap.tsx — components/LeafletSectoresMap.tsx
 *
 * Mapa Leaflet para el editor de sectores.
 * Muestra el trazado dividido en sectores con marcadores arrastrables
 * en cada punto de división para ajustar los límites.
 *
 * ⚠ Importar siempre con dynamic({ ssr: false })
 */

import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { useEffect, useRef } from "react";
import { sectorSlice, sectorLargo } from "@/lib/gps";

interface Coordenada { lat: number; lng: number; }

interface Rango {
  nombre: string;
  inicio: number;
  fin:    number;
  color:  string;
}

interface Props {
  trazado: Coordenada[];
  rangos:  Rango[];
  onBoundaryChange: (boundaryIdx: number, newFin: number) => void;
}

export default function LeafletSectoresMap({ trazado, rangos, onBoundaryChange }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef       = useRef<L.Map | null>(null);
  const layersRef    = useRef<L.Layer[]>([]);
  const markersRef   = useRef<L.Marker[]>([]);

  // ── Inicializar mapa ───────────────────────────────────────
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = L.map(containerRef.current, {
      center:             [-33.5, -70.6],
      zoom:               14,
      zoomControl:        false,
      attributionControl: false,
      // Mapa estático: el arrastre es para los marcadores de límite, no para navegar
      dragging:        false,
      scrollWheelZoom: false,
      doubleClickZoom: false,
      touchZoom:       false,
      keyboard:        false,
      boxZoom:         false,
    });

    L.tileLayer("https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png", {
      subdomains: "abcd", maxZoom: 20,
    }).addTo(map);

    mapRef.current = map;
    return () => { map.remove(); mapRef.current = null; };
  }, []);

  // ── Redibujar sectores y markers cuando cambian rangos ─────
  useEffect(() => {
    const map = mapRef.current;
    if (!map || trazado.length < 2 || !rangos.length) return;

    // Limpiar capas anteriores
    layersRef.current.forEach(l => { try { map.removeLayer(l); } catch {} });
    markersRef.current.forEach(m => { try { map.removeLayer(m); } catch {} });
    layersRef.current  = [];
    markersRef.current = [];

    // Fondo del trazado completo (gris claro)
    const allLatlngs = trazado.map(c => [c.lat, c.lng] as [number, number]);
    layersRef.current.push(
      L.polyline(allLatlngs, { color: "#cbd5e1", weight: 8, opacity: 1 }).addTo(map)
    );

    // Sectores coloreados (sectorSlice soporta el sector que cruza la meta)
    rangos.forEach(r => {
      const pts = sectorSlice(trazado, r.inicio, r.fin)
        .map(c => [c.lat, c.lng] as [number, number]);
      if (pts.length < 2) return;

      // Glow
      layersRef.current.push(
        L.polyline(pts, { color: r.color, weight: 18, opacity: 0.18 }).addTo(map)
      );
      // Línea principal
      layersRef.current.push(
        L.polyline(pts, { color: r.color, weight: 6, opacity: 0.95 }).addTo(map)
      );

      // Sin etiquetas de texto: los círculos bicolor de los límites bastan
      // para identificar los sectores y no tapan el trazado
    });

    // Marcador de largada
    const start = trazado[0];
    if (start) {
      layersRef.current.push(
        (L.circleMarker as any)([start.lat, start.lng], {
          radius: 8, fillColor: "#22c55e",
          color: "#fff", weight: 2, fillOpacity: 1,
        }).addTo(map)
      );
    }

    // ── Boundary markers arrastrables ──────────────────────
    // Circulares: N boundaries para N sectores. El límite N|1 (último→primero)
    // también se arrastra; el sector que cruza la meta queda con inicio > fin.
    const n     = rangos.length;
    const total = trazado.length;
    for (let i = 0; i < n && n >= 2; i++) {
      const boundaryIdx = i;
      const sigIdx      = (i + 1) % n;
      const ptIdx       = rangos[i].fin; // punto de división
      const pt          = trazado[ptIdx];
      if (!pt) continue;

      const colorA = rangos[i].color;
      const colorB = rangos[sigIdx].color;

      const icon = L.divIcon({
        html: `<div style="
          width:28px;height:28px;border-radius:50%;
          background:linear-gradient(135deg,${colorA} 50%,${colorB} 50%);
          border:3px solid #fff;
          display:flex;align-items:center;justify-content:center;
          font-size:9px;font-weight:900;color:#fff;
          box-shadow:0 2px 12px rgba(0,0,0,.8);
          cursor:grab;font-family:monospace;
          text-shadow:0 1px 3px rgba(0,0,0,.9);
        ">${i + 1}|${sigIdx + 1}</div>`,
        iconSize:   [28, 28],
        iconAnchor: [14, 14],
        className:  "",
      });

      const marker = L.marker([pt.lat, pt.lng], { draggable: true, icon, zIndexOffset: 800 }).addTo(map);

      marker.on("drag", function (e: any) {
        const latlng = e.target.getLatLng();
        // Snap al punto más cercano del trazado
        let minD = Infinity, nearest = ptIdx;
        trazado.forEach((c, j) => {
          const d = (latlng.lat - c.lat) ** 2 + (latlng.lng - c.lng) ** 2;
          if (d < minD) { minD = d; nearest = j; }
        });
        // Validez circular: dentro del arco entre sectores vecinos,
        // con mínimo 2 puntos por lado
        const ini  = rangos[boundaryIdx].inicio;
        const finS = rangos[sigIdx].fin;
        const arco = sectorLargo(ini, finS, total);
        const izq  = sectorLargo(ini, nearest, total);
        const der  = sectorLargo(nearest, finS, total);
        if (izq + der !== arco || izq < 2 || der < 2) {
          // Fuera del rango permitido: el marcador vuelve a su punto actual
          const actual = trazado[rangos[boundaryIdx].fin];
          e.target.setLatLng([actual.lat, actual.lng]);
          return;
        }
        e.target.setLatLng([trazado[nearest].lat, trazado[nearest].lng]);
        onBoundaryChange(boundaryIdx, nearest);
      });

      markersRef.current.push(marker);
    }

    // Ajustar vista al trazado
    map.fitBounds(L.polyline(allLatlngs).getBounds(), { padding: [24, 24] });
  }, [trazado, rangos, onBoundaryChange]);

  return (
    <div
      ref={containerRef}
      style={{
        width:        "100%",
        height:       240,
        borderRadius: "16px",
        overflow:     "hidden",
        position:     "relative",
        // Evita que los panes de Leaflet (z-index alto) se dibujen
        // sobre el header del panel al hacer scroll
        isolation:    "isolate",
        zIndex:       0,
      }}
    />
  );
}
