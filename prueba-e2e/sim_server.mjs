// Simuladores locales de las APIs externas del flujo M6.
// - Telegram Bot API (http://127.0.0.1:8081)  -> registra setWebhook, getFile, sendAudio, sendMessage
// - OpenAI-compatible (http://127.0.0.1:8082/v1) -> /audio/transcriptions con Whisper REAL (whisper-small, transformers.js)
//                                                   /embeddings (hash determinístico) y /chat/completions (LLM simulado por reglas)
// - ElevenLabs-compatible (http://127.0.0.1:8083/v1) -> /text-to-speech/:voice con TTS REAL (espeak-ng es-419 -> MP3)
// Cada pedido se registra en sim_log.jsonl con lo que n8n envió.
import http from 'http';
import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';
import { pipeline, env } from '@huggingface/transformers';

const DIR = path.dirname(new URL(import.meta.url).pathname);
const E2E = process.env.E2E_DIR || DIR;
const LOG = path.join(E2E, 'sim_log.jsonl');
const FILES = { VOZ_MENDOZA: path.join(E2E, 'nota_de_voz_cliente.oga'), VOZ_RUIDO: path.join(E2E, 'nota_de_voz_ruido.oga') };

env.allowRemoteModels = false;
// Modelo: paquete npm sts-whisper-small (Xenova/whisper-small, q8). Ruta configurable con WHISPER_MODELS_DIR.
env.localModelPath = (process.env.WHISPER_MODELS_DIR || path.join(DIR, 'small', 'package', 'models')) + '/';
const asr = await pipeline('automatic-speech-recognition', 'Xenova/whisper-small', { dtype: 'q8' });

const log = (svc, entry) => {
  const line = { ts: new Date().toISOString(), svc, ...entry };
  fs.appendFileSync(LOG, JSON.stringify(line) + '\n');
  console.log(svc, JSON.stringify(entry).slice(0, 300));
};

const readBody = req => new Promise(res => { const c = []; req.on('data', d => c.push(d)); req.on('end', () => res(Buffer.concat(c))); });

function parseMultipart(buf, contentType) {
  const m = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType || '');
  if (!m) return {};
  const boundary = Buffer.from('--' + (m[1] || m[2]));
  const parts = {};
  let start = buf.indexOf(boundary);
  while (start !== -1) {
    const next = buf.indexOf(boundary, start + boundary.length);
    if (next === -1) break;
    const part = buf.subarray(start + boundary.length + 2, next - 2);
    const sep = part.indexOf('\r\n\r\n');
    if (sep !== -1) {
      const head = part.subarray(0, sep).toString();
      const body = part.subarray(sep + 4);
      const name = /name="([^"]+)"/.exec(head)?.[1];
      const filename = /filename="([^"]*)"/.exec(head)?.[1];
      const ctype = /content-type:\s*([^\r\n]+)/i.exec(head)?.[1];
      if (name) parts[name] = filename !== undefined ? { filename, ctype, data: body } : body.toString();
    }
    start = next;
  }
  return parts;
}

const json = (res, code, obj) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)); };

// ---------------- Telegram ----------------
let msgId = 900;
let fileCounter = 0;
const filePaths = {};
http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const body = await readBody(req);
  const fileMatch = /^\/file\/bot[^/]+\/(.+)$/.exec(url.pathname);
  if (fileMatch) {
    const local = filePaths[fileMatch[1]];
    if (!local) return json(res, 404, { ok: false, description: 'Not Found' });
    const data = fs.readFileSync(local);
    log('telegram', { method: 'download', file_path: fileMatch[1], bytes: data.length });
    res.writeHead(200, { 'content-type': 'application/octet-stream' });
    return res.end(data);
  }
  const m = /^\/bot[^/]+\/(\w+)$/.exec(url.pathname);
  if (!m) return json(res, 404, { ok: false });
  const method = m[1];
  const ct = req.headers['content-type'] || '';
  let params = Object.fromEntries(url.searchParams);
  if (ct.includes('application/json') && body.length) params = { ...params, ...JSON.parse(body.toString()) };
  else if (ct.includes('multipart/form-data')) params = { ...params, ...parseMultipart(body, ct) };
  else if (ct.includes('urlencoded')) params = { ...params, ...Object.fromEntries(new URLSearchParams(body.toString())) };

  if (method === 'getWebhookInfo') { log('telegram', { method }); return json(res, 200, { ok: true, result: { url: '', pending_update_count: 0 } }); }
  if (method === 'setWebhook') { log('telegram', { method, url: params.url, secret_token: params.secret_token, allowed_updates: params.allowed_updates }); return json(res, 200, { ok: true, result: true }); }
  if (method === 'deleteWebhook') { log('telegram', { method }); return json(res, 200, { ok: true, result: true }); }
  if (method === 'getFile') {
    const local = FILES[params.file_id];
    if (!local) { log('telegram', { method, file_id: params.file_id, error: 'file not found' }); return json(res, 400, { ok: false, error_code: 400, description: 'Bad Request: invalid file_id' }); }
    const fp = `voice/file_${fileCounter++}.oga`;
    filePaths[fp] = local;
    const size = fs.statSync(local).size;
    log('telegram', { method, file_id: params.file_id, file_path: fp, file_size: size });
    return json(res, 200, { ok: true, result: { file_id: params.file_id, file_unique_id: 'u_' + params.file_id, file_size: size, file_path: fp } });
  }
  if (method === 'sendAudio') {
    const audio = params.audio;
    let saved = null;
    if (audio && audio.data) { saved = path.join(E2E, `respuesta_${Date.now()}.mp3`); fs.writeFileSync(saved, audio.data); }
    log('telegram', { method, chat_id: params.chat_id, caption: params.caption, caption_chars: (params.caption || '').length, reply_to_message_id: params.reply_to_message_id, title: params.title, audio_filename: audio?.filename, audio_ctype: audio?.ctype, audio_bytes: audio?.data?.length, saved });
    return json(res, 200, { ok: true, result: { message_id: ++msgId, chat: { id: Number(params.chat_id), type: 'private' }, date: Math.floor(Date.now() / 1000), audio: { duration: 9, mime_type: 'audio/mpeg', title: params.title, file_id: 'AUDIO_' + msgId, file_size: audio?.data?.length }, caption: params.caption } });
  }
  if (method === 'sendMessage') {
    log('telegram', { method, chat_id: params.chat_id, text: params.text, reply_to_message_id: params.reply_to_message_id });
    return json(res, 200, { ok: true, result: { message_id: ++msgId, chat: { id: Number(params.chat_id), type: 'private' }, date: Math.floor(Date.now() / 1000), text: params.text } });
  }
  log('telegram', { method, params: Object.keys(params) });
  return json(res, 200, { ok: true, result: true });
}).listen(8081, '127.0.0.1');

// ---------------- OpenAI-compatible ----------------
const norm = s => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
function fnv(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
function embed(text) {
  const v = new Float32Array(1536);
  const words = norm(text).split(/[^a-z0-9]+/).filter(w => w.length > 2);
  for (const w of words) {
    v[fnv(w) % 1536] += 1;
    const p = `#${w}#`;
    for (let i = 0; i + 4 <= p.length; i++) v[fnv('g' + p.slice(i, i + 4)) % 1536] += 0.35;
  }
  let n = Math.sqrt(v.reduce((a, b) => a + b * b, 0)) || 1;
  return Array.from(v, x => x / n);
}

function answerFromFragments(toolText) {
  const t = toolText.replace(/\\n/g, '\n');
  const row = /Interior[\s\S]{0,80}?Cuyo[\s\S]{0,80}?(\d+\s*a\s*\d+\s*d[ií]as h[aá]biles)[\s\S]{0,20}?\$\s?([\d.]+)/i.exec(t);
  if (row) return `El envío a Mendoza tarda de ${row[1].replace(/\s+/g, ' ')} y cuesta ${row[2]} pesos. Cuando lo despachamos te llega el número de seguimiento por email.`;
  return 'No tengo ese dato en el manual. Te derivo con un asesor.';
}

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const body = await readBody(req);
  const ct = req.headers['content-type'] || '';
  if (url.pathname.endsWith('/audio/transcriptions')) {
    const p = parseMultipart(body, ct);
    const f = p.file;
    const tmp = path.join(E2E, `in_${Date.now()}_${f?.filename || 'audio'}`);
    fs.writeFileSync(tmp, f.data);
    const pcm = execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-i', tmp, '-ac', '1', '-ar', '16000', '-f', 'f32le', '-']);
    const audio = new Float32Array(pcm.buffer.slice(pcm.byteOffset, pcm.byteOffset + pcm.byteLength));
    const t0 = Date.now();
    const lang = { es: 'spanish', en: 'english' }[p.language] || undefined;
    const out = await asr(audio, lang ? { language: lang, task: 'transcribe' } : { task: 'transcribe' });
    const dur = execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', tmp]).toString().trim();
    log('openai', { endpoint: 'audio/transcriptions', model: p.model, language: p.language, temperature: p.temperature ?? '(no enviado: 0)', filename: f.filename, ctype: f.ctype, bytes: f.data.length, duracion_s: Number(dur), text: out.text, motor: 'whisper-small (open source, local)', ms: Date.now() - t0 });
    return json(res, 200, { text: out.text });
  }
  const b = body.length ? JSON.parse(body.toString()) : {};
  if (url.pathname.endsWith('/embeddings')) {
    const inputs = Array.isArray(b.input) ? b.input : [b.input];
    log('openai', { endpoint: 'embeddings', model: b.model, n: inputs.length, primer_texto: String(inputs[0]).slice(0, 80) });
    return json(res, 200, { object: 'list', model: b.model, data: inputs.map((t, i) => ({ object: 'embedding', index: i, embedding: embed(String(t)) })), usage: { prompt_tokens: 1, total_tokens: 1 } });
  }
  if (url.pathname.endsWith('/chat/completions')) {
    const msgs = b.messages || [];
    const sys = msgs.find(m => m.role === 'system')?.content || '';
    const user = [...msgs].reverse().find(m => m.role === 'user');
    const userText = typeof user?.content === 'string' ? user.content : JSON.stringify(user?.content);
    const toolMsg = msgs.find(m => m.role === 'tool');
    const tools = (b.tools || []).map(t => t.function?.name);
    const base = { endpoint: 'chat/completions', model: b.model, max_tokens: b.max_tokens ?? b.max_completion_tokens, temperature: b.temperature, stream: !!b.stream, tools, system_tiene_regla_200: /M[AÁ]XIMO de 200 caracteres/i.test(sys) };
    let message, finish;
    if (!toolMsg && tools.includes('consultar_manual_politicas')) {
      const q = userText.split('\n').slice(1).join(' ').trim() || userText;
      const params = b.tools.find(t => t.function?.name === 'consultar_manual_politicas').function.parameters || {};
      const key = Object.keys(params.properties || { input: 1 })[0] || 'input';
      message = { role: 'assistant', content: null, tool_calls: [{ id: 'call_rag_1', type: 'function', function: { name: 'consultar_manual_politicas', arguments: JSON.stringify({ [key]: q }) } }] };
      finish = 'tool_calls';
      log('openai', { ...base, paso: '1 · el LLM pide la herramienta RAG', tool_args: { [key]: q } });
    } else {
      const toolText = typeof toolMsg?.content === 'string' ? toolMsg.content : JSON.stringify(toolMsg?.content || '');
      const answer = answerFromFragments(toolText);
      message = { role: 'assistant', content: answer };
      finish = 'stop';
      log('openai', { ...base, paso: '2 · respuesta con fragmentos del manual', fragmentos_chars: toolText.length, fragmento_cuyo_recuperado: /Cuyo/.test(toolText), respuesta: answer, respuesta_chars: answer.length });
    }
    const id = 'chatcmpl-sim-' + Date.now();
    if (b.stream) {
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      const delta = message.tool_calls ? { role: 'assistant', tool_calls: message.tool_calls.map((tc, i) => ({ index: i, ...tc })) } : { role: 'assistant', content: message.content };
      res.write(`data: ${JSON.stringify({ id, object: 'chat.completion.chunk', created: 0, model: b.model, choices: [{ index: 0, delta, finish_reason: null }] })}\n\n`);
      res.write(`data: ${JSON.stringify({ id, object: 'chat.completion.chunk', created: 0, model: b.model, choices: [{ index: 0, delta: {}, finish_reason: finish }], usage: { prompt_tokens: 900, completion_tokens: 40, total_tokens: 940 } })}\n\n`);
      return res.end('data: [DONE]\n\n');
    }
    return json(res, 200, { id, object: 'chat.completion', created: Math.floor(Date.now() / 1000), model: b.model, choices: [{ index: 0, message, finish_reason: finish }], usage: { prompt_tokens: 900, completion_tokens: 40, total_tokens: 940 } });
  }
  log('openai', { endpoint: url.pathname, nota: 'no simulado' });
  return json(res, 404, { error: { message: 'not simulated' } });
}).listen(8082, '127.0.0.1');

// ---------------- ElevenLabs-compatible ----------------
http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const body = await readBody(req);
  const m = /^\/v1\/text-to-speech\/([^/?]+)$/.exec(url.pathname);
  if (!m || req.method !== 'POST') return json(res, 404, { detail: 'not simulated' });
  const b = JSON.parse(body.toString());
  const stamp = Date.now();
  const wav = path.join(E2E, `tts_${stamp}.wav`), mp3 = path.join(E2E, `tts_${stamp}.mp3`);
  execFileSync('espeak-ng', ['-v', 'es-419', '-s', '150', '-w', wav, b.text]);
  const fmt = url.searchParams.get('output_format') || 'mp3_44100_128';
  const [, sr, kbps] = /mp3_(\d+)_(\d+)/.exec(fmt) || [null, '44100', '128'];
  execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', wav, '-ar', sr, '-ac', '1', '-c:a', 'libmp3lame', '-b:a', `${kbps}k`, mp3]);
  const data = fs.readFileSync(mp3);
  log('elevenlabs', { endpoint: 'text-to-speech', voice_id: m[1], output_format: fmt, model_id: b.model_id, voice_settings: b.voice_settings, text: b.text, chars_facturables: b.text.length, xi_api_key_presente: !!req.headers['xi-api-key'], mp3_bytes: data.length, motor: 'espeak-ng es-419 (local)' });
  res.writeHead(200, { 'content-type': 'audio/mpeg' });
  res.end(data);
}).listen(8083, '127.0.0.1');

console.log('SIMULADORES LISTOS 8081 8082 8083');
