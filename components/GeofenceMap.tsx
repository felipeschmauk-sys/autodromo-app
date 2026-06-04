"use client";

/**
 * GeofenceMap.tsx — COLOCAR en: components/GeofenceMap.tsx
 * No requiere npm install — usa Leaflet via CDN
 */

import { useEffect, useRef, useState } from "react";
import { guardarGeocerca, getGeocercaActiva, getUltimasUbicaciones, type Coordenada } from "@/lib/gps";
import { supabase } from "@/lib/supabase";

interface Props {
  pilotosEnPista?: { id: string; nombre: string }[];
}

// Carga Leaflet CSS + JS desde CDN y devuelve una promesa que resuelve cuando está listo
function cargarLeaflet(): Promise<any> {
  return new Promise((resolve) => {
    // Si ya está cargado, resolver inmediatamente
    if ((window as any).L) {
      resolve((window as any).L);
      return;
    }

    // CSS
    if (!document.getElementById("leaflet-css")) {
      const link = document.createElement("link");
      link.id = "leaflet-css";
      link.rel = "stylesheet";
      link.href = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css";
      document.head.appendChild(link);
    }

    // JS
    if (!document.getElementById("leaflet-js")) {
      const script = document.createElement("script");
      script.id = "leaflet-js";
      script.src = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js";
      script.onload = () => resolve((window as any).L);
      document.head.appendChild(script);
    } else {
      // Script ya existe, esperar a que cargue
      const interval = setInterval(() => {
        if ((window as any).L) {
          clearInterval(interval);
          resolve((window as any).L);
        }
      }, 50);
    }
  });
}

export default function GeofenceMap({ pilotosEnPista = [] }: Props) {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<any>(null);
  const polygonRef = useRef<any>(null);
  const vertexMarkersRef = useRef<any[]>([]);
  const pilotoMarkersRef = useRef<globalThis.Map<string, any>>(new globalThis.Map());

  const [coordenadas, setCoordenadas] = useState<Coordenada[]>([]);
  const [modoEdicion, setModoEdicion] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [cargando, setCargando] = useState(true);
  const [mensaje, setMensaje] = useState<{ tipo: "ok" | "error"; texto: string } | null>(null);

  // Inicializar mapa
  useEffect(() => {
    if (!mapRef.current) return;

    cargarLeaflet().then((L) => {
      if (!mapRef.current || mapInstanceRef.current) return;

      setCargando(false);

      const map = L.map(mapRef.current, {
        center: [-33.58, -70.58],
        zoom: 15,
        zoomControl: true,
      });

      // Satélite Esri — gratuito, sin API key, buena cobertura Chile
      L.tileLayer(
        "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
        { maxZoom: 20, attribution: "Tiles © Esri" }
      ).addTo(map);

      mapInstanceRef.current = map;

      // Cargar geocerca guardada
      getGeocercaActiva().then((coords) => {
        if (coords && coords.length >= 3) {
          setCoordenadas(coords);
          dibujarPoligono(L, map, coords);
          const bounds = L.latLngBounds(coords.map((c: Coordenada) => [c.lat, c.lng]));
          map.fitBounds(bounds, { padding: [50, 50] });
        }
      });

      // Cargar posiciones de pilotos
      getUltimasUbicaciones().then((data: any[]) => {
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

  // Modo edición: click para agregar puntos
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map) return;

    const handleClick = (e: any) => {
      if (!modoEdicion) return;
      const nueva: Coordenada = { lat: e.latlng.lat, lng: e.latlng.lng };
      setCoordenadas((prev) => {
        const nuevas = [...prev, nueva];
        const L = (window as any).L;
        if (L) dibujarPoligono(L, map, nuevas);
        return nuevas;
      });
    };

    map.on("click", handleClick);
    return () => { map.off("click", handleClick); };
  }, [modoEdicion, mapInstanceRef.current]);

  // Realtime: actualizar posiciones cuando llegan datos nuevos
  useEffect(() => {
    const channel = supabase
      .channel("gps-live-map")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "ubicaciones_piloto" }, () => {
        const map = mapInstanceRef.current;
        const L = (window as any).L;
        if (!map || !L) return;
        getUltimasUbicaciones().then((data: any[]) => actualizarMarcadores(L, map, data));
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, []);

  function dibujarPoligono(L: any, map: any, coords: Coordenada[]) {
    vertexMarkersRef.current.forEach((m) => m.remove());
    vertexMarkersRef.current = [];
    if (polygonRef.current) { polygonRef.current.remove(); polygonRef.current = null; }
    if (coords.length < 2) return;

    polygonRef.current = L.polygon(
      coords.map((c) => [c.lat, c.lng]),
      { color: "#22c55e", fillColor: "#22c55e", fillOpacity: 0.07, weight: 2 }
    ).addTo(map);

    coords.forEach((c, i) => {
      const m = L.circleMarker([c.lat, c.lng], {
        radius: 5, color: "#22c55e", fillColor: "#0a0a0a", fillOpacity: 1, weight: 2,
      }).bindTooltip(`Punto ${i + 1}`).addTo(map);
      vertexMarkersRef.current.push(m);
    });
  }

  function actualizarMarcadores(L: any, map: any, data: any[]) {
    pilotoMarkersRef.current.forEach((m) => m.remove());
    pilotoMarkersRef.current.clear();

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
        .bindPopup(`<div style="background:#111;color:#fff;padding:8px 10px;border-radius:8px;font-size:12px;min-width:120px;border:1px solid #222">
          <div style="font-weight:700;margin-bottom:3px">${nombre}</div>
          <div style="color:#22c55e">${vel} km/h</div>
          <div style="color:${color};font-size:11px;margin-top:2px">${dentro ? "✓ En pista" : "⚠ Fuera de pista"}</div>
        </div>`)
        .addTo(map);

      pilotoMarkersRef.current.set(u.piloto_id, marker);
    });
  }

  const handleGuardar = async () => {
    if (coordenadas.length < 3) {
      setMensaje({ tipo: "error", texto: "Se necesitan al menos 3 puntos." });
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
      <style>{`
        .leaflet-container { background: #0a0a0a !important; font-family: inherit; }
        .leaflet-popup-content-wrapper { background: transparent !important; border: none !important; box-shadow: none !important; padding: 0 !important; }
        .leaflet-popup-tip-container { display: none; }
        .leaflet-control-attribution { display: none !important; }
        .leaflet-bar a { background: #1a1a1a !important; color: #fff !important; border-color: #333 !important; }
        .leaflet-bar a:hover { background: #222 !important; }
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
              {modoEdicion ? "✏️ Editando — clic en el mapa para marcar puntos" : "✏️ Editar geocerca"}
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
        <div className="relative w-full rounded-xl overflow-hidden border border-gray-800" style={{ height: "420px" }}>
          {cargando && (
            <div className="absolute inset-0 flex items-center justify-center bg-gray-950 z-10">
              <span className="text-xs text-gray-500 animate-pulse">Cargando mapa...</span>
            </div>
          )}
          <div ref={mapRef} style={{ width: "100%", height: "100%" }} />
        </div>

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
