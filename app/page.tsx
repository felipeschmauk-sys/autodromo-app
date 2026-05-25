"use client";
import { useState } from "react";

type Stage = "login" | "registro" | "prueba" | "app";
type AppTab = "perfil" | "qr" | "saldo" | "reglamento";
type EstadoPiloto = "deshabilitado" | "pendiente" | "habilitado";

const PREGUNTAS = [
  { pregunta: "¿Por qué lado debes sobrepasar a otro vehículo en pista?", opciones: ["Por el lado izquierdo", "Por el lado derecho", "Por cualquier lado si hay espacio", "Solo en la recta principal"], correcta: 1 },
  { pregunta: "Si eres el vehículo adelantado, ¿qué debes hacer?", opciones: ["Acelerar para que no te pasen", "Cerrar la trayectoria para defenderte", "Mantener tu línea y facilitar el paso", "Frenarte bruscamente"], correcta: 2 },
  { pregunta: "¿Qué significa la bandera roja?", opciones: ["Acelera para salir de la zona", "Detención inmediata de todos los vehículos", "Solo se detienen los vehículos Sport", "El piloto puede continuar si está lejos"], correcta: 1 },
  { pregunta: "¿Qué indica la bandera amarilla?", opciones: ["Peligro, reducir velocidad y no adelantar", "Acelerar para salir rápido", "Puedes adelantar con precaución", "Fin de sesión, volver a boxes"], correcta: 0 },
  { pregunta: "¿Qué significa la bandera amarilla doble?", opciones: ["Adelantamiento permitido a baja velocidad", "Peligro grave. Velocidad máxima reducida. Adelantar prohibido.", "Dos zonas de peligro, puedes esquivarlas", "Advertencia menor, mantén el ritmo"], correcta: 1 },
  { pregunta: "¿Qué ocurre con el cobro si el vehículo se detiene dentro de pista?", opciones: ["El cobro se detiene automáticamente", "El cobro continúa mientras esté dentro de la geocerca", "El cobro se pausa tras 5 minutos detenido", "El piloto puede detenerlo desde la app"], correcta: 1 },
  { pregunta: "¿Quién puede pausar el cobro dentro de la pista?", opciones: ["El piloto desde su celular", "Solo el director de pista, con bandera roja o cerrando la sesión", "El cobro no puede pausarse", "Cualquier administrador"], correcta: 1 },
  { pregunta: "¿Qué ocurre al salir de la geocerca de pista?", opciones: ["El sistema cierra la tanda y detiene el cobro automáticamente", "Debes llamar al director para cerrar tu sesión", "Debes cerrar la sesión manualmente", "La tanda se cierra sola tras 10 minutos"], correcta: 0 },
];

const BANDERAS = [
  { color: "bg-red-500", emoji: "🔴", nombre: "Bandera roja", desc: "Detención inmediata de todos los vehículos en pista. El cobro se pausa. Ningún piloto puede ignorarla bajo ninguna circunstancia." },
  { color: "bg-yellow-400", emoji: "🟡", nombre: "Bandera amarilla", desc: "Peligro en la zona indicada. Reducir velocidad, no adelantar y estar preparado para detenerse." },
  { color: "bg-yellow-400", emoji: "🟡🟡", nombre: "Bandera amarilla doble", desc: "Peligro grave o vehículo detenido en pista. Velocidad máxima reducida. Adelantar está estrictamente prohibido." },
  { color: "bg-green-500", emoji: "🟢", nombre: "Bandera verde", desc: "Pista despejada. Circulación normal habilitada." },
  { color: "bg-white border border-gray-300", emoji: "⬜", nombre: "Bandera blanca", desc: "Vehículo lento en pista (ambulancia, grúa, vehículo de seguridad). Precaución máxima." },
  { color: "bg-gray-900", emoji: "⬛", nombre: "Bandera negra", desc: "El piloto señalado debe ingresar a boxes inmediatamente. Puede indicar descalificación o problema técnico grave." },
];

export default function Home() {
  const [stage, setStage] = useState<Stage>("login");
  const [subTab, setSubTab] = useState<"prueba" | "reglamento">("prueba");
  const [regPaso, setRegPaso] = useState(1);
  const [autos, setAutos] = useState([{ id: 1, marca: "", modelo: "" }]);
  const [respuestas, setRespuestas] = useState<(number | null)[]>(new Array(PREGUNTAS.length).fill(null));
  const [evaluado, setEvaluado] = useState(false);
  const [aprobado, setAprobado] = useState(false);
  const [appTab, setAppTab] = useState<AppTab>("perfil");
  const [estadoPiloto, setEstadoPiloto] = useState<EstadoPiloto>("deshabilitado");
  const [checks, setChecks] = useState([false, false, false]);

  const agregarAuto = () => setAutos([...autos, { id: Date.now(), marca: "", modelo: "" }]);
  const eliminarAuto = (id: number) => setAutos(autos.filter(a => a.id !== id));

  const selRespuesta = (qi: number, oi: number) => {
    if (evaluado) return;
    const r = [...respuestas];
    r[qi] = oi;
    setRespuestas(r);
    setEstadoPiloto("pendiente");
  };

  const evaluar = () => {
    setEvaluado(true);
    const ok = PREGUNTAS.every((p, i) => respuestas[i] === p.correcta);
    setAprobado(ok);
    if (ok) {
      setEstadoPiloto("habilitado");
      setTimeout(() => { setStage("app"); setAppTab("perfil"); }, 1800);
    }
  };

  const reintentar = () => {
    setRespuestas(new Array(PREGUNTAS.length).fill(null));
    setEvaluado(false);
    setAprobado(false);
    setEstadoPiloto("pendiente");
  };

  const toggleCheck = (i: number) => {
    const c = [...checks];
    c[i] = !c[i];
    setChecks(c);
  };

  const incorrectas = evaluado ? PREGUNTAS.filter((p, i) => respuestas[i] !== p.correcta).length : 0;
  const todosChecks = checks.every(Boolean);

  const semaforo = {
    deshabilitado: { label: "Deshabilitado", bg: "bg-red-500", text: "text-white", dot: "🔴" },
    pendiente: { label: "Prueba pendiente", bg: "bg-amber-500", text: "text-white", dot: "🟠" },
    habilitado: { label: "Habilitado", bg: "bg-green-500", text: "text-white", dot: "🟢" },
  }[estadoPiloto];

  return (
    <div className="min-h-screen bg-gray-100 flex items-start justify-center p-4">
      <div className="w-full max-w-lg bg-white rounded-2xl shadow overflow-hidden">

        {/* HEADER */}
        <div className="bg-indigo-700 text-white px-5 py-4 flex items-center gap-3">
          <span className="text-2xl">🏎</span>
          <div>
            <div className="font-semibold text-sm">Autódromo Las Vizcachas</div>
            <div className="text-xs opacity-75">
              {stage === "login" && "Acceso"}
              {stage === "registro" && `Registro — Paso ${regPaso} de 2`}
              {stage === "prueba" && "Prueba de conocimientos"}
              {stage === "app" && "Mi cuenta"}
            </div>
          </div>
          {stage === "app" && (
            <span className={`ml-auto text-xs px-2.5 py-1 rounded-full font-semibold ${semaforo.bg} ${semaforo.text}`}>
              {semaforo.dot} {semaforo.label}
            </span>
          )}
        </div>

        {/* BARRA DE PROGRESO */}
        {(stage === "registro" || stage === "prueba") && (
          <div className="h-1 bg-gray-200">
            <div className="h-1 bg-indigo-600 transition-all" style={{ width: stage === "registro" ? (regPaso === 1 ? "33%" : "66%") : "100%" }} />
          </div>
        )}

        <div className="p-5">

          {/* ── LOGIN ── */}
          {stage === "login" && (
            <div className="space-y-5">
              <div className="text-center space-y-1">
                <div className="text-lg font-semibold">Bienvenido</div>
                <div className="text-sm text-gray-500">Ingresa con tu cuenta de piloto</div>
              </div>
              <div className="space-y-3">
                <div>
                  <label className="text-xs text-gray-500 font-medium">Correo electrónico</label>
                  <input className="mt-1 w-full border rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400" type="email" placeholder="tu@correo.cl" />
                </div>
                <div>
                  <label className="text-xs text-gray-500 font-medium">Contraseña</label>
                  <input className="mt-1 w-full border rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400" type="password" placeholder="••••••••" />
                </div>
                <button onClick={() => { setStage("app"); setEstadoPiloto("pendiente"); }} className="w-full bg-indigo-600 text-white py-2.5 rounded-xl font-semibold text-sm hover:bg-indigo-700 transition">
                  Ingresar
                </button>
              </div>
              <div className="text-center text-sm text-gray-500">
                ¿Sin cuenta?{" "}
                <button onClick={() => { setStage("registro"); setRegPaso(1); setEstadoPiloto("deshabilitado"); }} className="text-indigo-600 font-semibold hover:underline">
                  Regístrate aquí
                </button>
              </div>
            </div>
          )}

          {/* ── REGISTRO PASO 1 ── */}
          {stage === "registro" && regPaso === 1 && (
            <div className="space-y-4">
              <div className="text-sm font-semibold text-gray-700">Datos personales</div>
              <div className="grid grid-cols-2 gap-3">
                {[["Nombre completo","Felipe Schmauk",false],["RUT","12.345.678-9",false],["Correo","tu@correo.cl",false],["Teléfono","+56 9 1234 5678",false]].map(([label,ph],i) => (
                  <div key={i}>
                    <label className="text-xs text-gray-500">{label} <span className="text-red-500">*</span></label>
                    <input className="mt-1 w-full border rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400" type={label==="Correo"?"email":"text"} placeholder={ph as string} />
                  </div>
                ))}
              </div>
              <div>
                <label className="text-xs text-gray-500">Contraseña <span className="text-red-500">*</span></label>
                <input className="mt-1 w-full border rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400" type="password" placeholder="Mínimo 8 caracteres" />
              </div>
              <div>
                <label className="text-xs text-gray-500">Licencia de conducir <span className="text-red-500">*</span></label>
                <div className="mt-1 border border-dashed rounded-xl p-4 text-center cursor-pointer bg-gray-50 hover:bg-indigo-50 transition text-sm text-gray-400">
                  📎 Toca para adjuntar foto de tu licencia
                </div>
              </div>

              <div className="border-t pt-4">
                <div className="flex items-center justify-between mb-3">
                  <div className="text-sm font-semibold text-gray-700">
                    Vehículos <span className="text-xs font-normal text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full ml-1">opcional</span>
                  </div>
                  <button onClick={agregarAuto} className="text-xs bg-indigo-50 text-indigo-700 border border-indigo-200 px-3 py-1.5 rounded-lg font-medium hover:bg-indigo-100 transition">
                    + Agregar vehículo
                  </button>
                </div>
                <div className="space-y-3">
                  {autos.map((auto, idx) => (
                    <div key={auto.id} className="bg-gray-50 rounded-xl p-3 border">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-xs font-medium text-gray-500">Vehículo {idx + 1}</span>
                        {autos.length > 1 && <button onClick={() => eliminarAuto(auto.id)} className="text-xs text-red-500 hover:text-red-700">✕ Eliminar</button>}
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <input className="border rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400" placeholder="Marca" />
                        <input className="border rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400" placeholder="Modelo" />
                      </div>
                    </div>
                  ))}
                </div>
                <div className="text-xs text-gray-400 mt-2">Puedes agregar más vehículos desde tu perfil.</div>
              </div>

              <div className="flex gap-2 pt-2">
                <button onClick={() => setStage("login")} className="border rounded-xl px-4 py-2.5 text-sm font-medium hover:bg-gray-50 transition">← Volver</button>
                <button onClick={() => setRegPaso(2)} className="flex-1 bg-indigo-600 text-white rounded-xl py-2.5 text-sm font-semibold hover:bg-indigo-700 transition">Continuar →</button>
              </div>
            </div>
          )}

          {/* ── REGISTRO PASO 2 ── */}
          {stage === "registro" && regPaso === 2 && (
            <div className="space-y-4">
              <div className="text-sm font-semibold text-gray-700">Términos y condiciones</div>
              <div className="bg-gray-50 rounded-xl p-4 text-xs text-gray-600 leading-relaxed border">
                Al registrarte confirmas que has leído el reglamento del autódromo y aceptas las normas de seguridad, el protocolo de banderas, la política de cobro por minuto y las condiciones de acceso a pista. Tu cuenta quedará habilitada para generar QR solo después de aprobar la prueba de conocimientos con 100% de respuestas correctas.
              </div>
              <div className="space-y-3">
                {[
                  "Acepto el reglamento interno del autódromo y las condiciones del evento",
                  "He leído y entiendo el protocolo de seguridad y el sistema de banderas",
                  "Entiendo que el cobro por minuto es automático y solo puede pausarlo el director de pista",
                ].map((txt, i) => (
                  <label key={i} className="flex items-start gap-3 cursor-pointer text-sm text-gray-700">
                    <input type="checkbox" checked={checks[i]} onChange={() => toggleCheck(i)} className="mt-0.5 accent-indigo-600" />
                    {txt}
                  </label>
                ))}
              </div>
              {!todosChecks && (
                <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 text-xs text-amber-700">
                  ⚠ Debes aceptar todas las condiciones para continuar.
                </div>
              )}
              <div className="bg-blue-50 border border-blue-200 rounded-xl px-4 py-3 text-xs text-blue-700">
                📋 Una vez creada tu cuenta deberás aprobar la prueba de conocimientos para quedar habilitado. La prueba se renueva en cada jornada de pista.
              </div>
              <div className="flex gap-2 pt-2">
                <button onClick={() => setRegPaso(1)} className="border rounded-xl px-4 py-2.5 text-sm font-medium hover:bg-gray-50 transition">← Volver</button>
                <button
                  onClick={() => { if (todosChecks) { setStage("prueba"); setSubTab("prueba"); } }}
                  className={`flex-1 rounded-xl py-2.5 text-sm font-semibold transition ${todosChecks ? "bg-indigo-600 text-white hover:bg-indigo-700" : "bg-gray-200 text-gray-400 cursor-not-allowed"}`}
                  disabled={!todosChecks}
                >
                  Crear cuenta ✓
                </button>
              </div>
            </div>
          )}

          {/* ── PRUEBA ── */}
          {stage === "prueba" && (
            <div className="space-y-4">
              <div className="flex border-b -mx-5 px-5">
                {(["prueba", "reglamento"] as const).map(t => (
                  <button key={t} onClick={() => setSubTab(t)}
                    className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-all ${subTab === t ? "border-indigo-600 text-indigo-700" : "border-transparent text-gray-500 hover:text-gray-700"}`}>
                    {t === "prueba" ? "📋 Prueba" : "📄 Reglamento"}
                  </button>
                ))}
              </div>

              {subTab === "reglamento" && (
                <div className="space-y-4">
                  <div className="text-sm text-gray-500">Lee el reglamento antes de rendir la prueba. Necesitas 100% para habilitar tu cuenta.</div>
                  <div className="space-y-2">
                    {[
                      { color: "bg-red-600", title: "Reglamento Interno de Pista", desc: "Normas de circulación, protocolo de banderas y condiciones de acceso" },
                      { color: "bg-blue-600", title: "Protocolo de Seguridad", desc: "Equipamiento obligatorio, procedimientos de emergencia y rescate" },
                      { color: "bg-green-700", title: "Condiciones y Tarifas", desc: "Política de cobro por minuto, multas, rescates y cargos adicionales" },
                    ].map((doc, i) => (
                      <div key={i} className="flex items-center gap-3 border rounded-xl p-3">
                        <div className={`${doc.color} rounded-lg w-10 h-12 flex items-center justify-center text-white text-xs font-bold flex-shrink-0`}>PDF</div>
                        <div className="flex-1"><div className="text-sm font-medium">{doc.title}</div><div className="text-xs text-gray-400">{doc.desc}</div></div>
                        <button className="text-xs border px-3 py-1.5 rounded-lg hover:bg-gray-50 transition flex-shrink-0">⬇ Descargar</button>
                      </div>
                    ))}
                  </div>
                  <div className="space-y-2">
                    {BANDERAS.map((b, i) => (
                      <div key={i} className="flex gap-3 items-start bg-gray-50 rounded-xl p-3 text-sm">
                        <div className={`${b.color} w-4 h-4 rounded-sm mt-0.5 flex-shrink-0`}></div>
                        <div><strong>{b.nombre}:</strong> {b.desc}</div>
                      </div>
                    ))}
                  </div>
                  <div className="bg-gray-50 border rounded-xl p-3 text-sm space-y-2">
                    <div className="font-medium text-gray-700">Normas de adelantamiento</div>
                    <div className="text-gray-600 text-xs space-y-1">
                      <div>• Solo se permite adelantar por el <strong>lado derecho</strong> del vehículo adelantado.</div>
                      <div>• Si eres adelantado: <strong>mantén tu línea</strong> y facilita el paso. No cierres bruscamente.</div>
                      <div>• Está prohibido adelantar bajo bandera amarilla o doble amarilla.</div>
                    </div>
                  </div>
                  <button onClick={() => setSubTab("prueba")} className="w-full bg-indigo-600 text-white py-2.5 rounded-xl text-sm font-semibold hover:bg-indigo-700 transition">
                    Ir a la prueba →
                  </button>
                </div>
              )}

              {subTab === "prueba" && (
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <div className="text-sm text-gray-500">Responde el 100% correctamente para habilitar tu cuenta.</div>
                    {evaluado && (
                      <span className={`text-xs px-2 py-1 rounded-full font-medium ${aprobado ? "bg-green-100 text-green-700" : "bg-red-100 text-red-600"}`}>
                        {aprobado ? "✓ Aprobada" : `${incorrectas} incorrecta${incorrectas > 1 ? "s" : ""}`}
                      </span>
                    )}
                  </div>
                  <div className="space-y-4">
                    {PREGUNTAS.map((p, qi) => (
                      <div key={qi} className="border rounded-xl p-4 space-y-3">
                        <div className="text-xs text-gray-400">Pregunta {qi + 1} de {PREGUNTAS.length}</div>
                        <div className="text-sm font-medium">{p.pregunta}</div>
                        <div className="space-y-2">
                          {p.opciones.map((op, oi) => {
                            let cls = "w-full text-left border rounded-xl px-3 py-2.5 text-sm transition flex items-center gap-3 ";
                            if (!evaluado) cls += respuestas[qi] === oi ? "border-indigo-500 bg-indigo-50 text-indigo-700" : "hover:border-indigo-300 hover:bg-indigo-50";
                            else if (oi === p.correcta) cls += "border-green-500 bg-green-50 text-green-700";
                            else if (respuestas[qi] === oi) cls += "border-red-400 bg-red-50 text-red-600";
                            else cls += "opacity-40";
                            return (
                              <button key={oi} onClick={() => selRespuesta(qi, oi)} className={cls} disabled={evaluado}>
                                <span className="w-5 h-5 rounded-full border flex items-center justify-center text-xs font-medium flex-shrink-0">
                                  {evaluado && oi === p.correcta ? "✓" : evaluado && respuestas[qi] === oi ? "✗" : String.fromCharCode(65 + oi)}
                                </span>
                                {op}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    ))}
                  </div>

                  {evaluado && aprobado && (
                    <div className="bg-green-50 border border-green-200 rounded-xl p-4 text-sm text-green-700">
                      <div className="font-semibold mb-1">🎉 ¡Prueba aprobada! {PREGUNTAS.length}/{PREGUNTAS.length} correctas</div>
                      Accediendo a tu cuenta...
                    </div>
                  )}
                  {evaluado && !aprobado && (
                    <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-sm text-red-600">
                      <div className="font-semibold mb-1">✗ {incorrectas} respuesta{incorrectas > 1 ? "s" : ""} incorrecta{incorrectas > 1 ? "s" : ""}</div>
                      Necesitas 100%. Las correctas están en verde. Revisa el reglamento y vuelve a intentarlo.
                    </div>
                  )}

                  <div className="flex gap-2">
                    {!evaluado && (
                      <button onClick={evaluar} className="flex-1 bg-indigo-600 text-white py-2.5 rounded-xl text-sm font-semibold hover:bg-indigo-700 transition">
                        Enviar respuestas →
                      </button>
                    )}
                    {evaluado && !aprobado && (
                      <button onClick={reintentar} className="flex-1 border py-2.5 rounded-xl text-sm font-medium hover:bg-gray-50 transition">
                        🔄 Reintentar
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ── APP ── */}
          {stage === "app" && (
            <div className="space-y-4">

              {/* ALERTA SI PRUEBA PENDIENTE */}
              {estadoPiloto !== "habilitado" && (
                <div className={`rounded-xl px-4 py-3 text-sm flex items-start gap-3 ${estadoPiloto === "deshabilitado" ? "bg-red-50 border border-red-200 text-red-700" : "bg-amber-50 border border-amber-200 text-amber-700"}`}>
                  <span className="text-lg flex-shrink-0">{estadoPiloto === "deshabilitado" ? "🔴" : "🟠"}</span>
                  <div>
                    <div className="font-semibold mb-0.5">{estadoPiloto === "deshabilitado" ? "Cuenta deshabilitada" : "Prueba pendiente"}</div>
                    <div className="text-xs">
                      {estadoPiloto === "deshabilitado"
                        ? "Debes aprobar la prueba de conocimientos para habilitar tu acceso a pista y poder generar QR."
                        : "Estás respondiendo la prueba. Debes obtener 100% para quedar habilitado."}
                    </div>
                    <button onClick={() => setStage("prueba")} className="mt-2 text-xs font-semibold underline">
                      Ir a la prueba →
                    </button>
                  </div>
                </div>
              )}

              {/* TABS */}
              <div className="flex border-b -mx-5 px-5 overflow-x-auto">
                {(["perfil", "qr", "saldo", "reglamento"] as AppTab[]).map(t => (
                  <button key={t} onClick={() => setAppTab(t)}
                    className={`px-3 py-2.5 text-sm font-medium border-b-2 transition-all whitespace-nowrap ${appTab === t ? "border-indigo-600 text-indigo-700" : "border-transparent text-gray-500 hover:text-gray-700"}`}>
                    {t === "perfil" ? "👤 Perfil" : t === "qr" ? "📷 Mi QR" : t === "saldo" ? "⏱ Saldo" : "📄 Reglamento"}
                  </button>
                ))}
              </div>

              {/* PERFIL */}
              {appTab === "perfil" && (
                <div className="space-y-4">
                  <div className="flex items-center gap-4 bg-indigo-50 rounded-xl p-4">
                    <div className="w-12 h-12 rounded-full bg-indigo-200 text-indigo-700 flex items-center justify-center font-bold text-base flex-shrink-0">FS</div>
                    <div>
                      <div className="font-semibold">Felipe Schmauk</div>
                      <div className="text-sm text-gray-500">Toyota GR86</div>
                      <span className={`text-xs px-2 py-0.5 rounded-full mt-1 inline-block font-medium ${estadoPiloto === "habilitado" ? "bg-green-100 text-green-700" : estadoPiloto === "pendiente" ? "bg-amber-100 text-amber-700" : "bg-red-100 text-red-600"}`}>
                        {estadoPiloto === "habilitado" ? "🟢 Habilitado para pista" : estadoPiloto === "pendiente" ? "🟠 Prueba pendiente" : "🔴 No habilitado"}
                      </span>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="bg-gray-50 rounded-xl p-3"><div className="text-xs text-gray-500">Saldo</div><div className="text-2xl font-semibold">142 min</div></div>
                    <div className="bg-gray-50 rounded-xl p-3"><div className="text-xs text-gray-500">Tandas este mes</div><div className="text-2xl font-semibold">9</div></div>
                  </div>
                  <div className="border rounded-xl divide-y text-sm">
                    {[["RUT","12.345.678-9"],["Correo","felipe@correo.cl"],["Teléfono","+56 9 8765 4321"],["Licencia","✓ Verificada"],["Prueba jornada", estadoPiloto === "habilitado" ? "✓ Aprobada" : "⏳ Pendiente"]].map(([k,v]) => (
                      <div key={k} className="flex justify-between px-4 py-3">
                        <span className="text-gray-500">{k}</span>
                        <span className={`font-medium ${k === "Prueba jornada" && estadoPiloto !== "habilitado" ? "text-amber-600" : ""}`}>{v}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* QR */}
              {appTab === "qr" && (
                <div className="space-y-4">
                  {estadoPiloto !== "habilitado" ? (
                    <div className="flex flex-col items-center gap-4 py-8 text-center">
                      <div className="text-5xl">🔒</div>
                      <div className="text-base font-semibold text-gray-700">QR bloqueado</div>
                      <div className="text-sm text-gray-500 max-w-xs">Debes aprobar la prueba de conocimientos de la jornada para poder generar tu código QR de acceso.</div>
                      <button onClick={() => setStage("prueba")} className="bg-indigo-600 text-white px-5 py-2.5 rounded-xl text-sm font-semibold hover:bg-indigo-700 transition">
                        Ir a la prueba →
                      </button>
                    </div>
                  ) : (
                    <div className="flex flex-col items-center gap-4 py-4">
                      <svg width="160" height="160" viewBox="0 0 160 160" xmlns="http://www.w3.org/2000/svg">
                        <rect width="160" height="160" fill="#fff" rx="8"/>
                        <rect x="10" y="10" width="56" height="56" fill="none" stroke="#1a1a1a" strokeWidth="4" rx="4"/>
                        <rect x="20" y="20" width="36" height="36" fill="#1a1a1a" rx="2"/>
                        <rect x="94" y="10" width="56" height="56" fill="none" stroke="#1a1a1a" strokeWidth="4" rx="4"/>
                        <rect x="104" y="20" width="36" height="36" fill="#1a1a1a" rx="2"/>
                        <rect x="10" y="94" width="56" height="56" fill="none" stroke="#1a1a1a" strokeWidth="4" rx="4"/>
                        <rect x="20" y="104" width="36" height="36" fill="#1a1a1a" rx="2"/>
                        <rect x="94" y="94" width="10" height="10" fill="#1a1a1a"/><rect x="108" y="94" width="10" height="10" fill="#1a1a1a"/>
                        <rect x="122" y="94" width="10" height="10" fill="#1a1a1a"/><rect x="136" y="94" width="10" height="10" fill="#1a1a1a"/>
                        <rect x="94" y="108" width="10" height="10" fill="#1a1a1a"/><rect x="122" y="108" width="10" height="10" fill="#1a1a1a"/>
                        <rect x="94" y="122" width="10" height="10" fill="#1a1a1a"/><rect x="108" y="122" width="10" height="10" fill="#1a1a1a"/>
                        <rect x="136" y="122" width="10" height="10" fill="#1a1a1a"/>
                        <rect x="94" y="136" width="10" height="10" fill="#1a1a1a"/><rect x="122" y="136" width="10" height="10" fill="#1a1a1a"/>
                        <rect x="136" y="136" width="10" height="10" fill="#1a1a1a"/>
                      </svg>
                      <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-2.5 text-xs text-amber-700 text-center max-w-xs">
                        QR válido para <strong>un ingreso</strong>. Al salir de pista se invalida. Genera uno nuevo para reingresar.
                      </div>
                      <div className="flex gap-2">
                        <button className="border text-sm px-4 py-2 rounded-xl hover:bg-gray-50 transition">🔄 Nuevo QR</button>
                        <button className="border text-sm px-4 py-2 rounded-xl hover:bg-gray-50 transition">⬇ Descargar</button>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* SALDO */}
              {appTab === "saldo" && (
                <div className="space-y-4">
                  <div className="bg-indigo-50 rounded-xl p-4">
                    <div className="text-xs text-gray-500">Saldo disponible</div>
                    <div className="text-4xl font-semibold text-indigo-700">142 <span className="text-xl text-gray-400">min</span></div>
                  </div>
                  <div className="grid grid-cols-3 gap-3">
                    {[{min:30,precio:"$18.900"},{min:60,precio:"$34.900"},{min:120,precio:"$59.900"}].map((p,i) => (
                      <div key={i} className={`border-2 rounded-xl p-3 cursor-pointer text-center transition ${i===1?"border-indigo-500 bg-indigo-50":"border-gray-200 hover:border-indigo-300"}`}>
                        <div className="font-semibold">{p.min} min</div>
                        <div className="text-xs text-gray-500">{p.precio}</div>
                        {i===1&&<div className="text-xs text-green-600 mt-1">popular</div>}
                        {i===2&&<div className="text-xs text-indigo-600 mt-1">mejor valor</div>}
                      </div>
                    ))}
                  </div>
                  <div className="space-y-2">
                    {["Webpay (débito / crédito)","MercadoPago"].map((m,i) => (
                      <label key={i} className="flex items-center gap-3 border rounded-xl p-3 cursor-pointer hover:bg-gray-50 transition text-sm">
                        <input type="radio" name="pago" defaultChecked={i===0} className="accent-indigo-600"/>{m}
                      </label>
                    ))}
                  </div>
                  <button className="w-full bg-indigo-600 text-white py-3 rounded-xl font-semibold hover:bg-indigo-700 transition">🔒 Pagar ahora</button>
                  <div className="border-t pt-4">
                    <div className="text-xs font-medium text-gray-500 mb-3">Historial de sesiones</div>
                    {[["Hoy 09:00","87 min"],["Ayer 14:30","60 min"],["12 jul","45 min"]].map(([f,d],i) => (
                      <div key={i} className="flex justify-between text-sm py-2 border-b last:border-0">
                        <span className="text-gray-400">{f}</span><span>{d}</span><span className="text-xs bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full">cerrada</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* REGLAMENTO */}
              {appTab === "reglamento" && (
                <div className="space-y-4">
                  <div className="text-sm text-gray-500">Consulta el reglamento y las normas de pista cuando quieras.</div>
                  <div className="space-y-2">
                    {[
                      { color: "bg-red-600", title: "Reglamento Interno de Pista", desc: "Normas de circulación, protocolo de banderas y condiciones de acceso" },
                      { color: "bg-blue-600", title: "Protocolo de Seguridad", desc: "Equipamiento obligatorio, procedimientos de emergencia y rescate" },
                      { color: "bg-green-700", title: "Condiciones y Tarifas", desc: "Política de cobro por minuto, multas, rescates y cargos adicionales" },
                    ].map((doc, i) => (
                      <div key={i} className="flex items-center gap-3 border rounded-xl p-3">
                        <div className={`${doc.color} rounded-lg w-10 h-12 flex items-center justify-center text-white text-xs font-bold flex-shrink-0`}>PDF</div>
                        <div className="flex-1"><div className="text-sm font-medium">{doc.title}</div><div className="text-xs text-gray-400">{doc.desc}</div></div>
                        <button className="text-xs border px-3 py-1.5 rounded-lg hover:bg-gray-50 transition flex-shrink-0">⬇</button>
                      </div>
                    ))}
                  </div>
                  <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide pt-2">Sistema de banderas</div>
                  <div className="space-y-2">
                    {BANDERAS.map((b, i) => (
                      <div key={i} className="flex gap-3 items-start bg-gray-50 rounded-xl p-3 text-sm">
                        <div className={`${b.color} w-4 h-4 rounded-sm mt-0.5 flex-shrink-0 border border-gray-200`}></div>
                        <div><strong>{b.nombre}:</strong> <span className="text-gray-600">{b.desc}</span></div>
                      </div>
                    ))}
                  </div>
                  <div className="bg-gray-50 border rounded-xl p-4 text-sm space-y-2">
                    <div className="font-semibold text-gray-700">Normas de adelantamiento</div>
                    <div className="text-gray-600 text-xs space-y-1.5">
                      <div>• Solo se permite adelantar por el <strong>lado derecho</strong> del vehículo adelantado.</div>
                      <div>• Si eres adelantado: <strong>mantén tu línea</strong> y facilita el paso. No cierres bruscamente.</div>
                      <div>• Está prohibido adelantar bajo bandera amarilla o doble amarilla.</div>
                      <div>• El adelantamiento debe hacerse con diferencia clara de velocidad y en zonas seguras.</div>
                    </div>
                  </div>
                  <div className="bg-blue-50 border border-blue-200 rounded-xl px-4 py-3 text-xs text-blue-700">
                    📋 Recuerda que la prueba de conocimientos se renueva en cada jornada de pista. Usa este reglamento para repasar antes de cada sesión.
                  </div>
                </div>
              )}

            </div>
          )}

        </div>
      </div>
    </div>
  );
}
