// Monitor de jornada: deja un registro con hora de qué estaba vivo en cada
// momento. Sirve para correlacionar después lo que se vio en pista con lo que
// el sistema estaba recibiendo de verdad.
//
// Muestrea el tiempo real de a ratos cortos en vez de mantener una suscripción
// abierta: una suscripción permanente suma mensajes a la cuota del proyecto, y
// justo eso es lo que no queremos alterar mientras medimos.
import { readFileSync, appendFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
const env = Object.fromEntries(readFileSync(".env.local","utf8")
  .split("\n").filter(l=>l.includes("=")).map(l=>{const i=l.indexOf("=");return [l.slice(0,i).trim(),l.slice(i+1).trim().replace(/^["']|["']$/g,"")];}));
const U=env.NEXT_PUBLIC_SUPABASE_URL, K=env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const H={apikey:K,Authorization:`Bearer ${K}`};
const LOG="/tmp/monitor-carrera.log";
const h=()=>new Date().toLocaleTimeString("es-CL",{timeZone:"America/Santiago",hour12:false});
const q=async(p,n=3)=>{for(let i=0;i<n;i++){try{
  return JSON.parse(await (await fetch(`${U}/rest/v1/${p}`,{headers:H,signal:AbortSignal.timeout(15000)})).text());
}catch(e){ if(i===n-1) return null; await new Promise(r=>setTimeout(r,1000)); }}};

const pil=await q("pilotos?select=id,nombre,numero");
const nom=new Map((pil||[]).map(p=>[p.id,p.numero||p.nombre]));
const linea=t=>{ appendFileSync(LOG,t+"\n"); console.log(t); };
linea(`\n═══ MONITOR INICIADO ${new Date().toLocaleString("es-CL",{timeZone:"America/Santiago",hour12:false})} ═══`);
linea(`hora      tel.vivos  eventos/10s  tanda            bandera   detalle`);

// Prueba corta de tiempo real: 10 s cada ciclo
async function pulsoRealtime(){
  return new Promise(res=>{
    const sb=createClient(U,K); let n=0;
    const ch=sb.channel("mon-"+Date.now())
      .on("postgres_changes",{event:"INSERT",schema:"public",table:"ubicaciones_piloto"},()=>n++)
      .subscribe();
    setTimeout(()=>{ sb.removeChannel(ch); res(n); },10000);
  });
}

let ciclos=0;
const MAX=120; // ~2 horas
const tick=async()=>{
  ciclos++;
  const ahora=Date.now();
  const ub=await q("ubicaciones_piloto?select=piloto_id,timestamp,velocidad,dentro_geocerca&order=timestamp.desc&limit=100");
  const ult=new Map();
  (ub||[]).forEach(r=>{ if(!ult.has(r.piloto_id)) ult.set(r.piloto_id,r); });
  const vivos=[...ult].filter(([,r])=>ahora-new Date(r.timestamp).getTime()<15000);
  const enPista=vivos.filter(([,r])=>r.dentro_geocerca===true).length;
  const ev=await pulsoRealtime();
  const t=await q("tandas?select=nombre,tipo,fin&order=inicio.desc&limit=1");
  const tn=t?.[0] ? `${t[0].nombre}${t[0].fin?" (fin)":""}` : "—";
  const ep=await q("estado_pista?select=bandera&activo=eq.true");
  const bn=ep?.[0]?.bandera ?? "?";
  const alerta = vivos.length>0 && ev===0 ? "  ⚠ hay escrituras y el tiempo real NO entrega"
               : vivos.length===0 ? "  ⚠ ningún teléfono escribiendo" : "";
  linea(`${h()}  ${String(vivos.length).padStart(9)}  ${String(ev).padStart(11)}  ${tn.padEnd(16)} ${bn.padEnd(9)} ${enPista} en pista${alerta}`);
  if(ciclos>=MAX){ linea(`═══ MONITOR TERMINADO ${h()} ═══`); process.exit(0); }
};
await tick();
setInterval(tick, 60000);
