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
  safety_car:     "#eab308",   // SC se señaliza con amarillo, no naranjo
  blanca:         "#9ca3af",
  negra:          "#6b7280",
};

const GLOBAL_FLAGS = new Set(["roja", "amarilla", "amarilla_doble", "safety_car", "cuadros"]);

// ── Task #59: dibujar polilínea según bandera ──────────────────
// Las polilíneas SVG de Leaflet solo aceptan color sólido, así que los
// patrones se simulan superponiendo una línea base + una línea con dashes:
//   rayas   → base amarilla + dashes rojos  (peligro en sector)
//   cuadros → base blanca   + dashes negros (fin de sesión)
function pushFlagPolyline(
  map: L.Map,
  layers: L.Layer[],
  pts: [number, number][],
  flag: string,
  mainWeight: number,
  glowWeight: number,
  glowOpacity: number,
) {
  if (flag === "rayas") {
    layers.push(L.polyline(pts, { color: "#eab308", weight: glowWeight, opacity: glowOpacity }).addTo(map));
    layers.push(L.polyline(pts, { color: "#eab308", weight: mainWeight, opacity: 0.95, lineCap: "butt" }).addTo(map));
    layers.push(L.polyline(pts, { color: "#ef4444", weight: mainWeight, opacity: 0.95, dashArray: "8 8", lineCap: "butt" }).addTo(map));
  } else if (flag === "cuadros") {
    layers.push(L.polyline(pts, { color: "#374151", weight: glowWeight, opacity: glowOpacity }).addTo(map));
    layers.push(L.polyline(pts, { color: "#ffffff", weight: mainWeight, opacity: 1, lineCap: "butt" }).addTo(map));
    layers.push(L.polyline(pts, { color: "#111111", weight: mainWeight, opacity: 1, dashArray: "7 7", lineCap: "butt" }).addTo(map));
  } else {
    const color = STROKE[flag] || STROKE.verde;
    layers.push(L.polyline(pts, { color, weight: glowWeight, opacity: glowOpacity }).addTo(map));
    layers.push(L.polyline(pts, { color, weight: mainWeight, opacity: 0.92 }).addTo(map));
  }
}

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
      zoomControl:        false,
      attributionControl: false,
      dragging:           false,
      scrollWheelZoom:    false,
      doubleClickZoom:    false,
      touchZoom:          false,
      keyboard:           false,
      boxZoom:            false,
    });

    L.tileLayer("https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png", {
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
      sectores.forEach((s, i) => {
        const ef    = globalOvride ? bandera : s.bandera;
        // Color para la etiqueta del sector (legible incluso con patrón)
        const color = ef === "rayas" ? "#ca8a04" : ef === "cuadros" ? "#111827" : (STROKE[ef] || STROKE.verde);
        const pts   = trazado
          .slice(s.punto_inicio, s.punto_fin + 1)
          .map(c => [c.lat, c.lng] as [number, number]);
        if (pts.length < 2) return;

        // Task #59: glow + línea principal (con patrón si es rayas/cuadros)
        pushFlagPolyline(map, trackRef.current, pts, ef, 4, 16, 0.12);

        // Etiqueta compacta en el cuarto del sector (no en el medio) para no tapar el trazado
        const quarterIdx = Math.floor(s.punto_inicio + (s.punto_fin - s.punto_inicio) * 0.25);
        const mc         = trazado[quarterIdx];
        if (mc) {
          const label = L.divIcon({
            html: `<div style="
              background:white;
              color:${color};
              border:1.5px solid ${color};
              border-radius:4px;
              padding:1px 5px;
              font-size:9px;
              font-weight:900;
              font-family:monospace;
              letter-spacing:.5px;
              white-space:nowrap;
              box-shadow:0 1px 3px rgba(0,0,0,.15);
              pointer-events:none;
              line-height:14px;
            ">S${i + 1}</div>`,
            iconSize:   [26, 16],
            iconAnchor: [13, 20],   // ancla debajo del punto → etiqueta queda fuera del trazado
            className:  "",
          });
          trackRef.current.push(
            L.marker([mc.lat, mc.lng], { icon: label, interactive: false }).addTo(map)
          );
        }
      });
    } else {
      // Task #59: trazado completo con patrón si corresponde
      pushFlagPolyline(map, trackRef.current, latlngs, bandera, 4, 16, 0.12);
    }

    map.fitBounds(L.polyline(latlngs).getBounds(), { padding: [36, 36] });
  }, [trazado, sectores, bandera]);

  // ── Actualizar marcadores de pilotos ───────────────────────
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const activeIds = new Set(pilotos.map(p => p.piloto_id));

    pilotos.forEach(p => {
      // Solo mostrar pilotos con GPS válido y dentro de la geocerca
      // (dentro_geocerca === null = sin geocerca configurada → mostrar igual)
      const sinGps   = p.lat === null || p.lng === null;
      const enBoxes  = p.dentro_geocerca === false;

      // Sin GPS nunca → eliminar marcador
      if (sinGps) {
        if (markersRef.current[p.piloto_id]) {
          map.removeLayer(markersRef.current[p.piloto_id]);
          delete markersRef.current[p.piloto_id];
        }
        return;
      }

      // En boxes → punto pequeño gris en última posición conocida
      if (enBoxes) {
        const icon = L.divIcon({
          html: `
            <div style="display:flex;flex-direction:column;gap:2px;white-space:nowrap">
              <div style="display:flex;align-items:center;gap:4px">
                <div style="
                  width:8px;height:8px;border-radius:50%;
                  background:#6b7280;border:1.5px solid #fff;
                  opacity:0.6;flex-shrink:0;
                "></div>
                <span style="
                  background:rgba(5,5,15,.6);color:#9ca3af;
                  border:1px solid #37415166;border-radius:4px;
                  padding:1px 5px;font-size:10px;font-weight:700;font-family:monospace;
                  letter-spacing:.5px;opacity:0.75;
                ">${p.nombre.split(" ")[0].toUpperCase()}</span>
              </div>
              <div style="
                margin-left:12px;background:rgba(5,5,15,.5);color:#6b7280;
                border-radius:3px;padding:0 5px;
                font-size:9px;font-weight:700;font-family:monospace;letter-spacing:.5px
              ">BOXES</div>
            </div>`,
          iconSize:   [100, 36],
          iconAnchor: [4, 6],
          className:  "",
        });
        if (markersRef.current[p.piloto_id]) {
          markersRef.current[p.piloto_id].setLatLng([p.lat!, p.lng!]);
          markersRef.current[p.piloto_id].setIcon(icon);
        } else {
          markersRef.current[p.piloto_id] = L.marker([p.lat!, p.lng!], {
            icon, zIndexOffset: 300,
          }).addTo(map);
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
        markersRef.current[p.piloto_id].setLatLng([p.lat!, p.lng!]);
        markersRef.current[p.piloto_id].setIcon(icon);
      } else {
        markersRef.current[p.piloto_id] = L.marker([p.lat!, p.lng!], {
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
