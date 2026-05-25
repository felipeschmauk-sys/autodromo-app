"use client";
import { useState, useEffect } from "react";

type Tab = "dashboard" | "director" | "mapa" | "pilotos" | "acceso" | "micuenta" | "compra";

const PILOTOS = [
  { id: "MR", nombre: "Marcos Reyes", auto: "Toyota GR86", categoria: "Sport", saldo: 142, estado: "en_pista", rut: "12-345.678-9", tiempo: "00:34:12", color: "#534AB7" },
  { id: "CA", nombre: "Camila Araya", auto: "Mazda MX-5", categoria: "Amateur", saldo: 58, estado: "en_pista", rut: "15-678.901-2", tiempo: "00:12:05", color: "#0F6E56" },
  { id: "DV", nombre: "Diego Vargas", auto: "Subaru WRX", categoria: "Sport", saldo: 18, estado: "en_pista", rut: "11-222.333-4", tiempo: "01:02:47", color: "#993C1D" },
  { id: "FS", nombre: "Felipe Soto", auto: "Honda Civic", categoria: "Amateur", saldo: 240, estado: "fuera", rut: "9-876.543-2", tiempo: "—", color: "#185FA5" },
  { id: "AM", nombre: "Ana Mora", auto: "Renault Clio", categoria: "Amateur", saldo: 0, estado: "bloqueado", rut: "16-111.222-3", tiempo: "—", color: "#854F0B" },
];

const PAQUETES = [
  { min: 30, precio: 18900, label: "Básico" },
  { min: 60, precio: 34900, label: "Popular" },
  { min: 120, precio: 59900, label: "Pro" },
];

export default function Home() {
  const [tab, setTab] = useState<Tab>("dashboard");
  const [banderaRoja, setBanderaRoja] = useState(false);
  const [log, setLog] = useState<string[]>([
    "10:42 — Marcos Reyes ingresó a pista. QR validado.",
    "10:30 — Camila Araya ingresó a pista. QR validado.",
    "09:15 — Diego Vargas ingresó a pista. QR validado.",
    "09:10 — Felipe Mora salió de pista. Tanda cerrada por GPS.",
  ]);
  const [scanResult, setScanResult] = useState<null | "ok" | "error">(null);
  const [paqueteSel, setPaqueteSel] = useState(0);
  const [pilotos, setPilotos] = useState(PILOTOS);

  const addLog = (msg: string) => {
    const now = new Date();
    const ts = `${now.getHours().toString().padStart(2,"0")}:${now.getMinutes().toString().padStart(2,"0")}`;
    setLog(prev => [`${ts} — ${msg}`, ...prev]);
  };

  const toggleBandera = () => {
    setBanderaRoja(prev => {
      addLog(prev ? "Bandera roja levantada. Cobro reanudado." : "⛔ BANDERA ROJA activada. Cobro pausado para todos.");
      return !prev;
    });
  };

  const cerrarTanda = (nombre: string) => {
    addLog(`${nombre}: tanda cerrada manualmente. QR invalidado.`);
    setPilotos(prev => prev.map(p => p.nombre === nombre ? { ...p, estado: "fuera", tiempo: "—" } : p));
  };

  const tabs: { id: Tab; label: string }[] = [
    { id: "dashboard", label: "Panel" },
    { id: "director", label: "Director" },
    { id: "mapa", label: "Mapa GPS" },
    { id: "pilotos", label: "Pilotos" },
    { id: "acceso", label: "Acceso QR" },
    { id: "micuenta", label: "Mi cuenta" },
    { id: "compra", label: "Comprar" },
  ];

  const enPista = pilotos.filter(p => p.estado === "en_pista");

  return (
    <div className="min-h-screen bg-gray-100 p-4">
      <div className="max-w-5xl mx-auto bg-white rounded-2xl shadow overflow-hidden">
        <div className="flex overflow-x-auto border-b bg-white">
          {tabs.map(t => (
            <button key={t.id} onClick={() => setTab(t.id)}
              className={`px-4 py-3 text-sm whitespace-nowrap border-b-2 transition-all ${tab === t.id ? "border-indigo-600 text-indigo-700 font-semibold" : "border-transparent text-gray-500 hover:text-gray-800"}`}>
              {t.label}
            </button>
          ))}
        </div>
        <div className="p-5">
          {banderaRoja && (
            <div className="mb-4 bg-red-600 text-white rounded-xl px-4 py-3 flex items-center gap-3 text-sm font-medium">
              <span className="text-lg">🚩</span>
              <div className="flex-1">⛔ Bandera roja activa — cobro pausado para todos los pilotos en pista</div>
              <button onClick={toggleBandera} className="bg-white text-red-600 px-3 py-1 rounded-lg text-xs font-bold">Levantar</button>
            </div>
          )}
          {tab === "dashboard" && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                {[
                  { label: "En pista", value: enPista.length, sub: "tandas activas" },
                  { label: "Sesiones hoy", value: 14, sub: "promedio 52 min" },
                  { label: "Ingresos hoy", value: "$182k", sub: "CLP" },
                  { label: "Alertas", value: pilotos.filter(p => p.saldo < 30 && p.estado === "en_pista").length, sub: "saldo bajo", red: true },
                ].map((m, i) => (
                  <div key={i} className="bg-gray-50 rounded-xl p-4">
                    <div className="text-xs text-gray-500 mb-1">{m.label}</div>
                    <div className={`text-2xl font-semibold ${m.red ? "text-red-600" : "text-gray-900"}`}>{m.value}</div>
                    <div className="text-xs text-gray-400">{m.sub}</div>
                  </div>
                ))}
              </div>
              <div className="bg-white border rounded-xl p-4">
                <div className="text-xs font-semibold text-gray-400 uppercase mb-3 flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse inline-block"></span>
                  Pilotos en pista
                </div>
                {enPista.map(p => (
                  <div key={p.id} className="flex items-center gap-3 py-2 border-b last:border-0">
                    <div className="w-9 h-9 rounded-full flex items-center justify-center text-xs font-bold text-white" style={{ background: p.color }}>{p.id}</div>
                    <div className="flex-1"><div className="text-sm font-medium">{p.nombre}</div><div className="text-xs text-gray-500">{p.auto}</div></div>
                    <span className="text-xs bg-green-100 text-green-700 px-2 py-1 rounded-full">{p.tiempo}</span>
                    <span className={`text-sm font-medium ${p.saldo < 30 ? "text-red-600" : "text-gray-700"}`}>{p.saldo} min {p.saldo < 30 ? "⚠" : ""}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
          {tab === "director" && (
            <div className="space-y-4">
              <div className={`rounded-xl px-4 py-3 flex items-center gap-3 ${banderaRoja ? "bg-red-600 text-white" : "bg-green-50 text-green-800"}`}>
                <span className="text-xl">🚩</span>
                <div className="flex-1 text-sm font-medium">{banderaRoja ? "Bandera roja activa — cobro pausado" : `Pista habilitada — ${enPista.length} pilotos en pista`}</div>
                <button onClick={toggleBandera} className={`px-3 py-1 rounded-lg text-xs font-bold ${banderaRoja ? "bg-white text-red-600" : "bg-red-600 text-white"}`}>
                  {banderaRoja ? "Levantar bandera" : "Activar bandera roja"}
                </button>
              </div>
              <div className="grid md:grid-cols-2 gap-4">
                <div className="border rounded-xl p-4">
                  <div className="text-xs font-semibold text-gray-400 uppercase mb-3">Pilotos en pista</div>
                  {enPista.length === 0 && <div className="text-sm text-gray-400">No hay pilotos en pista</div>}
                  {enPista.map(p => (
                    <div key={p.id} className="flex items-center gap-3 py-2 border-b last:border-0">
                      <div className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold text-white" style={{ background: p.color }}>{p.id}</div>
                      <div className="flex-1"><div className="text-sm font-medium">{p.nombre}</div><div className="text-xs text-gray-500">{p.tiempo} · {p.saldo} min</div></div>
                      <button onClick={() => cerrarTanda(p.nombre)} className="text-xs bg-red-50 text-red-600 border border-red-200 px-2 py-1 rounded-lg">Cerrar</button>
                    </div>
                  ))}
                </div>
                <div className="border rounded-xl p-4">
                  <div className="text-xs font-semibold text-gray-400 uppercase mb-3">Log de acciones</div>
                  <div className="space-y-2 max-h-48 overflow-y-auto">
                    {log.map((l, i) => (
                      <div key={i} className="text-xs text-gray-600 border-b pb-1">{l}</div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}
          {tab === "mapa" && (
            <div className="space-y-4">
              <div className="text-xs font-semibold text-gray-400 uppercase flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse inline-block"></span>
                GPS en tiempo real — {enPista.length} vehículos en pista
              </div>
              <div className="relative bg-gray-200 rounded-xl overflow-hidden" style={{ height: 320 }}>
                <svg width="100%" height="100%" viewBox="0 0 500 320">
                  <rect width="500" height="320" fill="#d4d0c8"/>
                  <ellipse cx="250" cy="160" rx="155" ry="95" fill="#8fbc6e" opacity="0.6"/>
                  <ellipse cx="250" cy="160" rx="200" ry="130" fill="none" stroke="#4a4a4a" strokeWidth="36"/>
                  <ellipse cx="250" cy="160" rx="200" ry="130" fill="none" stroke="#6b6b6b" strokeWidth="32"/>
                  <rect x="232" y="18" width="36" height="12" rx="2" fill="#fff"/>
                  <text x="250" y="27" textAnchor="middle" fontSize="8" fontWeight="500" fill="#333">META</text>
                  <text x="250" y="175" textAnchor="middle" fontSize="10" fill="#5a7a3a" fontWeight="500" opacity="0.8">ZONA INTERIOR</text>
                  <rect x="228" y="52" width="44" height="16" rx="2" fill="#888" opacity="0.8"/>
                  <text x="250" y="63" textAnchor="middle" fontSize="8" fill="#fff">BOXES</text>
                </svg>
                {enPista.map((p, i) => {
                  const positions = [{ top: "38%", left: "52%" }, { top: "65%", left: "75%" }, { top: "60%", left: "22%" }];
                  const pos = positions[i] || { top: "50%", left: "50%" };
                  return (
                    <div key={p.id} className="absolute transform -translate-x-1/2 -translate-y-1/2" style={{ top: pos.top, left: pos.left }}>
                      <div className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold text-white border-2 border-white shadow" style={{ background: p.color }}>{p.id}</div>
                      <div className="absolute top-8 left-1/2 -translate-x-1/2 bg-white text-xs px-2 py-0.5 rounded shadow whitespace-nowrap">{p.nombre.split(" ")[0]}</div>
                    </div>
                  );
                })}
              </div>
              <div className="grid grid-cols-3 gap-3">
                {enPista.map(p => (
                  <div key={p.id} className="border rounded-xl p-3">
                    <div className="flex items-center gap-2 mb-2">
                      <div className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold text-white" style={{ background: p.color }}>{p.id}</div>
                      <div className="text-xs font-medium">{p.nombre.split(" ")[0]}</div>
                    </div>
                    <div className="text-xs text-gray-500">{p.auto}</div>
                    <div className="text-xs text-gray-500 mt-1">{p.saldo} min disponibles</div>
                    <div className={`text-xs mt-1 font-medium ${p.saldo < 30 ? "text-red-600" : "text-green-600"}`}>{p.tiempo}</div>
                  </div>
                ))}
              </div>
            </div>
          )}
          {tab === "pilotos" && (
            <div className="space-y-4">
              <div className="flex justify-between items-center">
                <span className="font-semibold text-gray-800">Pilotos registrados</span>
                <button className="bg-indigo-600 text-white text-xs px-3 py-2 rounded-lg">+ Nuevo piloto</button>
              </div>
              <div className="border rounded-xl overflow-hidden">
                {pilotos.map((p, i) => (
                  <div key={p.id} className={`flex items-center gap-3 px-4 py-3 ${i < pilotos.length - 1 ? "border-b" : ""}`}>
                    <div className="w-9 h-9 rounded-full flex items-center justify-center text-xs font-bold text-white" style={{ background: p.color }}>{p.id}</div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium">{p.nombre}</div>
                      <div className="text-xs text-gray-500">{p.auto} · {p.rut}</div>
                    </div>
                    <span className={`text-xs px-2 py-1 rounded-full font-medium ${p.estado === "en_pista" ? "bg-green-100 text-green-700" : p.estado === "bloqueado" ? "bg-red-100 text-red-700" : p.saldo < 30 ? "bg-amber-100 text-amber-700" : "bg-gray-100 text-gray-600"}`}>
                      {p.estado === "en_pista" ? "en pista" : p.estado === "bloqueado" ? "bloqueado" : p.saldo < 30 ? "saldo bajo" : "fuera"}
                    </span>
                    <span className={`text-sm font-medium ${p.saldo < 30 ? "text-red-600" : "text-gray-700"}`}>{p.saldo} min</span>
                  </div>
                ))}
              </div>
            </div>
          )}
          {tab === "acceso" && (
            <div className="space-y-4">
              <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 text-xs text-amber-700">
                ⚠ Cada ingreso a pista requiere un QR nuevo. Al salir de la geocerca la tanda se cierra y el QR anterior queda invalidado.
              </div>
              <div className="border rounded-xl p-6">
                <div className="text-xs font-semibold text-gray-400 uppercase mb-4">Escanear QR de ingreso</div>
                <div onClick={() => setScanResult("ok")} className="border-2 border-dashed border-indigo-300 bg-indigo-50 rounded-xl p-8 flex flex-col items-center gap-3 cursor-pointer hover:bg-indigo-100 transition">
                  <div className="text-4xl">📷</div>
                  <div className="text-sm font-medium text-indigo-700">Toca para simular escaneo QR</div>
                  <div className="text-xs text-gray-400">Apunta la cámara al código del piloto</div>
                </div>
                {scanResult === "ok" && (
                  <div className="mt-4 bg-green-50 border border-green-200 rounded-xl p-4">
                    <div className="flex items-center gap-2 mb-2"><span className="text-green-600 text-lg">✅</span><span className="font-semibold text-green-700 text-sm">Acceso autorizado</span></div>
                    <div className="text-xs text-green-700 space-y-1">
                      <div><strong>Piloto:</strong> Marcos Reyes</div>
                      <div><strong>Vehículo:</strong> Toyota GR86 · PPH-3321</div>
                      <div><strong>Saldo:</strong> 142 minutos disponibles</div>
                      <div><strong>QR:</strong> válido para un ingreso · se invalida al salir</div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
          {tab === "micuenta" && (
            <div className="space-y-4">
              <div className="border rounded-xl p-5">
                <div className="flex items-center gap-4 mb-4">
                  <div className="w-12 h-12 rounded-full bg-indigo-100 text-indigo-700 flex items-center justify-center text-base font-bold">MR</div>
                  <div>
                    <div className="font-semibold text-gray-900">Marcos Reyes</div>
                    <div className="text-sm text-gray-500">Toyota GR86 · Sport</div>
                    <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full mt-1 inline-block">Activo</span>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="bg-gray-50 rounded-xl p-3"><div className="text-xs text-gray-500">Saldo</div><div className="text-2xl font-semibold">142</div><div className="text-xs text-gray-400">minutos</div></div>
                  <div className="bg-gray-50 rounded-xl p-3"><div className="text-xs text-gray-500">Tandas este mes</div><div className="text-2xl font-semibold">9</div><div className="text-xs text-gray-400">712 min totales</div></div>
                </div>
              </div>
              <div className="border rounded-xl p-5">
                <div className="text-xs font-semibold text-gray-400 uppercase mb-3">Mi QR para esta tanda</div>
                <div className="flex flex-col items-center gap-3">
                  <svg width="140" height="140" viewBox="0 0 140 140" xmlns="http://www.w3.org/2000/svg">
                    <rect width="140" height="140" fill="#fff" rx="6"/>
                    <rect x="8" y="8" width="46" height="46" fill="none" stroke="#1a1a1a" strokeWidth="3.5" rx="3"/>
                    <rect x="17" y="17" width="28" height="28" fill="#1a1a1a" rx="2"/>
                    <rect x="86" y="8" width="46" height="46" fill="none" stroke="#1a1a1a" strokeWidth="3.5" rx="3"/>
                    <rect x="95" y="17" width="28" height="28" fill="#1a1a1a" rx="2"/>
                    <rect x="8" y="86" width="46" height="46" fill="none" stroke="#1a1a1a" strokeWidth="3.5" rx="3"/>
                    <rect x="17" y="95" width="28" height="28" fill="#1a1a1a" rx="2"/>
                    <rect x="86" y="86" width="8" height="8" fill="#1a1a1a"/><rect x="98" y="86" width="8" height="8" fill="#1a1a1a"/>
                    <rect x="110" y="86" width="8" height="8" fill="#1a1a1a"/><rect x="122" y="86" width="8" height="8" fill="#1a1a1a"/>
                    <rect x="86" y="98" width="8" height="8" fill="#1a1a1a"/><rect x="110" y="98" width="8" height="8" fill="#1a1a1a"/>
                    <rect x="86" y="110" width="8" height="8" fill="#1a1a1a"/><rect x="98" y="110" width="8" height="8" fill="#1a1a1a"/>
                    <rect x="122" y="110" width="8" height="8" fill="#1a1a1a"/>
                    <rect x="86" y="122" width="8" height="8" fill="#1a1a1a"/><rect x="110" y="122" width="8" height="8" fill="#1a1a1a"/>
                    <rect x="122" y="122" width="8" height="8" fill="#1a1a1a"/>
                  </svg>
                  <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-2 text-xs text-amber-700 text-center max-w-xs">
                    Este QR es válido para <strong>un ingreso</strong>. Al salir de pista se invalida. Genera uno nuevo para reingresar.
                  </div>
                  <button className="border text-sm px-4 py-2 rounded-lg hover:bg-gray-50">🔄 Generar nuevo QR</button>
                </div>
              </div>
            </div>
          )}
          {tab === "compra" && (
            <div className="space-y-4">
              <div className="border rounded-xl p-5">
                <div className="text-xs font-semibold text-gray-400 uppercase mb-4">Selecciona un paquete</div>
                <div className="grid grid-cols-3 gap-3">
                  {PAQUETES.map((pq, i) => (
                    <div key={i} onClick={() => setPaqueteSel(i)} className={`rounded-xl p-4 cursor-pointer border-2 transition-all ${paqueteSel === i ? "border-indigo-600 bg-indigo-50" : "border-gray-200 hover:border-indigo-300"}`}>
                      <div className="text-xl font-semibold">{pq.min} min</div>
                      <div className="text-sm text-gray-500">${pq.precio.toLocaleString()} CLP</div>
                      <div className="text-xs text-gray-400 mt-1">${Math.round(pq.precio / pq.min)}/min</div>
                      {i === 1 && <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full mt-2 inline-block">Popular</span>}
                      {i === 2 && <span className="text-xs bg-indigo-100 text-indigo-700 px-2 py-0.5 rounded-full mt-2 inline-block">Mejor valor</span>}
                    </div>
                  ))}
                </div>
              </div>
              <div className="border rounded-xl p-5">
                <div className="text-xs font-semibold text-gray-400 uppercase mb-3">Método de pago</div>
                <div className="space-y-2">
                  {["Webpay (débito / crédito)", "MercadoPago"].map((m, i) => (
                    <label key={i} className="flex items-center gap-3 border rounded-xl p-3 cursor-pointer hover:bg-gray-50">
                      <input type="radio" name="pago" defaultChecked={i === 0} className="accent-indigo-600"/>
                      <span className="text-sm">{m}</span>
                    </label>
                  ))}
                </div>
              </div>
              <div className="border rounded-xl p-5">
                <div className="flex justify-between text-sm mb-4">
                  <span className="text-gray-500">Paquete seleccionado</span>
                  <span className="font-medium">{PAQUETES[paqueteSel].min} min · ${PAQUETES[paqueteSel].precio.toLocaleString()} CLP</span>
                </div>
                <button className="w-full bg-indigo-600 text-white py-3 rounded-xl font-semibold hover:bg-indigo-700 transition">🔒 Pagar ahora</button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}