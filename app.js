/* Editor Murillo's — v5 (interfaz estilo CapCut: vista previa arriba,
 * barra de herramientas abajo, paneles por herramienta; motor igual).
 * Todo el proceso pasa en el teléfono: nada se sube a internet.
 * Motor de video: ffmpeg.wasm 0.12.10 (un solo hilo, sin COOP/COEP).
 * Subtítulos: @xenova/transformers 2.17.2, modelo Xenova/whisper-tiny.
 * Recetas copiadas del editor de escritorio (editar.py): mismos números
 * de silencios, subtítulos, música y formato 9:16.
 */
'use strict';

/* ---------------- estado ---------------- */
const state = {
  mode: 'efecto',           // 'efecto' | 'plantilla'
  effect: 'burbuja',        // ninguno | burbuja | letra | irvenir | cine
  textSize: 'mediano',      // chico | mediano | grande (letras burbuja)
  textPos: 'arriba',        // arriba | centro | abajo (letras burbuja)
  musicVol: 'media',        // baja | media | fuerte
  voiceVol: 'normal',       // silencio | normal | fuerte
  filter: 'original',       // original | calido | frio | vivo | byn
  speed: 1,                 // 0.5 | 1 | 1.5 | 2
  mainFile: null, mainDuration: 0, mainSize: 0,
  musicFile: null,
  slots: [null, null, null, null],   // archivos por lugar de la plantilla
  template: null,           // definición de plantilla cargada
  workDuration: 0,          // duración del video en curso
  outBlob: null, outName: 'murillos-pizza-editado.mp4',
};

/* Plantilla integrada: Estilo Ren Director (igual que
 * ~/workspace/murillos-video-editor/plantillas/plantilla-ren-director.json) */
const TEMPLATE_REN = {
  nombre: 'Estilo Ren Director',
  formato: '9:16', resolucion: '1080x1920', version: 1,
  descripcion: 'Clips con efecto ir y venir, tono cine y tarjeta final negra.',
  clips: [
    { lugar: 1, que_va: 'video', duracion_segundos: 5.0, ejemplo: 'Horno encendiéndose' },
    { lugar: 2, que_va: 'video', duracion_segundos: 4.4, ejemplo: 'Estirando la masa' },
    { lugar: 3, que_va: 'video', duracion_segundos: 4.0, ejemplo: 'Pizza saliendo del horno' },
    { lugar: 4, que_va: 'video', duracion_segundos: 5.0, ejemplo: 'Puesto en el tianguis de noche' },
  ],
  cierre: { duracion_segundos: 3.5, fondo: 'negro', texto_principal: "MURILLO'S PIZZA", texto_secundario: 'MÉRIDA 2026', texto_final: 'Pide por WhatsApp 999 990 2960' },
};
state.template = TEMPLATE_REN;

/* ---------------- constantes ---------------- */
/* Motor de video en local (mismo origen): el Worker de ffmpeg no se puede
 * cargar desde otro dominio (CDN) en GitHub Pages, por eso los archivos
 * viven en vendor/ y se resuelven desde la URL de este script. */
const APP_BASE = new URL('.', import.meta.url).href;
const FFMPEG_ESM = new URL('vendor/ffmpeg/index.js', APP_BASE).href;
/* El núcleo y el .wasm se quedan en el CDN: se cargan con fetch/import
 * (que sí admiten otro origen con CORS). Lo único que el navegador exige
 * en el mismo origen es el Worker, y ese ya vive en vendor/ffmpeg/.
 * El .wasm pesa 32 MB y GitHub no permite subirlo por la web (límite 25 MB). */
const CORE_URL = 'https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.6/dist/esm/ffmpeg-core.js';
const WASM_URL = 'https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.6/dist/esm/ffmpeg-core.wasm';
/* Fuentes: se bajan de jsDelivr, no de github.com. La descarga desde
 * github.com/.../raw/... falla con "Failed to fetch" dentro del
 * navegador (la redirección a raw.githubusercontent.com no pasa), así
 * que las letras burbuja quedaban sin fuente y el video salía vacío. */
const TITAN_URL = 'https://cdn.jsdelivr.net/gh/google/fonts@main/ofl/titanone/TitanOne-Regular.ttf';
const LATO_URL = 'https://cdn.jsdelivr.net/gh/google/fonts@main/ofl/lato/Lato-Bold.ttf';
const TRANSFORMERS_URL = 'https://cdn.jsdelivr.net/npm/@xenova/transformers@2.17.2/dist/transformers.min.js';
const WHISPER_MODEL = 'Xenova/whisper-tiny';

const SILENCE_NOISE_DB = -32;   // igual que editar.py
const SILENCE_MIN_LEN = 0.5;
const SILENCE_PAD = 0.12;
/* Volúmenes según lo que elige el usuario en el panel de Audio. */
function musicVolume() { return state.musicVol === 'baja' ? 0.08 : state.musicVol === 'fuerte' ? 0.30 : 0.15; }
function musicVolumeSolo() { return state.musicVol === 'baja' ? 0.25 : state.musicVol === 'fuerte' ? 0.60 : 0.40; }
function voiceVolume() { return state.voiceVol === 'silencio' ? 0 : state.voiceVol === 'fuerte' ? 1.5 : 1.0; }
const SUB_FONT_SIZE = 72;
const SUB_MARGIN_BOTTOM = 260;
const WHATSAPP = 'Pide por WhatsApp 999 990 2960';

/* ---------------- atajos de pantalla ---------------- */
const $ = (id) => document.getElementById(id);
const ui = {
  carga: $('carga'), cargaTitulo: $('carga-titulo'), cargaTexto: $('carga-texto'),
  relleno: $('relleno'), btnVideo: $('btn-video'), btnVideo2: $('btn-video-2'),
  videoInput: $('videoInput'), emptyState: $('empty-state'),
  videoInfo: $('video-info'), preview: $('preview'), timelineFill: $('timeline-fill'),
  previewZone: $('preview-zone'),
  previewWrap: $('preview-wrap'), pvBubble: $('pv-bubble'), pvLyric: $('pv-lyric'),
  pvSubs: $('pv-subs'), pvNote: $('pv-note'), btnRecargar: $('btn-recargar'),
  panelEfecto: $('panel-efecto'), panelPlantilla: $('panel-plantilla'),
  efectos: $('efectos'), opBurbuja: $('op-burbuja'), opLetra: $('op-letra'),
  avisoIrvenir: $('aviso-irvenir'), textoHint: $('texto-hint'),
  chkSilencio: $('chk-silencio'), chkSubs: $('chk-subs'), keyword: $('keyword'),
  slots: $('slots'), tplInput: $('tplInput'), tplInfo: $('tpl-info'),
  cierre1: $('cierre-1'), cierre2: $('cierre-2'), cierre3: $('cierre-3'),
  btnMusica: $('btn-musica'), musicInput: $('musicInput'), musicaInfo: $('musica-info'),
  btnExportar: $('btn-exportar'), progreso: $('progreso'), relleno2: $('relleno2'),
  estado: $('estado'), resultado: $('resultado'), outVideo: $('out-video'),
  outLink: $('out-link'), btnCompartir: $('btn-compartir'), btnOtro: $('btn-otro'),
  registro: $('registro'), logTexto: $('log-texto'),
};

/* ---------------- motor ffmpeg ---------------- */
let ffmpeg = null, ffmpegReady = false, fontsReady = false;
let titanOK = false, latoOK = false, titanBlobURL = null;
let logLines = [];
let stepIdx = 0, stepTotal = 1, stepName = '';

function setStep(name) {
  stepName = name; stepIdx++;
  ui.estado.textContent = name;
  paintProgress(0);
}
function paintProgress(p) {
  const overall = Math.min(1, (stepIdx - 1 + p) / stepTotal);
  ui.relleno2.style.width = Math.round(overall * 100) + '%';
}

/* Ejecuta un comando ffmpeg y falla con el mensaje real si el comando
 * no termina bien. (ffmpeg.exec solo devuelve el código de salida; sin
 * esta comprobación un fallo quedaba en silencio y el video salía vacío.) */
async function runFFmpeg(args) {
  const ret = await ffmpeg.exec(args);
  if (typeof ret === 'number' && ret !== 0) {
    const tail = logLines.slice(-6).join(' | ');
    throw new Error('El motor de video terminó con código ' + ret + (tail ? ' — ' + tail : ''));
  }
  return ret;
}

/* Muestra el registro técnico (stderr de ffmpeg) en la página. */
function showLog() {
  if (!ui.registro || !ui.logTexto) return;
  ui.logTexto.textContent = logLines.join('\n') || '(sin registro)';
  ui.registro.style.display = 'block';
  ui.registro.open = true;
}

async function ensureFFmpeg() {
  if (ffmpegReady) return;
  ui.cargaTitulo.textContent = 'Descargando el motor de video…';
  ui.cargaTexto.textContent = 'Unos 30 MB. Solo la primera vez; luego queda guardado en el teléfono.';
  const mod = await import(FFMPEG_ESM);
  ffmpeg = new mod.FFmpeg();
  ffmpeg.on('log', ({ message }) => { logLines.push(message); if (logLines.length > 400) logLines.shift(); });
  ffmpeg.on('progress', ({ progress }) => { paintProgress(progress || 0); });
  await ffmpeg.load({ coreURL: CORE_URL, wasmURL: WASM_URL });
  ui.cargaTitulo.textContent = 'Descargando las letras…';
  await ensureFonts();
  ffmpegReady = true;
  ui.carga.style.display = 'none';
}

async function ensureFonts() {
  if (fontsReady) return;
  try { await ffmpeg.createDir('/fonts'); } catch (e) { /* ya existe */ }
  try {
    const res = await fetch(TITAN_URL);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const buf = new Uint8Array(await res.arrayBuffer());
    if (!buf.length) throw new Error('fuente vacía');
    await ffmpeg.writeFile('/TitanOne-Regular.ttf', buf);
    titanBlobURL = URL.createObjectURL(new Blob([buf], { type: 'font/ttf' }));
    titanOK = true;
  } catch (e) { titanOK = false; }
  try {
    const res = await fetch(LATO_URL);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const buf = new Uint8Array(await res.arrayBuffer());
    if (!buf.length) throw new Error('fuente vacía');
    await ffmpeg.writeFile('/fonts/Lato-Bold.ttf', buf);
    latoOK = true;
  } catch (e) { latoOK = false; }
  fontsReady = true;
}

/* Fuente para drawtext: Titan One si llegó, si no Lato Bold. */
function bubbleFont() { return titanOK ? '/TitanOne-Regular.ttf' : '/fonts/Lato-Bold.ttf'; }

/* ---------------- ayuda de archivos ---------------- */
function getVideoMeta(file) {
  return new Promise((resolve, reject) => {
    const v = document.createElement('video');
    v.preload = 'metadata';
    v.onloadedmetadata = () => { const d = { duration: v.duration, width: v.videoWidth, height: v.videoHeight }; URL.revokeObjectURL(v.src); resolve(d); };
    v.onerror = () => reject(new Error('No se pudo leer ese video. Prueba con otro.'));
    v.src = URL.createObjectURL(file);
  });
}
function isImageFile(f) { return f && f.type && f.type.startsWith('image/'); }
function fmtSeg(s) { return (Math.round(s * 10) / 10).toString().replace('.', ',') + ' s'; }

/* ---------------- texto en canvas (PNG) ---------------- */
/* Dibuja texto estilo burbuja en un canvas: negro grueso, blanco, amarillo. */
async function loadTitanForCanvas() {
  if (!titanBlobURL) return false;
  if (document.fonts.check('100px "Titan One"')) return true;
  try {
    const face = new FontFace('Titan One', `url(${titanBlobURL})`);
    await face.load(); document.fonts.add(face);
    return true;
  } catch (e) { return false; }
}

function fitFont(ctx, text, maxWidth, startPx) {
  let px = startPx;
  ctx.font = `${px}px "Titan One", sans-serif`;
  while (px > 30 && ctx.measureText(text).width > maxWidth) {
    px -= 4; ctx.font = `${px}px "Titan One", sans-serif`;
  }
  return px;
}

function bubbleTextOnCanvas(ctx, text, cx, cy, px) {
  ctx.font = `${px}px "Titan One", sans-serif`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = '#000'; ctx.lineWidth = Math.max(6, px * 0.16);
  ctx.strokeText(text, cx, cy);
  ctx.strokeStyle = '#fff'; ctx.lineWidth = Math.max(3, px * 0.08);
  ctx.strokeText(text, cx, cy);
  ctx.fillStyle = '#FFCC00';
  ctx.fillText(text, cx, cy);
}

/* PNG 1080x1920 con "MURILLO'S PIZZA" centrado, para el zoom final. */
async function makeZoomPNG() {
  await loadTitanForCanvas();
  const c = document.createElement('canvas'); c.width = 1080; c.height = 1920;
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, 1080, 1920);
  const px = fitFont(ctx, "MURILLO'S PIZZA", 1000, 120);
  bubbleTextOnCanvas(ctx, "MURILLO'S PIZZA", 540, 850, px);
  return await new Promise((res) => c.toBlob(res, 'image/png'));
}

/* PNG 1080x1920 negro con la tarjeta final de la plantilla. */
async function makeEndCardPNG(principal, secundario, finalLine) {
  await loadTitanForCanvas();
  const c = document.createElement('canvas'); c.width = 1080; c.height = 1920;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#000'; ctx.fillRect(0, 0, 1080, 1920);
  let px = fitFont(ctx, principal, 1000, 110);
  bubbleTextOnCanvas(ctx, principal, 540, 800, px);
  ctx.font = `${fitFont(ctx, secundario, 900, 64)}px "Titan One", sans-serif`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillStyle = '#fff'; ctx.fillText(secundario, 540, 960);
  ctx.font = `${fitFont(ctx, finalLine, 950, 46)}px "Titan One", sans-serif`;
  ctx.fillStyle = '#FFCC00'; ctx.fillText(finalLine, 540, 1700);
  return await new Promise((res) => c.toBlob(res, 'image/png'));
}

/* ---------------- subtítulos (igual que editar.py) ---------------- */
function assTime(sec) {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  return `${h}:${String(m).padStart(2, '0')}:${s.toFixed(2).padStart(5, '0')}`;
}
function assEscape(t) { return t.replace(/\\/g, '\\\\').replace(/\{/g, '\\{').replace(/\}/g, '\\}'); }

function buildASS(words, keyword) {
  const lines = [];
  let cur = [], curStart = null;
  for (const w of words) {
    if (cur.length && (cur.length >= 4 || w.end - curStart > 1.8 ||
        /[.!?]$/.test(cur[cur.length - 1].text.trim()))) {
      lines.push({ start: curStart, end: cur[cur.length - 1].end, words: cur });
      cur = []; curStart = null;
    }
    if (curStart === null) curStart = w.start;
    cur.push(w);
  }
  if (cur.length) lines.push({ start: curStart, end: cur[cur.length - 1].end, words: cur });

  const kw = (keyword || '').trim().toLowerCase();
  const colorize = (word) => {
    const clean = word.replace(/^[.,!?¿¡"']+|[.,!?¿¡"']+$/g, '').toLowerCase();
    if (kw && clean === kw) return '{\\c&H00FFFF&}' + assEscape(word) + '{\\c&H00FFFFFF&}';
    return assEscape(word);
  };

  const header = `[Script Info]
ScriptType: v4.00+
PlayResX: 1080
PlayResY: 1920
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Reel,Lato,${SUB_FONT_SIZE},&H00FFFFFF,&H000000FF,&H00000000,&H80000000,-1,0,0,0,100,100,0,0,1,5,2,2,80,80,${SUB_MARGIN_BOTTOM},1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;
  const events = lines.map((l) =>
    `Dialogue: 0,${assTime(l.start)},${assTime(l.end)},Reel,,0,0,0,,${l.words.map((w) => colorize(w.text)).join(' ')}`);
  return { ass: header + events.join('\n') + '\n', lines };
}

/* drawtext por línea (respaldo si el filtro de subtítulos falla en el teléfono). */
function subsDrawtextChain(lines, keyword) {
  const parts = [];
  const kw = (keyword || '').trim().toLowerCase();
  lines.forEach((l, i) => {
    const text = l.words.map((w) => w.text).join(' ');
    const safe = text.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/:/g, '\\:').replace(/%/g, '\\%');
    const y = 1920 - SUB_MARGIN_BOTTOM - SUB_FONT_SIZE;
    const en = `enable='between(t\\,${l.start.toFixed(2)}\\,${l.end.toFixed(2)})'`;
    parts.push(`drawtext=fontfile=/fonts/Lato-Bold.ttf:text='${safe}':fontsize=${SUB_FONT_SIZE}:fontcolor=black:borderw=9:bordercolor=black:x=(w-text_w)/2:y=${y}:${en}`);
    parts.push(`drawtext=fontfile=/fonts/Lato-Bold.ttf:text='${safe}':fontsize=${SUB_FONT_SIZE}:fontcolor=white:borderw=0:x=(w-text_w)/2:y=${y}:${en}`);
  });
  return parts.join(',');
}

/* ---------------- audio para Whisper ---------------- */
function parseWav16(u8) {
  const view = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  let off = 12; // salta "RIFF....WAVE"
  while (off + 8 <= u8.length) {
    const id = String.fromCharCode(view.getUint8(off), view.getUint8(off + 1), view.getUint8(off + 2), view.getUint8(off + 3));
    const size = view.getUint32(off + 4, true);
    if (id === 'data') {
      const n = Math.floor(size / 2);
      const out = new Float32Array(n);
      for (let i = 0; i < n; i++) out[i] = view.getInt16(off + 8 + i * 2, true) / 32768;
      return out;
    }
    off += 8 + size + (size % 2);
  }
  throw new Error('No se pudo leer el audio (WAV).');
}

let transcriberPromise = null;
function loadTransformersScript() {
  return new Promise((resolve, reject) => {
    if (window.transformers) return resolve();
    const s = document.createElement('script');
    s.src = TRANSFORMERS_URL;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('No se pudo descargar el modelo de voz. Revisa tu conexión e inténtalo de nuevo.'));
    document.head.appendChild(s);
  });
}

async function transcribeWords(pcm16k) {
  await loadTransformersScript();
  const { env, pipeline } = window.transformers;
  env.allowLocalModels = false;
  try { env.backends.onnx.wasm.numThreads = 1; } catch (e) { /* opcional */ }
  if (!transcriberPromise) {
    transcriberPromise = pipeline('automatic-speech-recognition', WHISPER_MODEL);
  }
  const transcriber = await transcriberPromise;
  const out = await transcriber(pcm16k, {
    language: 'es', task: 'transcribe',
    return_timestamps: 'word', chunk_length_s: 30,
  });
  const words = [];
  for (const c of (out.chunks || [])) {
    if (!c.timestamp || c.timestamp[0] == null) continue;
    const t = (c.text || '').trim();
    if (t) words.push({ start: c.timestamp[0], end: c.timestamp[1], text: t });
  }
  return words;
}

async function extractAudioWav(inputName, wavName) {
  await runFFmpeg(['-i', inputName, '-vn', '-ac', '1', '-ar', '16000', '-f', 'wav', wavName]);
  const data = await ffmpeg.readFile(wavName);
  return parseWav16(data);
}

/* ---------------- silencios (igual que editar.py) ---------------- */
function findSilencesFromLogs() {
  const text = logLines.join('\n');
  const starts = [...text.matchAll(/silence_start: ([\d.]+)/g)].map((m) => parseFloat(m[1]));
  const ends = [...text.matchAll(/silence_end: ([\d.]+)/g)].map((m) => parseFloat(m[1]));
  return starts.map((s, i) => [s, ends[i]]).filter((p) => p[1] != null);
}

function keepSegments(duration, silences) {
  const segs = [];
  let cursor = 0;
  for (const [s, e] of silences) {
    if (s - cursor >= 0.2) segs.push([cursor, s]);
    cursor = Math.max(cursor, e);
  }
  if (duration - cursor >= 0.2) segs.push([cursor, duration]);
  const padded = [];
  for (let [s, e] of segs) {
    s = Math.max(0, s - SILENCE_PAD);
    e = Math.min(duration, e + SILENCE_PAD);
    if (padded.length && s - padded[padded.length - 1][1] < 0.05) padded[padded.length - 1][1] = e;
    else padded.push([s, e]);
  }
  return padded.filter(([s, e]) => e - s >= 0.2);
}

async function cutSilences(input, output, segs, hasAudio) {
  const parts = [], labels = [];
  segs.forEach(([s, e], i) => {
    parts.push(`[0:v]trim=start=${s.toFixed(3)}:end=${e.toFixed(3)},setpts=PTS-STARTPTS,setsar=1[v${i}]`);
    if (hasAudio) {
      parts.push(`[0:a]atrim=start=${s.toFixed(3)}:end=${e.toFixed(3)},asetpts=PTS-STARTPTS[a${i}]`);
      labels.push(`[v${i}]`, `[a${i}]`);
    } else labels.push(`[v${i}]`);
  });
  const n = segs.length;
  parts.push(hasAudio
    ? `${labels.join('')}concat=n=${n}:v=1:a=1[vout][aout]`
    : `${labels.join('')}concat=n=${n}:v=1:a=0[vout]`);
  const maps = hasAudio ? ['-map', '[vout]', '-map', '[aout]'] : ['-map', '[vout]'];
  await runFFmpeg(['-i', input, '-filter_complex', parts.join(';'), ...maps,
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20',
    '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart', output]);
}

/* ---------------- normalizar a 9:16 ---------------- */
/* speed: 1 = normal (comando exacto de antes). Con otra velocidad se
 * acelera o se frena el video (setpts) y el audio (atempo). */
async function normalize(input, output, speed) {
  if (speed === 1) {
    await runFFmpeg(['-i', input,
      '-vf', 'scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,setsar=1,fps=30,format=yuv420p',
      '-r', '30', '-map', '0:v', '-map', '0:a?',
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20',
      '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart', output]);
    return;
  }
  await runFFmpeg(['-i', input,
    '-vf', `scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,setsar=1,setpts=PTS/${speed},fps=30,format=yuv420p`,
    '-af', `atempo=${speed}`,
    '-r', '30', '-map', '0:v', '-map', '0:a?',
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20',
    '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart', output]);
}

/* ---------------- efectos ---------------- */
/* Letras burbuja: 3 pasadas por línea (negro, blanco, amarillo).
 * `prefix` distingue los archivos de texto entre llamadas. */
function bubblePasses(lines, startY, fontSize, prefix) {
  const font = bubbleFont();
  const parts = [];
  const bwBlack = Math.round(fontSize * 0.14);
  const bwWhite = Math.round(fontSize * 0.08);
  lines.forEach((line, i) => {
    const y = startY + i * Math.round(fontSize * 1.3);
    const file = `/${prefix}_${i}.txt`;
    parts.push({ file, text: line });
    parts.push(`drawtext=fontfile=${font}:textfile=${file}:fontsize=${fontSize}:fontcolor=black:borderw=${bwBlack}:bordercolor=black:x=(w-text_w)/2:y=${y}`);
    parts.push(`drawtext=fontfile=${font}:textfile=${file}:fontsize=${fontSize}:fontcolor=white:borderw=${bwWhite}:bordercolor=white:x=(w-text_w)/2:y=${y}`);
    parts.push(`drawtext=fontfile=${font}:textfile=${file}:fontsize=${fontSize}:fontcolor=#FFCC00:borderw=0:x=(w-text_w)/2:y=${y}`);
  });
  return parts;
}

async function writeTextFiles(parts) {
  for (const p of parts) {
    if (typeof p === 'object') await ffmpeg.writeFile(p.file, new TextEncoder().encode(p.text));
  }
  return parts.filter((p) => typeof p === 'string');
}

async function applyBubble(input, output, lines, opts) {
  const clean = lines.map((l) => l.trim()).filter(Boolean).slice(0, 3);
  const base = opts.size === 'chico' ? 80 : opts.size === 'grande' ? 130 : 110;
  const fontSize = clean.some((l) => l.length > 14) ? Math.max(56, base - 22) : base;
  const startY = opts.pos === 'centro' ? 800 : opts.pos === 'abajo' ? 1050 : 380;
  const chain = bubblePasses(clean, startY, fontSize, 'b');
  const filters = await writeTextFiles(chain);
  // pie con el WhatsApp, más chico; va arriba de la zona de subtítulos (y=1480)
  const foot = bubblePasses([WHATSAPP], 1480, 46, 'f');
  const footFilters = await writeTextFiles(foot);
  const vf = [...filters, ...footFilters].join(',');
  await runFFmpeg(['-i', input, '-vf', vf, '-map', '0:v', '-map', '0:a?',
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20',
    '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart', output]);
}

/* Letra animada: frases que aparecen una por una + zoom final. */
async function applyLyric(input, output, lines, duration) {
  const clean = lines.map((l) => l.trim()).filter(Boolean).slice(0, 4);
  const fontSize = clean.some((l) => l.length > 16) ? 80 : 96;
  const blockH = clean.length * Math.round(fontSize * 1.25);
  const y0 = Math.round((1920 - blockH) / 2) - 120;
  const parts = [];
  const font = bubbleFont();
  const bwBlack = Math.round(fontSize * 0.14);
  const bwWhite = Math.round(fontSize * 0.08);
  clean.forEach((line, i) => {
    const start = Math.min(0.3 + i * 1.0, Math.max(0.3, duration - 0.6));
    const y = y0 + i * Math.round(fontSize * 1.25);
    const file = `/lyr_${i}.txt`;
    parts.push({ file, text: line });
    const en = `enable='between(t\\,${start.toFixed(2)}\\,${duration.toFixed(2)})'`;
    parts.push(`drawtext=fontfile=${font}:textfile=${file}:fontsize=${fontSize}:fontcolor=black:borderw=${bwBlack}:bordercolor=black:x=(w-text_w)/2:y=${y}:${en}`);
    parts.push(`drawtext=fontfile=${font}:textfile=${file}:fontsize=${fontSize}:fontcolor=white:borderw=${bwWhite}:bordercolor=white:x=(w-text_w)/2:y=${y}:${en}`);
    parts.push(`drawtext=fontfile=${font}:textfile=${file}:fontsize=${fontSize}:fontcolor=#FFCC00:borderw=0:x=(w-text_w)/2:y=${y}:${en}`);
  });
  const filters = await writeTextFiles(parts);
  await runFFmpeg(['-i', input, '-vf', filters.join(','), '-map', '0:v', '-map', '0:a?',
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20',
    '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart', 'parteA.mp4']);

  // Zoom final con el PNG del canvas (3 s, ease-in-cúbico).
  const png = await makeZoomPNG();
  await ffmpeg.writeFile('zoom.png', new Uint8Array(await png.arrayBuffer()));
  const wa = bubblePasses([WHATSAPP], 1920 - 300, 46, 'w');
  const waFilters = await writeTextFiles(wa);
  const zoomVf = `zoompan=z='min(1+1.2*pow(on/90\\,3)\\,2.2)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=90:s=1080x1920:fps=30,setsar=1,${waFilters.join(',')}`;
  await runFFmpeg(['-i', 'zoom.png', '-f', 'lavfi', '-t', '3', '-i', 'anullsrc=r=44100:cl=stereo',
    '-filter_complex', `[0:v]${zoomVf}[v]`, '-map', '[v]', '-map', '1:a',
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20',
    '-c:a', 'aac', '-b:a', '128k', '-t', '3', '-movflags', '+faststart', 'zoom.mp4']);

  await runFFmpeg(['-i', 'parteA.mp4', '-i', 'zoom.mp4', '-filter_complex',
    '[0:v]fps=30,format=yuv420p,setsar=1[v0];[0:a]aresample=44100,aformat=channel_layouts=stereo[a0];[1:v]fps=30,format=yuv420p,setsar=1[v1];[1:a]aresample=44100,aformat=channel_layouts=stereo[a1];[v0][a0][v1][a1]concat=n=2:v=1:a=1[vout][aout]',
    '-map', '[vout]', '-map', '[aout]',
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20',
    '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart', output]);
}

/* Ir y venir: trozos de 0.2 s, uno de cada dos al revés. Sin audio. */
async function applyBackNForth(input, output, duration) {
  const segLen = 0.2;
  const n = Math.max(1, Math.ceil(duration / segLen));
  const parts = [], labels = [];
  for (let i = 0; i < n; i++) {
    const s = i * segLen, e = Math.min((i + 1) * segLen, duration);
    if (i % 2 === 0) parts.push(`[0:v]trim=start=${s.toFixed(3)}:end=${e.toFixed(3)},setpts=PTS-STARTPTS,setsar=1[v${i}]`);
    else parts.push(`[0:v]trim=start=${s.toFixed(3)}:end=${e.toFixed(3)},setpts=PTS-STARTPTS,reverse,setsar=1[v${i}]`);
    labels.push(`[v${i}]`);
  }
  parts.push(`${labels.join('')}concat=n=${n}:v=1:a=0[vout]`);
  await runFFmpeg(['-i', input, '-filter_complex', parts.join(';'), '-map', '[vout]', '-an',
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20',
    '-movflags', '+faststart', output]);
}

/* Tono cine: sombras frías, luces cálidas. */
async function applyCine(input, output) {
  await runFFmpeg(['-i', input,
    '-vf', 'eq=saturation=1.3:contrast=1.06,colorbalance=rs=-0.08:gs=0.0:bs=0.08:rh=0.10:gh=0.02:bh=-0.08',
    '-map', '0:v', '-map', '0:a?',
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20',
    '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart', output]);
}

/* Filtros de color (panel Filtros). Se suman al efecto elegido. */
const FILTERS = {
  calido: 'eq=saturation=1.15:contrast=1.03,colorbalance=rs=0.06:gs=0.0:bs=-0.06:rh=0.12:gh=0.03:bh=-0.10',
  frio: 'eq=saturation=1.1:contrast=1.03,colorbalance=rs=-0.06:gs=0.0:bs=0.06:rh=-0.10:gh=-0.02:bh=0.12',
  vivo: 'eq=saturation=1.6:contrast=1.08',
  byn: 'eq=saturation=0:contrast=1.05',
};
async function applyFilter(input, output, name) {
  const vf = FILTERS[name];
  if (!vf) {
    const data = await ffmpeg.readFile(input);
    await ffmpeg.writeFile(output, data);
    return;
  }
  await runFFmpeg(['-i', input, '-vf', vf, '-map', '0:v', '-map', '0:a?',
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20',
    '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart', output]);
}

/* ---------------- render final (efecto) ---------------- */
async function finalRender(input, output, opts) {
  const { assFile, subLines, musicName, hasAudio } = opts;
  const keyword = ui.keyword.value.trim();
  const buildArgs = (useAss) => {
    const inputs = ['-i', input];
    if (musicName) inputs.push('-i', musicName);
    const fc = [];
    let v = '[0:v]';
    if (useAss && assFile) { fc.push(`${v}subtitles=${assFile}:fontsdir=/fonts[vsub]`); v = '[vsub]'; }
    else if (!useAss && subLines) { fc.push(`${v}${subsDrawtextChain(subLines, keyword)}[vsub]`); v = '[vsub]'; }
    fc.push(`${v}fps=30,format=yuv420p[vout]`);
    let maps;
    if (musicName && hasAudio) {
      fc.push(`[0:a]volume=${voiceVolume()}[voice]`);
      fc.push(`[1:a]volume=${musicVolume()},aloop=loop=-1:size=2e+09[bg]`);
      fc.push('[voice][bg]amix=inputs=2:duration=first:normalize=0[aout]');
      maps = ['-map', '[vout]', '-map', '[aout]'];
    } else if (musicName && !hasAudio) {
      fc.push(`[1:a]volume=${musicVolumeSolo()},aloop=loop=-1:size=2e+09,atrim=0:${state.workDuration.toFixed(2)}[aout]`);
      maps = ['-map', '[vout]', '-map', '[aout]'];
    } else {
      maps = ['-map', '[vout]', '-map', '0:a?'];
    }
    return [...inputs, '-filter_complex', fc.join(';'), ...maps,
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20',
      '-c:a', 'aac', '-b:a', '128k', '-r', '30', '-movflags', '+faststart', output];
  };
  try {
    await runFFmpeg(buildArgs(true));
  } catch (e) {
    if (assFile && subLines) {
      ui.estado.textContent = 'Los subtítulos normales no funcionaron en este teléfono, probando de otra forma…';
      await runFFmpeg(buildArgs(false));
    } else throw e;
  }
}

function extOf(file, fallback) {
  const m = (file.name || '').match(/\.([a-z0-9]+)$/i);
  return m ? '.' + m[1].toLowerCase() : fallback;
}

/* ---------------- exportar: modo efecto ---------------- */
async function exportEfecto() {
  const silenceOn = ui.chkSilencio.checked;
  const subOn = ui.chkSubs.checked;
  const effect = state.effect;
  const steps = ['vertical'];
  if (silenceOn) steps.push('silencio');
  if (effect !== 'ninguno') steps.push('efecto');
  if (state.filter !== 'original') steps.push('filtro');
  if (subOn && effect !== 'irvenir') steps.push('subtitulos');
  steps.push('final');
  stepTotal = steps.length; stepIdx = 0;

  setStep('Subiendo tu video al editor…');
  await ffmpeg.writeFile('entrada.mp4', new Uint8Array(await state.mainFile.arrayBuffer()));
  let musicName = null;
  if (state.musicFile) {
    musicName = 'musica' + extOf(state.musicFile, '.mp3');
    await ffmpeg.writeFile(musicName, new Uint8Array(await state.musicFile.arrayBuffer()));
  }

  setStep('Poniendo tu video en vertical 9:16…');
  logLines = [];
  await normalize('entrada.mp4', 'norm.mp4', state.speed);
  let cur = 'norm.mp4';
  state.workDuration = state.mainDuration / state.speed;
  // El registro de la conversión ya dice si el video trae audio.
  const hasAudio = logLines.some((l) => l.includes('Audio:'));

  if (silenceOn && hasAudio) {
    setStep('Quitando los silencios…');
    logLines = [];
    await runFFmpeg(['-i', cur, '-af', `silencedetect=noise=${SILENCE_NOISE_DB}dB:d=${SILENCE_MIN_LEN}`, '-f', 'null', '-']);
    const sils = findSilencesFromLogs();
    const segs = keepSegments(state.workDuration, sils);
    if (sils.length && segs.length > 1) {
      await cutSilences(cur, 'cortado.mp4', segs, true);
      cur = 'cortado.mp4';
      state.workDuration = segs.reduce((a, [s, e]) => a + (e - s), 0);
    }
  }

  if (effect === 'burbuja') {
    setStep('Poniendo las letras burbuja…');
    const lines = [$('burbuja-1').value, $('burbuja-2').value, $('burbuja-3').value];
    await applyBubble(cur, 'efecto.mp4', lines, { size: state.textSize, pos: state.textPos });
    cur = 'efecto.mp4';
  } else if (effect === 'letra') {
    setStep('Armando la letra animada…');
    const lines = [$('letra-1').value, $('letra-2').value, $('letra-3').value, $('letra-4').value];
    await applyLyric(cur, 'efecto.mp4', lines, state.workDuration);
    cur = 'efecto.mp4';
    state.workDuration += 3;
  } else if (effect === 'irvenir') {
    setStep('Haciendo el ir y venir…');
    const d = Math.min(state.workDuration, 30);
    await applyBackNForth(cur, 'efecto.mp4', d);
    cur = 'efecto.mp4';
    state.workDuration = d;
  } else if (effect === 'cine') {
    setStep('Poniendo el tono cine…');
    await applyCine(cur, 'efecto.mp4');
    cur = 'efecto.mp4';
  }

  if (state.filter !== 'original') {
    setStep('Poniendo el filtro…');
    await applyFilter(cur, 'filtro.mp4', state.filter);
    cur = 'filtro.mp4';
  }

  let assFile = null, subLines = null;
  if (subOn && hasAudio && effect !== 'irvenir') {
    setStep('Escribiendo los subtítulos… (la primera vez tarda 1 o 2 minutos)');
    paintProgress(0.4);
    try {
      const pcm = await extractAudioWav(cur, 'audio.wav');
      const words = await transcribeWords(pcm);
      if (words.length) {
        const built = buildASS(words, ui.keyword.value.trim());
        subLines = built.lines;
        await ffmpeg.writeFile('subs.ass', new TextEncoder().encode(built.ass));
        assFile = 'subs.ass';
      }
    } catch (e) { assFile = null; /* sigue sin subtítulos */ }
  }

  setStep('Exportando el video final…');
  if (assFile || musicName) {
    await finalRender(cur, 'salida.mp4', { assFile, subLines, musicName, hasAudio });
  } else {
    const data = await ffmpeg.readFile(cur);
    await ffmpeg.writeFile('salida.mp4', data);
  }
  return 'salida.mp4';
}

/* ---------------- exportar: modo plantilla ---------------- */
async function processSlotVideo(file, name, out, dur) {
  await ffmpeg.writeFile(name, new Uint8Array(await file.arrayBuffer()));
  await runFFmpeg(['-stream_loop', '-1', '-t', String(dur), '-i', name,
    '-vf', 'scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,setsar=1,fps=30,format=yuv420p',
    '-r', '30', '-map', '0:v',
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20',
    '-movflags', '+faststart', name + '.norm.mp4']);
  const n = Math.max(1, Math.ceil(dur / 0.2));
  const parts = [], labels = [];
  for (let i = 0; i < n; i++) {
    const s = i * 0.2, e = Math.min((i + 1) * 0.2, dur);
    if (i % 2 === 0) parts.push(`[0:v]trim=start=${s.toFixed(3)}:end=${e.toFixed(3)},setpts=PTS-STARTPTS,setsar=1[v${i}]`);
    else parts.push(`[0:v]trim=start=${s.toFixed(3)}:end=${e.toFixed(3)},setpts=PTS-STARTPTS,reverse,setsar=1[v${i}]`);
    labels.push(`[v${i}]`);
  }
  parts.push(`${labels.join('')}concat=n=${n}:v=1:a=0[vcat]`);
  parts.push('[vcat]eq=saturation=1.3:contrast=1.06,colorbalance=rs=-0.08:gs=0.0:bs=0.08:rh=0.10:gh=0.02:bh=-0.08[vout]');
  await runFFmpeg(['-i', name + '.norm.mp4', '-filter_complex', parts.join(';'),
    '-map', '[vout]', '-an',
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20',
    '-movflags', '+faststart', out]);
}

async function processSlotPhoto(file, name, out, dur) {
  await ffmpeg.writeFile(name, new Uint8Array(await file.arrayBuffer()));
  const frames = Math.max(1, Math.round(dur * 30));
  await runFFmpeg(['-i', name,
    '-vf', `scale=2160:3840:force_original_aspect_ratio=increase,crop=2160:3840,setsar=1,zoompan=z='min(1+0.15*on/${frames}\\,1.15)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${frames}:s=1080x1920:fps=30,setsar=1,eq=saturation=1.3:contrast=1.06,colorbalance=rs=-0.08:gs=0.0:bs=0.08:rh=0.10:gh=0.02:bh=-0.08`,
    '-r', '30', '-map', '0:v',
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20',
    '-movflags', '+faststart', out]);
}

async function exportPlantilla() {
  const tpl = state.template;
  for (let i = 0; i < tpl.clips.length; i++) {
    if (!state.slots[i]) throw new Error(`Falta el lugar ${i + 1} (${tpl.clips[i].ejemplo || 'clip'}). Toca su botón y elige un video o una foto.`);
  }
  stepTotal = tpl.clips.length + 3; stepIdx = 0;

  let musicName = null;
  if (state.musicFile) {
    musicName = 'musica' + extOf(state.musicFile, '.mp3');
    await ffmpeg.writeFile(musicName, new Uint8Array(await state.musicFile.arrayBuffer()));
  }

  const slotFiles = [];
  for (let i = 0; i < tpl.clips.length; i++) {
    const clip = tpl.clips[i];
    const file = state.slots[i];
    setStep(`Preparando el lugar ${i + 1} de ${tpl.clips.length}…`);
    const name = `slot${i}` + extOf(file, isImageFile(file) ? '.jpg' : '.mp4');
    const out = `slot${i}.mp4`;
    if (isImageFile(file)) await processSlotPhoto(file, name, out, clip.duracion_segundos);
    else await processSlotVideo(file, name, out, clip.duracion_segundos);
    slotFiles.push(out);
  }

  setStep('Armando la tarjeta final…');
  const png = await makeEndCardPNG(
    ui.cierre1.value.trim() || tpl.cierre.texto_principal,
    ui.cierre2.value.trim() || tpl.cierre.texto_secundario,
    ui.cierre3.value.trim() || tpl.cierre.texto_final);
  await ffmpeg.writeFile('cierre.png', new Uint8Array(await png.arrayBuffer()));
  await runFFmpeg(['-loop', '1', '-t', String(tpl.cierre.duracion_segundos), '-i', 'cierre.png',
    '-vf', 'fps=30,format=yuv420p,setsar=1', '-r', '30', '-map', '0:v',
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20',
    '-movflags', '+faststart', 'cierre.mp4']);
  slotFiles.push('cierre.mp4');

  setStep('Pegando todos los trozos…');
  const inputs = [], fc = [];
  slotFiles.forEach((f, i) => { inputs.push('-i', f); fc.push(`[${i}:v]fps=30,format=yuv420p,setsar=1[v${i}]`); });
  fc.push(`${slotFiles.map((_, i) => `[v${i}]`).join('')}concat=n=${slotFiles.length}:v=1:a=0[vout]`);
  await runFFmpeg([...inputs, '-filter_complex', fc.join(';'), '-map', '[vout]',
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20',
    '-movflags', '+faststart', 'plantilla.mp4']);

  const totalDur = tpl.clips.reduce((a, c) => a + c.duracion_segundos, 0) + tpl.cierre.duracion_segundos;
  state.workDuration = totalDur;

  if (musicName) {
    setStep('Añadiendo la música…');
    await runFFmpeg(['-i', 'plantilla.mp4', '-i', musicName, '-filter_complex',
      `[1:a]volume=${musicVolumeSolo()},aloop=loop=-1:size=2e+09,atrim=0:${totalDur.toFixed(2)}[aout]`,
      '-map', '0:v', '-map', '[aout]',
      '-c:v', 'copy', '-c:a', 'aac', '-b:a', '128k',
      '-movflags', '+faststart', 'salida.mp4']);
  } else {
    const data = await ffmpeg.readFile('plantilla.mp4');
    await ffmpeg.writeFile('salida.mp4', data);
  }
  return 'salida.mp4';
}

/* ---------------- flujo de exportar ---------------- */
async function exportar() {
  ui.btnExportar.disabled = true;
  ui.resultado.style.display = 'none';
  ui.progreso.style.display = 'block';
  ui.relleno2.style.width = '0%';
  try {
    await ensureFFmpeg();
    const outName = state.mode === 'plantilla' ? await exportPlantilla() : await exportEfecto();
    const data = await ffmpeg.readFile(outName);
    if (!data || data.length === 0) throw new Error('El video final salió vacío (0 bytes). Prueba con otro video o vuelve a intentarlo.');
    if (state.outBlob) URL.revokeObjectURL(state.outBlob);
    state.outBlob = URL.createObjectURL(new Blob([data], { type: 'video/mp4' }));
    ui.outVideo.src = state.outBlob;
    ui.outLink.href = state.outBlob;
    ui.outLink.download = state.outName;
    ui.progreso.style.display = 'none';
    ui.resultado.style.display = 'block';
    ui.estado.textContent = 'Listo. Ya lo puedes guardar o compartir.';
    ui.previewZone.classList.add('no-sticky');
    ui.resultado.scrollIntoView({ behavior: 'smooth' });
  } catch (e) {
    ui.estado.textContent = 'Algo falló: ' + (e && e.message ? e.message : e) + ' Prueba con un video más corto o vuelve a intentarlo.';
    showLog();
    ui.btnExportar.disabled = false;
    return;
  }
  ui.btnExportar.disabled = false;
}

/* ---------------- vista previa en vivo ---------------- */
/* Muestra el texto, los filtros y la velocidad sobre el video sin
 * exportar (como en CapCut): el usuario ve el resultado al instante
 * y solo exporta cuando le gusta. */
const CSS_FILTERS = {
  original: '',
  calido: 'sepia(.35) saturate(1.2) contrast(1.03) hue-rotate(-8deg)',
  frio: 'saturate(1.1) contrast(1.03) hue-rotate(12deg)',
  vivo: 'saturate(1.8) contrast(1.1)',
  byn: 'grayscale(1) contrast(1.05)',
};
let lyricTimer = null, lyricIdx = 0;

function bubbleLineHTML(text, px) {
  const esc = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const bwBlack = Math.max(2, Math.round(px * 0.16));
  const bwWhite = Math.max(1, Math.round(px * 0.08));
  return `<span class="s1" style="-webkit-text-stroke:${bwBlack}px #000">${esc}</span>` +
    `<span class="s2" style="-webkit-text-stroke:${bwWhite}px #fff">${esc}</span>` +
    `<span class="s3">${esc}</span>`;
}

function updatePreview() {
  const v = ui.preview;
  const hasVideo = !!state.mainFile && !!v.src;
  // Filtros y tono cine como filtro CSS sobre el video.
  let f = CSS_FILTERS[state.filter] || '';
  if (state.effect === 'cine') f = (f ? f + ' ' : '') + 'saturate(1.3) contrast(1.06) sepia(.08)';
  v.style.filter = f;
  // Velocidad: el video de vista previa corre a la velocidad elegida.
  if (hasVideo) v.playbackRate = state.speed;
  // Texto burbuja (mismo tamaño y posición que al exportar).
  const wrap = ui.previewWrap;
  const scale = wrap.clientWidth / 1080 || 0.3;
  let html = '';
  if (hasVideo && state.effect === 'burbuja') {
    const lines = [$('burbuja-1').value, $('burbuja-2').value, $('burbuja-3').value].map((l) => l.trim()).filter(Boolean).slice(0, 3);
    const base = state.textSize === 'chico' ? 80 : state.textSize === 'grande' ? 130 : 110;
    const fontSize = lines.some((l) => l.length > 14) ? Math.max(56, base - 22) : base;
    const startY = state.textPos === 'centro' ? 800 : state.textPos === 'abajo' ? 1050 : 380;
    lines.forEach((line, i) => {
      const y = startY + i * Math.round(fontSize * 1.3);
      html += `<div class="pv-line" style="top:${(y / 1920 * 100).toFixed(1)}%;font-size:${Math.round(fontSize * scale)}px">${bubbleLineHTML(line, fontSize * scale)}</div>`;
    });
    html += `<div class="pv-line" style="top:77%;font-size:${Math.round(46 * scale)}px">${bubbleLineHTML(WHATSAPP, 46 * scale)}</div>`;
  }
  ui.pvBubble.innerHTML = html;
  // Letra animada: las frases aparecen una por una, en ciclo.
  clearInterval(lyricTimer); lyricTimer = null;
  if (hasVideo && state.effect === 'letra') {
    const lines = [$('letra-1').value, $('letra-2').value, $('letra-3').value, $('letra-4').value].map((l) => l.trim()).filter(Boolean).slice(0, 4);
    const showLyric = () => {
      const px = Math.round(96 * scale);
      if (lyricIdx < lines.length) {
        const y = (700 + lyricIdx * 120) / 1920 * 100;
        ui.pvLyric.innerHTML = `<div class="pv-line" style="top:${y.toFixed(1)}%;font-size:${px}px">${bubbleLineHTML(lines[lyricIdx], px)}</div>`;
      } else {
        const pxBig = Math.round(120 * scale);
        ui.pvLyric.innerHTML = `<div class="pv-line" style="top:44%;font-size:${pxBig}px">${bubbleLineHTML("MURILLO'S PIZZA", pxBig)}</div>`;
      }
      lyricIdx = (lyricIdx + 1) % (lines.length + 1);
    };
    lyricIdx = 0; showLyric();
    lyricTimer = setInterval(showLyric, 1000);
  } else {
    ui.pvLyric.innerHTML = '';
  }
  // Subtítulos: una muestra de dónde saldrán.
  const showSubs = hasVideo && ui.chkSubs.checked && state.effect !== 'irvenir' && state.mode === 'efecto';
  ui.pvSubs.classList.toggle('oculto', !showSubs);
  if (showSubs) ui.pvSubs.style.fontSize = Math.round(28 * scale) + 'px';
  // Ir y venir no se puede previsualizar en vivo: avisar.
  ui.pvNote.classList.toggle('oculto', !(hasVideo && state.effect === 'irvenir'));
}

/* ---------------- interfaz ---------------- */
function refreshExportButton() {
  if (state.mode === 'plantilla') {
    ui.btnExportar.disabled = !state.template.clips.every((_, i) => state.slots[i]);
  } else {
    ui.btnExportar.disabled = !state.mainFile;
  }
}

function buildSlots() {
  const tpl = state.template;
  ui.slots.innerHTML = '';
  state.slots = tpl.clips.map(() => null);
  tpl.clips.forEach((clip, i) => {
    const div = document.createElement('div');
    div.className = 'slot';
    div.innerHTML = `<div class="t">Lugar ${clip.lugar} · ${fmtSeg(clip.duracion_segundos)}</div>
      <div class="d">Ejemplo: ${clip.ejemplo || 'tu clip'}</div>
      <label class="filebtn" for="slot-${i}">📁 Elegir video o foto</label>
      <input type="file" id="slot-${i}" accept="video/*,image/*">
      <div class="d" id="slot-info-${i}">Sin archivo todavía.</div>
      <img id="slot-img-${i}" alt="">
      <video id="slot-vid-${i}" playsinline muted loop></video>`;
    ui.slots.appendChild(div);
    div.querySelector(`#slot-${i}`).addEventListener('change', (ev) => {
      const f = ev.target.files[0];
      if (!f) return;
      state.slots[i] = f;
      const info = div.querySelector(`#slot-info-${i}`);
      info.textContent = `${f.name} (${(f.size / 1048576).toFixed(1)} MB)`;
      const url = URL.createObjectURL(f);
      if (isImageFile(f)) {
        const img = div.querySelector(`#slot-img-${i}`);
        img.src = url; img.style.display = 'block';
      } else {
        const v = div.querySelector(`#slot-vid-${i}`);
        v.src = url; v.style.display = 'block'; v.play().catch(() => {});
      }
      div.querySelector('label.filebtn').classList.add('sel');
      refreshExportButton();
    });
  });
  refreshExportButton();
}

/* Abre un panel de la barra de herramientas. "Plantilla" cambia el modo;
 * los demás paneles trabajan en modo efecto. */
function openPanel(name) {
  const panels = {
    efectos: ui.panelEfecto, texto: $('panel-texto'), audio: $('panel-audio'),
    filtros: $('panel-filtros'), velocidad: $('panel-velocidad'),
    subtitulos: $('panel-subtitulos'), plantilla: ui.panelPlantilla,
  };
  Object.entries(panels).forEach(([k, el]) => el.classList.toggle('oculto', k !== name));
  document.querySelectorAll('#toolbar button').forEach((b) => b.classList.toggle('on', b.dataset.panel === name));
  state.mode = name === 'plantilla' ? 'plantilla' : 'efecto';
  refreshExportButton();
}

function setEffect(name) {
  state.effect = name;
  document.querySelectorAll('#efectos button').forEach((b) => b.classList.toggle('on', b.dataset.efecto === name));
  ui.opBurbuja.classList.toggle('oculto', name !== 'burbuja');
  ui.opLetra.classList.toggle('oculto', name !== 'letra');
  ui.avisoIrvenir.classList.toggle('oculto', name !== 'irvenir');
  if (ui.textoHint) ui.textoHint.classList.toggle('oculto', name === 'burbuja' || name === 'letra');
  updatePreview();
}

/* Grupo de botones donde solo uno queda elegido (tamaño, posición, etc.). */
function wireSeg(id, key, cb) {
  const el = $(id);
  el.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => {
    el.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
    cb(b.dataset[key]);
  }));
}

/* ---------------- arranque ---------------- */
document.querySelectorAll('#toolbar button').forEach((b) => b.addEventListener('click', () => openPanel(b.dataset.panel)));
document.querySelectorAll('#efectos button').forEach((b) => b.addEventListener('click', () => setEffect(b.dataset.efecto)));
wireSeg('texto-tam', 'tam', (v) => { state.textSize = v; updatePreview(); });
wireSeg('texto-pos', 'pos', (v) => { state.textPos = v; updatePreview(); });
wireSeg('musica-vol', 'vol', (v) => { state.musicVol = v; });
wireSeg('voz-vol', 'voz', (v) => { state.voiceVol = v; });
wireSeg('filtros', 'filtro', (v) => { state.filter = v; updatePreview(); });
wireSeg('velocidad', 'vel', (v) => { state.speed = parseFloat(v); updatePreview(); });
['burbuja-1', 'burbuja-2', 'burbuja-3', 'letra-1', 'letra-2', 'letra-3', 'letra-4'].forEach((id) => $(id).addEventListener('input', updatePreview));
ui.chkSubs.addEventListener('change', updatePreview);
ui.btnRecargar.addEventListener('click', () => location.reload());
window.addEventListener('resize', updatePreview);

ui.videoInput.addEventListener('change', async (ev) => {
  const f = ev.target.files[0];
  if (!f) return;
  if (f.size > 250 * 1048576) {
    ui.videoInfo.textContent = 'Ese video pesa más de 250 MB. Elige uno más corto o con menos peso.';
    return;
  }
  state.mainFile = f; state.mainSize = f.size;
  try {
    const meta = await getVideoMeta(f);
    state.mainDuration = meta.duration;
    ui.videoInfo.textContent = `${f.name} · ${fmtSeg(meta.duration)} · ${(f.size / 1048576).toFixed(1)} MB`;
    ui.preview.src = URL.createObjectURL(f);
    ui.preview.style.display = 'block';
    ui.emptyState.style.display = 'none';
    ui.btnVideo2.classList.remove('oculto');
    ui.timelineFill.style.width = Math.min(100, (meta.duration / 60) * 100) + '%';
    updatePreview();
    /* La zona de vista previa queda fija arriba: al bajar a las
     * herramientas, el video sigue a la vista. No hace falta desplazar. */
  } catch (e) {
    ui.videoInfo.textContent = e.message;
    state.mainFile = null;
  }
  refreshExportButton();
});

ui.musicInput.addEventListener('change', (ev) => {
  const f = ev.target.files[0];
  if (!f) return;
  state.musicFile = f;
  ui.musicaInfo.textContent = `Música: ${f.name}`;
  ui.btnMusica.classList.add('sel');
  ui.btnMusica.textContent = 'Cambiar música';
});

ui.tplInput.addEventListener('change', async (ev) => {
  const f = ev.target.files[0];
  if (!f) return;
  try {
    const tpl = JSON.parse(await f.text());
    if (!Array.isArray(tpl.clips) || !tpl.cierre) throw new Error('Ese archivo no es una plantilla válida.');
    tpl.clips.forEach((c) => { if (typeof c.duracion_segundos !== 'number') throw new Error('Falta la duración en un lugar de la plantilla.'); });
    state.template = tpl;
    ui.cierre1.value = tpl.cierre.texto_principal || '';
    ui.cierre2.value = tpl.cierre.texto_secundario || '';
    ui.cierre3.value = tpl.cierre.texto_final || '';
    ui.tplInfo.textContent = `Plantilla cargada: ${tpl.nombre || 'sin nombre'} (${tpl.clips.length} lugares).`;
    buildSlots();
  } catch (e) {
    ui.tplInfo.textContent = 'No se pudo cargar esa plantilla: ' + e.message;
  }
});

ui.btnExportar.addEventListener('click', exportar);

ui.btnCompartir.addEventListener('click', async () => {
  if (!state.outBlob) return;
  const file = new File([await (await fetch(state.outBlob)).blob()], state.outName, { type: 'video/mp4' });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file], title: "Murillo's Pizza" }); return; } catch (e) { /* el usuario canceló */ }
  }
  alert('No se pudo abrir el menú de compartir en este teléfono. Usa el botón "Guardar video" y súbelo desde tu galería.');
});

ui.btnOtro.addEventListener('click', () => {
  ui.resultado.style.display = 'none';
  ui.progreso.style.display = 'none';
  if (state.outBlob) URL.revokeObjectURL(state.outBlob);
  state.outBlob = null;
  state.mainFile = null; state.musicFile = null;
  ui.videoInput.value = ''; ui.musicInput.value = '';
  ui.preview.style.display = 'none'; ui.preview.removeAttribute('src');
  ui.emptyState.style.display = 'block';
  ui.btnVideo2.classList.add('oculto');
  ui.timelineFill.style.width = '0%';
  ui.videoInfo.textContent = 'Sin video todavía.';
  ui.btnMusica.classList.remove('sel'); ui.btnMusica.textContent = 'Elegir música de fondo';
  ui.musicaInfo.textContent = 'Se mezcla bajita para no tapar tu voz. Si la canción es más corta que el video, se repite.';
  buildSlots();
  openPanel('efectos');
  updatePreview();
  ui.previewZone.classList.remove('no-sticky');
  refreshExportButton();
  window.scrollTo({ top: 0, behavior: 'smooth' });
});

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => { navigator.serviceWorker.register('sw.js').catch(() => {}); });
}

/* Carga el motor en cuanto abre la app, para que no espere al exportar. */
buildSlots();
ensureFFmpeg().then(() => { loadTitanForCanvas().catch(() => {}); updatePreview(); }).catch((e) => {
  ui.cargaTitulo.textContent = 'No se pudo preparar el editor';
  ui.cargaTexto.textContent = 'Revisa tu conexión y recarga la página. ' + (e && e.message ? e.message : '');
  showLog();
});
