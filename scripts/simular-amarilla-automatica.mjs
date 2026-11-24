#!/usr/bin/env node
/**
 * simular-amarilla-automatica.mjs — scripts/simular-amarilla-automatica.mjs
 *
 * Corre la decisión de la amarilla automática sobre una jornada ya exportada y
 * compara la regla vieja (solo velocidad) con la nueva (velocidad + tiempo
 * sostenido). Sirve para elegir el umbral con datos en vez de con opinión.
 *
 * Por qué existe: `checkAutoYellow` decidía solo por velocidad y no exigía que
 * el auto llevara detenido ningún tiempo. En Interlomas eso produjo episodios
 * de 0,4 · 0,7 · 1,5 · 2 y 4 segundos — un auto "detenido" menos de cinco
 * segundos es una curva lenta o ruido del GPS—, y cada uno se abre en abanico a
 * todos los teléfonos. Ver docs/PLAN_ADVERTENCIAS.md, punto 3.
 *
 * Lee `traza_gps.json`, que es el dato a 1 Hz de cada teléfono y cubre la
 * jornada entera. OJO: en vivo la decisión la disparan los `ubicaciones_piloto`
 * (cada 3 s), así que los instantes exactos difieren un poco; la comparación
 * entre las dos reglas sí es pareja porque las dos corren sobre lo mismo.
 *
 * Uso:
 *   node scripts/simular-amarilla-automatica.mjs exportes/2026-10-25-Interlomas
 *   node scripts/simular-amarilla-automatica.mjs exportes/... --segundos 3
 */

import { readFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
// lib/gps.ts no se puede importar desde node: usa alias "@/..." que solo
// resuelve el bundler. Estos tres tienen que seguir a los de allá.
const DETENIDO_KMH = 10;
const REANUDA_KMH  = 13;
const DETENIDO_MS  = 5_000;

const args = process.argv.slice(2);
const i = args.indexOf("--segundos");
const SOSTENIDO_MS = i >= 0 ? Number(args[i + 1]) * 1000 : DETENIDO_MS;
const carpeta = args.find((a, k) => !a.startsWith("--") && !(k > 0 && args[k - 1].startsWith("--")));
if (!carpeta) {
  console.error("Uso: node scripts/simular-amarilla-automatica.mjs <carpeta-exportada> [--segundos 5]");
  process.exit(1);
}
const dir = resolve(carpeta.replace(/^~/, process.env.HOME));
const leer = (n) => {
  const p = join(dir, n);
  if (!existsSync(p)) { console.error(`Falta ${n} en ${dir}`); process.exit(1); }
  return JSON.parse(readFileSync(p, "utf8"));
};

const traza = leer("traza_gps.json");
const nombre = new Map(leer("pilotos.json").map((p) => [p.id, p.numero || p.nombre]));
const hora = (t) => new Date(t - 3 * 3600_000).toISOString().replace("T", " ").slice(5, 19);

const filas = traza
  .filter((r) => r.t_dispositivo)
  .sort((a, b) => a.t_dispositivo.localeCompare(b.t_dispositivo))
  .map((r) => ({
    pid: r.piloto_id,
    t: new Date(r.t_dispositivo).getTime(),
    kmh: (r.velocidad_ms ?? 0) * 3.6,
    dentro: r.dentro_geocerca,
  }));

/** Misma lógica que checkAutoYellow en components/DireccionCarrera.tsx. */
function simular(conTiempo) {
  const amarilla = new Map(), lento = new Map(), rapido = new Map();
  const episodios = [];
  for (const f of filas) {
    if (f.dentro === false) {
      lento.delete(f.pid); rapido.delete(f.pid);
      if (amarilla.has(f.pid)) { episodios.push([amarilla.get(f.pid), f.t, f.pid]); amarilla.delete(f.pid); }
      continue;
    }
    if (f.dentro !== true) continue;
    if (f.kmh <= DETENIDO_KMH) {
      rapido.delete(f.pid);
      if (!lento.has(f.pid)) lento.set(f.pid, f.t);
      if (conTiempo && f.t - lento.get(f.pid) < SOSTENIDO_MS) continue;
      if (!amarilla.has(f.pid)) amarilla.set(f.pid, f.t);
    } else if (f.kmh > REANUDA_KMH) {
      lento.delete(f.pid);
      if (!rapido.has(f.pid)) rapido.set(f.pid, f.t);
      if (conTiempo && f.t - rapido.get(f.pid) < SOSTENIDO_MS) continue;
      if (amarilla.has(f.pid)) { episodios.push([amarilla.get(f.pid), f.t, f.pid]); amarilla.delete(f.pid); }
    }
  }
  return episodios.sort((a, b) => a[0] - b[0]);
}

console.log(`\nJornada: ${dir.split("/").pop()} · ${filas.length} lecturas`);
console.log(`Umbrales: detenido ≤ ${DETENIDO_KMH} km/h · reanuda > ${REANUDA_KMH} km/h · sostenido ${SOSTENIDO_MS / 1000} s\n`);

for (const [etiqueta, conTiempo] of [["REGLA DE HOY (solo velocidad)", false], [`REGLA NUEVA (${SOSTENIDO_MS / 1000} s sostenidos)`, true]]) {
  const ep = simular(conTiempo);
  const cortos = ep.filter(([i2, f]) => (f - i2) / 1000 <= 10).length;
  const total = ep.reduce((s, [i2, f]) => s + (f - i2) / 1000, 0);
  console.log(`=== ${etiqueta} ===`);
  console.log(`  ${ep.length} episodios · ${cortos} de 10 s o menos · ${(total / 60).toFixed(1)} min de amarilla en total`);
  ep.forEach(([i2, f, pid]) =>
    console.log(`   ${hora(i2)}  dura ${((f - i2) / 1000).toFixed(1).padStart(7)} s   ${nombre.get(pid) ?? pid.slice(0, 8)}`));
  console.log("");
}
console.log("Lo que importa no es cuánta amarilla hay sino cuántos EVENTOS: cada uno");
console.log("se abre en abanico a todos los teléfonos.\n");
