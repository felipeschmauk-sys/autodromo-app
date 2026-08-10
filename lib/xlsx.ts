// ── Escritor mínimo de .xlsx (varias hojas, sin dependencias) ──
//
// Un .xlsx es un ZIP con XML adentro. Se escribe a mano en vez de sumar una
// librería de ~1 MB al panel: acá solo se necesitan celdas de texto y número,
// sin formato ni fórmulas.
//
// Se usa ZIP "stored" (sin comprimir), que es válido y evita tener que
// implementar deflate. Las planillas de resultados son chicas.

export type Celda = string | number | null | undefined
export interface Hoja {
  nombre: string
  filas: Celda[][]
}

// ── ZIP ────────────────────────────────────────────────────────
const TABLA_CRC = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()

function crc32(datos: Uint8Array): number {
  let c = 0xffffffff
  for (let i = 0; i < datos.length; i++) c = TABLA_CRC[(c ^ datos[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

interface Entrada { nombre: string; datos: Uint8Array; crc: number; offset: number }

function u16(v: number) { return [v & 0xff, (v >>> 8) & 0xff] }
function u32(v: number) { return [v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff] }

function zip(archivos: { nombre: string; texto: string }[]): Blob {
  const enc = new TextEncoder()
  const partes: number[] = []
  const entradas: Entrada[] = []

  for (const a of archivos) {
    const datos = enc.encode(a.texto)
    const nombre = enc.encode(a.nombre)
    const crc = crc32(datos)
    const offset = partes.length
    partes.push(
      ...u32(0x04034b50), ...u16(20), ...u16(0), ...u16(0), ...u16(0), ...u16(0),
      ...u32(crc), ...u32(datos.length), ...u32(datos.length),
      ...u16(nombre.length), ...u16(0),
      ...nombre, ...datos,
    )
    entradas.push({ nombre: a.nombre, datos, crc, offset })
  }

  const inicioCentral = partes.length
  for (const e of entradas) {
    const nombre = enc.encode(e.nombre)
    partes.push(
      ...u32(0x02014b50), ...u16(20), ...u16(20), ...u16(0), ...u16(0), ...u16(0), ...u16(0),
      ...u32(e.crc), ...u32(e.datos.length), ...u32(e.datos.length),
      ...u16(nombre.length), ...u16(0), ...u16(0), ...u16(0), ...u16(0), ...u32(0),
      ...u32(e.offset), ...nombre,
    )
  }
  const largoCentral = partes.length - inicioCentral
  partes.push(
    ...u32(0x06054b50), ...u16(0), ...u16(0),
    ...u16(entradas.length), ...u16(entradas.length),
    ...u32(largoCentral), ...u32(inicioCentral), ...u16(0),
  )

  return new Blob([new Uint8Array(partes)], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
}

// ── XML ────────────────────────────────────────────────────────
// Los caracteres de control rompen el XML y Excel se niega a abrir el archivo
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g
const esc = (s: string) =>
  s.replace(CONTROL, '')
   .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
   .replace(/"/g, '&quot;')

/** 0 → A, 25 → Z, 26 → AA */
function columna(i: number): string {
  let s = ''
  i += 1
  while (i > 0) { const r = (i - 1) % 26; s = String.fromCharCode(65 + r) + s; i = (i - r - 1) / 26 }
  return s
}

function hojaXml(filas: Celda[][]): string {
  const out: string[] = [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>',
  ]
  filas.forEach((fila, f) => {
    out.push(`<row r="${f + 1}">`)
    fila.forEach((celda, c) => {
      if (celda === null || celda === undefined || celda === '') return
      const ref = `${columna(c)}${f + 1}`
      if (typeof celda === 'number' && Number.isFinite(celda)) {
        out.push(`<c r="${ref}"><v>${celda}</v></c>`)
      } else {
        // inlineStr evita tener que generar sharedStrings.xml
        out.push(`<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${esc(String(celda))}</t></is></c>`)
      }
    })
    out.push('</row>')
  })
  out.push('</sheetData></worksheet>')
  return out.join('')
}

/** Nombre de hoja válido para Excel: sin : \ / ? * [ ] y máximo 31 caracteres. */
function nombreHoja(n: string): string {
  return (n.replace(/[:\\/?*[\]]/g, '-').slice(0, 31)) || 'Hoja'
}

/** Genera un .xlsx con una hoja por cada entrada. */
export function construirXlsx(hojas: Hoja[]): Blob {
  const usados = new Set<string>()
  const nombres = hojas.map((h) => {
    let n = nombreHoja(h.nombre)
    let i = 2
    while (usados.has(n.toLowerCase())) { n = nombreHoja(`${h.nombre} ${i++}`) }
    usados.add(n.toLowerCase())
    return n
  })

  const archivos = [
    {
      nombre: '[Content_Types].xml',
      texto:
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Default Extension="xml" ContentType="application/xml"/>' +
        '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
        hojas.map((_, i) =>
          `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`
        ).join('') +
        '</Types>',
    },
    {
      nombre: '_rels/.rels',
      texto:
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
        '</Relationships>',
    },
    {
      nombre: 'xl/workbook.xml',
      texto:
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ' +
        'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>' +
        nombres.map((n, i) => `<sheet name="${esc(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('') +
        '</sheets></workbook>',
    },
    {
      nombre: 'xl/_rels/workbook.xml.rels',
      texto:
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        hojas.map((_, i) =>
          `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`
        ).join('') +
        '</Relationships>',
    },
    ...hojas.map((h, i) => ({ nombre: `xl/worksheets/sheet${i + 1}.xml`, texto: hojaXml(h.filas) })),
  ]

  return zip(archivos)
}

/** Dispara la descarga en el navegador. */
export function descargarXlsx(hojas: Hoja[], nombreArchivo: string) {
  const url = URL.createObjectURL(construirXlsx(hojas))
  const a = document.createElement('a')
  a.href = url
  a.download = nombreArchivo.endsWith('.xlsx') ? nombreArchivo : `${nombreArchivo}.xlsx`
  a.click()
  URL.revokeObjectURL(url)
}
