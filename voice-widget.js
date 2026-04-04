/**
 * =================================================================
 * VOICE AI ASSISTANT SDK - Embeddable Widget
 * =================================================================
 * Production-grade, framework-agnostic JavaScript SDK
 * 
 * USAGE:
 * <script>
 *   window.VOICE_AI_CONFIG = {
 *     clientId: "ca_firm_1",
 *     apiUrl: "https://yourdomain.com/api/voice-agent",
 *     position: "bottom-right",
 *     theme: "light"
 *   };
 * </script>
 * <script src="https://cdn.com/voice-widget.js"></script>
 * =================================================================
 */

(function () {
  'use strict';

  // ==================== Configuration ====================
  const DEFAULT_CONFIG = {
    clientId: 'default_client',
    apiUrl: 'http://localhost:3000/api/voice-agent',
    position: 'bottom-right',
    theme: 'light',
    autoStart: false,
    language: 'en-IN',
    voiceRate: 1.18,
    voicePitch: 1.03,
    voiceVolume: 1,
    preferredVoiceNames: ['Google UK English Female', 'Microsoft Neerja Online (Natural) - English (India)', 'Microsoft Aria Online (Natural) - English (United States)'],
    debug: false
  };

  // ==================== Constants ====================
  const STATES = {
    IDLE: 'idle',
    LISTENING: 'listening',
    PROCESSING: 'processing',
    SPEAKING: 'speaking',
    ERROR: 'error'
  };

  const ANIMATION_DURATION = 300;
  const DEBOUNCE_DELAY_API = 500;
  const MAX_CONVERSATION_HISTORY = 10;

  // ==================== VoiceAIWidget Class ====================
  class VoiceAIWidget {
    constructor(config = {}) {
      this.config = { ...DEFAULT_CONFIG, ...(window.VOICE_AI_CONFIG || {}), ...config };
      
      // State management
      this.state = STATES.IDLE;
      this.conversationHistory = [];
      this.isListening = false;
      this.isProcessing = false;
      this.isSpeaking = false;
      this.inputMode = 'voice';
      this.lastInputSource = 'voice';
      this.composerOpen = false;
      this.session_id = this.generateSessionId();
      
      // Browser APIs
      this.recognition = null;
      this.synthesis = window.speechSynthesis;
      this.currentUtterance = null;
      
      // DOM elements
      this.container = null;
      this.button = null;
      this.panel = null;
      this.transcript = null;
      this.statusIndicator = null;
      this.composer = null;
      this.composerInput = null;
      this.composerToggleButton = null;
      this.quickActions = null;
      this.reviewCard = null;
      this.reviewCardFields = null;
      this.currentBookingState = null;
      this.activeFieldHint = null;
      this.lastHandoffKey = null;
      
      // Debounce helpers
      this.apiCallTimeout = null;
      
      this.init();
    }

    // ==================== Initialization ====================
    init() {
      this.log('Initializing Voice AI Widget...');
      
      // Check browser support
      if (!this.checkBrowserSupport()) {
        this.log('Browser does not support required APIs', 'error');
        return;
      }
      
      // Setup speech recognition
      this.setupSpeechRecognition();
      
      // Inject styles
      this.injectStyles();
      
      // Create UI
      this.createUI();
      
      // Bind events
      this.bindEvents();
      
      this.log('Voice AI Widget initialized successfully');
    }

    // ==================== Browser Support Check ====================
    checkBrowserSupport() {
      const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
      const hasRecognition = !!SpeechRecognition;
      const hasSynthesis = !!window.speechSynthesis;
      
      this.log(`Speech Recognition: ${hasRecognition ? 'supported' : 'not supported'}`);
      this.log(`Speech Synthesis: ${hasSynthesis ? 'supported' : 'not supported'}`);
      
      return hasRecognition && hasSynthesis;
    }

    // ==================== Speech Recognition Setup ====================
    setupSpeechRecognition() {
      const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
      this.recognition = new SpeechRecognition();
      
      // Configuration
      this.recognition.continuous = true;
      this.recognition.interimResults = true;
      this.recognition.language = this.config.language;
      
      // Event: Speech recognized (interim)
      this.recognition.onresult = (event) => {
        let interimTranscript = '';
        let finalTranscript = '';
        
        for (let i = event.resultIndex; i < event.results.length; i++) {
          const transcript = event.results[i][0].transcript;
          
          if (event.results[i].isFinal) {
            finalTranscript += transcript + ' ';
          } else {
            interimTranscript += transcript;
          }
        }
        
        // Update UI
        if (finalTranscript) {
          this.addMessageToTranscript(finalTranscript, 'user', true);
          this.handleUserInput(finalTranscript, 'voice');
        } else if (interimTranscript) {
          this.updateTranscriptPreview(interimTranscript);
        }
      };
      
      // Event: Recognition started
      this.recognition.onstart = () => {
        this.setState(STATES.LISTENING);
        this.log('Listening started');
      };
      
      // Event: Recognition ended
      this.recognition.onend = () => {
        this.log('Listening ended');
        if (this.state === STATES.LISTENING) {
          this.setState(STATES.IDLE);
        }
      };
      
      // Event: Error
      this.recognition.onerror = (event) => {
        this.log(`Recognition error: ${event.error}`, 'error');
        this.setState(STATES.ERROR);
        
        // Show user-friendly error messages
        let errorMsg = 'Could not listen. ';
        if (event.error === 'no-speech') {
          errorMsg += 'No speech detected. Please try again.';
        } else if (event.error === 'network') {
          errorMsg += 'Network error. Check your connection.';
        } else if (event.error === 'not-allowed') {
          errorMsg += 'Microphone permission denied.';
        }
        
        this.addSystemMessage(errorMsg);
        
        // Reset to idle after error
        setTimeout(() => this.setState(STATES.IDLE), 2000);
      };
    }

    // ==================== UI Creation ====================
    createUI() {
      // Create main container
      this.container = document.createElement('div');
      this.container.id = 'voice-ai-widget';
      this.container.className = `voice-widget theme-${this.config.theme} position-${this.config.position}`;
      
      // Create floating button
      this.button = document.createElement('button');
      this.button.id = 'voice-widget-button';
      this.button.className = 'voice-widget-button';
      this.button.title = 'Voice Assistant';
      this.button.innerHTML = `
        <svg class="mic-icon" viewBox="0 0 24 24" fill="currentColor">
          <path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3z"/>
          <path d="M17 16.91c-1.48 1.46-3.51 2.36-5.77 2.36-2.26 0-4.29-.9-5.77-2.36l-1.1 1.1c1.86 1.86 4.41 2.86 6.87 2.86s5.01-1 6.87-2.86l-1.1-1.1zM20 9h-1.7c0 .58-.16 1.12-.38 1.6l1.38 1.38C19.54 11.35 20 10.22 20 9z"/>
        </svg>
      `;
      
      // Create panel
      this.panel = document.createElement('div');
      this.panel.id = 'voice-widget-panel';
      this.panel.className = 'voice-widget-panel hidden';

      const panelBackdrop = document.createElement('div');
      panelBackdrop.className = 'panel-backdrop';

      const panelGridTexture = document.createElement('div');
      panelGridTexture.className = 'panel-grid-texture';

      const panelOrbLayer = document.createElement('div');
      panelOrbLayer.className = 'panel-orb-layer';
      panelOrbLayer.innerHTML = `
        <div class="orb orb-primary"></div>
        <div class="orb orb-secondary"></div>
      `;

      const panelSurface = document.createElement('div');
      panelSurface.className = 'panel-surface';
      
      // Create panel header
      const header = document.createElement('div');
      header.className = 'panel-header';
      header.innerHTML = `
        <div class="panel-title-wrap">
          <div class="spark-icon" aria-hidden="true">✦</div>
          <div class="panel-title">
            <span class="assistant-name">Luminous Agent</span>
            <span class="assistant-subtitle">Voice Concierge</span>
          </div>
        </div>
        <div class="brand-pill" aria-label="Callora AI">
          <span class="brand-mark">CA</span>
          <span class="brand-name">Callora AI</span>
        </div>
      `;
      
      // Create transcript area
      this.transcript = document.createElement('div');
      this.transcript.id = 'voice-transcript';
      this.transcript.className = 'transcript';
      
      // Create status indicator
      this.statusIndicator = document.createElement('div');
      this.statusIndicator.className = 'status-indicator';
      this.statusIndicator.textContent = 'Ready';
      
      // Create controls area
      const controls = document.createElement('div');
      controls.className = 'panel-controls';
      controls.innerHTML = `
        <button class="control-btn listen-btn" title="Start listening">
          <span class="btn-icon">🎙️</span>
          <span class="btn-label">Listen</span>
        </button>
        <button class="control-btn compose-btn" title="Type a message">
          <span class="btn-icon">⌨</span>
          <span class="btn-label">Type</span>
        </button>
        <button class="control-btn clear-btn" title="Clear chat">
          <span class="btn-icon">⟲</span>
          <span class="btn-label">Clear</span>
        </button>
        <button class="close-btn" aria-label="Close">✕</button>
      `;

      this.composer = document.createElement('form');
      this.composer.className = 'message-composer hidden';
      this.composer.innerHTML = `
        <input class="composer-input" type="text" autocomplete="off" placeholder="Type your message or details" aria-label="Type a message" />
        <button class="composer-send" type="submit" aria-label="Send message">➤</button>
      `;
      this.composerInput = this.composer.querySelector('.composer-input');
      this.composerToggleButton = controls.querySelector('.compose-btn');

      this.quickActions = document.createElement('div');
      this.quickActions.className = 'quick-actions hidden';
      this.quickActions.innerHTML = `
        <button class="quick-action-btn" data-slot="name" type="button">Edit name</button>
        <button class="quick-action-btn" data-slot="phone_number" type="button">Edit phone</button>
        <button class="quick-action-btn" data-slot="email" type="button">Edit email</button>
      `;

      this.reviewCard = document.createElement('div');
      this.reviewCard.className = 'review-card hidden';
      this.reviewCard.innerHTML = `
        <div class="review-card-head">
          <div>
            <span class="review-label">Review details</span>
            <p class="review-hint">Tap any field below to correct it before confirming.</p>
          </div>
          <button class="review-confirm-btn" type="button">Confirm</button>
        </div>
        <div class="review-card-fields"></div>
      `;
      this.reviewCardFields = this.reviewCard.querySelector('.review-card-fields');
      
      // Assemble panel
      panelSurface.appendChild(header);
      panelSurface.appendChild(this.statusIndicator);
      panelSurface.appendChild(this.transcript);
      panelSurface.appendChild(this.reviewCard);
      panelSurface.appendChild(this.composer);
      panelSurface.appendChild(this.quickActions);
      panelSurface.appendChild(controls);
      this.panel.appendChild(panelBackdrop);
      this.panel.appendChild(panelGridTexture);
      this.panel.appendChild(panelOrbLayer);
      this.panel.appendChild(panelSurface);
      
      // Assemble container
      this.container.appendChild(this.button);
      this.container.appendChild(this.panel);
      
      // Mount to DOM
      document.body.appendChild(this.container);
      
      this.log('UI created');
    }

    // ==================== Event Binding ====================
    bindEvents() {
      // Button toggle
      this.button.addEventListener('click', () => this.togglePanel());
      
      // Close button
      this.panel.querySelector('.close-btn').addEventListener('click', () => this.togglePanel());
      
      // Listen button
      this.panel.querySelector('.listen-btn').addEventListener('click', () => this.toggleListening());

      // Composer toggle
      this.composerToggleButton.addEventListener('click', () => this.toggleComposer());

      this.quickActions.addEventListener('click', (event) => {
        const button = event.target.closest('[data-slot]');
        if (!button) return;
        this.setActiveField(button.dataset.slot, 'quick-action');
      });

      this.reviewCard.addEventListener('click', (event) => {
        const editButton = event.target.closest('[data-slot]');
        if (editButton) {
          this.setActiveField(editButton.dataset.slot, 'review-edit');
          return;
        }

        if (event.target.closest('.review-confirm-btn')) {
          this.sendQuickConfirm();
        }
      });

      // Composer submit
      this.composer.addEventListener('submit', (event) => {
        event.preventDefault();
        this.submitTypedMessage();
      });

      this.composerInput.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') {
          this.toggleComposer(false);
        }
      });
      
      // Clear button
      this.panel.querySelector('.clear-btn').addEventListener('click', () => this.clearChat());
      
      // Interrupt speech when user speaks
      if (this.recognition) {
        this.recognition.addEventListener('start', () => {
          if (this.isSpeaking) {
            this.synthesis.cancel();
            this.isSpeaking = false;
          }
        });
      }
      
      this.log('Events bound');
    }

    // ==================== State Management ====================
    setState(newState) {
      if (this.state === newState) return;
      
      this.state = newState;
      this.updateUIState();
      
      // Update status indicator
      const statusMap = {
        [STATES.IDLE]: '✓ Ready',
        [STATES.LISTENING]: '🎤 Listening...',
        [STATES.PROCESSING]: '⚙️ Processing...',
        [STATES.SPEAKING]: '🔊 Speaking...',
        [STATES.ERROR]: '⚠️ Error'
      };
      
      this.statusIndicator.textContent = statusMap[newState] || 'Ready';
      this.statusIndicator.className = `status-indicator status-${newState}`;
    }

    updateUIState() {
      const listenBtn = this.panel.querySelector('.listen-btn');

      const applyListenButton = (icon, label, disabled) => {
        listenBtn.innerHTML = `<span class="btn-icon">${icon}</span><span class="btn-label">${label}</span>`;
        listenBtn.disabled = disabled;
      };
      
      switch (this.state) {
        case STATES.IDLE:
          applyListenButton('🎙️', 'Listen', false);
          break;
        case STATES.LISTENING:
          applyListenButton('⏹️', 'Stop', false);
          break;
        case STATES.PROCESSING:
        case STATES.SPEAKING:
          applyListenButton('⏳', 'Wait', true);
          break;
        case STATES.ERROR:
          applyListenButton('🎙️', 'Retry', false);
          break;
      }
    }

    // ==================== Panel Toggle ====================
    togglePanel() {
      this.panel.classList.toggle('hidden');
      this.button.classList.toggle('active');
      
      // Focus on open
      if (!this.panel.classList.contains('hidden')) {
        this.transcript.scrollTop = this.transcript.scrollHeight;
      }
    }

    // ==================== Listening Control ====================
    toggleListening() {
      if (this.state === STATES.LISTENING) {
        this.stopListening();
      } else if (this.state === STATES.IDLE) {
        this.toggleComposer(false);
        this.startListening();
      }
    }

    startListening() {
      try {
        this.inputMode = 'voice';
        this.recognition.start();
        this.isListening = true;
        this.setState(STATES.LISTENING);
      } catch (err) {
        this.log(`Failed to start listening: ${err.message}`, 'error');
        this.addSystemMessage('Failed to start microphone.');
        this.setState(STATES.ERROR);
      }
    }

    stopListening() {
      try {
        this.recognition.stop();
      } catch (err) {
        this.log(`Failed to stop listening: ${err.message}`, 'warn');
      }
      this.isListening = false;
      this.setState(STATES.IDLE);
    }

    toggleComposer(forceOpen) {
      const nextOpen = typeof forceOpen === 'boolean' ? forceOpen : !this.composerOpen;
      this.composerOpen = nextOpen;
      this.inputMode = nextOpen ? 'text' : this.inputMode;

      this.composer.classList.toggle('hidden', !nextOpen);
      this.composer.classList.toggle('open', nextOpen);
      this.composerToggleButton.classList.toggle('active', nextOpen);
      this.quickActions.classList.toggle('hidden', !nextOpen || !this.currentBookingState);

      if (nextOpen) {
        if (this.isListening) {
          this.stopListening();
        }
        setTimeout(() => {
          this.composerInput.focus();
        }, 50);
      } else {
        this.composerInput.blur();
      }
    }

    setActiveField(slotName, source = 'manual') {
      this.activeFieldHint = slotName;
      this.toggleComposer(true);
      const placeholderMap = {
        name: 'Type the full name',
        phone_number: 'Type the phone number',
        email: 'Type the email address',
        preferred_date: 'Type the preferred date',
        preferred_time: 'Type the preferred time'
      };

      const labelMap = {
        name: 'Name',
        phone_number: 'Phone',
        email: 'Email',
        preferred_date: 'Date',
        preferred_time: 'Time'
      };

      this.composerInput.placeholder = placeholderMap[slotName] || 'Type your message or details';
      this.composerToggleButton.classList.add('attention');
      this.quickActions.classList.remove('hidden');

      if (this.reviewCard && !this.reviewCard.classList.contains('hidden')) {
        const activeField = this.reviewCard.querySelector(`[data-slot="${slotName}"]`);
        if (activeField) activeField.classList.add('active');
      }

      if (source === 'review-edit') {
        this.composerInput.value = '';
      }

      return labelMap[slotName] || slotName;
    }

    renderReviewCard(state) {
      if (!state || state.stage !== 'confirming') {
        this.currentBookingState = null;
        this.reviewCard.classList.add('hidden');
        this.quickActions.classList.toggle('hidden', !this.composerOpen);
        return;
      }

      this.currentBookingState = state;
      const slots = state.slots || {};
      const fields = [
        { slot: 'name', label: 'Full name', value: slots.name || slots.full_name || 'Missing' },
        { slot: 'phone_number', label: 'Phone number', value: slots.phone_number || slots.phone || 'Missing' },
        { slot: 'email', label: 'Email address', value: slots.email || 'Missing' }
      ];

      this.reviewCardFields.innerHTML = fields.map(field => `
        <button class="review-field" type="button" data-slot="${field.slot}">
          <span class="review-field-label">${field.label}</span>
          <span class="review-field-value">${field.value}</span>
          <span class="review-field-edit">Edit</span>
        </button>
      `).join('');

      this.reviewCard.classList.remove('hidden');
      this.quickActions.classList.remove('hidden');
      this.composerToggleButton.classList.add('attention');
      this.composerInput.placeholder = 'Type a correction or confirm the review';
    }

    sendQuickConfirm() {
      this.addMessageToTranscript('yes', 'user', false);
      this.handleUserInput('yes', 'text');
    }

    submitTypedMessage() {
      const text = this.composerInput.value.trim();
      if (!text) return;

      this.composerInput.value = '';
      this.toggleComposer(false);
      this.addMessageToTranscript(text, 'user', false);
      const metadata = this.activeFieldHint ? { pending_slot: this.activeFieldHint, edit_field: this.activeFieldHint } : {};
      this.handleUserInput(text, 'text', metadata);
      this.activeFieldHint = null;
    }

    // ==================== User Input Handling ====================
    handleUserInput(message, source = 'voice', metadata = {}) {
      this.lastInputSource = source;
      this.inputMode = source === 'text' ? 'text' : 'voice';

      if (this.isListening) {
        this.stopListening();
      }
      
      if (!message.trim()) return;
      
      message = message.trim();
      
      // Add to conversation history
      this.conversationHistory.push({
        role: 'user',
        content: message,
        timestamp: Date.now()
      });
      
      // Maintain sliding window
      if (this.conversationHistory.length > MAX_CONVERSATION_HISTORY) {
        this.conversationHistory.shift();
      }
      
      // Process with API
      this.setState(STATES.PROCESSING);
      this.sendToBackend(message, source, metadata);
    }

    // ==================== Backend Communication ====================
    sendToBackend(message, source = 'voice', metadata = {}) {
      // Clear any pending API calls
      if (this.apiCallTimeout) {
        clearTimeout(this.apiCallTimeout);
      }
      
      this.apiCallTimeout = setTimeout(() => {
        const payload = {
          message: message,
          history: this.conversationHistory.slice(0, -1), // Exclude current message
          client_id: this.config.clientId,
          input_mode: source,
          metadata: {
            timestamp: Date.now(),
            session_id: this.session_id,
            source: source,
            ...metadata
          }
        };
        
        this.log(`Sending to backend: ${JSON.stringify(payload)}`);
        
        fetch(this.config.apiUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(payload)
        })
          .then(response => {
            if (!response.ok) {
              throw new Error(`HTTP ${response.status}`);
            }
            return response.json();
          })
          .then(data => {
            this.handleBackendResponse(data);
          })
          .catch(err => {
            this.log(`Backend error: ${err.message}`, 'error');
            this.addSystemMessage('Could not reach server. Please try again.');
            this.setState(STATES.IDLE);
          });
      }, DEBOUNCE_DELAY_API);
    }

    handleBackendResponse(data) {
      const reply = data.reply || 'No response received.';
      const state = data.state || data.actions?.state || null;
      this.renderReviewCard(state);
      this.updateBookingControls(state);

      const whatsappHandoff = data.actions?.whatsapp_handoff || null;
      if (whatsappHandoff && whatsappHandoff.url) {
        const stage = state?.stage || 'unknown';
        const handoffKey = `${whatsappHandoff.url}:${stage}`;
        if (this.lastHandoffKey !== handoffKey) {
          this.lastHandoffKey = handoffKey;
          this.addActionMessage('Continue on WhatsApp', whatsappHandoff.url);
        }
      }
      
      // Add assistant message to history
      this.conversationHistory.push({
        role: 'assistant',
        content: reply,
        timestamp: Date.now()
      });
      
      // Display response
      this.addMessageToTranscript(reply, 'assistant', false);
      
      // Speak response
      this.speakResponse(reply);
    }

    updateBookingControls(state) {
      const isDataCollection = Boolean(state && (state.stage === 'collecting_slots' || state.stage === 'confirming'));
      this.composerToggleButton.classList.toggle('attention', isDataCollection);
      this.quickActions.classList.toggle('hidden', !isDataCollection && !this.composerOpen);
      this.reviewCard.classList.toggle('hidden', !(state && state.stage === 'confirming'));
    }

    // ==================== Text-to-Speech ====================
    speakResponse(text) {
      // Cancel any existing speech
      this.synthesis.cancel();
      
      this.currentUtterance = new SpeechSynthesisUtterance(text);
      this.currentUtterance.lang = this.config.language;
      this.currentUtterance.rate = this.config.voiceRate || 1.18;
      this.currentUtterance.pitch = this.config.voicePitch || 1.03;
      this.currentUtterance.volume = this.config.voiceVolume || 1;
      
      const preferredVoice = this.selectPreferredVoice();
      
      if (preferredVoice) {
        this.currentUtterance.voice = preferredVoice;
        this.currentUtterance.lang = preferredVoice.lang || this.config.language;
      }
      
      // Events
      this.currentUtterance.onstart = () => {
        this.setState(STATES.SPEAKING);
        this.isSpeaking = true;
      };
      
      this.currentUtterance.onend = () => {
        this.isSpeaking = false;
        this.setState(STATES.IDLE);
        
        // Auto resume listening
        setTimeout(() => {
          if (this.lastInputSource === 'voice' && !this.composerOpen && !this.isListening && this.state === STATES.IDLE) {
            this.startListening();
          }
        }, 500);
      };
      
      this.currentUtterance.onerror = (event) => {
        this.log(`Speech synthesis error: ${event.error}`, 'error');
        this.setState(STATES.IDLE);
      };
      
      // Speak
      this.synthesis.speak(this.currentUtterance);
    }

    selectPreferredVoice() {
      const voices = this.synthesis.getVoices();
      const preferredNames = this.config.preferredVoiceNames || [];

      return (
        voices.find(v => preferredNames.some(name => v.name.includes(name))) ||
        voices.find(v => v.localService && v.lang && v.lang.includes(this.config.language)) ||
        voices.find(v => v.name && v.name.toLowerCase().includes('natural')) ||
        voices.find(v => v.lang && v.lang.includes(this.config.language)) ||
        voices.find(v => v.lang && v.lang.startsWith('en')) ||
        voices[0] ||
        null
      );
    }

    // ==================== Transcript Management ====================
    addMessageToTranscript(message, role, isInterim = false) {
      const messageEl = document.createElement('div');
      messageEl.className = `message message-${role} ${isInterim ? 'interim' : ''}`;
      
      const contentEl = document.createElement('div');
      contentEl.className = 'message-content';
      contentEl.textContent = message;
      
      messageEl.appendChild(contentEl);
      this.transcript.appendChild(messageEl);
      
      // Auto scroll
      setTimeout(() => {
        this.transcript.scrollTop = this.transcript.scrollHeight;
      }, 50);
    }

    addSystemMessage(message) {
      const messageEl = document.createElement('div');
      messageEl.className = 'message message-system';
      
      const contentEl = document.createElement('div');
      contentEl.className = 'message-content';
      contentEl.textContent = message;
      
      messageEl.appendChild(contentEl);
      this.transcript.appendChild(messageEl);
      
      this.transcript.scrollTop = this.transcript.scrollHeight;
    }

    addActionMessage(label, url) {
      const messageEl = document.createElement('div');
      messageEl.className = 'message message-system message-action';

      const contentEl = document.createElement('div');
      contentEl.className = 'message-content';

      const textEl = document.createElement('div');
      textEl.className = 'action-text';
      textEl.textContent = 'You can continue this conversation on WhatsApp.';

      const linkEl = document.createElement('a');
      linkEl.className = 'action-link';
      linkEl.href = url;
      linkEl.target = '_blank';
      linkEl.rel = 'noopener noreferrer';
      linkEl.textContent = label;

      contentEl.appendChild(textEl);
      contentEl.appendChild(linkEl);
      messageEl.appendChild(contentEl);
      this.transcript.appendChild(messageEl);

      this.transcript.scrollTop = this.transcript.scrollHeight;
    }

    updateTranscriptPreview(text) {
      // Remove previous preview
      const preview = this.transcript.querySelector('.message-preview');
      if (preview) preview.remove();
      
      // Add new preview
      const previewEl = document.createElement('div');
      previewEl.className = 'message message-preview';

      const contentEl = document.createElement('div');
      contentEl.className = 'message-content';
      contentEl.textContent = text;

      previewEl.appendChild(contentEl);
      this.transcript.appendChild(previewEl);
      
      this.transcript.scrollTop = this.transcript.scrollHeight;
    }

    clearChat() {
      this.conversationHistory = [];
      this.transcript.innerHTML = '';
      this.addSystemMessage('Chat cleared. Ready to listen.');
      this.setState(STATES.IDLE);
      this.toggleComposer(false);
    }

    // ==================== Utility Methods ====================
    generateSessionId() {
      return `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }

    log(message, level = 'info') {
      if (this.config.debug) {
        const prefix = `[VoiceAI] ${level.toUpperCase()}`;
        if (level === 'error') {
          console.error(prefix, message);
        } else if (level === 'warn') {
          console.warn(prefix, message);
        } else {
          console.log(prefix, message);
        }
      }
    }

    // ==================== Cleanup ====================
    destroy() {
      if (this.recognition) {
        this.recognition.stop();
      }
      this.synthesis.cancel();
      if (this.container) {
        this.container.remove();
      }
      this.log('Widget destroyed');
    }
  }

  // ==================== Inject Styles ====================
  VoiceAIWidget.prototype.injectStyles = function () {
    if (document.getElementById('voice-widget-styles')) {
      return; // Already injected
    }
    
    const style = document.createElement('style');
    style.id = 'voice-widget-styles';
    style.textContent = this.getStylesheet();
    document.head.appendChild(style);
  };

  VoiceAIWidget.prototype.getStylesheet = function () {
    return `
@import url('https://fonts.googleapis.com/css2?family=Manrope:wght@400;500;600;700;800&display=swap');

/* Voice AI Widget - Global */
#voice-ai-widget {
  --callora-bg: #f4f7f7;
  --callora-surface: rgba(255, 255, 255, 0.54);
  --callora-surface-strong: rgba(255, 255, 255, 0.74);
  --callora-text: #1d2a31;
  --callora-text-soft: #4e616d;
  --callora-primary: #0f8a8f;
  --callora-secondary: #1164a3;
  --callora-accent: #de5f83;
  --callora-outline: rgba(255, 255, 255, 0.66);
  --callora-shadow: 0 20px 45px rgba(16, 46, 61, 0.16);
  --callora-radius: 24px;
  font-family: 'Manrope', 'Avenir Next', 'Segoe UI', sans-serif;
  -webkit-font-smoothing: antialiased;
  text-rendering: optimizeLegibility;
}

/* Positioning */
.voice-widget.position-bottom-right {
  position: fixed;
  bottom: 20px;
  right: 20px;
  z-index: 999999;
}

.voice-widget.position-bottom-left {
  position: fixed;
  bottom: 20px;
  left: 20px;
  z-index: 999999;
}

/* Floating Button */
.voice-widget-button {
  width: 66px;
  height: 66px;
  border-radius: 50%;
  border: 1px solid rgba(255, 255, 255, 0.7);
  background: radial-gradient(circle at 20% 20%, #69d2d6 0%, #0f8a8f 45%, #1164a3 100%);
  color: white;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 12px 34px rgba(16, 69, 93, 0.4);
  transition: all 0.3s ease;
  font-size: 24px;
}

.voice-widget-button:hover {
  transform: translateY(-2px) scale(1.04);
  box-shadow: 0 16px 40px rgba(16, 69, 93, 0.46);
}

.voice-widget-button.active {
  background: radial-gradient(circle at 22% 16%, #f08aab 0%, #de5f83 44%, #1164a3 100%);
  box-shadow: 0 14px 36px rgba(107, 43, 79, 0.44);
}

.voice-widget-button .mic-icon {
  width: 30px;
  height: 30px;
}

/* Panel */
.voice-widget-panel {
  position: absolute;
  bottom: 88px;
  right: 0;
  width: min(420px, calc(100vw - 28px));
  height: min(640px, 78vh);
  background: var(--callora-bg);
  border-radius: var(--callora-radius);
  box-shadow: var(--callora-shadow);
  border: 1px solid rgba(255, 255, 255, 0.8);
  overflow: hidden;
  animation: slideUp 0.3s ease;
}

.voice-widget.position-bottom-left .voice-widget-panel {
  left: 0;
  right: auto;
}

.panel-backdrop,
.panel-grid-texture,
.panel-orb-layer,
.panel-surface {
  position: absolute;
  inset: 0;
}

.panel-backdrop {
  background: linear-gradient(164deg, rgba(232, 243, 245, 0.88), rgba(226, 236, 243, 0.76));
}

.panel-grid-texture {
  background-image: radial-gradient(circle at 1px 1px, rgba(64, 92, 108, 0.2) 1px, transparent 0);
  background-size: 30px 30px;
  opacity: 0.22;
  pointer-events: none;
}

.panel-orb-layer {
  pointer-events: none;
}

.orb {
  position: absolute;
  border-radius: 999px;
  filter: blur(44px);
  animation: orbFloat 8s ease-in-out infinite alternate;
}

.orb-primary {
  width: 210px;
  height: 210px;
  top: -48px;
  right: -72px;
  background: radial-gradient(circle at center, rgba(17, 138, 148, 0.58), rgba(17, 100, 163, 0.34));
}

.orb-secondary {
  width: 180px;
  height: 180px;
  left: -58px;
  bottom: -52px;
  animation-delay: -2s;
  background: radial-gradient(circle at center, rgba(222, 95, 131, 0.5), rgba(15, 138, 143, 0.2));
}

.panel-surface {
  z-index: 1;
  display: flex;
  flex-direction: column;
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.36), rgba(255, 255, 255, 0.26));
  backdrop-filter: blur(22px);
}

.voice-widget-panel.hidden {
  display: none;
}

@keyframes slideUp {
  from {
    opacity: 0;
    transform: translateY(10px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

/* Panel Header */
.panel-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  padding: 14px 16px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.55);
  background: var(--callora-surface);
  backdrop-filter: blur(18px);
}

.panel-title-wrap {
  display: flex;
  align-items: center;
  gap: 10px;
}

.spark-icon {
  width: 30px;
  height: 30px;
  border-radius: 999px;
  display: grid;
  place-items: center;
  color: #ffffff;
  background: linear-gradient(135deg, var(--callora-primary), var(--callora-secondary));
  box-shadow: 0 8px 16px rgba(16, 77, 105, 0.28);
}

.panel-title {
  display: flex;
  flex-direction: column;
  gap: 1px;
}

.assistant-name {
  font-weight: 600;
  font-size: 15px;
  color: var(--callora-text);
}

.assistant-subtitle {
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--callora-text-soft);
}

.brand-pill {
  margin-left: auto;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px 6px 6px;
  border-radius: 999px;
  background: var(--callora-surface-strong);
  border: 1px solid var(--callora-outline);
  box-shadow: 0 6px 16px rgba(42, 66, 78, 0.12);
}

.brand-mark {
  width: 24px;
  height: 24px;
  border-radius: 999px;
  display: grid;
  place-items: center;
  font-size: 10px;
  font-weight: 800;
  letter-spacing: 0.03em;
  color: #ffffff;
  background: linear-gradient(135deg, var(--callora-primary), var(--callora-accent));
}

.brand-name {
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--callora-text);
}

.close-btn {
  background: rgba(255, 255, 255, 0.74);
  border: 1px solid var(--callora-outline);
  color: var(--callora-text);
  font-size: 15px;
  font-weight: 700;
  cursor: pointer;
  padding: 0;
  width: 38px;
  height: 38px;
  border-radius: 999px;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: transform 0.2s ease;
}

.close-btn:hover {
  transform: scale(1.06);
}

/* Status Indicator */
.status-indicator {
  margin: 12px 16px 0;
  padding: 8px 12px;
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.6);
  border: 1px solid rgba(255, 255, 255, 0.7);
  font-size: 11px;
  font-weight: 600;
  color: var(--callora-text-soft);
  transition: all 0.3s ease;
}

.status-indicator.status-listening {
  background: rgba(17, 138, 143, 0.16);
  color: #0f6f73;
  animation: pulse 1.5s infinite;
}

@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.6; }
}

.status-indicator.status-processing {
  background: rgba(17, 100, 163, 0.12);
  color: #154f7a;
}

.status-indicator.status-speaking {
  background: rgba(222, 95, 131, 0.13);
  color: #8a3051;
}

.status-indicator.status-error {
  background: rgba(214, 57, 81, 0.18);
  color: #8f1f39;
}

/* Transcript */
.transcript {
  flex: 1;
  overflow-y: auto;
  padding: 14px 16px 10px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  background: transparent;
}

.message {
  display: flex;
  margin-bottom: 8px;
  animation: fadeIn 0.3s ease;
}

@keyframes fadeIn {
  from {
    opacity: 0;
    transform: translateY(5px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.message-user {
  justify-content: flex-end;
}

.message-user .message-content {
  background: linear-gradient(135deg, #0f8a8f, #1164a3);
  color: #f7fdff;
  border-radius: 16px 16px 4px 16px;
  box-shadow: 0 7px 18px rgba(17, 100, 163, 0.26);
}

.message-assistant {
  justify-content: flex-start;
}

.message-assistant .message-content {
  background: rgba(255, 255, 255, 0.7);
  color: var(--callora-text);
  border: 1px solid rgba(255, 255, 255, 0.7);
  border-radius: 16px 16px 16px 4px;
  box-shadow: 0 4px 16px rgba(40, 60, 71, 0.08);
}

.message-system {
  justify-content: center;
}

.message-system .message-content {
  background: rgba(255, 255, 255, 0.5);
  color: #60717a;
  font-size: 12px;
  border-radius: 10px;
}

.message-action .message-content {
  display: grid;
  gap: 8px;
  min-width: 220px;
  text-align: left;
}

.action-text {
  font-size: 12px;
  color: #4f626f;
}

.action-link {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 8px 10px;
  border-radius: 10px;
  background: linear-gradient(135deg, #26d366, #128c7e);
  color: #ffffff;
  text-decoration: none;
  font-size: 12px;
  font-weight: 700;
}

.action-link:hover {
  filter: brightness(1.03);
}

.message-preview {
  justify-content: flex-start;
  opacity: 0.7;
  font-style: italic;
}

.message-preview .message-content {
  background: rgba(255, 255, 255, 0.58);
  color: #5a6d78;
  border-radius: 14px 14px 14px 4px;
}

.message-content {
  max-width: 88%;
  padding: 10px 13px;
  word-wrap: break-word;
  font-size: 13px;
  line-height: 1.5;
}

/* Controls */
.panel-controls {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) minmax(0, 1fr) auto;
  gap: 8px;
  padding: 12px 16px 14px;
  background: var(--callora-surface);
  border-top: 1px solid rgba(255, 255, 255, 0.55);
  backdrop-filter: blur(14px);
}

.message-composer {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 12px 16px 0;
  padding: 10px;
  border-radius: 18px;
  background: rgba(255, 255, 255, 0.72);
  border: 1px solid rgba(255, 255, 255, 0.8);
  box-shadow: 0 10px 24px rgba(40, 60, 71, 0.1);
}

.message-composer.hidden {
  display: none;
}

.quick-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin: 10px 16px 12px;
}

.quick-actions.hidden {
  display: none;
}

.quick-action-btn {
  border: 1px solid rgba(255, 255, 255, 0.82);
  background: rgba(255, 255, 255, 0.66);
  color: var(--callora-text);
  border-radius: 999px;
  padding: 8px 12px;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.04em;
  cursor: pointer;
  transition: transform 0.2s ease, background 0.2s ease, border-color 0.2s ease;
}

.quick-action-btn:hover {
  transform: translateY(-1px);
  background: rgba(255, 255, 255, 0.9);
  border-color: rgba(255, 255, 255, 1);
}

.review-card {
  margin: 12px 16px 0;
  padding: 14px;
  border-radius: 18px;
  background: rgba(255, 255, 255, 0.76);
  border: 1px solid rgba(255, 255, 255, 0.82);
  box-shadow: 0 12px 28px rgba(40, 60, 71, 0.12);
}

.review-card.hidden {
  display: none;
}

.review-card-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 12px;
}

.review-label {
  display: inline-block;
  font-size: 11px;
  font-weight: 800;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--callora-primary);
}

.review-hint {
  margin: 4px 0 0;
  font-size: 12px;
  color: var(--callora-text-soft);
}

.review-confirm-btn {
  border: none;
  padding: 10px 14px;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 800;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: white;
  cursor: pointer;
  background: linear-gradient(135deg, var(--callora-primary), var(--callora-secondary));
  box-shadow: 0 10px 20px rgba(17, 100, 163, 0.22);
}

.review-card-fields {
  display: grid;
  gap: 8px;
}

.review-field {
  width: 100%;
  display: grid;
  grid-template-columns: auto 1fr auto;
  gap: 10px;
  align-items: center;
  padding: 11px 12px;
  border-radius: 14px;
  border: 1px solid rgba(15, 138, 143, 0.1);
  background: rgba(244, 247, 247, 0.86);
  color: var(--callora-text);
  cursor: pointer;
  text-align: left;
}

.review-field.active {
  border-color: rgba(15, 138, 143, 0.38);
  box-shadow: 0 0 0 3px rgba(15, 138, 143, 0.08);
}

.review-field-label {
  font-size: 11px;
  font-weight: 800;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--callora-text-soft);
}

.review-field-value {
  font-size: 13px;
  font-weight: 700;
  color: var(--callora-text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.review-field-edit {
  font-size: 11px;
  font-weight: 800;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--callora-primary);
}

.composer-input {
  flex: 1;
  min-width: 0;
  border: none;
  outline: none;
  background: transparent;
  color: var(--callora-text);
  font: inherit;
  font-size: 14px;
}

.composer-input::placeholder {
  color: rgba(78, 97, 109, 0.7);
}

.composer-send {
  width: 40px;
  height: 40px;
  border: none;
  border-radius: 999px;
  color: white;
  cursor: pointer;
  background: linear-gradient(135deg, var(--callora-primary), var(--callora-secondary));
  box-shadow: 0 10px 20px rgba(17, 100, 163, 0.24);
  transition: transform 0.2s ease, box-shadow 0.2s ease;
}

.composer-send:hover {
  transform: translateY(-1px);
  box-shadow: 0 12px 24px rgba(17, 100, 163, 0.3);
}

.compose-btn.active {
  background: rgba(15, 138, 143, 0.16);
  border-color: rgba(15, 138, 143, 0.35);
  color: var(--callora-primary);
}

.compose-btn.attention {
  background: linear-gradient(135deg, rgba(15, 138, 143, 0.16), rgba(17, 100, 163, 0.14));
  border-color: rgba(15, 138, 143, 0.34);
  animation: attentionPulse 1.6s ease-in-out infinite;
}

.control-btn {
  padding: 11px 12px;
  border: 1px solid rgba(255, 255, 255, 0.84);
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.72);
  color: var(--callora-text);
  cursor: pointer;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  transition: all 0.2s ease;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
}

.control-btn:hover:not(:disabled) {
  transform: translateY(-1px);
  background: rgba(255, 255, 255, 0.9);
  border-color: rgba(255, 255, 255, 0.95);
}

.control-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.btn-icon {
  font-size: 14px;
}

.btn-label {
  display: inline;
}

@media (min-width: 480px) {
  .btn-label {
    display: inline;
  }
}

/* Dark Theme */
.voice-widget.theme-dark {
  --callora-bg: #0d171b;
  --callora-surface: rgba(20, 31, 36, 0.62);
  --callora-surface-strong: rgba(26, 37, 43, 0.76);
  --callora-text: #e6f4fb;
  --callora-text-soft: #9fb7c4;
  --callora-outline: rgba(151, 191, 210, 0.23);
  --callora-shadow: 0 22px 50px rgba(0, 0, 0, 0.38);
}

.voice-widget.theme-dark .panel-grid-texture {
  opacity: 0.16;
}

.voice-widget.theme-dark .status-indicator,
.voice-widget.theme-dark .message-assistant .message-content,
.voice-widget.theme-dark .message-preview .message-content,
.voice-widget.theme-dark .message-system .message-content,
.voice-widget.theme-dark .control-btn,
.voice-widget.theme-dark .close-btn,
.voice-widget.theme-dark .brand-pill {
  border-color: rgba(138, 174, 192, 0.22);
}

.voice-widget.theme-dark .message-assistant .message-content,
.voice-widget.theme-dark .message-preview .message-content,
.voice-widget.theme-dark .message-system .message-content,
.voice-widget.theme-dark .status-indicator,
.voice-widget.theme-dark .control-btn,
.voice-widget.theme-dark .close-btn,
.voice-widget.theme-dark .brand-pill {
  background: rgba(20, 31, 36, 0.68);
}

.voice-widget.theme-dark .spark-icon,
.voice-widget.theme-dark .brand-mark {
  box-shadow: none;
}

.voice-widget.theme-dark .quick-action-btn,
.voice-widget.theme-dark .review-card,
.voice-widget.theme-dark .review-field,
.voice-widget.theme-dark .message-composer {
  background: rgba(20, 31, 36, 0.76);
  border-color: rgba(138, 174, 192, 0.22);
  color: var(--callora-text);
}

.voice-widget.theme-dark .review-field-value,
.voice-widget.theme-dark .review-field-label,
.voice-widget.theme-dark .review-hint {
  color: var(--callora-text-soft);
}

/* Mobile Responsive */
@media (max-width: 480px) {
  .voice-widget.position-bottom-right,
  .voice-widget.position-bottom-left {
    bottom: 8px;
  }

  .voice-widget.position-bottom-right {
    right: 8px;
    left: auto;
  }

  .voice-widget.position-bottom-left {
    left: 8px;
    right: auto;
  }

  .voice-widget-panel {
    width: min(420px, calc(100vw - 16px));
    height: min(74vh, 560px);
    bottom: 78px;
    right: 0;
    left: auto;
  }

  .voice-widget-button {
    width: 62px;
    height: 62px;
  }

  .brand-name {
    display: none;
  }

  .panel-controls {
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) minmax(0, 1fr) 40px;
  }

  .message-composer {
    margin: 10px 12px 0;
  }

  .quick-actions {
    margin: 8px 12px 12px;
  }
}

@keyframes orbFloat {
  from {
    transform: translate(0, 0) scale(1);
  }
  to {
    transform: translate(8px, -10px) scale(1.06);
  }
}

@keyframes attentionPulse {
  0%, 100% {
    transform: translateY(0);
    box-shadow: 0 0 0 0 rgba(15, 138, 143, 0.18);
  }
  50% {
    transform: translateY(-1px);
    box-shadow: 0 0 0 8px rgba(15, 138, 143, 0.06);
  }
}

/* Scrollbar */
.transcript::-webkit-scrollbar {
  width: 6px;
}

.transcript::-webkit-scrollbar-track {
  background: transparent;
}

.transcript::-webkit-scrollbar-thumb {
  background: rgba(44, 95, 123, 0.35);
  border-radius: 3px;
}

.transcript::-webkit-scrollbar-thumb:hover {
  background: rgba(44, 95, 123, 0.55);
}
    `;
  };

  // ==================== Auto Initialization ====================
  function initializeWidget() {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => {
        window.voiceAIWidget = new VoiceAIWidget();
      });
    } else {
      window.voiceAIWidget = new VoiceAIWidget();
    }
  }

  // Initialize when script loads
  initializeWidget();

  // Export for manual initialization if needed
  window.VoiceAIWidget = VoiceAIWidget;

})();
