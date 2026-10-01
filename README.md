# 🎙️ Pre-entrega Módulo 6 · Ecosistemas Multimedia de Audio (Voice AI)

**Alumno:** Lleyton Murphy · **Plataforma:** n8n · **Proyecto integrador:** Agente de Soporte de *Lleyton Tech Store* (M1 → M3 → M4 → M5 → **M6**)

Circuito cerrado conversacional de voz en n8n: el cliente manda una **nota de voz por Telegram** y recibe una **respuesta en audio** basada en el Manual de Políticas del M5 (RAG). Tiene tope de costos de 200 caracteres, ruta de contingencia y un protocolo de privacidad para los audios.

## 📦 Contenido

| Archivo / carpeta | Qué es |
|---|---|
| [`PreEntrega_Modulo6_LleytonMurphy.docx`](./PreEntrega_Modulo6_LleytonMurphy.docx) | La misma entrega en Word (.docx), 17 páginas. |
| [`PreEntrega_Modulo6_LleytonMurphy.pdf`](./PreEntrega_Modulo6_LleytonMurphy.pdf) | **Entregable** (17 páginas): checklist de la consigna, diagnóstico de viabilidad (ROI y fatiga cognitiva), capturas de la configuración en n8n, System Prompt, Compliance, flujo en formato texto y prueba de punta a punta. |
| [`checkpoint6_lleyton_murphy.json`](./checkpoint6_lleyton_murphy.json) | Flujo de n8n completo (M5 + capa de voz, 56 nodos). Se importa con *Import from File*. |
| [`capturas/configuracion/`](./capturas/configuracion) | Capturas del editor de n8n: lienzo y panel de cada nodo. |
| [`capturas/prueba-e2e/`](./capturas/prueba-e2e) | Capturas de la ejecución de punta a punta: lienzo en verde y datos de salida de cada nodo. |
| [`prueba-e2e/`](./prueba-e2e) | Evidencia reproducible: simuladores, workflows de prueba, registro de llamadas, nota de voz de entrada y MP3 de respuesta. |
| [`fuente-rag/`](./fuente-rag) | Manual de Políticas v2.1, la base documental del RAG (M5). |

## 🔁 Circuito

```
[Telegram Trigger] → [Get File · binario data] → [OpenAI Whisper · data · es]
      → [IF ¿Transcripción válida?]
            ├─ true  → [AI Agent Voz (Tools Agent) + consultar_manual_politicas (RAG M5)]
            │            → [Tope 200 caracteres] → [ElevenLabs · Multilingual v2] → [Telegram Send Audio]
            └─ false → [Telegram · Aviso audio inválido (texto)]
      → [🔒 Purga binaria (Compliance)]
```

## ✅ Componentes obligatorios

| Componente | Implementación |
|---|---|
| Interceptación binaria | Telegram Trigger (bot oficial, webhook con secret token) + Get File → binario `data`. El trigger de n8n no descarga notas de voz (solo foto, video y documento), por eso se usa Get File. |
| Oídos (Whisper) | Input Binary Property `data`, idioma `es`, temperatura 0, *On Error: Continue*. |
| Cerebro (AI Agent) | AI Agent v3 (Tools Agent) con la transcripción limpia, gpt-4o-mini y la herramienta RAG del M5. |
| Contención financiera | System Message: “Limita la longitud de TODAS tus respuestas escritas a un MAXIMO de 200 caracteres” + Max Tokens 120 + nodo guardrail que corta en la última oración completa. |
| Voz (ElevenLabs) | Eleven Multilingual v2, voz Sarah, Stability 0.60, Clarity (similarity_boost) 0.80, MP3 44,1 kHz 64 kbps. |
| Salida binaria | Telegram **Send Audio** con el binario `data` de ElevenLabs, caption con el texto y respuesta citando la nota original. |
| Contingencia no-code | IF: sin error, ≥ 3 caracteres y sin alucinaciones de Whisper (“[Ruido…]”, “(Música…)”, frases en bucle, “Amara.org”). Si falla, avisa por texto sin gastar LLM ni ElevenLabs. |
| Compliance | Save executions = *Do not save* + purga final sin binarios ni transcripción + agente sin memoria. En la instancia: `N8N_DEFAULT_BINARY_DATA_MODE=default`, `EXECUTIONS_DATA_HARD_DELETE_BUFFER=0`, `EXECUTIONS_DATA_PRUNE_HARD_DELETE_INTERVAL=1` (audio solo en RAM y purga en menos de 1 min, medido). |

## 🧪 Prueba de punta a punta

El carril de voz se ejecutó en **n8n 2.41.5** con una nota de voz real y **Whisper real** (whisper-small open source, local):

- **Camino feliz:** “Hola. ¿Cuánto tarde ha en llegar un envío a Mendoza?” → RAG (sección 2.1) → “El envío a Mendoza tarda de 3 a 5 días hábiles y cuesta 8.900 pesos…” (135 caracteres) → MP3 enviado a Telegram.
- **Contingencia:** con ruido, Whisper alucinó “[Ruido de la venta]” → aviso de texto, sin LLM ni TTS.
- **Compliance:** 0 ejecuciones visibles después de 3 notas de voz, 0 archivos de audio en disco y purga en menos de 1 minuto.

Simulados (aclarado en el PDF): los servidores de Telegram, los embeddings, el LLM (reglas fijas) y la voz de ElevenLabs. Detalle en [`prueba-e2e/README.md`](./prueba-e2e/README.md).

## ▶️ Puesta en marcha

1. n8n → *Import from File* → `checkpoint6_lleyton_murphy.json`.
2. Crear el bot con @BotFather y asignar la credencial **Telegram API** a Trigger, Get File, Send Audio y Aviso.
3. Asignar las credenciales **OpenAI** (Whisper, Chat Model, Embeddings) y **ElevenLabs** (paquete verificado `@elevenlabs/n8n-nodes-elevenlabs`).
4. Ejecutar una vez “Cargar Manual (ejecutar 1 vez)” para indexar el manual del M5.
5. (Self-hosted) Definir las 3 variables de Compliance y reiniciar n8n.
6. Publicar el workflow (un solo webhook por bot de Telegram).

---
Lleyton Murphy · Lleyton IA Automation
