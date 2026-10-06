"use client";

import { useEffect, useState } from "react";
import type { EstadoCarreraViva, PosicionViva } from "@/lib/posiciones";

// ── Cuadrícula con lo que cada piloto está viendo ──────────────
//
// Qué es y qué NO es: cada recuadro se dibuja con lo que ESE TELÉFONO informa
// que está mostrando —su bandera ya resuelta, su batería, si la app sigue al
// frente—, no con lo que el panel calcula que debería ver. La diferencia
// importa: un espejo calculado repetiría el mismo error que la app y no
// serviría para desconfiar de ella, que es justamente para lo que existe esto.
//
// Lo que no alcanza a ver, y conviene tener presente: una notificación del
// sistema, una llamada entrante o la barra de Android no son visibles para una
// página web. Lo que sí se detecta es que la app dejó de estar al frente, y eso
// se muestra como "sin foco". Para los píxeles de verdad está la grabación de
// pantalla de Android en un auto por jornada.
//
// Costo: cero mensajes nuevos. Los tres datos viajan dentro del mensaje de
// posición que cada teléfono ya manda una vez por segundo.

const SIN_SENAL_MS = 20_000;
// Umbrales de batería. El de aviso es el mismo que pinta el borde amarillo y el
// que cuenta el chip de arriba: si no coincidieran, el resumen diría una cosa y
// los recuadros otra.
const BAT_AVISO  = 20;
const BAT_CRITICA = 10;

// Colores REALES de cada bandera, los mismos que pinta el teléfono.
// Si acá dijeran otra cosa, el recuadro mentiría.
const COLOR: Record<string, { bg: string; txt: string; sub: string; label: string }> = {
  verde:          { bg: "#16a34a", txt: "#ffffff", sub: "#dcfce7", label: "Pista libre" },
  formacion:      { bg: "#6b7280", txt: "#ffffff", sub: "#f3f4f6", label: "Formación" },
  amarilla:       { bg: "#facc15", txt: "#422006", sub: "#713f12", label: "Amarilla" },
  amarilla_doble: { bg: "#facc15", txt: "#422006", sub: "#713f12", label: "Doble amarilla" },
  roja:           { bg: "#dc2626", txt: "#ffffff", sub: "#fee2e2", label: "Roja" },
  safety_car:     { bg: "#facc15", txt: "#422006", sub: "#713f12", label: "Safety car" },
  blanca:         { bg: "#f3f4f6", txt: "#111827", sub: "#4b5563", label: "Vehículo lento" },
  negra:          { bg: "#000000", txt: "#ffffff", sub: "#d1d5db", label: "Ingrese a boxes" },
  negra_blanco:   { bg: "#1f2937", txt: "#ffffff", sub: "#d1d5db", label: "Advertencia" },
  azul:           { bg: "#2563eb", txt: "#ffffff", sub: "#dbeafe", label: "Bandera azul" },
  taller:         { bg: "#7c3aed", txt: "#ffffff", sub: "#ede9fe", label: "Ingrese a taller" },
  rayas:          { bg: "#facc15", txt: "#7f1d1d", sub: "#991b1b", label: "Pista resbaladiza" },
  cuadros:        { bg: "#1c1917", txt: "#ffffff", sub: "#d6d3d1", label: "Cuadros" },
};

interface Props {
  /** pid → lo que ese teléfono informa de sí mismo */
  pantallas: Map<string, PosicionViva & { recibido: number }>;
  /** pid → posición, vueltas y diferencias que calculó el panel */
  estado: EstadoCarreraViva["pilotos"];
  /** pid → nombre */
  nombres: Map<string, string>;
  /** Pilotos con sesión abierta, en orden */
  pilotos: { piloto_id: string; nombre: string }[];
}

const seg = (n: number | null | undefined) =>
  n == null ? "—" : `${Math.abs(n).toFixed(1)}`;

export default function PantallasPilotos({ pantallas, estado, nombres, pilotos }: Props) {
  // Reloj propio: el ref con los datos se llena a 1 Hz pero no provoca
  // re-render. Se redibuja acá, y solo mientras la pestaña está montada.
  const [, tick] = useState(0);
  useEffect(() => {
    const i = setInterval(() => tick(t => t + 1), 1000);
    return () => clearInterval(i);
  }, []);

  const ahora = Date.now();
  const filas = pilotos.map(p => {
    const vista = pantallas.get(p.piloto_id);
    const est   = estado[p.piloto_id];
    const edad  = vista ? ahora - vista.recibido : Infinity;
    const vivo  = edad < SIN_SENAL_MS;
    return { pid: p.piloto_id, nombre: p.nombre, vista, est, edad, vivo };
  });

  const sinSenal = filas.filter(f => !f.vivo).length;
  const sinFoco  = filas.filter(f => f.vivo && f.vista?.foco === false).length;
  const bateriaBaja = filas.filter(f => f.vivo && (f.vista?.bat ?? 100) <= BAT_AVISO).length;
  const enPista  = filas.filter(f => f.vivo && f.vista?.pista === true).length;

  if (!pilotos.length) {
    return (
      <div className="bg-gray-50 border border-gray-200 rounded-2xl px-6 py-14 text-center">
        <p className="text-4xl mb-3">📱</p>
        <p className="text-base font-bold text-gray-800">Sin pilotos en sesión</p>
        <p className="text-sm text-gray-400 mt-2">
          Acá aparece lo que está mostrando el teléfono de cada piloto en pista.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-lg font-bold text-gray-800">Pantallas</h2>
        <span className="text-xs text-gray-400">lo que informa cada teléfono</span>
        <div className="ml-auto flex flex-wrap gap-1.5">
          <Chip tono="ok">{enPista} en pista</Chip>
          {sinFoco > 0      && <Chip tono="aviso">{sinFoco} sin foco</Chip>}
          {bateriaBaja > 0  && <Chip tono="alerta">{bateriaBaja} con batería baja</Chip>}
          {sinSenal > 0     && <Chip tono="alerta">{sinSenal} sin señal</Chip>}
        </div>
      </div>

      <div className="grid gap-2.5 grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
        {filas.map(f => (
          <Recuadro key={f.pid} {...f} nombres={nombres} />
        ))}
      </div>

      <p className="text-xs text-gray-400 leading-relaxed">
        Borde rojo: necesita atención · Borde amarillo: aviso · Los números son
        la diferencia con el de adelante y el de atrás. Una notificación o una
        llamada no se ven; se ven como “sin foco”.
      </p>
    </div>
  );
}

function Chip({ tono, children }: { tono: "ok" | "aviso" | "alerta"; children: React.ReactNode }) {
  const c = tono === "ok"    ? "bg-emerald-50 text-emerald-700"
          : tono === "aviso" ? "bg-amber-50 text-amber-700"
          :                    "bg-red-50 text-red-700";
  return <span className={`text-xs px-2.5 py-1 rounded-lg font-medium ${c}`}>{children}</span>;
}

function Recuadro({
  nombre, vista, est, edad, vivo, nombres,
}: {
  nombre: string;
  vista?: PosicionViva & { recibido: number };
  est?: EstadoCarreraViva["pilotos"][string];
  edad: number;
  vivo: boolean;
  nombres: Map<string, string>;
}) {
  const bat = vista?.bat ?? null;
  const foco = vista?.foco !== false;
  const bandera = vista?.bd ?? "verde";
  const c = COLOR[bandera] ?? COLOR.verde;

  // Qué merece que el recuadro grite. La regla es la de Felipe: una azul sobre
  // alguien que va primero o segundo es imposible, y un teléfono callado más de
  // 20 segundos ya no es un hipo de la red.
  const azulImposible = bandera === "azul" && est?.pos != null && est.pos <= 2;
  const alerta = !vivo || azulImposible || (bat != null && bat <= BAT_CRITICA);
  const aviso  = vivo && !alerta && (!foco || (bat != null && bat <= BAT_AVISO));
  const borde  = alerta ? "border-2 border-red-500"
               : aviso  ? "border-2 border-amber-400"
               :          "border border-gray-200";

  const icono = bat == null ? "" : bat <= BAT_AVISO ? "🪫" : "🔋";
  const colorBat = bat == null ? "text-gray-300"
                 : bat <= BAT_CRITICA ? "text-red-600"
                 : bat <= BAT_AVISO ? "text-amber-600"
                 : "text-gray-400";

  return (
    <div className={`rounded-xl overflow-hidden ${borde}`}>
      <div className="flex items-center gap-1.5 px-2 py-1.5 bg-gray-50">
        <span className="text-xs font-bold text-gray-700 truncate">{nombre}</span>
        <span className={`ml-auto text-[11px] shrink-0 ${colorBat}`}>
          {icono} {bat == null ? "sin dato" : `${bat}%`}
        </span>
      </div>

      {!vivo ? (
        <div className="px-2 py-3 text-center bg-white border-t border-gray-100">
          <div className="text-xs font-medium text-red-600">📵 Sin señal</div>
          <div className="text-lg font-bold text-gray-400 my-0.5">
            {edad === Infinity ? "nunca" : `hace ${Math.round(edad / 1000)} s`}
          </div>
          <div className="text-[11px] text-gray-400">
            {est?.pos ? `última: P${est.pos} · V${est.vu}` : "sin datos previos"}
          </div>
        </div>
      ) : !foco ? (
        <div className="px-2 py-3 text-center" style={{ background: "#44403c" }}>
          <div className="text-xs font-medium" style={{ color: "#fde68a" }}>🚫 Sin foco</div>
          <div className="text-lg font-bold my-0.5" style={{ color: "#e7e5e4" }}>
            {est?.pos ? `P${est.pos} · V${est.vu}` : "—"}
          </div>
          <div className="text-[11px]" style={{ color: "#a8a29e" }}>no está viendo la app</div>
        </div>
      ) : (
        <div className="px-2 py-3 text-center" style={{ background: c.bg }}>
          <div className="text-xs font-medium truncate" style={{ color: c.sub }}>{c.label}</div>
          <div className="text-lg font-bold my-0.5" style={{ color: c.txt }}>
            {est?.pos ? `P${est.pos}` : "P—"} · V{est?.vu ?? "—"}
          </div>
          <div className="text-[11px] truncate" style={{ color: c.sub }}>
            {/* Con bandera azul el dato útil es quién te dobla, no el gap */}
            {est?.azul && est.azulDe
              ? `lo dobla ${nombres.get(est.azulDe) ?? "otro auto"}`
              : `${seg(est?.ad)} / ${seg(est?.at)}`}
          </div>
        </div>
      )}
    </div>
  );
}
