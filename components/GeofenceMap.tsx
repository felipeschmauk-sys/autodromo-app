"use client";

/**
 * GeofenceMap.tsx — COLOCAR en: components/GeofenceMap.tsx
 *
 * Requiere: npm install leaflet @types/leaflet
 *
 * En admin/page.tsx usar así:
 *   import dynamic from 'next/dynamic'
 *   const GeofenceMap = dynamic(() => import('@/components/GeofenceMap'), { ssr: false })
 */

import { useEffect, useRef, useState } from "react";
import type { Map, Polygon, CircleMarker } from "leaflet";
import { guardarGeocerca, getGeocercaActiva, getUltimasUbicaciones, type Coordenada } from "@/lib/gps";
import { supabase } from "@/lib/supabase";

interface Props {
  pilotosEnPista?: { id: string; nombre: string }[];
}

export default function GeofenceMap({ pilotosEnPista = [] }: Props) {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<Map | null>(null);
  const polygonRef = useRef<Polygon | null>(null);
  const vertexMarkersRef = useRef<CircleMarker[]>([]);
  const pilotoMarkersRef = useRef<Map<string, any>>(new Map());

  const [coordenadas, setCoordenadas] = useState<Coordenada[]>([]);
  const [modoEdicion, setModoEdicion] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [mensaje, setMensaje] = useState<{ tipo: "ok" | "error"; texto: string } | null>(null);

  // Inicializar mapa
  useEffect(() => {
    if (!mapRef.current || mapInstanceRef.current) return;

    // Import dinámico de leaflet (solo en cliente)
    import("leaflet").then((L) => {
      // Fix icono por defecto de Leaflet con webpack
      delete (L.Icon.Default.prototype as any)._getIconUrl;
      L.Icon.Default.mergeOptions({
        iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
        iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
        shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
      });

      if (!mapRef.current || mapInstanceRef.current) return;

      const map = L.map(mapRef.current, {
        center: [-33.58, -70.58], // Las Vizcachas / Santiago sur
        zoom: 15,
        zoomControl: true,
      });

      // Tile oscuro Carto Dark Matter
      L.tileLayer(
        "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",
        {
          attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> © <a href="https://carto.com/">CARTO</a>',
          subdomains: "abcd",
          maxZoom: 20,
        }
      ).addTo(map);

      mapInstanceRef.current = map;

      // Cargar geocerca guardada
      getGeocercaActiva().then((coords) => {
        if (coords && coords.length >= 3) {
          setCoordenadas(coords);
          dibujarPoligono(L, map, coords);
          const bounds = L.latLngBounds(coords.map((c) => [c.lat, c.lng] as [number, number]));
          map.fitBounds(bounds, { padding: [50, 50] });
        }
      });

      // Cargar ubicaciones
      getUltimasUbicaciones().then((data) => {
        actualizarMarcadores(L, map, data);
      });
    });

    return () => {
      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove();
        mapInstanceRef.current = null;
      }
    };
  }, []);

  // Click en el mapa para agregar puntos
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map) return;

    import("leaflet").then((L) => {
      const handleClick = (e: any) => {
        if (!modoEdicion) return;
        const nueva: Coordenada = { lat: e.latlng.lat, lng: e.latlng.lng };
        setCoordenadas((prev) => {
          const nuevas = [...prev, nueva];
          dibujarPoligono(L, map, nuevas);
          return nuevas;
        });
      };

      map.on("click", handleClick);
      return () => { map.off("click", handleClick); };
    });
  }, [modoEdicion]);

  // Realtime ubicaciones
  useEffect(() => {
    const channel = supabase
      .channel("gps-live-map")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "ubicaciones_piloto" }, () => {
        const map = mapInstanceRef.current;
        if (!map) return;
        import("leaflet").then((L) => {
          getUltimasUbicaciones().then((data) => actualizarMarcadores(L, map, data));
        });
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, []);

  function dibujarPoligono(L: any, map: Map, coords: Coordenada[]) {
    // Limpiar anteriores
    vertexMarkersRef.current.forEach((m) => m.remove());
    vertexMarkersRef.current = [];
    if (polygonRef.current) { polygonRef.current.remove(); polygonRef.current = null; }
    if (coords.length < 2) return;

    const latLngs = coords.map((c) => [c.lat, c.lng] as [number, number]);

    polygonRef.current = L.polygon(latLngs, {
      color: "#22c55e",
      fillColor: "#22c55e",
      fillOpacity: 0.07,
      weight: 2,
    }).addTo(map);

    coords.forEach((c, i) => {
      const m = L.circleMarker([c.lat, c.lng], {
        radius: 5,
        color: "#22c55e",
        fillColor: "#0a0a0a",
        fillOpacity: 1,
        weight: 2,
      }).bindTooltip(`Punto ${i + 1}`).addTo(map);
      vertexMarkersRef.current.push(m);
    });
  }

  function actualizarMarcadores(L: any, map: Map, data: any[]) {
    pilotoMarkersRef.current.forEach((m) => m.remove());
    (pilotoMarkersRef.current as any).clear();

    data.forEach((u: any) => {
      if (!u.lat || !u.lng) return;
      const nombre = u.pilotos?.nombre || "Piloto";
      const vel = u.velocidad || 0;
      const dentro = u.dentro_geocerca !== false;
      const color = dentro ? "#22c55e" : "#ef4444";

      const icon = L.divIcon({
        html: `<div style="background:#111;border:2px solid ${color};border-radius:50%;width:14px;height:14px;box-shadow:0 0 8px ${color}88"></div>`,
        className: "",
        iconSize: [14, 14],
        iconAnchor: [7, 7],
      });

      const marker = L.marker([u.lat, u.lng], { icon })
        .bindPopup(`
          <div style="background:#111;color:#fff;padding:8px 10px;border-radius:8px;font-size:12px;min-width:130px;border:1px solid #333">
            <div style="font-weight:700;margin-bottom:4px">${nombre}</div>
            <div style="color:#22c55e;font-size:13px">${vel} km/h</div>
            <div style="color:${color};font-size:11px;margin-top:2px">${dentro ? "✓ En pista" : "⚠ Fuera de pista"}</div>
          </div>
        `)
        .addTo(map);

      (pilotoMarkersRef.current as any).set(u.piloto_id, marker);
    });
  }

  const handleGuardar = async () => {
    if (coordenadas.length < 3) {
      setMensaje({ tipo: "error", texto: "Se necesitan al menos 3 puntos para definir la geocerca." });
      return;
    }
    setGuardando(true);
    const { error } = await guardarGeocerca(coordenadas);
    setGuardando(false);
    if (error) {
      setMensaje({ tipo: "error", texto: error });
    } else {
      setMensaje({ tipo: "ok", texto: "Geocerca guardada correctamente." });
      setModoEdicion(false);
      setTimeout(() => setMensaje(null), 3000);
    }
  };

  const handleLimpiar = () => {
    setCoordenadas([]);
    if (polygonRef.current) { polygonRef.current.remove(); polygonRef.current = null; }
    vertexMarkersRef.current.forEach((m) => m.remove());
    vertexMarkersRef.current = [];
  };

  return (
    <>
      {/* Leaflet CSS — cargado una sola vez */}
      <style>{`
        @import url('https://unpkg.com/leaflet@1.9.4/dist/leaflet.css');
        .leaflet-container { background: #0a0a0a; }
        .leaflet-popup-content-wrapper {
          background: transparent !important;
          border: none !important;
          box-shadow: none !important;
          padding: 0 !important;
        }
        .leaflet-popup-tip { display: none; }
        .leaflet-control-attribution { display: none; }
      `}</style>

      <div className="flex flex-col gap-3">
        {/* Toolbar */}
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center gap-2">
            <button
              onClick={() => setModoEdicion((v) => !v)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                modoEdicion
                  ? "bg-green-500 text-white shadow-lg shadow-green-500/30"
                  : "bg-gray-800 text-gray-300 hover:bg-gray-700 border border-gray-700"
              }`}
            >
              {modoEdicion ? "✏️ Editando — clic en el mapa para agregar puntos" : "✏️ Editar geocerca"}
            </button>
            {coordenadas.length > 0 && (
              <span className="text-xs text-gray-500">
                {coordenadas.length} punto{coordenadas.length !== 1 ? "s" : ""}
                {coordenadas.length >= 3 ? " ✓" : " (mín. 3)"}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            {coordenadas.length >= 3 && (
              <button
                onClick={handleGuardar}
                disabled={guardando}
                className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-green-600 text-white hover:bg-green-500 transition disabled:opacity-60"
              >
                {guardando ? "Guardando..." : "✓ Guardar geocerca"}
              </button>
            )}
            {coordenadas.length > 0 && (
              <button
                onClick={handleLimpiar}
                className="px-3 py-1.5 rounded-lg text-xs text-gray-400 hover:text-white border border-gray-700 hover:border-gray-500 transition"
              >
                Limpiar
              </button>
            )}
          </div>
        </div>

        {mensaje && (
          <div className={`text-xs px-3 py-2 rounded-lg ${
            mensaje.tipo === "ok"
              ? "bg-green-950 border border-green-800 text-green-400"
              : "bg-red-950 border border-red-800 text-red-400"
          }`}>
            {mensaje.texto}
          </div>
        )}

        {/* Mapa */}
        <div
          ref={mapRef}
          className="w-full rounded-xl overflow-hidden border border-gray-800"
          style={{ height: "420px" }}
        />

        {modoEdicion && (
          <p className="text-xs text-gray-500">
            Haga clic sobre el mapa para marcar los vértices del perímetro de la pista.
            El polígono se cierra automáticamente. Mínimo 3 puntos para guardar.
          </p>
        )}
      </div>
    </>
  );
}
