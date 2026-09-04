# AI Voice Widget

A lightweight, embeddable **AI voice assistant widget** that can be added to any website using a single JavaScript `<script>` tag.

This repository contains the **client-side widget** for the [AI-Voice-Assistant](https://github.com/utkarsh-2033/AI-Voice-Assistant) project. It is maintained as a separate repository so the compiled JavaScript asset can be **hosted publicly and consumed directly by external websites**.

```text
<script src="https://your-public-host/voice-widget.js"></script>
```

The widget handles the browser-side voice experience while communicating with the AI Voice Assistant backend through a REST API.

---

## ✨ Features

* 🎙️ Browser-based speech recognition
* 🔊 Text-to-speech responses
* 💬 Text input fallback
* 🧠 Conversation history
* ⚡ Real-time listening / processing / speaking states
* 🎨 Light, dark, and automatic themes
* 📱 Responsive floating widget
* 🌐 Configurable language support
* 🔄 Automatic voice interruption handling
* 📋 Structured information collection
* ✅ Confirmation/review UI for collected details
* 🟢 Graceful text-only fallback when browser voice APIs are unavailable
* 🔗 Backend-driven assistant configuration
* 📲 Support for actions such as WhatsApp handoff and starting a new conversation

The widget currently defaults to `en-IN` and supports browser speech recognition and speech synthesis APIs.

---

## 🏗️ Architecture

The project is the **client layer** of the larger AI Voice Assistant system.

```text
┌───────────────────────────────────────┐
│           Customer Website            │
│                                       │
│   <script src="voice-widget.js">      │
└───────────────────┬───────────────────┘
                    │
                    ▼
┌───────────────────────────────────────┐
│          AI Voice Widget              │
│                                       │
│  • UI / floating assistant            │
│  • Speech Recognition                 │
│  • Text-to-Speech                     │
│  • Conversation state                 │
│  • Text fallback                      │
│  • Client configuration               │
└───────────────────┬───────────────────┘
                    │
                 REST API
                    │
                    ▼
┌───────────────────────────────────────┐
│       AI-Voice-Assistant Backend      │
│                                       │
│  • Voice agent                        │
│  • LLM / response generation          │
│  • Client configuration               │
│  • Conversation processing            │
└───────────────────────────────────────┘
```

The main AI Voice Assistant repository separates the client SDK/widget from the backend voice engine and exposes configuration through an API endpoint.

---

## 📦 What's in this repository?

This repository intentionally contains a minimal distribution artifact:

```text
AI-Voice-Widget/
└── voice-widget.js
```

`voice-widget.js` is a self-contained browser script that:

* creates the widget UI
* injects its own styles
* initializes browser voice APIs
* manages conversation state
* communicates with the voice-agent API
* renders assistant responses
* speaks responses using browser TTS
* falls back to text input when voice APIs are unavailable

The script creates and mounts the widget directly into the page DOM, so the consuming website does not need a framework such as React or Vue.

---


## ⚙️ Configuration

```javascript
window.VOICE_AI_CONFIG = {
  clientId: "your_client_id",
  apiUrl: "https://your-api.example.com/api/voice-agent",

  position: "bottom-right",
  theme: "auto",
  language: "en-IN",

  autoStart: false,
  debug: false
};
```

### Configuration options

| Option      | Description                                      |
| ----------- | ------------------------------------------------ |
| `clientId`  | Identifies the client/business configuration     |
| `apiUrl`    | Voice-agent backend endpoint                     |
| `position`  | Widget position: `bottom-right` / `bottom-left`  |
| `theme`     | `light`, `dark`, or `auto`                       |
| `language`  | Speech recognition / synthesis language          |
| `autoStart` | Whether the assistant should start automatically |
| `debug`     | Enables debug logging                            |

Additional voice settings such as speech rate, pitch, volume, preferred browser voices, assistant name, and subtitle are also supported internally by the widget configuration.

---

# 🎙️ Voice Interaction

The widget uses the browser's built-in speech APIs.

```text
User speaks
    ↓
Speech Recognition
    ↓
Transcript
    ↓
Voice Agent API
    ↓
AI Response
    ↓
Text displayed
    ↓
Text-to-Speech
    ↓
Assistant speaks
```

The widget maintains explicit interaction states:

```text
IDLE
  ↓
LISTENING
  ↓
PROCESSING
  ↓
SPEAKING
  ↓
IDLE
```

These states are reflected in the widget UI to provide feedback during a conversation.

---

# ⌨️ Text Fallback

Voice interaction depends on browser support and microphone permissions.

When speech recognition or speech synthesis is unavailable, the widget automatically switches to a **text-only mode** instead of completely failing.

This makes the assistant usable in environments where browser voice APIs are unavailable or microphone access has been denied.

---

# 🧩 Client-Specific Configuration

The widget is designed to support multiple clients/businesses through `clientId`-based configuration.

```text
Website
   │
   └── clientId
          │
          ▼
   Voice Assistant API
          │
          ▼
   Client-specific configuration
```

The backend can use the client identifier to provide the appropriate assistant behavior, branding, conversation rules, knowledge, and actions.

The main project documents configuration for assistant identity, conversation rules, knowledge, lead capture, appointment booking, and LLM settings.

---

# 🔗 Related Project

This repository is the **frontend/client distribution layer** of:

### [AI-Voice-Assistant](https://github.com/utkarsh-2033/AI-Voice-Assistant)

The main repository contains the broader voice-assistant system, while this repository exists specifically to distribute the embeddable browser widget independently.

```text
AI-Voice-Assistant
        │
        ├── AI / Voice Agent Backend
        │
        └── AI-Voice-Widget
                │
                └── Public embeddable JavaScript
```

---

# 🛠️ Technology

The widget is intentionally dependency-light and browser-native.

* JavaScript
* Web Speech API
* Browser DOM APIs
* REST API
* HTML / CSS
* Static hosting / CDN

Speech recognition is initialized through `SpeechRecognition` / `webkitSpeechRecognition`, while responses are spoken through `SpeechSynthesis`.

---

# 📌 Design Goals

The widget is designed around a simple integration principle:

> **Add conversational AI to an existing website without changing the website's frontend architecture.**

A consuming application should only need:

```html
<script src="https://your-host/voice-widget.js"></script>
```

while configuration and backend integration remain handled by the widget itself.

---
