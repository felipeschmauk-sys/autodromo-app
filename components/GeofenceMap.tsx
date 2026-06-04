"use client";

/**
 * GeofenceMap.tsx
 * Editor visual de geocerca + mapa de posiciones en tiempo real.
 *
 * INSTALACIÓN REQUERIDA (ejecutar en terminal del proyecto):
 *   npm install leaflet @types/leaflet
 *
 * COLOCAR en: components/GeofenceMap.tsx
 *
 * USO en admin/page.tsx:
 *   import dynamic from 'next/dynamic'
 *   const GeofenceMap = dynamic(() => import('@/components/GeofenceMap'), { ssr: false })
 *   // Luego en el JSX:
 *   <GeofenceMap pilotosEnPista={sesionesActivas} />
 */

import { useEffect, useRef, useState, useCallback } from "react";
import {
  guardarGeocerca,
  getGeocercaActiva,
  getUltimasUbicaciones,
  type Coordenada,
} from "@/lib/gps";
import { supabase } from "@/lib/supabase";

interface PilotoEnPista {
  id: string;
  nombre: string;
  lat?: number;
  lng?: number;
  velocidad?: number;
  dentro_geocerca?: boolean;
}

interface Props {
  pilotosEnPista?: PilotoEnPista[];
}

export default function GeofenceMap({ pilotosEnPista = [] }: Props) {
  const mapRef = useRef<HTMLDivElement>(null);
  const leafletMapRef = useRef<any>(null);
  const polylineRef = useRef<any>(null);
  const markersRef = useRef<any[]>([]);
  const pilotoMarkersRef = useRef<Map<string, any>>(new Map());

  const [coordenadas, setCoordenadas] = useState<Coordenada[]>([]);
  const [modoEdicion, setModoEdicion] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [mensaje, setMensaje] = useState<{ tipo: "ok" | "error"; texto: string } | null>(null);
  const [ubicaciones, setUbicaciones] = useState<any[]>([]);
  const [geocercaCargada, setGeocercaCargada] = useState(false);

  // Inicializar mapa Leaflet
  useEffect(() => {
    if (!mapRef.current || leafletMapRef.current) return;

    const L = (window as any).L;
    if (!L) return;

    // Mapa con tile oscuro (Carto Dark)
    const map = L.map(mapRef.current, {
      center: [-33.45, -70.65], // Santiago por defecto
      zoom: 15,
      zoomControl: true,
    });

    L.tileLayer(
      "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",
      {
        attribution: "© OpenStreetMap © CARTO",
        subdomains: "abcd",
        maxZoom: 20,
      }
    ).addTo(map);

    leafletMapRef.current = map;

    // Cargar geocerca existente
    getGeocercaActiva().then((coords) => {
      if (coords && coords.length >= 3) {
        setCoordenadas(coords);
        setGeocercaCargada(true);
        dibujarPoligono(map, L, coords);
        // Centrar mapa en la geocerca
        const bounds = L.latLngBounds(coords.map((c) => [c.lat, c.lng]));
        map.fitBounds(bounds, { padding: [40, 40] });
      }
    });

    // Cargar ubicaciones de pilotos
    cargarUbicaciones(map, L);

    return () => {
      map.remove();
      leafletMapRef.current = null;
    };
  }, []);

  // Suscripción Realtime a ubicaciones
  useEffect(() => {
    const channel = supabase
      .channel("ubicaciones-live")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "ubicaciones_piloto" },
        () => {
          if (leafletMapRef.current) {
            cargarUbicaciones(leafletMapRef.current, (window as any).L);
          }
        }
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, []);

  // Modo edición: click en el mapa agrega puntos
  useEffect(() => {
    const map = leafletMapRef.current;
    const L = (window as any).L;
    if (!map || !L) return;

    const handleClick = (e: any) => {
      if (!modoEdicion) return;

      const nuevaCoord: Coordenada = { lat: e.latlng.lat, lng: e.latlng.lng };
      setCoordenadas((prev) => {
        const nuevas = [...prev, nuevaCoord];
        dibujarPoligono(map, L, nuevas);
        return nuevas;
      });
    };

    map.on("click", handleClick);
    return () => { map.off("click", handleClick); };
  }, [modoEdicion]);

  function dibujarPoligono(map: any, L: any, coords: Coordenada[]) {
    // Limpiar marcadores de vértices anteriores
    markersRef.current.forEach((m) => m.remove());
    markersRef.current = [];

    // Limpiar polígono anterior
    if (polylineRef.current) {
      polylineRef.current.remove();
      polylineRef.current = null;
    }

    if (coords.length < 2) return;

    const latLngs = coords.map((c) => [c.lat, c.lng]);

    // Dibujar polígono con estilo racing
    const poly = L.polygon(latLngs, {
      color: "#22c55e",
      fillColor: "#22c55e",
      fillOpacity: 0.08,
      weight: 2,
      dashArray: coords.length < 3 ? "6,4" : undefined,
    }).addTo(map);

    polylineRef.current = poly;

    // Marcadores de vértices
    coords.forEach((c, i) => {
      const marker = L.circleMarker([c.lat, c.lng], {
        radius: 6,
        color: "#22c55e",
        fillColor: "#111",
        fillOpacity: 1,
        weight: 2,
      })
        .bindTooltip(`Punto ${i + 1}`, { permanent: false })
        .addTo(map);
      markersRef.current.push(marker);
    });
  }

  async function cargarUbicaciones(map: any, L: any) {
    if (!L) return;
    const data = await getUltimasUbicaciones();
    setUbicaciones(data);

    // Limpiar marcadores de pilotos anteriores
    pilotoMarkersRef.current.forEach((m) => m.remove());
    pilotoMarkersRef.current.clear();

    data.forEach((u: any) => {
      if (!u.lat || !u.lng) return;

      const nombre = (u.pilotos as any)?.nombre || "Piloto";
      const vel = u.velocidad || 0;
      const dentro = u.dentro_geocerca !== false;

      const color = dentro ? "#22c55e" : "#ef4444";
      const html = `
        <div style="
          background: #111;
          border: 2px solid ${color};
          border-radius: 50%;
          width: 14px;
          height: 14px;
          box-shadow: 0 0 8px ${color}88;
        "></div>
      `;

      const icon = L.divIcon({
        html,
        className: "",
        iconSize: [14, 14],
        iconAnchor: [7, 7],
      });

      const marker = L.marker([u.lat, u.lng], { icon })
        .bindPopup(
          `<div style="background:#111;color:#fff;padding:8px;border-radius:8px;font-size:12px;min-width:120px">
            <div style="font-weight:700;margin-bottom:4px">${nombre}</div>
            <div style="color:#22c55e">${vel} km/h</div>
            <div style="color:${dentro ? '#22c55e' : '#ef4444'};font-size:11px">${dentro ? '✓ En pista' : '⚠ Fuera de pista'}</div>
          </div>`,
          { className: "leaflet-popup-dark" }
        )
        .addTo(map);

      pilotoMarkersRef.current.set(u.piloto_id, marker);
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
      setGeocercaCargada(true);
      setTimeout(() => setMensaje(null), 3000);
    }
  };

  const handleLimpiar = () => {
    setCoordenadas([]);
    setGeocercaCargada(false);
    if (polylineRef.current) polylineRef.current.remove();
    markersRef.current.forEach((m) => m.remove());
    markersRef.current = [];
  };

  return (
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
            {modoEdicion ? "✏️ Editando — clic para agregar puntos" : "✏️ Editar geocerca"}
          </button>

          {coordenadas.length > 0 && (
            <span className="text-xs text-gray-500">
              {coordenadas.length} punto{coordenadas.length !== 1 ? "s" : ""}
              {coordenadas.length >= 3 ? " — polígono válido" : " — mínimo 3"}
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

      {/* Mensaje de estado */}
      {mensaje && (
        <div
          className={`text-xs px-3 py-2 rounded-lg ${
            mensaje.tipo === "ok"
              ? "bg-green-950 border border-green-800 text-green-400"
              : "bg-red-950 border border-red-800 text-red-400"
          }`}
        >
          {mensaje.texto}
        </div>
      )}

      {/* Leyenda */}
      {ubicaciones.length > 0 && (
        <div className="flex items-center gap-4 text-xs text-gray-500">
          <span className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-green-500 inline-block" />
            En pista
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-red-500 inline-block" />
            Fuera de pista
          </span>
          <span className="text-gray-600">
            {ubicaciones.length} piloto{ubicaciones.length !== 1 ? "s" : ""} activo{ubicaciones.length !== 1 ? "s" : ""}
          </span>
        </div>
      )}

      {/* Mapa */}
      <div
        ref={mapRef}
        className="w-full rounded-xl overflow-hidden border border-gray-800"
        style={{ height: "420px" }}
      />

      {/* Instrucciones modo edición */}
      {modoEdicion && (
        <div className="text-xs text-gray-500 bg-gray-900 rounded-lg px-3 py-2 border border-gray-800">
          Haga clic en el mapa para marcar los vértices de la geocerca.
          Trace el perímetro completo de la pista. Mínimo 3 puntos para guardar.
          El último punto se conecta automáticamente al primero.
        </div>
      )}

      {/* Script de Leaflet — se carga dinámicamente */}
      <LeafletLoader />
    </div>
  );
}

// Carga Leaflet via CDN si no está disponible
function LeafletLoader() {
  useEffect(() => {
    if ((window as any).L) return;

    // CSS
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css";
    document.head.appendChild(link);

    // JS
    const script = document.createElement("script");
    script.src = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js";
    script.async = true;
    document.head.appendChild(script);

    return () => {
      // No remover — puede ser usado por otras instancias
    };
  }, []);

  return null;
}
