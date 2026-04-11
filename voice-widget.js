
(function () {
  'use strict';

  // ==================== Configuration ====================
  const DEFAULT_CONFIG = {
    clientId: 'default_client',
    apiUrl: 'http://localhost:3000/api/voice-agent',
    position: 'bottom-right',
    theme: 'auto',  // 'light' | 'dark' | 'auto'
    autoStart: false,
    language: 'en-IN',
    voiceRate: 1.18,
    voicePitch: 1.03,
    voiceVolume: 1,
    preferredVoiceNames: ['Google UK English Female', 'Microsoft Neerja Online (Natural) - English (India)', 'Microsoft Aria Online (Natural) - English (United States)'],
    assistantName: 'Voice Assistant',
    assistantSubtitle: 'AI Concierge',
    greeting: '',
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

      this.originalThemeConfig = this.config.theme;
      // Resolve theme
      if (this.config.theme === 'auto') {
        const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
        this.config.theme = mediaQuery.matches ? 'dark' : 'light';
        
        // 4.5 - Auto-toggle when OS changes
        mediaQuery.addEventListener('change', e => {
          if (this.originalThemeConfig === 'auto') {
            this.config.theme = e.matches ? 'dark' : 'light';
            if (this.container) {
              this.container.className = `voice-widget theme-${this.config.theme} position-${this.config.position}`;
            }
          }
        });
      }

      // Detect iOS (needs special TTS handling)
      this.isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
      
      // 4.3 - iOS disables autoplay by default to respect browser rules
      if (this.isIOS && this.config.voiceAutoplay !== false) {
        this.config.voiceAutoplay = false;
      } else if (this.config.voiceAutoplay === undefined) {
        this.config.voiceAutoplay = true;
      }
      // Text-only mode flag (set when voice not supported)
      this.voiceOnlyFailed = false;
      // Whether we already showed the greeting
      this.greetingShown = false;
      // Whether server config has been loaded
      this.serverConfigLoaded = false;
      // Server config cache
      this.serverConfig = null;

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
      this.messageList = null;
      this.statusIndicator = null;
      this.composer = null;
      this.composerInput = null;
      this.composerToggleButton = null;
      this.quickActions = null;
      this.reviewCard = null;
      this.reviewCardFields = null;
      this.reviewConfirmButton = null;
      this.fieldAssist = null;
      this.fieldAssistLabel = null;
      this.fieldAssistBody = null;
      this.currentBookingState = null;
      this.activeFieldHint = null;
      this.lastHandoffKey = null;
      this.lastSessionActionKey = null;

      // Debounce helpers
      this.apiCallTimeout = null;

      this.init();
    }

    // ==================== Initialization ====================
    init() {
      this.log('Initializing Voice AI Widget...');

      const voiceSupported = this.checkBrowserSupport();

      if (!voiceSupported) {
        this.log('Voice APIs not supported — switching to text-only mode', 'warn');
        this.voiceOnlyFailed = true;
      } else {
        this.setupSpeechRecognition();
      }

      // Inject styles
      this.injectStyles();

      // Create UI
      this.createUI();

      // Bind events
      this.bindEvents();

      // Fetch server config (async, non-blocking — updates UI when done)
      this.fetchServerConfig().then(() => {
        this._applyServerConfig();
      });

      // Text-only fallback setup
      if (this.voiceOnlyFailed) {
        this.initTextOnlyMode();
      }

      this.log('Voice AI Widget initialized successfully');
    }

    // ==================== Browser Support Check ====================
    checkBrowserSupport() {
      const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
      const hasRecognition = !!SpeechRecognition;
      const hasSynthesis = !!window.speechSynthesis;

      this.log(`Speech Recognition: ${hasRecognition ? 'supported' : 'NOT supported'}`);
      this.log(`Speech Synthesis: ${hasSynthesis ? 'supported' : 'NOT supported'}`);

      // Both must be available for full voice mode
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
          this.voiceOnlyFailed = true; // 4.4 - Hard degrade to text-only mode
          this.initTextOnlyMode();
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
      
      // Create panel header — use dynamic names from config
      const header = document.createElement('div');
      header.className = 'panel-header';
      const assistantName = this.config.assistantName || 'Voice Assistant';
      const assistantSubtitle = this.config.assistantSubtitle || (this.voiceOnlyFailed ? 'Text Concierge' : 'Voice Concierge');
      const initials = assistantName.split(' ').map(w => w[0]).join('').substring(0, 2).toUpperCase() || 'AI';
      header.innerHTML = `
        <div class="panel-title-wrap">
          <div class="spark-icon" aria-hidden="true">✦</div>
          <div class="panel-title">
            <span class="assistant-name" id="voice-assistant-name">${assistantName}</span>
            <span class="assistant-subtitle" id="voice-assistant-subtitle">${assistantSubtitle}</span>
          </div>
        </div>
        <div class="brand-pill" aria-label="Callora AI">
          <span class="brand-mark" id="voice-brand-mark">${initials}</span>
          <span class="brand-name">Callora AI</span>
        </div>
      `;
      
      // Create transcript area
      this.transcript = document.createElement('div');
      this.transcript.id = 'voice-transcript';
      this.transcript.className = 'transcript';
      this.transcript.setAttribute('aria-live', 'polite');

      this.messageList = document.createElement('div');
      this.messageList.className = 'transcript-messages';
      this.transcript.appendChild(this.messageList);
      
      // Create status indicator
      this.statusIndicator = document.createElement('div');
      this.statusIndicator.className = 'status-indicator';
      this.statusIndicator.textContent = 'Ready';
      this.statusIndicator.setAttribute('aria-live', 'polite');
      
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
      this.reviewConfirmButton = this.reviewCard.querySelector('.review-confirm-btn');

      this.fieldAssist = document.createElement('div');
      this.fieldAssist.className = 'field-assist hidden';
      this.fieldAssist.innerHTML = `
        <div class="field-assist-label"></div>
        <div class="field-assist-body"></div>
      `;
      this.fieldAssistLabel = this.fieldAssist.querySelector('.field-assist-label');
      this.fieldAssistBody = this.fieldAssist.querySelector('.field-assist-body');

      this.transcript.appendChild(this.reviewCard);
      this.transcript.appendChild(this.fieldAssist);
      
      // Assemble panel
      panelSurface.appendChild(header);
      panelSurface.appendChild(this.statusIndicator);
      panelSurface.appendChild(this.transcript);
      panelSurface.appendChild(this.composer);
      panelSurface.appendChild(this.quickActions);
      panelSurface.appendChild(controls);
      this.panel.appendChild(panelBackdrop);
      this.panel.appendChild(panelGridTexture);
      this.panel.appendChild(panelOrbLayer);
      this.panel.appendChild(panelSurface);
      
      // Create tooltip
      this.tooltip = document.createElement('div');
      this.tooltip.className = 'voice-widget-tooltip';
      this.tooltip.innerHTML = `
        <div class="tooltip-content">
          <div class="tooltip-avatar">
            <div class="tooltip-orb"></div>
          </div>
          <div class="tooltip-text-wrap">
            <span class="tooltip-greeting">Hi there ✨</span>
            <span class="tooltip-text">Need help? Talk to me!</span>
          </div>
          <button class="tooltip-close" aria-label="Dismiss" type="button">✕</button>
        </div>
      `;
      
      // Assemble container
      this.container.appendChild(this.tooltip);
      this.container.appendChild(this.button);
      this.container.appendChild(this.panel);
      
      // Mount to DOM
      document.body.appendChild(this.container);

      // Track the orb for reactivity
      this.orbPrimary = this.panel.querySelector('.orb-primary');
      
      this.log('UI created');
    }

    // ==================== Event Binding ====================
    bindEvents() {
      // Button toggle
      this.button.addEventListener('click', () => this.togglePanel());
      
      // Tooltip events
      if (this.tooltip) {
        this.tooltip.addEventListener('click', (e) => {
          if (!e.target.closest('.tooltip-close')) {
            this.togglePanel();
          }
        });
        
        const closeTooltipBtn = this.tooltip.querySelector('.tooltip-close');
        if (closeTooltipBtn) {
          closeTooltipBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.tooltip.classList.add('hidden');
          });
        }
      }
      
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

      this.transcript.addEventListener('wheel', (event) => {
        if (this.panel.classList.contains('hidden')) return;
        const canScroll = this.transcript.scrollHeight > this.transcript.clientHeight;
        if (!canScroll) return;
        event.preventDefault();
        this.transcript.scrollTop += event.deltaY;
      }, { passive: false });

      this.fieldAssist.addEventListener('click', (event) => {
        const chip = event.target.closest('[data-field-value]');
        if (!chip) return;
        const slot = chip.dataset.slot;
        const value = chip.dataset.fieldValue;
        if (!slot || !value) return;
        this.submitStructuredField(slot, value);
      });

      this.fieldAssist.addEventListener('change', (event) => {
        const input = event.target.closest('[data-field-input]');
        if (!input || !input.value) return;
        this.submitStructuredField(input.dataset.slot, input.value);
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

      // Orb animation
      if (this.orbPrimary) {
        if (newState === STATES.LISTENING) {
          this.orbPrimary.classList.add('listening');
        } else {
          this.orbPrimary.classList.remove('listening');
        }
      }
    }

    updateUIState() {
      const listenBtn = this.panel.querySelector('.listen-btn');

      const applyListenButton = (icon, label, disabled) => {
        listenBtn.innerHTML = `<span class="btn-icon">${icon}</span><span class="btn-label">${label}</span>`;
        listenBtn.disabled = disabled;
      };
      
      if (this.voiceOnlyFailed) {
        applyListenButton('🚫', 'Disabled', true);
        listenBtn.title = 'Microphone access is blocked or unavailable in your browser.';
        return;
      }
      
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

      // Hide tooltip when panel is toggled
      if (this.tooltip && !this.panel.classList.contains('hidden')) {
        this.tooltip.classList.add('hidden');
      }

      // On open
      if (!this.panel.classList.contains('hidden')) {
        this.transcript.scrollTop = this.transcript.scrollHeight;
        // Show greeting on first open (GAP-19)
        setTimeout(() => this.showGreetingOnOpen(), 350);
      } else {
        // Panel closed — stop listening / speaking
        if (this.isListening) this.stopListening();
        if (this.isSpeaking) this.synthesis.cancel();
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
      this.renderFieldAssist(this.currentBookingState);

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
      const slotOrder = ['name', 'phone_number', 'email', 'service_type', 'preferred_date', 'preferred_time'];
      const labelMap = {
        name: 'Full name',
        phone_number: 'Phone number',
        email: 'Email address',
        service_type: 'Service',
        preferred_date: 'Preferred date',
        preferred_time: 'Preferred time'
      };
      const valueMap = {
        name: slots.name || slots.full_name,
        phone_number: slots.phone_number || slots.phone,
        email: slots.email,
        service_type: slots.service_type || slots.service_requested,
        preferred_date: slots.preferred_date,
        preferred_time: slots.preferred_time
      };
      const fields = slotOrder
        .filter(slot => valueMap[slot] || (state.required_slots || []).includes(slot))
        .map(slot => ({
          slot,
          label: labelMap[slot] || slot,
          value: valueMap[slot] || 'Missing'
        }));

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

    renderFieldAssist(state) {
      const isBookingActive = Boolean(state && (state.stage === 'collecting_slots' || state.stage === 'confirming'));
      if (!isBookingActive) {
        this.fieldAssist.classList.add('hidden');
        this.fieldAssistBody.innerHTML = '';
        return;
      }

      const slot = state?.stage === 'collecting_slots'
        ? (state?.pending_slot || this.activeFieldHint || null)
        : (this.activeFieldHint || state?.pending_slot || null);
      if (!slot || !['preferred_date', 'preferred_time'].includes(slot)) {
        this.fieldAssist.classList.add('hidden');
        this.fieldAssistBody.innerHTML = '';
        return;
      }

      if (slot === 'preferred_date') {
        const today = new Date();
        const nextWeek = new Date(today);
        nextWeek.setDate(today.getDate() + 7);
        this.fieldAssistLabel.textContent = 'Pick a preferred date';
        this.fieldAssistBody.innerHTML = `
          <input class="field-assist-input" type="date" data-field-input="true" data-slot="preferred_date" min="${this.formatDateForInput(today)}" />
          <div class="field-assist-chips">
            <button class="field-assist-chip" type="button" data-slot="preferred_date" data-field-value="today">Today</button>
            <button class="field-assist-chip" type="button" data-slot="preferred_date" data-field-value="tomorrow">Tomorrow</button>
            <button class="field-assist-chip" type="button" data-slot="preferred_date" data-field-value="${this.formatDateForInput(nextWeek)}">Next week</button>
          </div>
        `;
      } else {
        this.fieldAssistLabel.textContent = 'Pick a preferred time';
        this.fieldAssistBody.innerHTML = `
          <input class="field-assist-input" type="time" data-field-input="true" data-slot="preferred_time" step="900" />
          <div class="field-assist-chips">
            <button class="field-assist-chip" type="button" data-slot="preferred_time" data-field-value="morning">Morning</button>
            <button class="field-assist-chip" type="button" data-slot="preferred_time" data-field-value="afternoon">Afternoon</button>
            <button class="field-assist-chip" type="button" data-slot="preferred_time" data-field-value="evening">Evening</button>
          </div>
        `;
      }

      this.fieldAssist.classList.remove('hidden');
    }

    formatDateForInput(date) {
      const year = date.getFullYear();
      const month = String(date.getMonth() + 1).padStart(2, '0');
      const day = String(date.getDate()).padStart(2, '0');
      return `${year}-${month}-${day}`;
    }

    submitStructuredField(slot, value) {
      if (!slot || !value) return;
      this.activeFieldHint = slot;
      this.addMessageToTranscript(value, 'user', false);
      this.handleUserInput(value, 'text', { pending_slot: slot, edit_field: slot });
      this.activeFieldHint = null;
      this.toggleComposer(false);
    }

    setReviewConfirmLoading(isLoading) {
      if (!this.reviewConfirmButton) return;
      this.reviewConfirmButton.disabled = isLoading;
      this.reviewConfirmButton.textContent = isLoading ? 'Confirming...' : 'Confirm';
    }

    sendQuickConfirm() {
      if (this.isProcessing) return;
      this.activeFieldHint = null;
      this.setReviewConfirmLoading(true);
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
      // Show typing indicator while waiting (GAP-18)
      this.showTypingIndicator();
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
            this.removeTypingIndicator();
            this.setReviewConfirmLoading(false);
            this.log(`Backend error: ${err.message}`, 'error');
            this.addSystemMessage('Could not reach server. Please check your connection and try again.');
            this.setState(STATES.IDLE);
          });
      }, DEBOUNCE_DELAY_API);
    }

    handleBackendResponse(data) {
      // Remove typing indicator (GAP-18)
      this.removeTypingIndicator();

      const reply = data.reply || 'No response received.';
      const state = data.state || data.actions?.state || null;
      if (state?.stage === 'collecting_slots') {
        this.activeFieldHint = state.pending_slot || null;
      } else if (!state || state.stage !== 'confirming') {
        this.activeFieldHint = null;
      }
      this.renderReviewCard(state);
      this.renderFieldAssist(state);
      this.updateBookingControls(state);
      this.setReviewConfirmLoading(false);

      const whatsappHandoff = data.actions?.whatsapp_handoff || null;
      if (whatsappHandoff && whatsappHandoff.url) {
        const stage = state?.stage || 'unknown';
        const handoffKey = `${whatsappHandoff.url}:${stage}`;
        if (this.lastHandoffKey !== handoffKey) {
          this.lastHandoffKey = handoffKey;
          this.addActionMessage('Continue on WhatsApp', whatsappHandoff.url);
        }
      }

      if (data.actions?.start_new_chat) {
        const actionKey = `${data.session_id || this.session_id}:${data.actions?.idle_timeout_minutes || 'timeout'}`;
        if (this.lastSessionActionKey !== actionKey) {
          this.lastSessionActionKey = actionKey;
          this.addSessionControlMessage('Start New Chat', () => this.startNewChatSession());
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

      // Speak (guard for text-only / iOS)
      if (!this.voiceOnlyFailed && this.config.voiceAutoplay) {
        this.speakResponse(reply);
      } else if (!this.voiceOnlyFailed && !this.config.voiceAutoplay && this.isIOS && this.lastInputSource === 'voice') {
        // iOS requires user gesture to speak — show tap button
        this.showTapToSpeakButton(reply);
      } else {
        // Text-only mode — just go back to idle
        this.setState(STATES.IDLE);
      }
    }

    updateBookingControls(state) {
      const isDataCollection = Boolean(state && (state.stage === 'collecting_slots' || state.stage === 'confirming'));
      this.composerToggleButton.classList.toggle('attention', isDataCollection);
      this.quickActions.classList.toggle('hidden', !isDataCollection && !this.composerOpen);
      this.reviewCard.classList.toggle('hidden', !(state && state.stage === 'confirming'));
      this.renderFieldAssist(state);
    }

    // ==================== Text-to-Speech ====================
    speakResponse(text) {
      // Guard: never call synthesis in text-only mode
      if (this.voiceOnlyFailed || !this.synthesis) {
        this.setState(STATES.IDLE);
        return;
      }
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
      this.messageList.appendChild(messageEl);
      
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
      this.messageList.appendChild(messageEl);
      
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
      this.messageList.appendChild(messageEl);

      this.transcript.scrollTop = this.transcript.scrollHeight;
    }

    updateTranscriptPreview(text) {
      // Remove previous preview
      const preview = this.messageList.querySelector('.message-preview');
      if (preview) preview.remove();
      
      // Add new preview
      const previewEl = document.createElement('div');
      previewEl.className = 'message message-preview';

      const contentEl = document.createElement('div');
      contentEl.className = 'message-content';
      contentEl.textContent = text;

      previewEl.appendChild(contentEl);
      this.messageList.appendChild(previewEl);
      
      this.transcript.scrollTop = this.transcript.scrollHeight;
    }

    clearChat() {
      this.conversationHistory = [];
      this.currentBookingState = null;
      this.activeFieldHint = null;
      this.lastHandoffKey = null;
      this.lastSessionActionKey = null;
      this.messageList.innerHTML = '';
      this.reviewCard.classList.add('hidden');
      this.fieldAssist.classList.add('hidden');
      this.addSystemMessage('Chat cleared. Ready to listen.');
      this.setState(STATES.IDLE);
      this.toggleComposer(false);
    }

    startNewChatSession() {
      this.clearChat();
      this.session_id = this.generateSessionId();
      this.greetingShown = false;
      this.addSystemMessage('Started a new chat. How can I help you today?');
    }

    addSessionControlMessage(label, onClick) {
      const messageEl = document.createElement('div');
      messageEl.className = 'message message-system message-action';

      const contentEl = document.createElement('div');
      contentEl.className = 'message-content';

      const textEl = document.createElement('div');
      textEl.className = 'action-text';
      textEl.textContent = 'Session timed out due to inactivity.';

      const actionBtn = document.createElement('button');
      actionBtn.className = 'action-button';
      actionBtn.type = 'button';
      actionBtn.textContent = label;
      actionBtn.addEventListener('click', onClick);

      contentEl.appendChild(textEl);
      contentEl.appendChild(actionBtn);
      messageEl.appendChild(contentEl);
      this.messageList.appendChild(messageEl);
      this.transcript.scrollTop = this.transcript.scrollHeight;
    }

    // ==================== Utility Methods ====================
    generateSessionId() {
      return `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }

    log(message, level = 'info') {
      if (this.config.debug) {
        const prefix = `[VoiceAI] ${level.toUpperCase()}`;
        if (level === 'error') console.error(prefix, message);
        else if (level === 'warn') console.warn(prefix, message);
        else console.log(prefix, message);
      }
    }

    // ==================== Server Config Fetch (GAP-17) ====================
    async fetchServerConfig() {
      try {
        const cacheKey = `voice_cfg_${this.config.clientId}`;
        const cached = sessionStorage.getItem(cacheKey); // sessionStorage = per-tab, auto-clears
        if (cached) {
          const { data, ts } = JSON.parse(cached);
          if (Date.now() - ts < 3600000) { // 1 hour TTL
            this.serverConfig = data;
            return;
          }
        }
        const baseUrl = this.config.apiUrl.replace('/api/voice-agent', '');
        const resp = await fetch(`${baseUrl}/api/configs/${encodeURIComponent(this.config.clientId)}`);
        if (resp.ok) {
          const data = await resp.json();
          this.serverConfig = data;
          sessionStorage.setItem(cacheKey, JSON.stringify({ data, ts: Date.now() }));
          this.log('Server config loaded');
        }
      } catch (e) {
        this.log(`Server config fetch failed (non-fatal): ${e.message}`, 'warn');
      }
    }

    _applyServerConfig() {
      const cfg = this.serverConfig;
      if (!cfg) return;

      // Update assistant name in header
      const name = cfg.assistant?.name;
      const nameEl = document.getElementById('voice-assistant-name');
      if (name && nameEl) {
        nameEl.textContent = name;
        this.config.assistantName = name;
        // Update brand mark initials
        const markEl = document.getElementById('voice-brand-mark');
        if (markEl) markEl.textContent = name.split(' ').map(w => w[0]).join('').substring(0, 2).toUpperCase();
      }

      // Apply theme colors from server config
      const primary = cfg.ui?.color_scheme?.primary;
      const secondary = cfg.ui?.color_scheme?.secondary;
      const accent = cfg.ui?.color_scheme?.accent;
      const widget = document.getElementById('voice-ai-widget');
      if (widget) {
        if (primary) widget.style.setProperty('--callora-primary', primary);
        if (secondary) widget.style.setProperty('--callora-secondary', secondary);
        if (accent) widget.style.setProperty('--callora-accent', accent);
      }

      // Cache greeting for use when panel opens
      if (cfg.conversation?.greeting) {
        this.config.greeting = cfg.conversation.greeting;
      }

      this.serverConfigLoaded = true;

      // Trigger scroll-based engagement once config applies
      if (this.config.autoStart || cfg.features?.enable_proactive_greeting) {
        this.setupProactiveEngagement();
      }
    }

    // ==================== Typing Indicator (GAP-18) ====================
    showTypingIndicator() {
      this.removeTypingIndicator(); // remove if already exists
      const el = document.createElement('div');
      el.id = 'voice-typing-indicator';
      el.className = 'message message-assistant';
      el.setAttribute('aria-label', 'Assistant is typing');
      el.innerHTML = '<div class="message-content typing-indicator-dots"><span></span><span></span><span></span></div>';
      this.messageList.appendChild(el);
      this.transcript.scrollTop = this.transcript.scrollHeight;
    }

    removeTypingIndicator() {
      const el = document.getElementById('voice-typing-indicator');
      if (el) el.remove();
    }

    // ==================== Text-Only Fallback (GAP-05) ====================
    initTextOnlyMode() {
      this.log('Initializing text-only mode');
      // Auto-open composer
      if (this.composer) {
        this.composer.classList.remove('hidden');
        this.composerOpen = true;
      }
      // Visually disable the listen button gracefully
      const listenBtn = this.panel.querySelector('.listen-btn');
      if (listenBtn) {
        listenBtn.innerHTML = `<span class="btn-icon">🚫</span><span class="btn-label">Disabled</span>`;
        listenBtn.disabled = true;
        listenBtn.title = 'Microphone access is blocked or unavailable in your browser.';
      }
      // Show info message
      setTimeout(() => {
        this.addSystemMessage('Voice input is not supported in this browser. Type your message below — everything else works perfectly!');
      }, 300);
    }

    // ==================== iOS Tap-to-Speak Button (GAP-05) ====================
    showTapToSpeakButton(text) {
      const el = document.createElement('div');
      el.className = 'message message-assistant tap-to-speak';
      el.innerHTML = `
        <div class="message-content tap-to-speak-content">
          <span class="tap-to-speak-text">${text}</span>
          <button class="tap-speak-btn" title="Tap to hear reply">🔊 Tap to hear</button>
        </div>
      `;
      el.querySelector('.tap-speak-btn').addEventListener('click', () => {
        this.config.voiceAutoplay = true; // Unlock autoplay natively for the rest of the session
        this.speakResponse(text);
        el.querySelector('.tap-speak-btn').remove();
      });
      this.messageList.appendChild(el);
      this.transcript.scrollTop = this.transcript.scrollHeight;
    }

    // ==================== Greeting on Open (GAP-19) ====================
    showGreetingOnOpen() {
      if (this.greetingShown || this.conversationHistory.length > 0) return;

      const greeting = this.config.greeting
        || this.serverConfig?.conversation?.greeting
        || null;

      if (!greeting) return;

      this.greetingShown = true;
      this.addMessageToTranscript(greeting, 'assistant', false);
      if (!this.voiceOnlyFailed && this.config.voiceAutoplay) {
        this.speakResponse(greeting);
      } else if (!this.voiceOnlyFailed && !this.config.voiceAutoplay && this.isIOS) {
        this.showTapToSpeakButton(greeting);
      }
    }

    // ==================== Proactive Engagement (GAP-19) ====================
    setupProactiveEngagement() {
      // Create intersection observer
      const observer = new IntersectionObserver((entries) => {
        if (entries[0].isIntersecting) return; // Top is visible, don't trigger yet
        
        // Scrolled down, trigger proactive engagement
        setTimeout(() => {
          if (!this.panel.classList.contains('hidden') || this.conversationHistory.length > 0) return; // Already open/used
          
          this.togglePanel(); // Open it
          
          const fallbackGreeting = "Hi there! I can help you easily find what you're looking for.";
          const greeting = this.serverConfig?.conversation?.proactive_greeting 
            || this.config.proactiveGreeting 
            || fallbackGreeting;

          // Prevent duplication
          this.greetingShown = true;
          this.addMessageToTranscript(greeting, 'assistant', false);
          if (!this.voiceOnlyFailed && this.config.voiceAutoplay) {
            this.speakResponse(greeting);
          } else if (!this.voiceOnlyFailed && !this.config.voiceAutoplay && this.isIOS) {
            this.showTapToSpeakButton(greeting);
          }
        }, 1500);
        observer.disconnect(); // Fire only once
      }, { threshold: [0] });

      // Observe the body or top header
      const topTrigger = document.querySelector('header') || document.body;
      if (topTrigger) {
        observer.observe(topTrigger);
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

/* Tooltip */
.voice-widget-tooltip {
  position: absolute;
  bottom: 80px;
  right: 0;
  width: max-content;
  background: rgba(255, 255, 255, 0.85);
  backdrop-filter: blur(16px);
  border: 1px solid rgba(255, 255, 255, 0.6);
  padding: 10px 14px 10px 10px;
  border-radius: 20px 20px 0 20px;
  box-shadow: 0 12px 30px rgba(16, 46, 61, 0.15);
  font-family: inherit;
  display: flex;
  align-items: center;
  gap: 12px;
  opacity: 1;
  transform: translateY(0);
  transition: all 0.4s cubic-bezier(0.34, 1.56, 0.64, 1);
  animation: floatTooltip 3s ease-in-out infinite;
  z-index: 10;
  cursor: pointer;
}

.voice-widget.theme-dark .voice-widget-tooltip {
  background: rgba(20, 31, 36, 0.85);
  border-color: rgba(138, 174, 192, 0.22);
  box-shadow: 0 12px 30px rgba(0, 0, 0, 0.4);
}

.voice-widget.position-bottom-left .voice-widget-tooltip {
  right: auto;
  left: 0;
  border-radius: 20px 20px 20px 0;
}

.voice-widget-tooltip:hover {
  transform: translateY(-2px) scale(1.02);
  animation-play-state: paused;
}

.voice-widget-tooltip.hidden {
  opacity: 0;
  transform: translateY(15px) scale(0.9);
  pointer-events: none;
}

.tooltip-content {
  display: flex;
  align-items: center;
  gap: 10px;
}

.tooltip-avatar {
  width: 36px;
  height: 36px;
  border-radius: 50%;
  background: var(--callora-surface-strong);
  border: 1px solid var(--callora-outline);
  display: grid;
  place-items: center;
  position: relative;
  overflow: hidden;
}

.tooltip-orb {
  width: 100%;
  height: 100%;
  background: radial-gradient(circle at 30% 30%, var(--callora-primary), var(--callora-secondary));
  border-radius: 50%;
  animation: pulseOrb 2s alternate infinite ease-in-out;
}

@keyframes pulseOrb {
  0% { transform: scale(0.85); filter: brightness(1) blur(2px); }
  100% { transform: scale(1.1); filter: brightness(1.2) blur(4px); }
}

.tooltip-text-wrap {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.tooltip-greeting {
  font-size: 11px;
  font-weight: 800;
  color: var(--callora-primary);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.voice-widget.theme-dark .tooltip-greeting {
  color: #69d2d6;
}

.tooltip-text {
  font-size: 13px;
  font-weight: 600;
  color: var(--callora-text);
  white-space: nowrap;
}

.tooltip-close {
  background: none;
  border: none;
  color: var(--callora-text-soft);
  font-size: 12px;
  cursor: pointer;
  padding: 4px;
  margin-left: 4px;
  border-radius: 50%;
  display: grid;
  place-items: center;
  transition: background 0.2s, color 0.2s;
}

.tooltip-close:hover {
  background: rgba(0,0,0,0.05);
  color: var(--callora-text);
}

.voice-widget.theme-dark .tooltip-close:hover {
  background: rgba(255,255,255,0.1);
}

@keyframes floatTooltip {
  0%, 100% { transform: translateY(0); }
  50% { transform: translateY(-5px); }
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

.orb-primary.listening {
  animation: orbPulse 0.8s ease-in-out infinite alternate;
}

@keyframes orbPulse {
  from { transform: scale(1); filter: blur(44px) brightness(1); }
  to   { transform: scale(1.18); filter: blur(36px) brightness(1.2); }
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
  min-height: 0;
  overflow-y: auto;
  padding: 14px 16px 10px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  background: transparent;
  overscroll-behavior: contain;
  -webkit-overflow-scrolling: touch;
  touch-action: pan-y;
}

.transcript-messages {
  display: flex;
  flex-direction: column;
  gap: 10px;
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

.action-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 8px 12px;
  border-radius: 10px;
  border: none;
  background: linear-gradient(135deg, var(--callora-primary), var(--callora-secondary));
  color: #ffffff;
  font-size: 12px;
  font-weight: 700;
  cursor: pointer;
}

.message-preview {
  justify-content: flex-end;
  opacity: 0.7;
  font-style: italic;
}

.message-preview .message-content {
  background: linear-gradient(135deg, rgba(15, 138, 143, 0.6), rgba(17, 100, 163, 0.6));
  color: #f7fdff;
  border-radius: 16px 16px 4px 16px;
  box-shadow: 0 4px 12px rgba(17, 100, 163, 0.15);
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

.review-confirm-btn:disabled {
  opacity: 0.7;
  cursor: wait;
}

.review-card-fields {
  display: grid;
  gap: 8px;
}

.field-assist {
  display: grid;
  gap: 10px;
  margin: 0 0 4px;
  padding: 14px;
  border-radius: 18px;
  background: rgba(255, 255, 255, 0.76);
  border: 1px solid rgba(255, 255, 255, 0.82);
  box-shadow: 0 12px 28px rgba(40, 60, 71, 0.1);
}

.field-assist.hidden {
  display: none;
}

.field-assist-label {
  font-size: 11px;
  font-weight: 800;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--callora-primary);
}

.field-assist-body {
  display: grid;
  gap: 10px;
}

.field-assist-input {
  width: 100%;
  min-height: 44px;
  border-radius: 12px;
  border: 1px solid rgba(15, 138, 143, 0.18);
  background: rgba(255, 255, 255, 0.9);
  color: var(--callora-text);
  padding: 0 12px;
  font: inherit;
}

.field-assist-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.field-assist-chip {
  border: 1px solid rgba(15, 138, 143, 0.18);
  background: rgba(244, 247, 247, 0.92);
  color: var(--callora-text);
  border-radius: 999px;
  padding: 8px 12px;
  font-size: 11px;
  font-weight: 700;
  cursor: pointer;
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
.voice-widget.theme-dark .message-system .message-content,
.voice-widget.theme-dark .control-btn,
.voice-widget.theme-dark .close-btn,
.voice-widget.theme-dark .brand-pill {
  border-color: rgba(138, 174, 192, 0.22);
}

.voice-widget.theme-dark .message-assistant .message-content,
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
.voice-widget.theme-dark .message-composer,
.voice-widget.theme-dark .field-assist,
.voice-widget.theme-dark .field-assist-input,
.voice-widget.theme-dark .field-assist-chip {
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

/* Typing Indicator */
.typing-indicator-dots {
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 12px 16px !important;
  min-width: 52px;
}

.typing-indicator-dots span {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: rgba(15, 138, 143, 0.55);
  animation: typingBounce 1.2s infinite ease-in-out;
  display: block;
}

.typing-indicator-dots span:nth-child(1) { animation-delay: 0s; }
.typing-indicator-dots span:nth-child(2) { animation-delay: 0.18s; }
.typing-indicator-dots span:nth-child(3) { animation-delay: 0.36s; }

@keyframes typingBounce {
  0%, 60%, 100% { transform: translateY(0); opacity: 0.4; }
  30% { transform: translateY(-6px); opacity: 1; }
}

/* Tap-to-Speak (iOS) */
.tap-to-speak-content {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.tap-speak-btn {
  align-self: flex-start;
  border: none;
  border-radius: 999px;
  padding: 6px 12px;
  font-size: 12px;
  font-weight: 700;
  background: linear-gradient(135deg, var(--callora-primary), var(--callora-secondary));
  color: white;
  cursor: pointer;
  letter-spacing: 0.04em;
}

.tap-speak-btn:hover {
  filter: brightness(1.08);
}

/* Text-only notice */
.message-system .message-content {
  font-style: italic;
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
