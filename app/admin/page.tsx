"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import dynamic from "next/dynamic";
import {
  getTodosLosPilotos,
  getPilotosEnSesion,
  validarQRToken,
  confirmarIngreso,
} from "@/lib/auth";
import { supabase } from "@/lib/supabase";
const GeofenceMap = dynamic(() => import('@/components/GeofenceMap'), { ssr: false })

const QrScanner = dynamic(() => import("@/components/QrScanner"), {
  ssr: false,
  loading: () => (
    <div className="text-center py-10 text-gray-400 text-sm">Iniciando cámara…</div>
  ),
});

// ─── Types ────────────────────────────────────────────────────────────────────
interface Piloto {
  id: string;
  nombre: string;
  rut: string;
  telefono: string;
  prueba_aprobada: boolean;
  saldo_minutos: number;
  bloqueado: boolean;
}

interface SesionActiva {
  id: string;
  piloto_id: string;
  inicio: string;
  piloto?: Piloto;
}

interface ValidacionResult {
  valido: boolean;
  motivo?: string;
  piloto?: Piloto;
  qr_id?: string;
  advertencia?: string;
}

type PanelTab = "direccion" | "qr" | "pilotos" | "config";
type QRStep = "idle" | "scanning" | "validating" | "result" | "confirmed";

const MAX_PILOTOS_DEFAULT = 10;
const MIN_SALDO_DEFAULT = 5;

const AUTODROMO_OPTIONS = [
  "Las Vizcachas — Puente Alto, RM",
  "Leyda — San Antonio, RM",
  "Codegua — O'Higgins",
  "Interlomas — Santiago",
  "Huachalalume — IV Región",
];

export default function AdminPage() {
  const [autenticado, setAutenticado] = useState(false);
  const [loginEmail, setLoginEmail] = useState("");
  const [loginPass, setLoginPass] = useState("");
  const [loginError, setLoginError] = useState("");

  const [tab, setTab] = useState<PanelTab>("direccion");
  const [pilotos, setPilotos] = useState<Piloto[]>([]);
  const [sesiones, setSesiones] = useState<SesionActiva[]>([]);
  const [loadingPilotos, setLoadingPilotos] = useState(false);
  const [maxPilotos, setMaxPilotos] = useState(MAX_PILOTOS_DEFAULT);
  const [minSaldo, setMinSaldo] = useState(MIN_SALDO_DEFAULT);
  const [banderaRoja, setBanderaRoja] = useState(false);
  const [autodromo, setAutodromo] = useState(AUTODROMO_OPTIONS[0]);
  const [busqueda, setBusqueda] = useState("");
  const [alertas, setAlertas] = useState<string[]>([]);
  const [realtimeConectado, setRealtimeConectado] = useState(false);

  const [qrStep, setQrStep] = useState<QRStep>("idle");
  const [validacion, setValidacion] = useState<ValidacionResult | null>(null);
  const [scanError, setScanError] = useState("");

  // ── Login ────────────────────────────────────────────────────────────────
  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault();
    if (loginEmail === "admin@autodromo.cl" && loginPass === "admin123") {
      setAutenticado(true);
    } else {
      setLoginError("Credenciales incorrectas");
    }
  };

  // ── Data ─────────────────────────────────────────────────────────────────
  const cargarPilotos = useCallback(async () => {
    setLoadingPilotos(true);
    try {
      const data = await getTodosLosPilotos();
      setPilotos(data || []);
    } catch {
      setPilotos([]);
    } finally {
      setLoadingPilotos(false);
    }
  }, []);

  const cargarSesiones = useCallback(async () => {
    try {
      const data = await getPilotosEnSesion();
      setSesiones(data || []);
      // Generar alertas de saldo bajo
      const nuevasAlertas = (data || [])
        .filter((s: SesionActiva) => s.piloto && s.piloto.saldo_minutos < 20)
        .map((s: SesionActiva) => `${s.piloto?.nombre} — saldo bajo (${s.piloto?.saldo_minutos} min)`);
      setAlertas(nuevasAlertas);
    } catch {
      setSesiones([]);
    }
  }, []);

   useEffect(() => {
    if (!autenticado) return;

    // Carga inicial
    cargarPilotos();
    cargarSesiones();

    // Suscripción Realtime a tabla sesiones
    const channel = supabase
      .channel("admin-sesiones-live")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "sesiones" },
        () => {
          // Cada vez que cambia una sesión (INSERT/UPDATE/DELETE),
          // recargar la lista automáticamente — sin polling
          cargarSesiones();
        }
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "pilotos" },
        () => {
          cargarPilotos();
        }
      )
      .subscribe((status) => {
        setRealtimeConectado(status === "SUBSCRIBED");
      });

    return () => {
      supabase.removeChannel(channel);
      setRealtimeConectado(false);
    };
  }, [autenticado, cargarPilotos, cargarSesiones]);

  // ── QR ───────────────────────────────────────────────────────────────────
  const iniciarScanner = useCallback(() => {
    setScanError("");
    setValidacion(null);
    setQrStep("scanning");
  }, []);

  const detenerScanner = useCallback(() => {
    setQrStep("idle");
    setValidacion(null);
    setScanError("");
  }, []);

  const handleScan = useCallback(async (decodedText: string) => {
    setQrStep("validating");
    try {
      const result = await validarQRToken(decodedText, maxPilotos, minSaldo);
      // Normalize field name (auth.ts uses 'autorizado', panel expects 'valido')
      const normalized: ValidacionResult = {
        valido: (result as any).valido ?? (result as any).autorizado ?? false,
        motivo: (result as any).motivo,
        piloto: (result as any).piloto,
        qr_id: (result as any).qr_id,
      };
      setValidacion(normalized);
      setQrStep("result");
    } catch {
      setValidacion({ valido: false, motivo: "Error al validar el token QR" });
      setQrStep("result");
    }
  }, [maxPilotos, minSaldo]);

  const handleConfirmarIngreso = async () => {
    if (!validacion?.qr_id || !validacion?.piloto?.id) return;
    try {
      await confirmarIngreso(validacion.qr_id, validacion.piloto.id);
      setQrStep("confirmed");
      await cargarSesiones();
      setTimeout(() => { setQrStep("idle"); setValidacion(null); }, 3000);
    } catch {
      setScanError("Error al confirmar el ingreso.");
    }
  };

  useEffect(() => {
    if (tab !== "qr") detenerScanner();
  }, [tab, detenerScanner]);

  const pilotosFiltrados = pilotos.filter(p =>
    p.nombre.toLowerCase().includes(busqueda.toLowerCase()) ||
    p.rut.includes(busqueda)
  );

  const nombreAutodromo = autodromo.split(" — ")[0];

  // ── Login screen ──────────────────────────────────────────────────────────
  if (!autenticado) {
    return (
      <div className="min-h-screen bg-gray-100 flex items-center justify-center p-4">
        <div className="w-full max-w-sm bg-white rounded-2xl shadow-lg overflow-hidden">
          <div className="bg-gray-900 text-white px-6 py-5 flex items-center gap-3">
            <span className="text-2xl">🏁</span>
            <div>
              <div className="font-bold text-sm tracking-wide">Panel Maestro</div>
              <div className="text-xs text-gray-400">Autódromo · Acceso restringido</div>
            </div>
          </div>
          <form onSubmit={handleLogin} className="p-6 space-y-4">
            <div>
              <label className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Email</label>
              <input
                type="email"
                value={loginEmail}
                onChange={e => setLoginEmail(e.target.value)}
                className="mt-1 w-full border border-gray-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900"
                placeholder="admin@autodromo.cl"
                required
              />
            </div>
            <div>
              <label className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Contraseña</label>
              <input
                type="password"
                value={loginPass}
                onChange={e => setLoginPass(e.target.value)}
                className="mt-1 w-full border border-gray-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900"
                placeholder="••••••••"
                required
              />
            </div>
            {loginError && <p className="text-red-500 text-sm">{loginError}</p>}
            <button
              type="submit"
              className="w-full bg-gray-900 hover:bg-gray-800 text-white font-semibold py-3 rounded-xl transition-colors text-sm"
            >
              Ingresar
            </button>
          </form>
        </div>
      </div>
    );
  }

  // ── Main Panel ────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-gray-100">

      {/* Header */}
      <header className="bg-gray-900 text-white px-5 py-3 flex items-center justify-between sticky top-0 z-50">
        <div className="flex items-center gap-3">
          <span className="text-xl">🏁</span>
          <div>
            <div className="font-bold text-sm leading-none">Panel Maestro</div>
            <div className="text-xs text-gray-400 leading-none mt-0.5">{nombreAutodromo} · Jornada activa</div>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {alertas.length > 0 && (
            <div className="flex items-center gap-1.5 bg-amber-500 text-white text-xs font-bold px-2.5 py-1 rounded-full">
              ⚠ {alertas.length}
            </div>
          )}
          <div className={`flex items-center gap-1.5 text-xs font-medium ${realtimeConectado ? "text-green-400" : "text-yellow-400"}`}>
            <span className={`w-2 h-2 rounded-full inline-block ${realtimeConectado ? "bg-green-400 animate-pulse" : "bg-yellow-400"}`} />
            {realtimeConectado ? "En vivo" : "Conectando..."}
          </div>
          <button
            onClick={() => setAutenticado(false)}
            className="text-gray-400 hover:text-white text-xs transition-colors"
          >
            Salir
          </button>
        </div>
      </header>

      {/* Tab Navigation */}
      <nav className="bg-white border-b border-gray-200 px-4 flex sticky top-[52px] z-40">
        {([
          { id: "direccion", label: "Dirección", emoji: "🏎" },
          { id: "qr", label: "Acceso QR", emoji: "📷" },
          { id: "pilotos", label: "Pilotos", emoji: "👤" },
          { id: "config", label: "Config", emoji: "⚙️" },
        ] as const).map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`flex items-center gap-1.5 px-4 py-3.5 text-sm font-medium border-b-2 transition-all ${
              tab === t.id
                ? "border-gray-900 text-gray-900"
                : "border-transparent text-gray-500 hover:text-gray-700"
            }`}
          >
            <span className="text-base">{t.emoji}</span>
            <span>{t.label}</span>
          </button>
        ))}
      </nav>

      <main className="max-w-3xl mx-auto p-4 space-y-4">

        {/* ── DIRECCIÓN ──────────────────────────────────────────────── */}
        {tab === "direccion" && (
          <>
            {/* Estado de pista + Bandera roja */}
            <div className={`rounded-2xl border-2 px-5 py-4 flex items-center justify-between ${
              banderaRoja
                ? "bg-red-50 border-red-300"
                : "bg-green-50 border-green-300"
            }`}>
              <div className="flex items-center gap-3">
                <div className={`w-3 h-3 rounded-full flex-shrink-0 ${
                  banderaRoja ? "bg-red-500" : "bg-green-500 animate-pulse"
                }`} />
                <div>
                  <p className={`font-bold text-base leading-tight ${banderaRoja ? "text-red-700" : "text-green-700"}`}>
                    {banderaRoja ? "Bandera roja activa" : "Pista habilitada"}
                  </p>
                  <p className="text-sm text-gray-500">
                    {sesiones.length} de {maxPilotos} cupos ocupados · {nombreAutodromo}
                  </p>
                </div>
              </div>
              <button
                onClick={() => setBanderaRoja(!banderaRoja)}
                className={`flex items-center gap-2 px-4 py-2 rounded-xl font-bold text-sm transition-all ${
                  banderaRoja
                    ? "bg-gray-900 text-white hover:bg-gray-700"
                    : "bg-red-600 hover:bg-red-700 text-white"
                }`}
              >
                🚩 {banderaRoja ? "Desactivar" : "Bandera roja"}
              </button>
            </div>

            {/* Capacidad de pista */}
            <div className="bg-white rounded-2xl border border-gray-200 px-5 py-4">
              <div className="flex items-center justify-between mb-3">
                <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Capacidad de pista</span>
                <span className="text-sm font-bold text-gray-900">{sesiones.length} / {maxPilotos}</span>
              </div>
              <div className="h-2.5 bg-gray-100 rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all duration-500 ${
                    sesiones.length / maxPilotos >= 0.9 ? "bg-red-500"
                    : sesiones.length / maxPilotos >= 0.7 ? "bg-amber-400"
                    : "bg-green-500"
                  }`}
                  style={{ width: `${Math.min(100, (sesiones.length / maxPilotos) * 100)}%` }}
                />
              </div>
            </div>

            {/* Alertas activas */}
            {alertas.length > 0 && (
              <div className="bg-amber-50 border border-amber-200 rounded-2xl px-5 py-4">
                <p className="text-xs font-semibold text-amber-700 uppercase tracking-wider mb-2">⚠ Alertas activas</p>
                {alertas.map((a, i) => (
                  <div key={i} className="flex items-center justify-between py-1">
                    <span className="text-sm text-amber-800">{a}</span>
                    <button
                      onClick={() => setAlertas(alertas.filter((_, j) => j !== i))}
                      className="text-amber-400 hover:text-amber-600 text-lg leading-none ml-4"
                    >×</button>
                  </div>
                ))}
              </div>
            )}

            {/* Pilotos en sesión */}
            <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
              <div className="px-5 py-3.5 border-b border-gray-100 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
                  <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Pilotos en sesión</span>
                </div>
                <button onClick={cargarSesiones} className="text-gray-400 hover:text-gray-600 transition-colors">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                  </svg>
                </button>
              </div>
              {sesiones.length === 0 ? (
                <div className="px-5 py-8 text-center text-gray-400 text-sm">
                  Ningún piloto activo en este momento
                </div>
              ) : (
                <div className="divide-y divide-gray-50">
                  {sesiones.map(s => {
                    const nombre = s.piloto?.nombre || `Piloto ${s.piloto_id.slice(0, 6)}`;
                    const iniciales = nombre.split(" ").map(n => n[0]).join("").slice(0, 2).toUpperCase();
                    const saldo = s.piloto?.saldo_minutos ?? 0;
                    const colors = ["bg-indigo-500", "bg-teal-500", "bg-orange-500", "bg-pink-500", "bg-purple-500"];
                    const color = colors[nombre.charCodeAt(0) % colors.length];
                    return (
                      <div key={s.id} className="px-5 py-3.5 flex items-center gap-4">
                        <div className={`w-9 h-9 rounded-full ${color} text-white text-sm font-bold flex items-center justify-center flex-shrink-0`}>
                          {iniciales}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-semibold text-gray-900 truncate">{nombre}</p>
                          <p className="text-xs text-gray-400">
                            {new Date(s.inicio).toLocaleTimeString("es-CL", { hour: "2-digit", minute: "2-digit" })}
                          </p>
                        </div>
                        {saldo < 20 && (
                          <span className="text-xs text-amber-600 font-medium">⚠ Saldo bajo</span>
                        )}
                        <span className={`text-sm font-bold ${saldo < 20 ? "text-amber-600" : "text-gray-900"}`}>
                          {saldo} min
                        </span>
                        <span className="text-xs bg-green-100 text-green-700 font-medium px-2.5 py-1 rounded-full">
                          En pista
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Log de acciones */}
            <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
              <div className="px-5 py-3.5 border-b border-gray-100">
                <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Log de acciones</span>
              </div>
              <div className="divide-y divide-gray-50">
                {sesiones.slice(0, 5).map(s => (
                  <div key={s.id} className="px-5 py-3 flex items-center gap-3">
                    <span className="text-xs text-gray-400 w-12 flex-shrink-0">
                      {new Date(s.inicio).toLocaleTimeString("es-CL", { hour: "2-digit", minute: "2-digit" })}
                    </span>
                    <span className="text-sm text-gray-600">
                      {s.piloto?.nombre || `Piloto ${s.piloto_id.slice(0, 6)}`} — QR escaneado. Acceso autorizado.
                    </span>
                  </div>
                ))}
                {sesiones.length === 0 && (
                  <div className="px-5 py-6 text-center text-gray-400 text-sm">Sin registros aún</div>
                )}
              </div>
            </div>
          </>
        )}

        {/* ── ACCESO QR ──────────────────────────────────────────────── */}
        {tab === "qr" && (
          <>
            <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
              <div className="px-5 py-3.5 border-b border-gray-100">
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Escanear QR de ingreso</p>
              </div>

              {qrStep === "idle" && (
                <div
                  onClick={sesiones.length < maxPilotos ? iniciarScanner : undefined}
                  className={`m-4 border-2 border-dashed rounded-2xl p-10 flex flex-col items-center gap-3 transition-all ${
                    sesiones.length >= maxPilotos
                      ? "border-gray-200 opacity-50 cursor-not-allowed"
                      : "border-indigo-300 cursor-pointer hover:border-indigo-500 hover:bg-indigo-50"
                  }`}
                >
                  <span className="text-4xl">📷</span>
                  <p className="text-indigo-600 font-semibold text-sm">
                    {sesiones.length >= maxPilotos ? "Pista llena" : "Activar cámara para escanear QR"}
                  </p>
                  {scanError && <p className="text-red-500 text-xs text-center">{scanError}</p>}
                </div>
              )}

              {qrStep === "scanning" && (
                <div className="p-4">
<QrScanner onScan={handleScan} active={qrStep === "scanning"} />
                  <button
                    onClick={detenerScanner}
                    className="mt-3 w-full text-sm text-gray-500 border border-gray-200 rounded-xl py-2 hover:bg-gray-50 transition-colors"
                  >
                    Cancelar
                  </button>
                </div>
              )}

              {qrStep === "validating" && (
                <div className="py-12 flex flex-col items-center gap-3">
                  <div className="w-10 h-10 border-4 border-gray-200 border-t-gray-900 rounded-full animate-spin" />
                  <p className="text-sm text-gray-500">Validando…</p>
                </div>
              )}

              {qrStep === "result" && validacion && (
                <div className="p-4 space-y-3">
                  <div className={`rounded-xl p-4 border-2 flex items-center gap-3 ${
                    validacion.valido ? "bg-green-50 border-green-300" : "bg-red-50 border-red-300"
                  }`}>
                    <span className="text-2xl">{validacion.valido ? "✅" : "❌"}</span>
                    <div>
                      <p className={`font-bold text-sm ${validacion.valido ? "text-green-700" : "text-red-700"}`}>
                        {validacion.valido ? "QR Válido" : "QR Rechazado"}
                      </p>
                      {validacion.motivo && <p className="text-xs text-gray-500 mt-0.5">{validacion.motivo}</p>}
                    </div>
                  </div>

                  {validacion.piloto && (
                    <div className="bg-gray-50 rounded-xl p-4 border border-gray-100 space-y-2 text-sm">
                      <p className="font-bold text-gray-900">{validacion.piloto.nombre}</p>
                      <div className="grid grid-cols-2 gap-2">
                        <div><span className="text-gray-400 text-xs">RUT</span><p className="font-medium">{validacion.piloto.rut}</p></div>
                        <div><span className="text-gray-400 text-xs">Saldo</span><p className={`font-bold ${validacion.piloto.saldo_minutos < minSaldo ? "text-red-500" : "text-green-600"}`}>{validacion.piloto.saldo_minutos} min</p></div>
                        <div><span className="text-gray-400 text-xs">Prueba</span><p className={validacion.piloto.prueba_aprobada ? "text-green-600 font-medium" : "text-red-500 font-medium"}>{validacion.piloto.prueba_aprobada ? "✓ Aprobada" : "✗ Pendiente"}</p></div>
                        <div><span className="text-gray-400 text-xs">Teléfono</span><p className="font-medium">{validacion.piloto.telefono}</p></div>
                      </div>
                    </div>
                  )}

                  <div className="flex gap-2">
                    <button
                      onClick={() => { setQrStep("idle"); setValidacion(null); }}
                      className="flex-1 border border-gray-200 text-gray-700 font-medium py-2.5 rounded-xl text-sm hover:bg-gray-50 transition-colors"
                    >
                      Cancelar
                    </button>
                    {validacion.valido ? (
                      <button
                        onClick={handleConfirmarIngreso}
                        className="flex-1 bg-green-600 hover:bg-green-700 text-white font-bold py-2.5 rounded-xl text-sm transition-colors"
                      >
                        ✓ Confirmar ingreso
                      </button>
                    ) : (
                      <button
                        onClick={iniciarScanner}
                        className="flex-1 bg-gray-900 hover:bg-gray-700 text-white font-medium py-2.5 rounded-xl text-sm transition-colors"
                      >
                        Escanear otro
                      </button>
                    )}
                  </div>
                </div>
              )}

              {qrStep === "confirmed" && (
                <div className="py-12 flex flex-col items-center gap-3">
                  <div className="w-14 h-14 bg-green-100 rounded-full flex items-center justify-center text-2xl">✓</div>
                  <p className="text-green-700 font-bold">¡Ingreso confirmado!</p>
                  <p className="text-sm text-gray-400">El piloto ha sido registrado en pista</p>
                </div>
              )}
            </div>

            {/* Control manual */}
            <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
              <div className="px-5 py-3.5 border-b border-gray-100">
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Control manual de tanda</p>
              </div>
              <div className="p-4 space-y-3">
                <div className="flex gap-2">
                  <input
                    type="text"
                    placeholder="Buscar piloto por nombre o RUT..."
                    className="flex-1 border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900"
                  />
                  <button className="bg-green-600 hover:bg-green-700 text-white font-medium px-4 py-2.5 rounded-xl text-sm flex items-center gap-1.5 transition-colors">
                    ▶ Iniciar
                  </button>
                  <button className="bg-red-600 hover:bg-red-700 text-white font-medium px-4 py-2.5 rounded-xl text-sm flex items-center gap-1.5 transition-colors">
                    ■ Cerrar
                  </button>
                </div>
                <p className="text-xs text-gray-400">Solo usar si el QR falla. Queda registrado en el log.</p>
              </div>
            </div>
          </>
        )}

        {/* ── PILOTOS ────────────────────────────────────────────────── */}
        {tab === "pilotos" && (
          <>
            <div className="flex items-center justify-between">
              <h2 className="text-base font-bold text-gray-900">Pilotos registrados</h2>
              <input
                type="text"
                placeholder="Buscar..."
                value={busqueda}
                onChange={e => setBusqueda(e.target.value)}
                className="border border-gray-200 rounded-xl px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900 w-40"
              />
            </div>

            {loadingPilotos ? (
              <div className="bg-white rounded-2xl border border-gray-200 py-12 flex justify-center">
                <div className="w-8 h-8 border-4 border-gray-200 border-t-gray-900 rounded-full animate-spin" />
              </div>
            ) : (
              <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
                <div className="divide-y divide-gray-50">
                  {pilotosFiltrados.map(p => {
                    const enPista = sesiones.some(s => s.piloto_id === p.id);
                    const iniciales = p.nombre.split(" ").map(n => n[0]).join("").slice(0, 2).toUpperCase();
                    const colors = ["bg-indigo-500", "bg-teal-500", "bg-orange-500", "bg-pink-500", "bg-purple-500"];
                    const color = colors[p.nombre.charCodeAt(0) % colors.length];
                    return (
                      <div key={p.id} className="px-5 py-3.5 flex items-center gap-4">
                        <div className={`w-9 h-9 rounded-full ${color} text-white text-sm font-bold flex items-center justify-center flex-shrink-0`}>
                          {iniciales}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-semibold text-gray-900 truncate">{p.nombre}</p>
                          <p className="text-xs text-gray-400">{p.rut}</p>
                        </div>
                        <div className="text-right flex-shrink-0 flex items-center gap-3">
                          {p.bloqueado ? (
                            <span className="text-xs bg-red-100 text-red-600 font-medium px-2.5 py-1 rounded-full flex items-center gap-1">
                              🔴 Bloqueado
                            </span>
                          ) : enPista ? (
                            <span className="text-xs bg-green-100 text-green-700 font-medium px-2.5 py-1 rounded-full flex items-center gap-1">
                              🟢 En pista
                            </span>
                          ) : (
                            <span className="text-xs bg-gray-100 text-gray-500 font-medium px-2.5 py-1 rounded-full">
                              Fuera
                            </span>
                          )}
                          <span className={`text-sm font-bold ${p.saldo_minutos < minSaldo ? "text-red-500" : "text-gray-900"}`}>
                            {p.saldo_minutos} min
                          </span>
                          <button className="text-xs border border-gray-200 px-3 py-1.5 rounded-lg hover:bg-gray-50 text-gray-600 transition-colors">
                            Ver
                          </button>
                        </div>
                      </div>
                    );
                  })}
                  {pilotosFiltrados.length === 0 && (
                    <div className="py-10 text-center text-gray-400 text-sm">No hay pilotos</div>
                  )}
                </div>
              </div>
            )}

            <div className="flex gap-2 flex-wrap">
              <button onClick={cargarPilotos} className="text-xs border border-green-200 text-green-700 bg-green-50 px-4 py-2 rounded-xl font-medium hover:bg-green-100 transition-colors">
                + Cargar minutos
              </button>
              <button className="text-xs border border-orange-200 text-orange-700 bg-orange-50 px-4 py-2 rounded-xl font-medium hover:bg-orange-100 transition-colors">
                🔒 Bloquear piloto
              </button>
              <button className="text-xs border border-yellow-200 text-yellow-700 bg-yellow-50 px-4 py-2 rounded-xl font-medium hover:bg-yellow-100 transition-colors">
                ⚠ Aplicar multa
              </button>
            </div>
          </>
        )}

        {/* ── CONFIG ─────────────────────────────────────────────────── */}
        {tab === "config" && (
          <>
            <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
              <div className="px-5 py-3.5 border-b border-gray-100">
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Autódromo activo</p>
              </div>
              <div className="p-5 space-y-4">
                <select
                  value={autodromo}
                  onChange={e => setAutodromo(e.target.value)}
                  className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900 bg-white"
                >
                  {AUTODROMO_OPTIONS.map(a => (
                    <option key={a} value={a}>{a}</option>
                  ))}
                </select>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs text-gray-500 font-medium">Máx. pilotos en pista</label>
                    <input
                      type="number"
                      value={maxPilotos}
                      onChange={e => setMaxPilotos(Number(e.target.value))}
                      min={1} max={30}
                      className="mt-1 w-full border border-gray-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-gray-500 font-medium">Saldo mínimo para ingresar</label>
                    <div className="mt-1 relative">
                      <input
                        type="number"
                        value={minSaldo}
                        onChange={e => setMinSaldo(Number(e.target.value))}
                        min={0} max={60}
                        className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900 pr-10"
                      />
                      <span className="absolute right-4 top-3 text-xs text-gray-400">min</span>
                    </div>
                  </div>
                </div>
                <button className="w-full bg-gray-900 hover:bg-gray-700 text-white font-semibold py-3 rounded-xl text-sm transition-colors">
                  Guardar configuración
                </button>
              </div>
            </div>

            <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
              <div className="px-5 py-3.5 border-b border-gray-100">
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Definir geocerca de pista</p>
              </div>
              <div className="p-5">
                <div className="bg-blue-50 border border-blue-200 rounded-xl px-4 py-3 text-xs text-blue-700 mb-4">
                  📍 Haz clic en el mapa para marcar los vértices de la geocerca. Mínimo 3 puntos para guardar.
                </div>
                <GeofenceMap />
                <div className="flex gap-2 mt-3">
                  <button className="bg-gray-900 text-white text-xs font-medium px-4 py-2 rounded-xl hover:bg-gray-700 transition-colors">
                    ✓ Guardar geocerca
                  </button>
                  <button className="border border-gray-200 text-gray-600 text-xs font-medium px-4 py-2 rounded-xl hover:bg-gray-50 transition-colors">
                    🗑 Limpiar
                  </button>
                </div>
              </div>
            </div>

            <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
              <div className="px-5 py-3.5 border-b border-gray-100">
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Estado del sistema</p>
              </div>
              <div className="divide-y divide-gray-50">
                {[
                  { label: "Pilotos registrados", value: pilotos.length },
                  { label: "Sesiones activas", value: sesiones.length },
                  { label: "Capacidad disponible", value: `${Math.max(0, maxPilotos - sesiones.length)} lugares` },
                  { label: "Bandera roja", value: banderaRoja ? "ACTIVA" : "Inactiva", color: banderaRoja ? "text-red-600 font-bold" : "text-green-600" },
                ].map((row, i) => (
                  <div key={i} className="px-5 py-3 flex justify-between items-center text-sm">
                    <span className="text-gray-500">{row.label}</span>
                    <span className={`font-semibold text-gray-900 ${row.color || ""}`}>{row.value}</span>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}

      </main>
    </div>
  );
}
