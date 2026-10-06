#!/usr/bin/env node
/**
 * prueba-banderas.mjs — scripts/prueba-banderas.mjs
 *
 * Prueba de regresión de la bandera azul y del reloj de carrera, con los
 * números REALES de la Carrera 2 del 4 de octubre de 2026 — la carrera en que
 * a Iván del Pino le salió azul yendo segundo sin haber sido doblado nunca.
 *
 * Correr esto después de tocar lib/carrera.ts o lib/gaps.ts.
 * Complementa a replay-carrera.mjs: el replay dice si las azules legítimas
 * siguen saliendo; esto dice si las falsas siguen sin salir.
 *
 *   node scripts/prueba-banderas.mjs
 */
import { vueltasComparables, vueltasDeCarrera, deadlineTanda, transcurridoTandaS } from "../lib/carrera.ts";
import { sostenerAzul } from "../lib/gaps.ts";

const ok=(c,t)=>console.log(`  ${c?"✓":"✗ FALLA"}  ${t}`);
let fallas=0; const chk=(c,t)=>{ if(!c)fallas++; ok(c,t); };

// ── Escenario real: Carrera 2, Iván del Pino ──────────────────
// Cruces reales de su traza (ms). Largada 14:47:34.
const LARGADA = Date.parse("2026-10-04T17:47:34Z");
const cruces  = [Date.parse("2026-10-04T17:45:13Z"), Date.parse("2026-10-04T17:47:40Z")];

console.log("1. El desacuerdo que causó la azul falsa\n");
const sinSaber = vueltasDeCarrera(cruces, null);
const sabiendo = vueltasDeCarrera(cruces, LARGADA);
console.log(`  Antes — teléfono que NO sabe la largada: ${sinSaber} vueltas`);
console.log(`  Antes — teléfono que SÍ sabe:            ${sabiendo} vueltas`);
chk(sinSaber !== sabiendo, `los dos conteos viejos difieren (${sinSaber} vs ${sabiendo}) ← la causa`);

const carreraSinLargada = { tipo: "carrera", largadaMs: null };
const carreraConLargada = { tipo: "carrera", largadaMs: LARGADA };
console.log(`\n  Ahora — teléfono que NO sabe: ${JSON.stringify(vueltasComparables(cruces, carreraSinLargada))}`);
console.log(`  Ahora — teléfono que SÍ sabe: ${vueltasComparables(cruces, carreraConLargada)}`);
chk(vueltasComparables(cruces, carreraSinLargada) === null, "sin saber la largada ahora responde null (no adivina)");
chk(vueltasComparables(cruces, carreraConLargada) === 0,    "sabiendo la largada responde 0, igual que antes");

console.log("\n2. Entrenamiento y clasificación no cambian\n");
const libre = { tipo: "entrenamiento", largadaMs: null };
chk(vueltasComparables(cruces, libre) === sinSaber, `sin largada, fuera de carrera sigue descontando la vuelta de salida (${sinSaber})`);
chk(vueltasComparables(cruces, null) === sinSaber,  "sin tanda tampoco cambia");

console.log("\n3. El retardo de confirmación de la azul\n");
const azul = { pid: "rival", segundos: 3 };
let e; let t = 0;
e = sostenerAzul(undefined, azul, t);
chk(e.activa === false, "en el primer instante NO enciende (antes encendía al toque)");
t += 1000; e = sostenerAzul(e, azul, t);
chk(e.activa === false, "al segundo 1 sigue apagada");
t += 1500; e = sostenerAzul(e, azul, t);
chk(e.activa === true,  "al pasar los 2 s de condición sostenida, enciende");

console.log("\n4. Un destello de un segundo ya no llega al piloto\n");
let d = sostenerAzul(undefined, azul, 0);
d = sostenerAzul(d, azul, 900);
d = sostenerAzul(d, null, 1800);          // el desacuerdo se corrigió
chk(d.activa === false, "condición que dura 0,9 s: nunca se muestra");

console.log("\n5. Una azul legítima sostenida sigue funcionando\n");
let g = sostenerAzul(undefined, azul, 0);
for (let i = 1; i <= 8; i++) g = sostenerAzul(g, azul, i * 1000);
chk(g.activa === true && g.pid === "rival", "8 s de condición real → bandera encendida");
g = sostenerAzul(g, null, 9000);
chk(g.activa === true, "un hueco corto no la apaga (amortiguador de siempre)");

console.log("\n6. El reloj de carrera corre desde la largada\n");
// Carrera 2 real: tanda abierta 14:43:07, largada 14:47:34, 15 minutos.
const tanda = {
  inicio: "2026-10-04T17:43:07Z",
  largada_at: "2026-10-04T17:47:34Z",
  duracion_min: 15,
};
const finReal = Date.parse("2026-10-04T17:59:54Z");   // cuadros de verdad
const dl = deadlineTanda(tanda);
console.log(`  La carrera debía terminar a las ${new Date(dl).toLocaleTimeString("es-CL",{timeZone:"America/Santiago",hour12:false})}`);
console.log(`  La bandera a cuadros real cayó a las 14:59:54`);
chk(dl > Date.parse("2026-10-04T17:58:10Z"),
    "ya no se corta a las 14:58:10, que fue el cierre prematuro");
chk(Math.abs(dl - finReal) < 3 * 60000,
    "el nuevo cierre queda dentro de 3 min de la bandera real");
const sinLargada = deadlineTanda({ inicio: tanda.inicio, duracion_min: 15 });
chk(dl - sinLargada === Date.parse(tanda.largada_at) - Date.parse(tanda.inicio),
    "la diferencia es exactamente el tiempo de grilla y formación (4m27s)");
chk(deadlineTanda({ inicio: tanda.inicio, duracion_min: null }) === null,
    "una tanda sin duración sigue sin deadline");
const corrido = transcurridoTandaS(tanda, Date.parse("2026-10-04T17:52:34Z"));
chk(corrido === 300, `a 5 min de la largada el transcurrido es 5:00 (dio ${corrido} s)`);

console.log(`\n${fallas === 0 ? "TODO OK" : `${fallas} FALLAS`}`);
process.exit(fallas ? 1 : 0);
