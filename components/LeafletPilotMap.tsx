"use client";
/**
 * LeafletPilotMap.tsx — components/LeafletPilotMap.tsx
 *
 * Mapa Leaflet para la app del piloto.
 * Muestra el trazado coloreado por sector/bandera y la posición del piloto en tiempo real.
 * Sigue automáticamente al piloto mientras se mueve.
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
  punto_inicio: number;
  punto_fin: number;
  bandera: string;
}

interface Props {
  trazado: Coordenada[];
  sectores: Sector[];
  bandera: string;
  height?: number;
  onTap?: () => void;
}

// ── Colores por bandera ────────────────────────────────────────
const STROKE: Record<string, string> = {
  verde:          "#22c55e",
  amarilla:       "#eab308",
  amarilla_doble: "#f59e0b",
  roja:           "#ef4444",
  safety_car:     "#eab308",   // SC se señaliza con amarillo, no naranjo
  blanca:         "#9ca3af",
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
    layers.push(L.polyline(pts, { color: "#ef4444", weight: mainWeight, opacity: 0.95, dashArray: "10 10", lineCap: "butt" }).addTo(map));
  } else if (flag === "cuadros") {
    layers.push(L.polyline(pts, { color: "#374151", weight: glowWeight, opacity: glowOpacity }).addTo(map));
    layers.push(L.polyline(pts, { color: "#ffffff", weight: mainWeight, opacity: 1, lineCap: "butt" }).addTo(map));
    layers.push(L.polyline(pts, { color: "#111111", weight: mainWeight, opacity: 1, dashArray: "9 9", lineCap: "butt" }).addTo(map));
  } else {
    const color = STROKE[flag] || STROKE.verde;
    layers.push(L.polyline(pts, { color, weight: glowWeight, opacity: glowOpacity }).addTo(map));
    layers.push(L.polyline(pts, { color, weight: mainWeight, opacity: 0.95 }).addTo(map));
  }
}

// ── Componente ─────────────────────────────────────────────────
export default function LeafletPilotMap({
  trazado,
  sectores,
  bandera,
  height = 200,
  onTap,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef       = useRef<L.Map | null>(null);
  const trackRef     = useRef<L.Layer[]>([]);
  const posRef       = useRef<L.Marker | null>(null);
  const watchRef     = useRef<number | null>(null);
  const gpsHistRef   = useRef<[number, number][]>([]);

  // ── Inicializar mapa una sola vez ──────────────────────────
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = L.map(containerRef.current, {
      center:             [-33.5, -70.6],
      zoom:               15,
      zoomControl:        false,
      attributionControl: false,
      // Vista fija: el piloto no necesita explorar el mapa
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

    if (onTap) {
      map.on("click", onTap);
    }

    mapRef.current = map;

    // ── GPS: seguir al piloto ──────────────────────────────
    if (navigator.geolocation) {
      watchRef.current = navigator.geolocation.watchPosition(
        pos => {
          // Suavizado GPS — promedia últimas 4 lecturas
          gpsHistRef.current.push([pos.coords.latitude, pos.coords.longitude]);
          if (gpsHistRef.current.length > 4) gpsHistRef.current.shift();
          const lat = gpsHistRef.current.reduce((s, p) => s + p[0], 0) / gpsHistRef.current.length;
          const lng = gpsHistRef.current.reduce((s, p) => s + p[1], 0) / gpsHistRef.current.length;

          if (!posRef.current) {
            const icon = L.divIcon({
              html: `<div style="
                width:18px;height:18px;border-radius:50%;
                background:#ef4444;border:3px solid #fff;
                box-shadow:0 0 20px #ef444499;
              "></div>`,
              iconSize:   [18, 18],
              iconAnchor: [9, 9],
              className:  "",
            });
            posRef.current = L.marker([lat, lng], { icon, zIndexOffset: 1000 }).addTo(map);
          } else {
            posRef.current.setLatLng([lat, lng]);
          }
          // Sin panTo — el mapa queda fijo mostrando el trazado completo
        },
        null,
        { enableHighAccuracy: true, maximumAge: 0 }
      );
    }

    return () => {
      if (watchRef.current !== null) navigator.geolocation.clearWatch(watchRef.current);
      map.remove();
      mapRef.current     = null;
      posRef.current     = null;
      gpsHistRef.current = [];
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Redibujar trazado cuando cambian datos ─────────────────
  useEffect(() => {
    const map = mapRef.current;
    if (!map || trazado.length < 2) return;

    trackRef.current.forEach(l => { try { map.removeLayer(l); } catch {} });
    trackRef.current = [];

    const latlngs = trazado.map(c => [c.lat, c.lng] as [number, number]);
    const override = GLOBAL_FLAGS.has(bandera);

    if (sectores.length > 0 && !override) {
      sectores.forEach(s => {
        const pts = trazado
          .slice(s.punto_inicio, s.punto_fin + 1)
          .map(c => [c.lat, c.lng] as [number, number]);
        if (pts.length < 2) return;
        // Task #59: con patrón si es rayas/cuadros
        pushFlagPolyline(map, trackRef.current, pts, s.bandera, 7, 20, 0.18);
      });
    } else {
      // Task #59: trazado completo con patrón si corresponde
      pushFlagPolyline(map, trackRef.current, latlngs, bandera, 7, 20, 0.18);
    }

    // Siempre ajustar la vista al trazado completo — el punto GPS se mueve sin mover el mapa
    map.fitBounds(L.polyline(latlngs).getBounds(), { padding: [28, 28] });
  }, [trazado, sectores, bandera]);

  // ── Invalidar tamaño cuando cambia height ─────────────────
  useEffect(() => {
    mapRef.current?.invalidateSize();
  }, [height]);

  return (
    <div
      ref={containerRef}
      onClick={onTap}
      style={{
        width:        "100%",
        height,
        borderRadius: "16px",
        overflow:     "hidden",
        position:     "relative", // necesario para contener z-indexes de Leaflet
        cursor:       onTap ? "pointer" : "default",
      }}
    />
  );
}
