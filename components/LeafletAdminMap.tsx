"use client";
/**
 * LeafletAdminMap.tsx — components/LeafletAdminMap.tsx
 *
 * Mapa Leaflet para el panel de Dirección de Carrera.
 * Muestra el trazado coloreado por sectores/banderas
 * y los marcadores de pilotos en tiempo real con velocidad.
 *
 * ⚠ Importar siempre con dynamic({ ssr: false })
 */

import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { useEffect, useRef } from "react";

// ── Tipos ─────────────────────────────────────────────────────
interface Coordenada { lat: number; lng: number; }

interface Sector {
  id: string;
  nombre: string;
  orden: number;
  punto_inicio: number;
  punto_fin: number;
  bandera: string;
}

interface Piloto {
  piloto_id: string;
  nombre: string;
  lat: number | null;
  lng: number | null;
  velocidad: number;
  color: string;
  dentro_geocerca: boolean | null;
}

interface Props {
  trazado: Coordenada[];
  sectores: Sector[];
  bandera: string;
  pilotos: Piloto[];
}

// ── Colores por bandera ────────────────────────────────────────
const STROKE: Record<string, string> = {
  verde:          "#22c55e",
  amarilla:       "#eab308",
  amarilla_doble: "#f59e0b",
  roja:           "#ef4444",
  safety_car:     "#f97316",
  blanca:         "#9ca3af",
  negra:          "#6b7280",
};

const GLOBAL_FLAGS = new Set(["roja", "amarilla", "amarilla_doble", "safety_car"]);

// ── Componente ─────────────────────────────────────────────────
export default function LeafletAdminMap({ trazado, sectores, bandera, pilotos }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef       = useRef<L.Map | null>(null);
  const trackRef     = useRef<L.Layer[]>([]);
  const markersRef   = useRef<Record<string, L.Marker>>({});

  // ── Inicializar mapa una sola vez ──────────────────────────
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = L.map(containerRef.current, {
      center:             [-33.5, -70.6],
      zoom:               14,
      zoomControl:        true,
      attributionControl: false,
    });

    L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", {
      subdomains: "abcd",
      maxZoom:    20,
    }).addTo(map);

    mapRef.current = map;

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // ── Redibujar trazado cuando cambian datos ─────────────────
  useEffect(() => {
    const map = mapRef.current;
    if (!map || trazado.length < 2) return;

    // Limpiar capas anteriores
    trackRef.current.forEach(l => { try { map.removeLayer(l); } catch {} });
    trackRef.current = [];

    const latlngs      = trazado.map(c => [c.lat, c.lng] as [number, number]);
    const globalOvride = GLOBAL_FLAGS.has(bandera);

    if (sectores.length > 0) {
      sectores.forEach(s => {
        const ef    = globalOvride ? bandera : s.bandera;
        const color = STROKE[ef] || STROKE.verde;
        const pts   = trazado
          .slice(s.punto_inicio, s.punto_fin + 1)
          .map(c => [c.lat, c.lng] as [number, number]);
        if (pts.length < 2) return;

        // Capa glow
        trackRef.current.push(
          L.polyline(pts, { color, weight: 16, opacity: 0.12 }).addTo(map)
        );
        // Capa principal
        trackRef.current.push(
          L.polyline(pts, { color, weight: 4, opacity: 0.92 }).addTo(map)
        );
      });
    } else {
      const color = STROKE[bandera] || STROKE.verde;
      trackRef.current.push(
        L.polyline(latlngs, { color, weight: 16, opacity: 0.12 }).addTo(map)
      );
      trackRef.current.push(
        L.polyline(latlngs, { color, weight: 4, opacity: 0.92 }).addTo(map)
      );
    }

    // Marcador de largada
    trackRef.current.push(
      (L.circleMarker as any)(latlngs[0], {
        radius: 8, fillColor: "#22c55e",
        color: "#fff", weight: 2, fillOpacity: 1,
      }).addTo(map)
    );

    map.fitBounds(L.polyline(latlngs).getBounds(), { padding: [36, 36] });
  }, [trazado, sectores, bandera]);

  // ── Actualizar marcadores de pilotos ───────────────────────
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const activeIds = new Set(pilotos.map(p => p.piloto_id));

    pilotos.forEach(p => {
      if (p.lat === null || p.lng === null) {
        if (markersRef.current[p.piloto_id]) {
          map.removeLayer(markersRef.current[p.piloto_id]);
          delete markersRef.current[p.piloto_id];
        }
        return;
      }

      const stopped  = p.velocidad <= 2;
      const dotColor = stopped ? "#f59e0b" : p.color;
      const spdColor = p.velocidad > 80 ? "#ef4444"
                     : p.velocidad > 40 ? "#f59e0b"
                     : "#22c55e";

      const icon = L.divIcon({
        html: `
          <div style="display:flex;flex-direction:column;gap:2px;white-space:nowrap">
            <div style="display:flex;align-items:center;gap:4px">
              <div style="
                width:14px;height:14px;border-radius:50%;
                background:${dotColor};border:2px solid #fff;
                box-shadow:0 0 10px ${dotColor}99;flex-shrink:0;
                ${stopped ? "animation:pulse 1s ease-in-out infinite" : ""}
              "></div>
              <span style="
                background:rgba(5,5,15,.92);color:${dotColor};
                border:1px solid ${dotColor}44;border-radius:4px;
                padding:1px 7px;font-size:11px;font-weight:800;font-family:monospace;
                letter-spacing:.5px
              ">${p.nombre.split(" ")[0].toUpperCase()}</span>
            </div>
            ${p.velocidad > 0
              ? `<div style="
                  margin-left:18px;background:rgba(5,5,15,.88);
                  border-radius:3px;padding:0 5px;
                  font-size:10px;font-weight:700;color:${spdColor};font-family:monospace
                ">${p.velocidad} km/h</div>`
              : stopped
              ? `<div style="
                  margin-left:18px;background:#f59e0b;color:#000;
                  border-radius:3px;padding:0 6px;
                  font-size:10px;font-weight:800;font-family:monospace;letter-spacing:.5px
                ">DETENIDO</div>`
              : ""
            }
          </div>`,
        iconSize:   [120, 40],
        iconAnchor: [7, 9],
        className:  "",
      });

      if (markersRef.current[p.piloto_id]) {
        markersRef.current[p.piloto_id].setLatLng([p.lat, p.lng]);
        markersRef.current[p.piloto_id].setIcon(icon);
      } else {
        markersRef.current[p.piloto_id] = L.marker([p.lat, p.lng], {
          icon, zIndexOffset: 700,
        }).addTo(map);
      }
    });

    // Eliminar marcadores de pilotos que ya no están activos
    Object.keys(markersRef.current).forEach(id => {
      if (!activeIds.has(id)) {
        map.removeLayer(markersRef.current[id]);
        delete markersRef.current[id];
      }
    });
  }, [pilotos]);

  return (
    <div
      ref={containerRef}
      style={{ width: "100%", height: "100%", minHeight: 300 }}
    />
  );
}
