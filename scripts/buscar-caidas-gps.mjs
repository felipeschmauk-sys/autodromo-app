#!/usr/bin/env node
/**
 * buscar-caidas-gps.mjs — scripts/buscar-caidas-gps.mjs
 *
 * Busca, dentro de una jornada exportada, los momentos en que VARIOS teléfonos
 * apagaron el GPS en el mismo segundo.
 *
 * La huella: antes de apagarse, el teléfono vuelca de golpe la traza que tenía
 * acumulada (`detenerGPS()` en app/page.tsx llama a `volcarTraza()`). En
 * `traza_gps` eso se ve como muchas filas de muchas sesiones escritas en un
 * mismo segundo, cuando lo normal es una o dos sesiones por segundo. Después,
 * silencio.
 *
 * Así se diagnosticó el 4 de octubre (docs/INCIDENTE_2026-10-04.md) y así se
 * encontraron las tres caídas de Interlomas (docs/INCIDENTE_2026-10-18.md).
 * Esto lo deja como herramienta en vez de como consulta a mano, para poder
 * correrlo sobre cada jornada nueva.
 *
 * Uso:
 *   node scripts/buscar-caidas-gps.mjs exportes/2026-10-25-Interlomas
 *   node scripts/buscar-caidas-gps.mjs exportes/... --sesiones 4 --peloton 6 --tz -3
 */

import { readFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";

const args = process.argv.slice(2);
const opcion = (n, pordefecto) => {
  const i = args.indexOf(n);
  return i >= 0 ? Number(args[i + 1]) : pordefecto;
};
// A partir de cuántas sesiones escribiendo en el mismo segundo se considera
// un volcado. Ojo con bajarlo a 4: la subida periódica normal de la traza
// junta 4 sesiones cada 10 s y aparecerían como falsos positivos. En Interlomas
// el corte es nítido: 4 sesiones ocurre 17 veces, y 6, 7 y 8 una vez cada una
// —las tres caídas—.
const UMBRAL = opcion("--sesiones", 5);
// Cuántos teléfonos en pista cuentan como "pelotón". Es otra cosa que el
// umbral de volcado y por eso va aparte.
const PELOTON = opcion("--peloton", 4);
// Huso horario del autódromo, para que las horas se lean como en pista
const TZ = opcion("--tz", -3);
const carpeta = args.find((a, i) => !a.startsWith("--") && !(i > 0 && args[i - 1].startsWith("--")));

if (!carpeta) {
  console.error("Uso: node scripts/buscar-caidas-gps.mjs <carpeta-exportada> [--sesiones 4] [--tz -3]");
  process.exit(1);
}
const dir = resolve(carpeta.replace(/^~/, process.env.HOME));
const leer = (n) => {
  const p = join(dir, n);
  if (!existsSync(p)) { console.error(`Falta ${n} en ${dir}`); process.exit(1); }
  return JSON.parse(readFileSync(p, "utf8"));
};

const traza   = leer("traza_gps.json");
const log     = leer("log_acciones.json");
const pilotos = leer("pilotos.json");

const nombre = new Map(pilotos.map((p) => [p.id, p.numero || p.nombre]));
const seg = (s) => Math.floor(new Date(s).getTime() / 1000);
const hora = (s) => new Date((s + TZ * 3600) * 1000).toISOString().replace("T", " ").slice(5, 19);

// ── Teléfonos vivos, por el instante en que MIDIERON ──────────
const vivos = new Map();
for (const r of traza) {
  if (!r.t_dispositivo) continue;
  const s = seg(r.t_dispositivo);
  if (!vivos.has(s)) vivos.set(s, new Set());
  vivos.get(s).add(r.piloto_id);
}
const cuantos = (desde, hasta) => {
  const u = new Set();
  for (let s = desde; s <= hasta; s++) vivos.get(s)?.forEach((p) => u.add(p));
  return u.size;
};

// ── Escrituras, por el instante en que SE GUARDARON ───────────
const escrituras = new Map();
for (const r of traza) {
  if (!r.created_at) continue;
  const s = seg(r.created_at);
  if (!escrituras.has(s)) escrituras.set(s, { filas: 0, ses: new Set() });
  const e = escrituras.get(s);
  e.filas++; e.ses.add(r.sesion_id);
}

console.log(`\nJornada: ${dir.split("/").pop()} · ${traza.length} lecturas de GPS\n`);

const reparto = new Map();
escrituras.forEach((e) => reparto.set(e.ses.size, (reparto.get(e.ses.size) ?? 0) + 1));
console.log("Sesiones escribiendo en un mismo segundo (reparto normal):");
[...reparto.keys()].sort((a, b) => a - b).forEach((k) =>
  console.log(`   ${String(k).padStart(2)} sesiones · ${reparto.get(k)} segundos${k >= UMBRAL ? "   ← sospechoso" : ""}`));

const sospechosos = [...escrituras].filter(([, e]) => e.ses.size >= UMBRAL).sort((a, b) => a[0] - b[0]);
// La subida periódica de la traza es cada ~10 s, así que con muchos autos en
// pista también junta varias sesiones por segundo. Lo que delata un apagón no
// es el tamaño sino que esté SUELTO: un volcado de verdad no tiene otro igual
// 10 s antes ni 10 s después.
const enCadencia = new Set(sospechosos
  .filter(([s]) => sospechosos.some(([o]) => o !== s && Math.abs(o - s) >= 8 && Math.abs(o - s) <= 12))
  .map(([s]) => s));
const sueltos = sospechosos.filter(([s]) => !enCadencia.has(s));

console.log(`\nVolcados de ${UMBRAL}+ sesiones en el mismo segundo: ${sospechosos.length}` +
            ` · sueltos (sospechosos de apagón): ${sueltos.length}`);
sueltos.forEach(([s, e]) => console.log(`   ${hora(s)}  ${String(e.filas).padStart(4)} filas · ${e.ses.size} sesiones   ← suelto`));
if (enCadencia.size) {
  console.log(`   (${enCadencia.size} más caen en la cadencia de ~10 s de la subida normal y se omiten;` +
              ` --todos para verlos)`);
  if (args.includes("--todos")) {
    sospechosos.filter(([s]) => enCadencia.has(s))
      .forEach(([s, e]) => console.log(`   ${hora(s)}  ${String(e.filas).padStart(4)} filas · ${e.ses.size} sesiones   periódico`));
  }
}

// ── Amarillas automáticas: qué pasó con los teléfonos ─────────
const amarillas = log
  .filter((x) => x.tipo === "auto_yellow" && /Amarilla/.test(x.descripcion))
  .sort((a, b) => a.creado_at.localeCompare(b.creado_at));

console.log(`\nAmarillas automáticas: ${amarillas.length} · con pelotón (${PELOTON}+ teléfonos):`);
console.log(`   ${"hora".padEnd(15)} ${"antes".padStart(6)} ${"11-30 s".padStart(8)} ${"31-120 s".padStart(9)}   volcado máximo`);

let caidas = 0, conPeloton = 0;
for (const a of amarillas) {
  const t = seg(a.creado_at);
  const antes = cuantos(t - 10, t - 1);
  if (antes < PELOTON) continue;
  conPeloton++;
  const luego = cuantos(t + 11, t + 30);
  const vuelve = cuantos(t + 31, t + 120);
  let pico = null;
  for (let s = t; s <= t + 15; s++) {
    const e = escrituras.get(s);
    if (e && (!pico || e.ses.size > pico.e.ses.size)) pico = { s, e };
  }
  const cae = luego <= Math.floor(antes / 2);
  if (cae) caidas++;
  console.log(
    `   ${hora(t).padEnd(15)} ${String(antes).padStart(6)} ${String(luego).padStart(8)} ${String(vuelve).padStart(9)}` +
    `   ${pico ? `${pico.e.ses.size} sesiones a los ${pico.s - t} s` : "—"}${cae ? "   ← CAÍDA" : ""}`);
}

console.log(`\n  Con pelotón: ${conPeloton} · tumbaron el GPS: ${caidas}`);
if (caidas) {
  console.log("\n  Alrededor de cada caída (lo registrado entre -30 s y +60 s):");
  for (const a of amarillas) {
    const t = seg(a.creado_at);
    const antes = cuantos(t - 10, t - 1);
    if (antes < PELOTON || cuantos(t + 11, t + 30) > Math.floor(antes / 2)) continue;
    console.log(`\n   ── ${hora(t)} ──`);
    log
      .filter((e) => { const d = seg(e.creado_at) - t; return d >= -30 && d <= 60; })
      .sort((x, y) => x.creado_at.localeCompare(y.creado_at))
      .forEach((e) => {
        const d = seg(e.creado_at) - t;
        const quien = e.piloto_id ? nombre.get(e.piloto_id) ?? "" : "";
        console.log(`   ${(d >= 0 ? "+" : "") + d}s`.padStart(8) +
                    `  ${e.tipo.padEnd(15)} ${e.descripcion.slice(0, 62)}  ${quien}`);
      });
  }
}
console.log("");
