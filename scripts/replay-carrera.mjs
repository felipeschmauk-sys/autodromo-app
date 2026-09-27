#!/usr/bin/env node
/**
 * replay-carrera.mjs — scripts/replay-carrera.mjs
 *
 * Vuelve a correr una tanda ya guardada contra la lógica ACTUAL del código, sin
 * pisar el autódromo. Reconstruye lo que cada teléfono habría detectado y lo que
 * el panel habría calculado y repartido: vueltas, posiciones, orden de llegada y
 * banderas azules.
 *
 * Para qué sirve: cuando se toque el detector, el cálculo de diferencias o la
 * bandera azul, correr esto sobre una jornada real dice si el cambio mejoró algo
 * o rompió lo que funcionaba. Es la red de seguridad que reemplaza a salir a
 * probar con autos.
 *
 * Usa una carpeta hecha con `exportar-prueba.mjs`, así que funciona sin red.
 *
 * Uso:
 *   node scripts/replay-carrera.mjs exportes/2026-09-27-prueba-1
 *   node scripts/replay-carrera.mjs exportes/2026-09-27-prueba-1 "Carrera 5"
 */

import { readFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { vueltasDeCarrera } from "../lib/carrera.ts";
import { calcularGaps, instanteEn } from "../lib/gaps.ts";
import { prepararTrazado } from "../lib/trazado.ts";

const [carpetaArg, tandaArg] = process.argv.slice(2);
if (!carpetaArg) {
  console.error("Uso: node scripts/replay-carrera.mjs <carpeta-exportada> [nombre de tanda]");
  process.exit(1);
}
const dir = resolve(carpetaArg.replace(/^~/, process.env.HOME));
const leer = (n) => {
  const p = join(dir, n);
  if (!existsSync(p)) { console.error(`Falta ${n} en ${dir}`); process.exit(1); }
  return JSON.parse(readFileSync(p, "utf8"));
};

const circuito = leer("circuito.json");
const tandas   = leer("tandas.json");
const pilotos  = leer("pilotos.json");
const traza    = leer("traza_gps.json");
const vueltas  = leer("vueltas.json");

const tz = prepararTrazado(circuito?.trazado_coords ?? []);
if (!tz) { console.error("El circuito exportado no tiene trazado utilizable."); process.exit(1); }
const LARGO = tz.largo;

const nombre = new Map(pilotos.map((p) => [p.id, p.numero || p.nombre]));
const catDe  = new Map(pilotos.map((p) => [p.id, p.categoria_id ?? null]));
const hora   = (t) => new Date(t).toLocaleTimeString("es-CL", { timeZone: "America/Santiago", hour12: false });

const candidatas = tandas.filter((t) => (tandaArg ? t.nombre === tandaArg : true));
if (!candidatas.length) {
  console.error(`No encontré la tanda "${tandaArg}". Disponibles:`);
  tandas.forEach((t) => console.error(`  · ${t.nombre} [${t.tipo}]`));
  process.exit(1);
}

console.log(`\nCircuito: ${circuito.nombre} · ${Math.round(LARGO)} m · ${circuito.trazado_coords.length} puntos`);

for (const t of candidatas) {
  const filas = traza.filter((r) => r.tanda_id === t.id && r.progreso != null);
  if (filas.length < 10) continue;

  const PROG = t.vueltas_programadas ?? null;
  const LG   = t.largada_at ? new Date(t.largada_at).getTime() : null;
  const esCarrera = t.tipo === "carrera";

  console.log(`\n${"═".repeat(62)}`);
  console.log(`${t.nombre} [${t.tipo}] · ${filas.length} lecturas` +
              (PROG ? ` · ${PROG} vueltas` : "") +
              (LG ? ` · largada ${hora(LG)}` : esCarrera ? " · SIN LARGADA MARCADA" : ""));

  // Estado por piloto, simulando el detector que corre en cada teléfono
  const est = new Map();
  const llegadas = new Map();
  const alTerminar = new Map();
  let liderTermino = false;
  const eventos = [];
  let azules = 0, instantesDoblaje = 0, mejorAcercamiento = Infinity, mejorTxt = "";

  for (const r of filas) {
    const t0 = new Date(r.t_dispositivo).getTime() + (r.offset_ms ?? 0);
    const p  = r.progreso;
    const e  = est.get(r.piloto_id) ?? {
      prog: null, armado: false, cruces: [], cerrado: false,
      vu: 0, progreso: p, t: t0, dentro: r.dentro_geocerca, hist: [],
    };
    // Histéresis igual que en la app: se arma al pasar por la mitad del circuito
    if (p > 0.4 && p < 0.7) e.armado = true;
    if (!e.cerrado && e.armado && e.prog != null && p < e.prog - 0.5) {
      e.cruces.push(t0);
      e.armado = false;
      if (PROG && vueltasDeCarrera(e.cruces, LG) >= PROG) e.cerrado = true;
    }
    e.prog = p; e.progreso = p; e.t = t0; e.dentro = r.dentro_geocerca;
    e.vu = vueltasDeCarrera(e.cruces, LG);
    e.hist.push({ t: t0, recorrido: (e.vu + p) * LARGO });
    if (e.hist.length > 300) e.hist.shift();
    est.set(r.piloto_id, e);

    const estados = [...est]
      .filter(([, v]) => v.hist.length >= 2)
      .map(([pid, v]) => ({ pid, vueltas: v.vu, progreso: v.progreso, t: v.t, enPista: v.dentro, historia: v.hist }));
    if (estados.length < 1) continue;

    const gaps = calcularGaps(estados, { largo: LARGO, ahora: t0, modo: esCarrera ? "carrera" : "libre" });
    gaps.forEach((g) => { if (g.azul) azules++; });

    // Oportunidades de bandera azul, se cumplan o no: sirve para saber si un
    // cambio de umbral tendría efecto sobre datos reales
    if (esCarrera) {
      for (const yo of estados) {
        for (const otro of estados) {
          if (otro.pid === yo.pid || otro.vueltas <= yo.vueltas) continue;
          if (otro.enPista === false || yo.enPista === false) continue;
          instantesDoblaje++;
          const vr = otro.progreso <= yo.progreso ? yo.vueltas : yo.vueltas - 1;
          let tt = null;
          for (const v of [vr, vr - 1]) { tt = instanteEn(yo.historia, (v + otro.progreso) * LARGO); if (tt != null) break; }
          if (tt == null) continue;
          const seg = (otro.t - tt) / 1000;
          if (seg >= 0 && seg < mejorAcercamiento) {
            mejorAcercamiento = seg;
            mejorTxt = `${nombre.get(otro.pid)} (v${otro.vueltas}) sobre ${nombre.get(yo.pid)} (v${yo.vueltas}) a ${seg.toFixed(1)} s @ ${hora(t0)}`;
          }
        }
      }
    }

    // Llegada: cada piloto termina en SU cruce, y el resultado lo fijan las
    // vueltas primero y el orden de cruce después
    if (esCarrera && PROG) {
      const orden = [...estados].sort((a, b) => (b.vueltas + b.progreso) - (a.vueltas + a.progreso));
      if (!liderTermino && orden[0].vueltas >= PROG) {
        liderTermino = true;
        orden.forEach((x) => alTerminar.set(x.pid, x.vueltas));
        eventos.push(`${hora(t0)}  el líder (${nombre.get(orden[0].pid)}) completa las ${PROG} vueltas`);
      }
      for (const x of orden) {
        if (llegadas.has(x.pid)) continue;
        const ya = x.vueltas >= PROG || (liderTermino && x.vueltas > (alTerminar.get(x.pid) ?? Infinity));
        if (!ya) continue;
        llegadas.set(x.pid, { vueltas: x.vueltas, t: t0 });
        eventos.push(`${hora(t0)}  cruza su meta ${String(nombre.get(x.pid)).padEnd(16)} con ${x.vueltas} vueltas`);
      }
    }
  }

  // ── Conteo de vueltas: replay contra lo que quedó registrado en vivo ──
  const registradas = new Map();
  vueltas.filter((v) => v.tanda_id === t.id).forEach((v) => registradas.set(v.piloto_id, (registradas.get(v.piloto_id) ?? 0) + 1));
  console.log(`\n  ${"piloto".padEnd(16)} replay  en vivo  dif`);
  let descuadres = 0;
  [...est].sort((a, b) => b[1].vu - a[1].vu).forEach(([pid, e]) => {
    const viva = registradas.get(pid) ?? 0;
    const dif = e.cruces.length - viva;
    if (dif !== 0) descuadres++;
    console.log(`  ${String(nombre.get(pid)).padEnd(16)} ${String(e.cruces.length).padStart(6)} ${String(viva).padStart(8)} ${String(dif > 0 ? "+" + dif : dif).padStart(4)}`);
  });
  if (descuadres === 0) console.log("  → el replay reproduce exactamente los cruces registrados en pista");

  if (eventos.length) {
    console.log("\n  Llegada:");
    eventos.forEach((e) => console.log("    " + e));
    const lista = [...llegadas].map(([pid, l]) => ({ pid, ...l, cat: catDe.get(pid) }));
    const porCat = new Map();
    lista.forEach((l) => { if (!l.cat) return; if (!porCat.has(l.cat)) porCat.set(l.cat, []); porCat.get(l.cat).push(l); });
    console.log("\n  Resultado oficial (vueltas, luego orden de cruce):");
    porCat.forEach((li) => {
      li.sort((a, b) => b.vueltas - a.vueltas || a.t - b.t);
      li.forEach((l, i) => console.log(`    P${i + 1}  ${String(nombre.get(l.pid)).padEnd(16)} ${l.vueltas} vueltas · cruzó ${hora(l.t)}`));
    });
  }

  if (esCarrera) {
    console.log(`\n  Bandera azul: ${azules} instantes encendida · ${instantesDoblaje} instantes con alguien doblado`);
    console.log(`  Acercamiento máximo doblador→doblado: ${mejorAcercamiento === Infinity ? "nunca se dio" : mejorTxt}`);
  }
}
console.log("");
