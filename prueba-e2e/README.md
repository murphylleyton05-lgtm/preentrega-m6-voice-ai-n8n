# Prueba de punta a punta del carril de voz (M6)

Evidencia de que el flujo `checkpoint6_lleyton_murphy.json` funciona de la nota de voz al audio de respuesta. Se ejecutó en n8n 2.41.5 (ver sección 11 del PDF).

| Archivo | Qué es |
|---|---|
| `prueba_e2e_carril_voz.json` | Copia del carril de voz. Es idéntica salvo un nodo: ElevenLabs se reemplazó por un HTTP Request que envía el mismo pedido al simulador, porque el nodo oficial tiene la URL `api.elevenlabs.io` fija. |
| `prueba_cargar_indice_rag.json` | Carga los 15 fragmentos del Manual v2.1 en el Simple Vector Store (`politicas_tienda_v2_1`). |
| `sim_server.mjs` | Simuladores locales: Telegram Bot API (8081), API compatible con OpenAI (8082) con **Whisper real** (whisper-small open source vía transformers.js) y ElevenLabs (8083) con TTS local (espeak-ng). Registran lo que n8n envía. |
| `registro_simuladores.jsonl` | Registro de todas las llamadas de la prueba: modelo, idioma, `max_tokens`, `voice_settings`, bytes de audio, captions. |
| `nota_de_voz_cliente.oga` / `nota_de_voz_ruido.oga` | Audios de entrada (consulta y ruido puro). |
| `respuesta_enviada_a_telegram.mp3` | Audio que llegó al `sendAudio` de Telegram (11,5 s, 44,1 kHz, 64 kbps). |

## Resultados

- **Camino feliz:** Whisper transcribió “Hola. ¿Cuánto tarde ha en llegar un envío a Mendoza?”. El agente consultó el RAG (sección 2.1, Cuyo) y respondió en 135 caracteres. ElevenLabs recibió `eleven_multilingual_v2` con stability 0.6 y similarity_boost 0.8, y Telegram recibió el MP3 con caption.
- **Contingencia:** con ruido, Whisper alucinó “[Ruido de la venta]”. El IF lo desvió al aviso de texto sin llamar al LLM ni a ElevenLabs.
- **Compliance:** después de 3 notas de voz, Executions y la API muestran 0 ejecuciones. Con `N8N_DEFAULT_BINARY_DATA_MODE=default`, `EXECUTIONS_DATA_HARD_DELETE_BUFFER=0` y `EXECUTIONS_DATA_PRUNE_HARD_DELETE_INTERVAL=1` no se escribió ningún audio en disco y todo se purgó en menos de 1 minuto.

**Simulado (no real):** los servidores de Telegram, los embeddings (hash determinístico), el LLM (reglas fijas que piden la herramienta y responden con el fragmento recuperado) y la voz de ElevenLabs. Para producción, asignar las credenciales reales en el `.json` principal.
