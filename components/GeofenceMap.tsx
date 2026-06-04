"use client";

/**
 * GeofenceMap.tsx — COLOCAR en: components/GeofenceMap.tsx
 * No requiere npm install — usa Leaflet via CDN
 * Soporta: importar KML, ubicación actual, geocerca editable
 */

import { useEffect, useRef, useState } from "react";
import { guardarGeocerca, getGeocercaActiva, getUltimasUbicaciones, type Coordenada } from "@/lib/gps";
import { supabase } from "@/lib/supabase";

interface Props {
  pilotosEnPista?: { id: string; nombre: string }[];
}

function cargarLeaflet(): Promise<any> {
  return new Promise((resolve) => {
    if ((window as any).L) { resolve((window as any).L); return; }
    if (!document.getElementById("leaflet-css")) {
      const link = document.createElement("link");
      link.id = "leaflet-css";
      link.rel = "stylesheet";
      link.href = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css";
      document.head.appendChild(link);
    }
    if (!document.getElementById("leaflet-js")) {
      const script = document.createElement("script");
      script.id = "leaflet-js";
      script.src = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js";
      script.onload = () => resolve((window as any).L);
      document.head.appendChild(script);
    } else {
      const interval = setInterval(() => {
        if ((window as any).L) { clearInterval(interval); resolve((window as any).L); }
      }, 50);
    }
  });
}

// Parsea un archivo KML y devuelve las coordenadas del primer polígono/línea encontrado
function parsearKML(contenido: string): Coordenada[] | null {
  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(contenido, "text/xml");

    // Buscar <coordinates> en el KML
    const coordNodes = doc.getElementsByTagName("coordinates");
    if (coordNodes.length === 0) return null;

    // Tomar el bloque de coordenadas más largo (el polígono principal)
    let mejorBloque = "";
    for (let i = 0; i < coordNodes.length; i++) {
      const texto = coordNodes[i].textContent || "";
      if (texto.length > mejorBloque.length) mejorBloque = texto;
    }

    // KML: cada punto es "lng,lat,alt" separados por espacios o saltos de línea
    const puntos = mejorBloque.trim().split(/\s+/);
    const coords: Coordenada[] = [];

    for (const punto of puntos) {
      const partes = punto.split(",");
      if (partes.length >= 2) {
        const lng = parseFloat(partes[0]);
        const lat = parseFloat(partes[1]);
        if (!isNaN(lat) && !isNaN(lng)) {
          coords.push({ lat, lng });
        }
      }
    }

    return coords.length >= 3 ? coords : null;
  } catch {
    return null;
  }
}

export default function GeofenceMap({ pilotosEnPista = [] }: Props) {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<any>(null);
  const polygonRef = useRef<any>(null);
  const vertexMarkersRef = useRef<any[]>([]);
  const pilotoMarkersRef = useRef<globalThis.Map<string, any>>(new globalThis.Map());
  const ubicacionActualRef = useRef<any>(null);
  const kmlInputRef = useRef<HTMLInputElement>(null);

  const [coordenadas, setCoordenadas] = useState<Coordenada[]>([]);
  const [modoEdicion, setModoEdicion] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [cargando, setCargando] = useState(true);
  const [mensaje, setMensaje] = useState<{ tipo: "ok" | "error"; texto: string } | null>(null);
  const [ubicacionActiva, setUbicacionActiva] = useState(false);

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

      L.tileLayer(
        "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
        { maxZoom: 20 }
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

      // Ubicación actual
      mostrarUbicacionActual(L, map);

      // Pilotos en pista
      getUltimasUbicaciones().then((data: any[]) => actualizarMarcadores(L, map, data));
    });

    return () => {
      if (mapInstanceRef.current) { mapInstanceRef.current.remove(); mapInstanceRef.current = null; }
    };
  }, []);

  // Click para agregar puntos en modo edición
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

  // Realtime GPS pilotos
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

  function mostrarUbicacionActual(L: any, map: any) {
    if (!navigator.geolocation) return;

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude: lat, longitude: lng } = pos.coords;
        setUbicacionActiva(true);

        // Marcador pulsante para ubicación actual
        const html = `
          <div style="position:relative;width:20px;height:20px">
            <div style="position:absolute;inset:0;background:#3b82f6;border-radius:50%;opacity:0.3;animation:pulse 2s infinite"></div>
            <div style="position:absolute;inset:4px;background:#3b82f6;border-radius:50%;border:2px solid white"></div>
          </div>
          <style>@keyframes pulse{0%,100%{transform:scale(1);opacity:0.3}50%{transform:scale(1.8);opacity:0}}</style>
        `;

        const icon = L.divIcon({ html, className: "", iconSize: [20, 20], iconAnchor: [10, 10] });

        if (ubicacionActualRef.current) ubicacionActualRef.current.remove();
        ubicacionActualRef.current = L.marker([lat, lng], { icon })
          .bindPopup(`<div style="background:#111;color:#fff;padding:6px 10px;border-radius:8px;font-size:11px;border:1px solid #333">📍 Tu ubicación actual</div>`)
          .addTo(map);

        // Si no hay geocerca cargada, centrar en ubicación actual
        if (!polygonRef.current) {
          map.setView([lat, lng], 16);
        }
      },
      () => { /* GPS no disponible o denegado */ },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  }

  // Centrar mapa en ubicación actual
  const irAUbicacionActual = () => {
    const map = mapInstanceRef.current;
    const L = (window as any).L;
    if (!map || !L) return;
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        map.setView([pos.coords.latitude, pos.coords.longitude], 17);
        mostrarUbicacionActual(L, map);
      },
      () => setMensaje({ tipo: "error", texto: "No se pudo obtener la ubicación GPS." })
    );
  };

  // Importar KML
  const handleKMLImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (ev) => {
      const contenido = ev.target?.result as string;
      const coords = parsearKML(contenido);

      if (!coords) {
        setMensaje({ tipo: "error", texto: "No se encontraron coordenadas válidas en el KML." });
        return;
      }

      const map = mapInstanceRef.current;
      const L = (window as any).L;
      if (!map || !L) return;

      setCoordenadas(coords);
      dibujarPoligono(L, map, coords);

      const bounds = L.latLngBounds(coords.map((c: Coordenada) => [c.lat, c.lng]));
      map.fitBounds(bounds, { padding: [40, 40] });

      setMensaje({ tipo: "ok", texto: `KML importado: ${coords.length} puntos cargados. Revise y guarde la geocerca.` });
      setTimeout(() => setMensaje(null), 5000);
    };
    reader.readAsText(file);

    // Limpiar input para permitir reimportar el mismo archivo
    e.target.value = "";
  };

  function dibujarPoligono(L: any, map: any, coords: Coordenada[]) {
    vertexMarkersRef.current.forEach((m) => m.remove());
    vertexMarkersRef.current = [];
    if (polygonRef.current) { polygonRef.current.remove(); polygonRef.current = null; }
    if (coords.length < 2) return;

    polygonRef.current = L.polygon(
      coords.map((c) => [c.lat, c.lng]),
      { color: "#22c55e", fillColor: "#22c55e", fillOpacity: 0.1, weight: 2.5 }
    ).addTo(map);

    // Mostrar vértices solo si son pocos (KML puede tener cientos)
    if (coords.length <= 30) {
      coords.forEach((c, i) => {
        const m = L.circleMarker([c.lat, c.lng], {
          radius: 4, color: "#22c55e", fillColor: "#0a0a0a", fillOpacity: 1, weight: 2,
        }).bindTooltip(`Punto ${i + 1}`).addTo(map);
        vertexMarkersRef.current.push(m);
      });
    }
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
      const icon = (window as any).L.divIcon({
        html: `<div style="background:#111;border:2px solid ${color};border-radius:50%;width:14px;height:14px;box-shadow:0 0 8px ${color}88"></div>`,
        className: "", iconSize: [14, 14], iconAnchor: [7, 7],
      });
      const marker = L.marker([u.lat, u.lng], { icon })
        .bindPopup(`<div style="background:#111;color:#fff;padding:8px 10px;border-radius:8px;font-size:12px;min-width:120px;border:1px solid #222">
          <div style="font-weight:700;margin-bottom:3px">${nombre}</div>
          <div style="color:#22c55e">${vel} km/h</div>
          <div style="color:${color};font-size:11px;margin-top:2px">${dentro ? "✓ En pista" : "⚠ Fuera de pista"}</div>
        </div>`).addTo(map);
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
        .leaflet-container { background: #0a0a0a !important; }
        .leaflet-popup-content-wrapper { background: transparent !important; border: none !important; box-shadow: none !important; padding: 0 !important; }
        .leaflet-popup-tip-container { display: none; }
        .leaflet-control-attribution { display: none !important; }
        .leaflet-bar a { background: #1a1a1a !important; color: #fff !important; border-color: #333 !important; }
        .leaflet-bar a:hover { background: #222 !important; }
      `}</style>

      {/* Input KML oculto */}
      <input
        ref={kmlInputRef}
        type="file"
        accept=".kml,.kmz"
        className="hidden"
        onChange={handleKMLImport}
      />

      <div className="flex flex-col gap-3">
        {/* Toolbar fila 1: edición y KML */}
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center gap-2 flex-wrap">
            <button
              onClick={() => setModoEdicion((v) => !v)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                modoEdicion
                  ? "bg-green-500 text-white shadow-lg shadow-green-500/30"
                  : "bg-gray-800 text-gray-300 hover:bg-gray-700 border border-gray-700"
              }`}
            >
              {modoEdicion ? "✏️ Editando — clic en el mapa" : "✏️ Editar geocerca"}
            </button>

            <button
              onClick={() => kmlInputRef.current?.click()}
              className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-blue-900 text-blue-300 hover:bg-blue-800 border border-blue-800 transition"
            >
              📂 Importar KML
            </button>

            <button
              onClick={irAUbicacionActual}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition ${
                ubicacionActiva
                  ? "bg-blue-950 text-blue-400 border-blue-800 hover:bg-blue-900"
                  : "bg-gray-800 text-gray-400 border-gray-700 hover:bg-gray-700"
              }`}
            >
              {ubicacionActiva ? "📍 Mi ubicación" : "📍 Buscar ubicación"}
            </button>

            {coordenadas.length > 0 && (
              <span className="text-xs text-gray-500">
                {coordenadas.length} puntos{coordenadas.length >= 3 ? " ✓" : " (mín. 3)"}
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
        <div className="relative w-full rounded-xl overflow-hidden border border-gray-800" style={{ height: "460px" }}>
          {cargando && (
            <div className="absolute inset-0 flex items-center justify-center bg-gray-950 z-10">
              <span className="text-xs text-gray-500 animate-pulse">Cargando mapa...</span>
            </div>
          )}
          <div ref={mapRef} style={{ width: "100%", height: "100%" }} />
        </div>

        {modoEdicion && (
          <p className="text-xs text-gray-500">
            Clic en el mapa para agregar vértices. El polígono se cierra automáticamente al guardar.
          </p>
        )}
      </div>
    </>
  );
}
