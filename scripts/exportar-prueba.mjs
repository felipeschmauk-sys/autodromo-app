#!/usr/bin/env node
/**
 * exportar-prueba.mjs — scripts/exportar-prueba.mjs
 *
 * Saca a disco todo lo que una fecha dejó grabado, para poder recrear la
 * jornada en el escritorio sin volver al autódromo.
 *
 * Lo que importa de verdad es `traza_gps`: una fila por lectura del GPS por
 * piloto, con lo que el detector calculó en ese mismo instante. Con eso se
 * puede volver a correr el detector con otros umbrales, recalcular las
 * diferencias entre autos o probar una bandera azul distinta, contra datos
 * reales y sin depender de que nadie salga a pista.
 *
 * Lo que NO queda grabado: las diferencias y la bandera azul que el panel
 * repartió en vivo. Viajan por broadcast efímero y no tocan la base. Se pueden
 * RECALCULAR desde la traza —que es justamente lo que sirve para probar
 * cambios—, pero lo que el piloto vio en su pantalla solo existe en la
 * grabación de pantalla de su teléfono.
 *
 * Uso:
 *   node scripts/exportar-prueba.mjs "prueba 1"
 *   node scripts/exportar-prueba.mjs "prueba 1" --salida ~/pruebas/2026-09-27
 *   node scripts/exportar-prueba.mjs --listar
 */

import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";

const RAIZ = resolve(new URL("..", import.meta.url).pathname);

function leerEnv() {
  try {
    const txt = readFileSync(join(RAIZ, ".env.local"), "utf8");
    return Object.fromEntries(
      txt.split("\n").filter((l) => l.includes("=") && !l.trimStart().startsWith("#")).map((l) => {
        const i = l.indexOf("=");
        return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")];
      })
    );
  } catch {
    console.error("No pude leer .env.local en la raíz del proyecto.");
    process.exit(1);
  }
}

const env = leerEnv();
const URL_BASE = env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
if (!URL_BASE || !KEY) {
  console.error("Faltan NEXT_PUBLIC_SUPABASE_URL o NEXT_PUBLIC_SUPABASE_ANON_KEY en .env.local");
  process.exit(1);
}
const H = { apikey: KEY, Authorization: `Bearer ${KEY}` };

async function pedir(path) {
  const r = await fetch(`${URL_BASE}/rest/v1/${path}`, { headers: H });
  if (!r.ok) throw new Error(`${path.split("?")[0]}: ${r.status} ${(await r.text()).slice(0, 160)}`);
  return r.json();
}

/**
 * PostgREST corta en 1000 filas por respuesta. La traza de una jornada son
 * decenas de miles, así que se pide por páginas hasta que deja de devolver.
 */
async function pedirTodo(tabla, query, etiqueta) {
  const PASO = 1000;
  const filas = [];
  for (let desde = 0; ; desde += PASO) {
    const r = await fetch(`${URL_BASE}/rest/v1/${tabla}?${query}&offset=${desde}&limit=${PASO}`, { headers: H });
    if (!r.ok) throw new Error(`${tabla}: ${r.status} ${(await r.text()).slice(0, 160)}`);
    const lote = await r.json();
    filas.push(...lote);
    if (etiqueta) process.stdout.write(`\r  ${etiqueta}: ${filas.length} filas…`);
    if (lote.length < PASO) break;
  }
  if (etiqueta) process.stdout.write(`\r  ${etiqueta}: ${filas.length} filas   \n`);
  return filas;
}

const args = process.argv.slice(2);
const iSalida = args.indexOf("--salida");
const salidaArg = iSalida >= 0 ? args[iSalida + 1] : null;
const nombreBuscado = args.filter((a, i) => !a.startsWith("--") && i !== iSalida + 1)[0];

const fechas = await pedir("fechas_evento?select=id,nombre,fecha_evento,estado,circuito_id,campeonato_id&order=fecha_evento.desc&limit=50");

if (args.includes("--listar") || !nombreBuscado) {
  console.log("\nFechas disponibles:\n");
  fechas.forEach((f) => console.log(`  ${f.fecha_evento}   ${f.nombre}   [${f.estado}]`));
  console.log('\nUso: node scripts/exportar-prueba.mjs "nombre de la fecha"\n');
  process.exit(0);
}

const fecha = fechas.find((f) => (f.nombre || "").toLowerCase().includes(nombreBuscado.toLowerCase()));
if (!fecha) {
  console.error(`No encontré ninguna fecha que contenga "${nombreBuscado}". Corre --listar para verlas.`);
  process.exit(1);
}

const sello = new Date().toISOString().slice(0, 10);
const carpeta = salidaArg
  ? resolve(salidaArg.replace(/^~/, process.env.HOME))
  : join(RAIZ, "exportes", `${fecha.fecha_evento}-${(fecha.nombre || "fecha").replace(/[^\w]+/g, "-").replace(/^-|-$/g, "")}`);
mkdirSync(carpeta, { recursive: true });

console.log(`\nExportando: ${fecha.nombre}  (${fecha.fecha_evento})`);
console.log(`Destino:    ${carpeta}\n`);

const guardar = (nombre, datos) => {
  writeFileSync(join(carpeta, nombre), JSON.stringify(datos, null, 2));
  const n = Array.isArray(datos) ? datos.length : 1;
  console.log(`  ${nombre.padEnd(24)} ${String(n).padStart(7)} ${Array.isArray(datos) ? "filas" : "objeto"}`);
};

const tandas = await pedir(`tandas?select=*&fecha_id=eq.${fecha.id}&order=inicio`);
const ids = tandas.map((t) => t.id);
const enTandas = ids.length ? `tanda_id=in.(${ids.join(",")})` : "tanda_id=is.null";

const circuito = fecha.circuito_id ? (await pedir(`circuitos?id=eq.${fecha.circuito_id}&select=*`))[0] : null;
const campeonato = fecha.campeonato_id ? (await pedir(`campeonatos?id=eq.${fecha.campeonato_id}&select=*`))[0] : null;

guardar("fecha.json", { fecha, campeonato });
guardar("circuito.json", circuito);
guardar("tandas.json", tandas);
guardar("sectores.json", await pedir("sectores_pista?select=*&order=orden"));
guardar("pilotos.json", await pedir("pilotos?select=id,nombre,numero,categoria_id"));

try { guardar("categorias.json", await pedir("categorias?select=*&order=orden")); }
catch { console.log("  categorias.json          (migración sin correr — omitido)"); }

guardar("vueltas.json", await pedirTodo("vueltas", `select=*&${enTandas}&order=cruce_at`, "vueltas"));
guardar("traza_gps.json", await pedirTodo("traza_gps", `select=*&${enTandas}&order=t_dispositivo`, "traza_gps"));

// `ubicaciones_piloto` no guarda la tanda, así que se acota por hora. La fecha
// del evento viene como día suelto: hay que completarla a instante o PostgREST
// la rechaza.
const crudo = tandas.length && tandas[0].inicio ? tandas[0].inicio : fecha.fecha_evento;
const desde = new Date(crudo.includes("T") ? crudo : `${crudo}T00:00:00Z`).toISOString();
const hasta = new Date(new Date(desde).getTime() + 36 * 3600e3).toISOString();
// encodeURIComponent es obligatorio: el "+" de la zona horaria se lee como
// espacio en una query string y Postgres rechaza la fecha
try {
  guardar("ubicaciones.json", await pedirTodo(
    "ubicaciones_piloto",
    `select=*&timestamp=gte.${encodeURIComponent(desde)}&timestamp=lte.${encodeURIComponent(hasta)}&order=timestamp`,
    "ubicaciones"));
} catch (e) { console.log(`  ubicaciones.json         (no se pudo: ${e.message.slice(0, 70)})`); }

// Ojo: la columna es `creado_at`, no `created_at`
try { guardar("log_acciones.json", await pedirTodo("log_acciones", `select=*&fecha_id=eq.${fecha.id}&order=creado_at`, "log")); }
catch (e) { console.log(`  log_acciones.json        (no se pudo: ${e.message.slice(0, 70)})`); }

// Resumen legible, para saber qué hay en la carpeta sin abrir los JSON
const traza = JSON.parse(readFileSync(join(carpeta, "traza_gps.json"), "utf8"));
const vueltas = JSON.parse(readFileSync(join(carpeta, "vueltas.json"), "utf8"));
const pilotos = JSON.parse(readFileSync(join(carpeta, "pilotos.json"), "utf8"));
const nombreDe = new Map(pilotos.map((p) => [p.id, p.nombre]));

const porPiloto = new Map();
for (const r of traza) {
  const e = porPiloto.get(r.piloto_id) ?? { lecturas: 0, vueltas: 0 };
  e.lecturas++;
  porPiloto.set(r.piloto_id, e);
}
for (const v of vueltas) {
  const e = porPiloto.get(v.piloto_id) ?? { lecturas: 0, vueltas: 0 };
  e.vueltas++;
  porPiloto.set(v.piloto_id, e);
}

const lineas = [
  `# ${fecha.nombre} — ${fecha.fecha_evento}`,
  ``,
  `Exportado el ${sello} desde ${URL_BASE.replace(/^https?:\/\//, "")}`,
  `Circuito: ${circuito?.nombre ?? "sin asignar"}` +
    (circuito?.trazado_coords ? ` · trazado de ${circuito.trazado_coords.length} puntos` : ""),
  ``,
  `## Tandas`,
  ...(tandas.length ? tandas.map((t) => `- ${t.nombre} [${t.tipo}] · inicio ${t.inicio ?? "—"} · fin ${t.fin ?? "—"}`) : ["- ninguna"]),
  ``,
  `## Por piloto`,
  `| Piloto | Lecturas GPS | Vueltas |`,
  `|---|---:|---:|`,
  ...[...porPiloto.entries()]
    .sort((a, b) => b[1].lecturas - a[1].lecturas)
    .map(([id, e]) => `| ${nombreDe.get(id) ?? id.slice(0, 8)} | ${e.lecturas} | ${e.vueltas} |`),
  ``,
  `## Qué hay acá`,
  `- traza_gps.json — una fila por lectura del GPS (~1 Hz por piloto). Es lo que`,
  `  permite volver a correr el detector o recalcular las diferencias entre autos`,
  `  con otro algoritmo, sin volver a pista.`,
  `- vueltas.json — los cruces de meta tal como quedaron registrados en vivo.`,
  `- circuito.json — trazado, geocercas y vuelta mínima vigentes ese día. Sin esto`,
  `  la traza no se puede reproyectar.`,
  ``,
  `Lo que NO está: las diferencias y la bandera azul que el panel repartió en`,
  `vivo. Viajan por broadcast efímero y no tocan la base. Se recalculan desde la`,
  `traza; lo que cada piloto vio en pantalla solo existe en su grabación.`,
  ``,
];
writeFileSync(join(carpeta, "RESUMEN.md"), lineas.join("\n"));
console.log(`  ${"RESUMEN.md".padEnd(24)}         legible`);
console.log(`\nListo. ${traza.length} lecturas de GPS y ${vueltas.length} vueltas guardadas.\n`);
