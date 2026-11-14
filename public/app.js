import { createMobileHome } from './mobile-home.js';
import { detectDeviceProfile } from './device-monitor.js';
import { getPublicShareUrl } from './share-link.js';
import { initializeAppHubs } from './app-hub.js';
import { createSearchSummaryPrompt } from './search-summary.js';
import { readApiResponse, readChatReply } from './api-response.js';
import { researchBrowserPage } from './browser-agent.js';
import {
  normalizeSourceResults,
  renderBriefingResults,
  renderBriefingState,
  renderSearchResults,
} from './news-briefing.js';
import {
  createMicrophonePermissionGuard,
  createRecognitionLifecycle,
  createSpeechReplayController,
  createWakeWordRecoveryPolicy,
  getWakeWordListeningBlockReason,
  getSpeechRecognitionErrorMessage,
  getSpeechRecognitionConstructor,
  getSpeechRecognitionLanguage,
  getSpeechRecognitionStartError,
  isFatalSpeechRecognitionError,
  getSpeechSynthesisErrorMessage,
  isPageForeground,
  matchWakeWord,
  monitorSpeechSynthesisStart,
  nextWakeWordRestartDelay,
  primeSpeechSynthesis,
  readSpeechRecognitionAlternatives,
  readSpeechRecognitionResult,
  readWakeWordCommand,
  resolveVoiceOutputEnabled,
  selectSpeechSynthesisVoice,
  shouldPlaySpeech,
  shouldRunWakeWord,
  WAKE_WORD_MAX_RESTART_ATTEMPTS,
} from './voice/speech-input.js';
import { GeminiLiveVoice } from './voice/gemini-live.js';
import { createLocalTts, readLocalTtsPreference, writeLocalTtsPreference } from './local-tts.js';
import { applySpeechBoundaryCue } from './avatar-cues.js';
import {
  createPortraitAnimation,
  PORTRAIT_OVERLAY_CONFIG,
  PORTRAIT_ANIMATION_EVENT,
} from './portrait-animation.js';
import { createPortraitMotion } from './portrait-motion.js';
import { parseSmartCommand } from './smart-command-router.js';
import { planTask } from './agent-planner.js';
import { runPlan } from './agent-engine.js';
import { createPermissionBroker, RISK } from './security-permissions.js';
import { createFile, createZip, downloadFile, editFile, listZipEntries, readUploadedFile, readZipEntry } from './file-manager.js';
import { exportMemories, importMemories, summarizeConversation } from './memory-engine.js';
import { encryptMemories, decryptMemories } from './memory-crypto.js';
import { createNoiseGate, startMicrophoneMonitor } from './voice-noise-control.js';
import { createInterruptionController } from './voice-interruption.js';
import {
  createMemory,
  loadMemories,
  MEMORIES_STORAGE_KEY,
  removeMemory,
  saveMemories,
  selectMemoryAwareChatContext,
  setMemoryContextApproval,
  updateMemory,
  upsertMemory,
} from './local-memory.js';
import {
  createNote,
  createTask,
  loadNotes,
  loadTasks,
  NOTES_STORAGE_KEY,
  getDailyProductivityInsights,
  getTaskPrioritySummary,
  saveNotes,
  saveTasks,
  setTaskCompleted,
  TASKS_STORAGE_KEY,
  updateNote,
  updateTask,
} from './local-planner.js';
import {
  completeFocusTimer,
  createFocusTimerState,
  FOCUS_TIMER_STORAGE_KEY,
  getFocusTimerRemaining,
  loadFocusTimer,
  pauseFocusTimer,
  saveFocusTimer,
  startFocusTimer,
} from './focus-timer.js';
import {
  getUiLanguagePreference,
  translateUiText,
} from './ui-localization.js';
import {
  DEFAULT_LAB_PREFERENCES,
  LAB_PREFERENCES_KEY,
  LAB_ACCENTS,
  applyLabPreferences,
  loadLabPreferences,
  resetLabPreferencesDraft,
  saveLabPreferences,
} from './lab-personalize.js';
import {
  LAB_AI_MODIFY_HISTORY_KEY,
  getLabAiModifyRequestStatus,
  loadLabAiModifyHistory,
  recordLabAiModifyHistory,
} from './lab-ai-modify.js';
import {
  CODE_STUDIO_LANGUAGES,
  createCodeExport,
  reviewCodeLocally,
  validateCodeFile,
} from './lab-code-studio.js';
import {
  EXTENSION_PACKAGE_MAX_BYTES,
  addPendingExtension,
  getExtensionPackageFileStatus,
  loadLabExtensions,
  recordLabExtensionExport,
  recordLabExtensionRejection,
  removeLabExtension,
  serializeLabExtensionPackage,
  setLabExtensionState,
  validateExtensionPackageText,
} from './lab-extensions.js';
import {
  LAB_PROJECT_CHANGES_ENABLED,
  containsSensitiveText,
  redactSensitiveText,
} from './lab-safety.js';

const HISTORY_KEY = 'jarvis.history.v1';
const PREFERENCES_KEY = 'jarvis.preferences.v1';
const AVATAR_THEMES = new Set([
  'electric-blue',
  'neon-purple',
  'matrix-green',
  'cyber-amber',
  'holographic-cyan',
  'neon-pink',
]);
const historyLimit = 80;
const maxVisionDimension = 1_280;
const maxVisionImageBytes = 500 * 1024;
const speechDiagnosticsEnabled = new URLSearchParams(location.search).get('diagnostics') === '1';
const localDateTimeFormatter = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });
let speechAudioPreviewUrl = '';
const defaults = {
  language: 'en',
  voiceURI: '',
  speechRate: 1,
  voiceEnabled: 'speechSynthesis' in window,
  wakeWordEnabled: false,
  memoryEnabled: true,
  fullAccessEnabled: false,
  studyMode: false,
  avatarTheme: 'electric-blue',
  smartMemoryEnabled: false,
};

const elements = {
  transcript: document.querySelector('#transcript'),
  feedback: document.querySelector('#assistant-feedback'),
  message: document.querySelector('#message-input'),
  form: document.querySelector('#chat-form'),
  send: document.querySelector('#send-button'),
  searchToggle: document.querySelector('#search-toggle'),
  mic: document.querySelector('#mic-button'),
  dashboardLayout: document.querySelector('#dashboard-layout'),
  holoStage: document.querySelector('#holo-stage'),
  avatarFrame: document.querySelector('.avatar-frame'),
  avatarCanvas: document.querySelector('#avatar-canvas'),
  hologramToggle: document.querySelector('#toggle-hologram'),
  hologramQuality: document.querySelector('#hologram-quality'),
  avatarImage: document.querySelector('#ai-avatar'),
  avatarActivateButton: document.querySelector('#activate-3d-avatar'),
  earthActivateButton: document.querySelector('#activate-holographic-earth'),
  customAvatarButton: document.querySelector('#load-custom-avatar'),
  customAvatarFile: document.querySelector('#avatar-model-file'),
  avatarStatus: document.querySelector('#avatar-model-status'),
  labLayout: document.querySelector('#jarvis-lab'),
  labModules: document.querySelector('.lab-module-grid'),
  labSafetyPanel: document.querySelector('#lab-safety-panel'),
  labSafetyChangeState: document.querySelector('#lab-safety-change-state'),
  personalizePanel: document.querySelector('#personalize-panel'),
  personalizeTitle: document.querySelector('#personalize-title'),
  personalizeForm: document.querySelector('#personalize-form'),
  personalizePreview: document.querySelector('#personalize-preview'),
  personalizePreviewNote: document.querySelector('#personalize-preview-note'),
  personalizePreviewVoice: document.querySelector('#personalize-preview-voice'),
  personalizeStatus: document.querySelector('#personalize-status'),
  labDensity: document.querySelector('#lab-density-select'),
  labVoice: document.querySelector('#lab-voice-select'),
  aiModifyPanel: document.querySelector('#ai-modify-panel'),
  aiModifyTitle: document.querySelector('#ai-modify-title'),
  aiModifyRequest: document.querySelector('#ai-modify-request'),
  aiModifyPlanStatus: document.querySelector('#ai-modify-plan-status'),
  aiModifyStatus: document.querySelector('#ai-modify-status'),
  aiModifyHistory: document.querySelector('#ai-modify-history'),
  codeStudioPanel: document.querySelector('#code-studio-panel'),
  codeStudioTitle: document.querySelector('#code-studio-title'),
  codeStudioEditor: document.querySelector('#code-studio-editor'),
  codeStudioLanguage: document.querySelector('#code-studio-language'),
  codeStudioReadonly: document.querySelector('#code-studio-readonly'),
  codeStudioFile: document.querySelector('#code-studio-file'),
  codeStudioStatus: document.querySelector('#code-studio-status'),
  codeStudioCount: document.querySelector('#code-studio-count'),
  codeStudioReviewSummary: document.querySelector('#code-studio-review-summary'),
  codeStudioFindings: document.querySelector('#code-studio-findings'),
  extensionsPanel: document.querySelector('#extensions-panel'),
  extensionsTitle: document.querySelector('#extensions-title'),
  extensionsFile: document.querySelector('#extensions-package-file'),
  extensionsStatus: document.querySelector('#extensions-status'),
  extensionsCount: document.querySelector('#extensions-count'),
  extensionsList: document.querySelector('#extensions-list'),
  extensionsHistory: document.querySelector('#extensions-history'),
  dashboardChatPanel: document.querySelector('.dashboard-chat-panel'),
  conversationView: document.querySelector('#conversation-view'),
  dashboardTranscript: document.querySelector('#dashboard-transcript'),
  dashboardFeedback: document.querySelector('#dashboard-feedback'),
  conversationChatState: document.querySelector('#conversation-chat-state'),
  conversationChatStateLabel: document.querySelector('#conversation-chat-state-label'),
  conversationRetryButton: document.querySelector('#conversation-retry-button'),
  assistantState: document.querySelector('#assistant-state'),
  holoWaveform: document.querySelector('#holo-waveform'),
  holoStateAnnouncement: document.querySelector('#holo-state-announcement'),
  statePanelLive: document.querySelector('#state-panel-live'),
  holoStates: document.querySelectorAll('[data-holo-state]'),
  dashboardConnection: document.querySelector('#connection-status-dashboard'),
  providerNote: document.querySelector('#provider-note'),
  connection: document.querySelector('#connection-status'),
  settings: document.querySelector('#settings-dialog'),
  shareLinkButton: document.querySelector('#share-link-button'),
  copyLinkButton: document.querySelector('#copy-link-button'),
  shareStatus: document.querySelector('#share-status'),
  aiSettingsForm: document.querySelector('#ai-settings-form'),
  aiProvider: document.querySelector('#ai-provider-select'),
  aiModel: document.querySelector('#ai-model-input'),
  aiBaseUrl: document.querySelector('#ai-base-url'),
  aiBaseUrlField: document.querySelector('#ai-base-url-field'),
  aiApiKey: document.querySelector('#ai-api-key'),
  aiKeyLabel: document.querySelector('#ai-key-label'),
  aiKeyField: document.querySelector('#ai-key-field'),
  aiProviderHelp: document.querySelector('#ai-provider-help'),
  aiSetupStatus: document.querySelector('#ai-setup-status'),
  aiModelMode: document.querySelector('#ai-model-mode'),
  aiModelRefresh: document.querySelector('#ai-model-refresh'),
  aiModelTest: document.querySelector('#ai-model-test'),
  aiModelUse: document.querySelector('#ai-model-use'),
  aiModelStatus: document.querySelector('#ai-model-status'),
  aiModelList: document.querySelector('#ai-model-list'),
  aiSettingsSave: document.querySelector('#ai-settings-save'),
  aiSettingsEnvironment: document.querySelector('#ai-settings-environment'),
  homeAssistantRefresh: document.querySelector('#home-assistant-refresh'),
  homeAssistantStatus: document.querySelector('#home-assistant-status'),
  homeAssistantEntities: document.querySelector('#home-assistant-entities'),
  googleWorkspaceConnect: document.querySelector('#google-workspace-connect'),
  googleWorkspaceRefresh: document.querySelector('#google-workspace-refresh'),
  googleWorkspaceDisconnect: document.querySelector('#google-workspace-disconnect'),
  googleWorkspaceStatus: document.querySelector('#google-workspace-status'),
  googleDraftForm: document.querySelector('#google-draft-form'),
  googleDraftTo: document.querySelector('#google-draft-to'),
  googleDraftSubject: document.querySelector('#google-draft-subject'),
  googleDraftBody: document.querySelector('#google-draft-body'),
  googleCalendarRefresh: document.querySelector('#google-calendar-refresh'),
  googleCalendarEvents: document.querySelector('#google-calendar-events'),
  googleEventForm: document.querySelector('#google-event-form'),
  googleEventSummary: document.querySelector('#google-event-summary'),
  googleEventStart: document.querySelector('#google-event-start'),
  googleEventEnd: document.querySelector('#google-event-end'),
  googleEventDescription: document.querySelector('#google-event-description'),
  telegramRefresh: document.querySelector('#telegram-refresh'),
  telegramStatus: document.querySelector('#telegram-status'),
  telegramSendForm: document.querySelector('#telegram-send-form'),
  telegramRecipient: document.querySelector('#telegram-recipient'),
  telegramMessage: document.querySelector('#telegram-message'),
  telegramSend: document.querySelector('#telegram-send'),
  facebookMessengerRefresh: document.querySelector('#facebook-messenger-refresh'),
  facebookMessengerStatus: document.querySelector('#facebook-messenger-status'),
  facebookMessengerSendForm: document.querySelector('#facebook-messenger-send-form'),
  facebookMessengerRecipient: document.querySelector('#facebook-messenger-recipient'),
  facebookMessengerMessage: document.querySelector('#facebook-messenger-message'),
  facebookMessengerSend: document.querySelector('#facebook-messenger-send'),
  language: document.querySelector('#language-select'),
  voice: document.querySelector('#voice-select'),
  voiceSupport: document.querySelector('#voice-support'),
  speechAudioFile: document.querySelector('#speech-audio-file'),
  speechAudioPreview: document.querySelector('#speech-audio-preview'),
  speechAudioStatus: document.querySelector('#speech-audio-status'),
  speechAudioClear: document.querySelector('#speech-audio-clear'),
  speechRate: document.querySelector('#speech-rate'),
  speechRateValue: document.querySelector('#speech-rate-value'),
  voiceEnabled: document.querySelector('#voice-enabled'),
  localTtsEnabled: document.querySelector('#local-tts-enabled'),
  localTtsStatus: document.querySelector('#local-tts-status'),
  wakeWordEnabled: document.querySelector('#wake-word-enabled'),
  wakeWordSupport: document.querySelector('#wake-word-support'),
  memoryEnabled: document.querySelector('#memory-enabled'),
  smartMemoryEnabled: document.querySelector('#smart-memory-enabled'),
  smartMemoryEnabledDashboard: document.querySelector('#smart-memory-enabled-dashboard'),
  avatarTheme: document.querySelector('#avatar-theme-select'),
  install: document.querySelector('#install-button'),
  installHelp: document.querySelector('#install-help'),
  installInstructions: document.querySelector('#install-instructions'),
  footerStatus: document.querySelector('#footer-status'),
  accessToken: document.querySelector('#access-token'),
  fullAccess: document.querySelector('#full-access-toggle'),
  fullAccessMobile: document.querySelector('#full-access-mobile-toggle'),
  accessNote: document.querySelector('#access-mode-note'),
  activityLog: document.querySelector('#activity-log'),
  networkValue: document.querySelector('#network-value'),
  localDateTimeValue: document.querySelector('#local-datetime-value'),
  voiceValue: document.querySelector('#voice-value'),
  voiceOutputValue: document.querySelector('#voice-output-value'),
  backendConnectionValue: document.querySelector('#backend-connection-value'),
  memoryValue: document.querySelector('#memory-value'),
  modelValue: document.querySelector('#model-value'),
  deviceTypeValue: document.querySelector('#device-type-value'),
  platformValue: document.querySelector('#platform-value'),
  batteryValue: document.querySelector('#battery-value'),
  browserMemoryValue: document.querySelector('#browser-memory-value'),
  fileInput: document.querySelector('#file-input'),
  attachButton: document.querySelector('#attach-button'),
  attachmentNote: document.querySelector('#attachment-note'),
  leftAiStatus: document.querySelector('#left-ai-status'),
  leftAiDetail: document.querySelector('#left-ai-detail'),
  leftSessionStatus: document.querySelector('#left-session-status'),
  leftMemoryStatus: document.querySelector('#left-memory-status'),
  voiceConsoleStatus: document.querySelector('#voice-console-status'),
  dashboardMicButton: document.querySelector('#dashboard-mic-button'),
  dashboardVoiceMicButton: document.querySelector('#dashboard-voice-mic-button'),
  dashboardVoiceToggle: document.querySelector('#dashboard-voice-toggle'),
  dashboardVoiceLabel: document.querySelector('#dashboard-voice-label'),
  dashboardSettingsButton: document.querySelector('#dashboard-settings-button'),
  dashboardAttachButton: document.querySelector('#dashboard-attach-button'),
  dashboardFileStatus: document.querySelector('#dashboard-file-status'),
  fileCreateForm: document.querySelector('#file-create-form'),
  fileCreateName: document.querySelector('#file-create-name'),
  fileCreateContent: document.querySelector('#file-create-content'),
  fileWorkspaceContent: document.querySelector('#file-workspace-content'),
  fileWorkspaceList: document.querySelector('#file-workspace-list'),
  fileZipEntries: document.querySelector('#file-zip-entries'),
  fileSaveButton: document.querySelector('#file-save-button'),
  fileDownloadButton: document.querySelector('#file-download-button'),
  fileExportButton: document.querySelector('#file-export-button'),
  dashboardCommandForm: document.querySelector('#dashboard-command-form'),
  dashboardMessage: document.querySelector('#dashboard-message'),
  dashboardSend: document.querySelector('#dashboard-command-form button[type="submit"]'),
  dashboardChatState: document.querySelector('#dashboard-chat-state'),
  dashboardChatStateLabel: document.querySelector('#dashboard-chat-state-label'),
  dashboardRetryButton: document.querySelector('#dashboard-retry-button'),
  agentModeButtons: document.querySelectorAll('[data-agent-mode-toggle]'),
  agentPlanResults: document.querySelector('#agent-plan-results'),
  agentStepList: document.querySelector('#agent-step-list'),
  agentStopButton: document.querySelector('#agent-stop-button'),
  agentConfirmDialog: document.querySelector('#agent-confirm-dialog'),
  agentConfirmRisk: document.querySelector('#agent-confirm-risk'),
  agentConfirmAction: document.querySelector('#agent-confirm-action'),
  agentConfirmDetail: document.querySelector('#agent-confirm-detail'),
  agentConfirmForm: document.querySelector('#agent-confirm-form'),
  voiceWaveform: document.querySelector('#voice-waveform'),
  leftMicStatus: document.querySelector('#left-mic-status'),
  leftModeStatus: document.querySelector('#left-mode-status'),
  leftLanguageStatus: document.querySelector('#left-language-status'),
  studyIndicator: document.querySelector('#study-mode-indicator'),
  studyQuickIndicator: document.querySelector('#study-quick-indicator'),
  cpuValue: document.querySelector('#cpu-value'),
  cpuMeter: document.querySelector('#cpu-meter'),
  cpuMeterTrack: document.querySelector('#cpu-meter-track'),
  ramValue: document.querySelector('#ram-value'),
  ramMeter: document.querySelector('#ram-meter'),
  ramMeterTrack: document.querySelector('#ram-meter-track'),
  diskValue: document.querySelector('#disk-value'),
  diskMeter: document.querySelector('#disk-meter'),
  diskMeterTrack: document.querySelector('#disk-meter-track'),
  monitorContext: document.querySelector('#monitor-context'),
  cpuLabel: document.querySelector('#cpu-label'),
  ramLabel: document.querySelector('#ram-label'),
  diskLabel: document.querySelector('#disk-label'),
  briefingButton: document.querySelector('#news-button'),
  briefingResults: document.querySelector('#briefing-results'),
  fileSearchDialog: document.querySelector('#file-search-dialog'),
  fileSearchQuery: document.querySelector('#file-search-query'),
  fileSearchResults: document.querySelector('#file-search-results'),
  historyDialog: document.querySelector('#history-dialog'),
  historyCount: document.querySelector('#history-count'),
  historyList: document.querySelector('#history-list'),
  applicationDialog: document.querySelector('#application-dialog'),
  browserResearchDialog: document.querySelector('#browser-research-dialog'),
  browserResearchOpen: document.querySelector('#browser-research-open'),
  browserResearchForm: document.querySelector('#browser-research-form'),
  browserResearchUrl: document.querySelector('#browser-research-url'),
  browserResearchQuestion: document.querySelector('#browser-research-question'),
  browserResearchSubmit: document.querySelector('#browser-research-submit'),
  browserResearchStop: document.querySelector('#browser-research-stop'),
  browserResearchStatus: document.querySelector('#browser-research-status'),
  browserResearchResult: document.querySelector('#browser-research-result'),
  browserResearchSource: document.querySelector('#browser-research-source'),
  screenCaptureDialog: document.querySelector('#screen-capture-dialog'),
  capturePreview: document.querySelector('#capture-preview'),
  captureFramePreview: document.querySelector('#capture-frame-preview'),
  captureCanvas: document.querySelector('#capture-canvas'),
  captureFrameButton: document.querySelector('#capture-frame-button'),
  cameraCaptureButton: document.querySelector('#camera-capture-button'),
  visionQuestion: document.querySelector('#vision-question'),
  visionSendButton: document.querySelector('#vision-send-button'),
  downloadCapture: document.querySelector('#download-capture'),
  stopCaptureButton: document.querySelector('#stop-capture-button'),
  captureStatus: document.querySelector('#capture-status'),
  moreNavigationDialog: document.querySelector('#more-navigation-dialog'),
  focusTimerDisplay: document.querySelector('#focus-timer-display'),
  focusTimerButton: document.querySelector('#focus-timer-button'),
  noteForm: document.querySelector('#note-form'),
  noteTitle: document.querySelector('#note-title'),
  noteContent: document.querySelector('#note-content'),
  noteSaveButton: document.querySelector('#note-save-button'),
  noteCancelButton: document.querySelector('#note-cancel-button'),
  noteSearch: document.querySelector('#note-search'),
  noteList: document.querySelector('#notes-list'),
  noteStatus: document.querySelector('#note-status'),
  taskForm: document.querySelector('#task-form'),
  taskTitle: document.querySelector('#task-title'),
  taskDetails: document.querySelector('#task-details'),
  taskSaveButton: document.querySelector('#task-save-button'),
  taskCancelButton: document.querySelector('#task-cancel-button'),
  taskStatus: document.querySelector('#task-status'),
  pendingTaskCount: document.querySelector('#pending-task-count'),
  completedTaskCount: document.querySelector('#completed-task-count'),
  pendingTaskList: document.querySelector('#pending-task-list'),
  completedTaskList: document.querySelector('#completed-task-list'),
  prioritySummary: document.querySelector('#priority-summary'),
  insightTotalTasks: document.querySelector('#insight-total-tasks'),
  insightPendingTasks: document.querySelector('#insight-pending-tasks'),
  insightCompletedTasks: document.querySelector('#insight-completed-tasks'),
  insightCompletedToday: document.querySelector('#insight-completed-today'),
  insightFocusSessions: document.querySelector('#insight-focus-sessions'),
  insightOldestTask: document.querySelector('#insight-oldest-task'),
  insightNextAction: document.querySelector('#insight-next-action'),
  priorityActivity: document.querySelector('#priority-activity'),
  prioritySuggestion: document.querySelector('#priority-suggestion'),
  priorityTaskTitle: document.querySelector('#priority-task-title'),
  priorityReason: document.querySelector('#priority-reason'),
  priorityEmpty: document.querySelector('#priority-empty'),
  priorityAccept: document.querySelector('#priority-accept'),
  priorityDismiss: document.querySelector('#priority-dismiss'),
  smartMemoryPanel: document.querySelector('#smart-memory-panel'),
  smartMemoryForm: document.querySelector('#smart-memory-form'),
  smartMemoryType: document.querySelector('#smart-memory-type'),
  smartMemoryTitle: document.querySelector('#smart-memory-title-input'),
  smartMemoryContent: document.querySelector('#smart-memory-content-input'),
  smartMemorySave: document.querySelector('#smart-memory-save'),
  smartMemoryCancel: document.querySelector('#smart-memory-cancel'),
  smartMemoryClear: document.querySelector('#smart-memory-clear'),
  smartMemoryStatus: document.querySelector('#smart-memory-status'),
  smartMemorySearch: document.querySelector('#smart-memory-search'),
  smartMemoryList: document.querySelector('#smart-memory-list'),
  smartMemoryExport: document.querySelector('#smart-memory-export'),
  smartMemoryExportEncrypted: document.querySelector('#smart-memory-export-encrypted'),
  smartMemoryPassphrase: document.querySelector('#smart-memory-passphrase'),
  smartMemoryImportButton: document.querySelector('#smart-memory-import'),
  smartMemoryImportFile: document.querySelector('#smart-memory-import-file'),
  smartMemorySaveConversation: document.querySelector('#smart-memory-save-conversation'),
};

function reportSpeechDiagnostic(event, details = {}) {
  if (!speechDiagnosticsEnabled) return;
  window.dispatchEvent(new CustomEvent('jarvis:speech-diagnostic', {
    detail: {
      event,
      timestamp: new Date().toISOString(),
      ...details,
    },
  }));
}

function reportTtsDiagnostic(event, details = {}) {
  const synthesis = window.speechSynthesis;
  reportSpeechDiagnostic(event, {
    speaking: Boolean(synthesis?.speaking),
    pending: Boolean(synthesis?.pending),
    paused: Boolean(synthesis?.paused),
    ...details,
  });
}

function reportWakeWordStatus(reason) {
  reportSpeechDiagnostic('Wake-word status', {
    enabled: state.preferences.wakeWordEnabled,
    language: getSpeechRecognitionLanguage(state.preferences.language),
    microphonePermission: state.microphonePermission,
    visibility: document.visibilityState,
    focused: pageIsFocused(),
    secureContext: window.isSecureContext === true,
    reason,
  });
}

function readStoredJson(key, fallback) {
  try {
    const parsed = JSON.parse(localStorage.getItem(key));
    return parsed ?? fallback;
  } catch {
    return fallback;
  }
}

function getLocalStorageSafely() {
  try {
    return localStorage;
  } catch {
    return null;
  }
}

function loadPreferences() {
  const stored = readStoredJson(PREFERENCES_KEY, {});
  return {
    ...defaults,
    ...stored,
    language: getUiLanguagePreference(stored),
    speechRate: Number.isFinite(Number(stored.speechRate)) ? Math.min(1.3, Math.max(.7, Number(stored.speechRate))) : 1,
    voiceURI: typeof stored.voiceURI === 'string' ? stored.voiceURI : '',
    voiceEnabled: resolveVoiceOutputEnabled(stored.voiceEnabled, 'speechSynthesis' in window),
    wakeWordEnabled: stored.wakeWordEnabled === true,
    memoryEnabled: stored.memoryEnabled !== false,
    smartMemoryEnabled: stored.smartMemoryEnabled === true,
    fullAccessEnabled: stored.fullAccessEnabled === true,
    studyMode: stored.studyMode === true,
    avatarTheme: AVATAR_THEMES.has(stored.avatarTheme) ? stored.avatarTheme : 'electric-blue',
  };
}

function loadWorkspaceView() {
  return 'dashboard';
}

const state = {
  preferences: loadPreferences(),
  messages: [],
  voices: [],
  pending: false,
  searchMode: false,
  recognition: null,
  recognitionPurpose: null,
  recognitionWakeSession: false,
  wakeWordTriggered: false,
  wakeWordResumePending: false,
  wakeWordManualRetryPending: false,
  wakeWordManualTakeoverPending: false,
  wakeWordPagePaused: false,
  wakeWordRestartTimer: null,
  wakeWordRestartDelay: 600,
  recognitionStartTimer: null,
  recognitionStartedAt: null,
  recognitionError: null,
  listening: false,
  liveVoiceStartPending: false,
  liveReconnectWanted: false,
  liveReconnectAttempts: 0,
  liveReconnectTimer: null,
  pendingSpeechText: null,
  localSpeechActive: false,
  speechOutputTexts: new Set(),
  speechStartMonitorCancel: null,
  speechInterruptionMonitor: null,
  speechInterruptionMonitorStarting: false,
  speechInterruptionMonitorToken: 0,
  pendingSpeechOptions: null,
  installPrompt: null,
  accessRequired: false,
  accessToken: '',
  pendingAttachment: null,
  agentMode: false,
  agentAbortController: null,
  workspaceFiles: [],
  activeWorkspaceFile: null,
  uploadedZip: null,
  speechPlaybackId: 0,
  livePlaybackId: 0,
  liveTextPending: false,
  workspaceView: loadWorkspaceView(),
  displayStream: null,
  cameraStream: null,
  focusRemaining: 25 * 60,
  focusTimerState: createFocusTimerState(),
  focusTimerId: null,
  notes: [],
  tasks: [],
  memories: [],
  notesAvailable: false,
  tasksAvailable: false,
  memoriesAvailable: false,
  editingNoteId: null,
  editingTaskId: null,
  editingMemoryId: null,
  dismissedTaskSuggestions: new Set(),
  suggestedTaskId: null,
  focusTaskId: null,
  focusTaskTitle: null,
  captureObjectUrl: null,
  visionFrame: null,
  visionSending: false,
  visionAbortController: null,
  visionCaptureSequence: 0,
  browserResearchAbortController: null,
  assistantMode: 'normal',
  holoOnline: false,
  microphonePermission: 'unknown',
  lastChatFailure: null,
  aiSettingsLoaded: false,
  aiConfigured: false,
  aiProvider: null,
  labPreferences: loadLabPreferences(getLocalStorageSafely()),
};

let personalizeDraft = null;
let codeStudioPreviewSource = null;
let avatar3dInstance = null;
let avatar3dModulePromise = null;
let avatar3dActivationPending = false;
let avatar3dActivated = false;
let avatar3dActiveMode = '';

let healthRequestSequence = 0;
const recognitionLifecycle = createRecognitionLifecycle();
const speechReplayController = createSpeechReplayController(() => renderMessages());
const wakeWordRecoveryPolicy = createWakeWordRecoveryPolicy();
const microphonePermissionGuard = createMicrophonePermissionGuard();
const geminiLiveVoice = new GeminiLiveVoice();
const portraitAnimation = createPortraitAnimation({
  onChange: (detail) => {
    elements.avatarFrame.style.setProperty(
      '--portrait-blink-close-duration',
      `${detail.blinkCloseDuration}ms`,
    );
    elements.avatarFrame.style.setProperty(
      '--portrait-blink-open-duration',
      `${detail.blinkOpenDuration}ms`,
    );
    elements.avatarImage.dispatchEvent(new CustomEvent(PORTRAIT_ANIMATION_EVENT, { detail }));
  },
});
const portraitOverlay = PORTRAIT_OVERLAY_CONFIG.cutout;
const portraitMotion = createPortraitMotion({
  portraitFrame: elements.avatarFrame,
  portraitHead: elements.avatarFrame.querySelector('.portrait-head'),
  portraitArtwork: elements.avatarFrame.querySelector('.portrait-artwork'),
  portraitImage: elements.avatarImage,
  mouthCanvas: elements.avatarFrame.querySelector('.portrait-mouth-canvas'),
  mouthConfig: portraitOverlay.mouth,
  liveliness: 0.6,
});
portraitMotion.setQuality(elements.hologramQuality?.value);

document.documentElement.style.setProperty('--portrait-eye-left-y', `${portraitOverlay.eyes.y * 100}%`);
document.documentElement.style.setProperty('--portrait-eye-left-x', `${portraitOverlay.eyes.leftX * 100}%`);
document.documentElement.style.setProperty('--portrait-eye-right-x', `${portraitOverlay.eyes.rightX * 100}%`);
document.documentElement.style.setProperty('--portrait-eye-right-y', `${portraitOverlay.eyes.rightY * 100}%`);
document.documentElement.style.setProperty('--portrait-eye-width', `${portraitOverlay.eyes.width * 100}%`);
document.documentElement.style.setProperty('--portrait-eye-height', `${portraitOverlay.eyes.height * 100}%`);
document.documentElement.style.setProperty('--portrait-mouth-x', `${portraitOverlay.mouth.x * 100}%`);
document.documentElement.style.setProperty('--portrait-mouth-y', `${portraitOverlay.mouth.y * 100}%`);
document.documentElement.style.setProperty('--portrait-mouth-width', `${portraitOverlay.mouth.width * 100}%`);
document.documentElement.style.setProperty('--portrait-chin-x', `${portraitOverlay.chin.x * 100}%`);
document.documentElement.style.setProperty('--portrait-chin-y', `${portraitOverlay.chin.y * 100}%`);
document.documentElement.style.setProperty('--portrait-debug', new URLSearchParams(location.search).get('debug') === '1' ? 'flex' : 'none');
window.jarvisAvatarAnimation = {
  setSpeaking: (active) => {
    portraitAnimation.setSpeaking(active);
    portraitMotion.setSpeaking(active);
  },
  setEyeMode: (mode) => {
    portraitAnimation.setEyeMode(mode);
    portraitMotion.setEyeMode(mode);
  },
  setSpeechCue: (opening, viseme, options) => portraitMotion.setSpeechCue(opening, viseme, options),
  setAudioLevel: (level) => portraitMotion.setAudioLevel(level),
  setLiveliness: (value) => portraitMotion.setLiveliness(value),
  blink: (options) => portraitAnimation.blink(options),
  getMotionState: () => portraitMotion.getState(),
};
window.addEventListener('jarvis:avatar-projection-fallback', () => {
  avatar3dActiveMode = '';
  avatar3dActivated = false;
  avatar3dActivationPending = false;
  updateProjectionButtons();
});
window.addEventListener('jarvis:hologram-quality-change', ({ detail }) => {
  portraitMotion.setQuality(detail?.quality);
});
createMobileHome();
elements.avatarImage.addEventListener(PORTRAIT_ANIMATION_EVENT, ({ detail }) => {
  elements.avatarFrame.dataset.blink = detail.blink;
  elements.avatarFrame.dataset.viseme = detail.viseme;
  elements.avatarFrame.dataset.speaking = String(detail.speaking);
});
function loadHistory() {
  if (!state.preferences.memoryEnabled) return [];
  const stored = readStoredJson(HISTORY_KEY, []);
  if (!Array.isArray(stored)) return [];
  return stored.slice(-historyLimit).filter((message) => (
    message && ['user', 'assistant'].includes(message.role) && typeof message.content === 'string'
  ));
}

function savePreferences() {
  try {
    localStorage.setItem(PREFERENCES_KEY, JSON.stringify(state.preferences));
  } catch {
    showFeedback('Preferences could not be saved in this browser.');
  }
}

function saveHistory() {
  if (!state.preferences.memoryEnabled) return;
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(state.messages.slice(-historyLimit)));
  } catch {
    showFeedback('History could not be saved. Browser storage may be full.');
  }
}

function formatPlannerDate(value) {
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
}

function createPlannerButton(label, action, id) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'planner-item-action';
  button.dataset.plannerAction = action;
  button.dataset.itemId = id;
  button.textContent = label;
  return button;
}

function renderNotes() {
  const query = elements.noteSearch.value.trim().toLocaleLowerCase();
  const notes = state.notes.filter((note) => (
    `${note.title}\n${note.content}`.toLocaleLowerCase().includes(query)
  ));
  elements.noteList.replaceChildren();

  if (!notes.length) {
    const empty = document.createElement('li');
    empty.className = 'planner-empty';
    empty.textContent = query ? 'No notes match this search.' : 'No notes yet. Add one above.';
    elements.noteList.append(empty);
    return;
  }

  for (const note of [...notes].reverse()) {
    const item = document.createElement('li');
    item.className = 'planner-item note-item';
    const heading = document.createElement('div');
    heading.className = 'planner-item-heading';
    const title = document.createElement('strong');
    title.textContent = note.title;
    const dates = document.createElement('time');
    dates.dateTime = note.updatedAt;
    dates.textContent = `Created ${formatPlannerDate(note.createdAt)} · Updated ${formatPlannerDate(note.updatedAt)}`;
    heading.append(title, dates);

    const content = document.createElement('p');
    content.className = 'planner-item-content';
    content.textContent = note.content || 'No note text.';

    const actions = document.createElement('div');
    actions.className = 'planner-item-actions';
    actions.append(
      createPlannerButton('Edit', 'edit-note', note.id),
      createPlannerButton('Delete', 'delete-note', note.id),
    );
    item.append(heading, content, actions);
    elements.noteList.append(item);
  }
}

function renderTaskPriority({ resetDismissed = false } = {}) {
  if (resetDismissed) state.dismissedTaskSuggestions.clear();
  const activityEntries = [...elements.activityLog.querySelectorAll('li')].map((item) => ({
    message: item.querySelector('span')?.textContent || '',
    timestamp: item.querySelector('time')?.dateTime || '',
  }));
  const priorityActivityEntries = activityEntries.map(({ message }) => message);
  const priority = getTaskPrioritySummary(
    state.tasks,
    priorityActivityEntries,
    new Date(),
    [...state.dismissedTaskSuggestions],
  );
  const insights = getDailyProductivityInsights(state.tasks, activityEntries, new Date());
  elements.prioritySummary.textContent = priority.summary;
  elements.insightTotalTasks.textContent = String(insights.totalTasks);
  elements.insightPendingTasks.textContent = String(insights.pendingTasks);
  elements.insightCompletedTasks.textContent = String(insights.completedTasks);
  elements.insightCompletedToday.textContent = String(insights.completedToday);
  elements.insightFocusSessions.textContent = String(insights.focusSessionsToday);
  elements.insightOldestTask.textContent = insights.oldestPendingTask
    ? `Oldest pending: ${insights.oldestPendingTask.title}${insights.daysPending ? ` · ${insights.daysPending} day${insights.daysPending === 1 ? '' : 's'}` : ' · added today'}`
    : 'Oldest pending: none';
  elements.insightNextAction.textContent = `Next action: ${insights.nextAction}`;
  elements.priorityActivity.textContent = insights.recentFocusActivity
    ? `Available activity: ${insights.recentFocusActivity}`
    : 'Available activity: no focus activity recorded in this session.';
  state.suggestedTaskId = priority.suggestedTask?.id || null;

  if (state.focusTaskId) {
    const activeTask = state.tasks.find((task) => task.id === state.focusTaskId);
    if (activeTask && !activeTask.completed) {
      state.suggestedTaskId = activeTask.id;
      elements.prioritySuggestion.hidden = false;
      elements.priorityEmpty.hidden = true;
      elements.priorityTaskTitle.textContent = activeTask.title;
      elements.priorityReason.textContent = state.focusTimerId
        ? 'A focus session for this task is running.'
        : 'A focus session for this task is paused.';
      elements.priorityAccept.textContent = state.focusTimerId ? 'Focus session active' : 'Resume focus session';
      elements.priorityAccept.disabled = Boolean(state.focusTimerId);
      return;
    }
    state.focusTaskId = null;
    state.focusTaskTitle = null;
    state.focusTimerState = {
      ...state.focusTimerState,
      taskId: null,
      taskTitle: null,
    };
  }

  elements.priorityAccept.disabled = false;
  elements.priorityAccept.textContent = 'Start focus session';
  if (priority.suggestedTask) {
    elements.prioritySuggestion.hidden = false;
    elements.priorityEmpty.hidden = true;
    elements.priorityTaskTitle.textContent = priority.suggestedTask.title;
    elements.priorityReason.textContent = insights.nextAction;
    return;
  }

  elements.prioritySuggestion.hidden = true;
  elements.priorityEmpty.hidden = false;
  elements.priorityEmpty.textContent = priority.pendingCount
    ? 'All current suggestions are dismissed. Add or update a task to refresh priorities.'
    : 'No pending tasks. Add a task whenever you are ready.';
}

function renderTasks({ resetDismissed = false } = {}) {
  const pending = state.tasks.filter((task) => !task.completed);
  const completed = state.tasks.filter((task) => task.completed);
  elements.pendingTaskCount.textContent = String(pending.length);
  elements.completedTaskCount.textContent = String(completed.length);

  const renderTaskGroup = (list, tasks, emptyText) => {
    list.replaceChildren();
    if (!tasks.length) {
      const empty = document.createElement('li');
      empty.className = 'planner-empty';
      empty.textContent = emptyText;
      list.append(empty);
      return;
    }

    for (const task of [...tasks].reverse()) {
      const item = document.createElement('li');
      item.className = `planner-item task-item${task.completed ? ' is-completed' : ''}`;
      const row = document.createElement('div');
      row.className = 'task-item-row';
      const label = document.createElement('label');
      label.className = 'task-check-label';
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.checked = task.completed;
      checkbox.dataset.taskId = task.id;
      checkbox.setAttribute('aria-label', `${task.completed ? 'Mark task incomplete' : 'Mark task complete'}: ${task.title}`);
      const title = document.createElement('strong');
      title.textContent = task.title;
      label.append(checkbox, title);

      const actions = document.createElement('div');
      actions.className = 'planner-item-actions';
      actions.append(
        createPlannerButton('Edit', 'edit-task', task.id),
        createPlannerButton('Delete', 'delete-task', task.id),
      );
      row.append(label, actions);
      item.append(row);

      if (task.content) {
        const details = document.createElement('p');
        details.className = 'planner-item-content';
        details.textContent = task.content;
        item.append(details);
      }

      const added = document.createElement('time');
      added.className = 'task-added-date';
      added.dateTime = task.createdAt;
      added.textContent = `Added ${formatPlannerDate(task.createdAt)}`;
      item.append(added);
      list.append(item);
    }
  };

  renderTaskGroup(elements.pendingTaskList, pending, 'No pending tasks.');
  renderTaskGroup(elements.completedTaskList, completed, 'No completed tasks.');
  renderTaskPriority({ resetDismissed });
}

function setPlannerFormAvailability(form, available) {
  form.querySelectorAll('input, textarea, button').forEach((control) => {
    control.disabled = !available;
  });
}

function resetNoteForm() {
  state.editingNoteId = null;
  elements.noteForm.reset();
  elements.noteSaveButton.textContent = 'Save note';
  elements.noteCancelButton.hidden = true;
}

function resetTaskForm() {
  state.editingTaskId = null;
  elements.taskForm.reset();
  elements.taskSaveButton.textContent = 'Add task';
  elements.taskCancelButton.hidden = true;
}

function initializeLocalPlanner() {
  try {
    state.notes = loadNotes(localStorage);
    state.notesAvailable = true;
  } catch (error) {
    elements.noteStatus.textContent = `Saved notes could not be loaded and will not be overwritten: ${error.message}`;
  }

  try {
    state.tasks = loadTasks(localStorage);
    state.tasksAvailable = true;
  } catch (error) {
    elements.taskStatus.textContent = `Saved tasks could not be loaded and will not be overwritten: ${error.message}`;
  }

  setPlannerFormAvailability(elements.noteForm, state.notesAvailable);
  elements.noteSearch.disabled = !state.notesAvailable;
  setPlannerFormAvailability(elements.taskForm, state.tasksAvailable);
  renderNotes();
  renderTasks({ resetDismissed: true });
}

function resetSmartMemoryForm() {
  state.editingMemoryId = null;
  elements.smartMemoryForm.reset();
  elements.smartMemorySave.textContent = 'Save memory';
  elements.smartMemoryCancel.hidden = true;
}

function setSmartMemoryAvailability(available) {
  elements.smartMemoryForm.querySelectorAll('input, textarea, select, button').forEach((control) => {
    control.disabled = !available;
  });
  elements.smartMemorySearch.disabled = !available;
  elements.smartMemoryEnabled.disabled = !available;
  elements.smartMemoryEnabledDashboard.disabled = !available;
  elements.smartMemoryClear.disabled = false;
  elements.smartMemoryExport.disabled = !available;
  elements.smartMemoryImportButton.disabled = !available;
  elements.smartMemorySaveConversation.disabled = !available;
}

function renderSmartMemories() {
  const query = elements.smartMemorySearch.value.trim().toLocaleLowerCase();
  const memories = state.memories.filter((memory) => (
    `${memory.type}\n${memory.title}\n${memory.content}`.toLocaleLowerCase().includes(query)
  ));
  elements.smartMemoryList.replaceChildren();

  if (!memories.length) {
    const empty = document.createElement('li');
    empty.className = 'planner-empty';
    empty.textContent = query ? 'No memories match this search.' : 'No memories saved on this device. Add one above when you choose.';
    elements.smartMemoryList.append(empty);
    return;
  }

  for (const memory of [...memories].reverse()) {
    const item = document.createElement('li');
    item.className = 'planner-item smart-memory-item';
    const heading = document.createElement('div');
    heading.className = 'planner-item-heading';
    const title = document.createElement('strong');
    title.textContent = memory.title;
    const meta = document.createElement('time');
    meta.dateTime = memory.updatedAt;
    meta.textContent = `${memory.type === 'preference' ? 'Preference' : 'Fact'} · Created ${formatPlannerDate(memory.createdAt)} · Updated ${formatPlannerDate(memory.updatedAt)}`;
    heading.append(title, meta);

    const content = document.createElement('p');
    content.className = 'planner-item-content';
    content.textContent = memory.content;

    const approval = document.createElement('label');
    approval.className = 'smart-memory-approval';
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = memory.includeInContext;
    checkbox.disabled = !state.memoriesAvailable;
    checkbox.dataset.memoryApprovalId = memory.id;
    const approvalText = document.createElement('span');
    approvalText.textContent = 'Approve this reviewed memory for AI context';
    approval.append(checkbox, approvalText);

    const actions = document.createElement('div');
    actions.className = 'planner-item-actions';
    const edit = createPlannerButton('Edit', 'edit-memory', memory.id);
    const remove = createPlannerButton('Delete', 'delete-memory', memory.id);
    edit.disabled = !state.memoriesAvailable;
    remove.disabled = !state.memoriesAvailable;
    actions.append(edit, remove);
    item.append(heading, content, approval, actions);
    elements.smartMemoryList.append(item);
  }
}

function persistSmartMemories(memories) {
  saveMemories(localStorage, memories);
  state.memories = memories;
  state.memoriesAvailable = true;
  setSmartMemoryAvailability(true);
  renderSmartMemories();
}

function setSmartMemoryEnabled(enabled) {
  if (enabled && !state.memoriesAvailable) {
    elements.smartMemoryStatus.textContent = 'Saved memories are unavailable; review the storage error before enabling them.';
    syncSettings();
    return;
  }
  const previous = state.preferences.smartMemoryEnabled;
  state.preferences.smartMemoryEnabled = enabled;
  elements.smartMemoryEnabled.checked = enabled;
  elements.smartMemoryEnabledDashboard.checked = enabled;
  try {
    localStorage.setItem(PREFERENCES_KEY, JSON.stringify(state.preferences));
    elements.smartMemoryStatus.textContent = enabled
      ? 'Smart Memory is on. Only reviewed, approved preferences and relevant approved facts may be included in AI context.'
      : 'Smart Memory is off. Saved memories remain on this device and will not be included in AI context.';
  } catch (error) {
    if (!enabled) {
      state.preferences.smartMemoryEnabled = false;
      elements.smartMemoryEnabled.checked = false;
      elements.smartMemoryEnabledDashboard.checked = false;
      elements.smartMemoryStatus.textContent = `Smart Memory is off for this session, but the setting could not be saved: ${error.message}`;
      return;
    }
    state.preferences.smartMemoryEnabled = previous;
    elements.smartMemoryEnabled.checked = previous;
    elements.smartMemoryEnabledDashboard.checked = previous;
    elements.smartMemoryStatus.textContent = `Smart Memory could not be enabled: ${error.message}`;
  }
}

function initializeSmartMemories() {
  try {
    state.memories = loadMemories(localStorage);
    state.memoriesAvailable = true;
    elements.smartMemoryStatus.textContent = state.preferences.smartMemoryEnabled
      ? 'Smart Memory is on. Only reviewed and explicitly approved memories can be considered for relevant AI replies.'
      : 'Smart Memory is off. Saved memories will not be included in AI context.';
  } catch (error) {
    elements.smartMemoryStatus.textContent = `Saved memories could not be loaded and will not be overwritten: ${error.message}`;
  }
  setSmartMemoryAvailability(state.memoriesAvailable);
  renderSmartMemories();
}

function handleSmartMemoryAction(event) {
  const button = event.target.closest('[data-planner-action][data-item-id]');
  if (!button) return;
  const memory = state.memories.find((item) => item.id === button.dataset.itemId);
  if (!memory) return;

  if (button.dataset.plannerAction === 'edit-memory') {
    state.editingMemoryId = memory.id;
    elements.smartMemoryType.value = memory.type;
    elements.smartMemoryTitle.value = memory.title;
    elements.smartMemoryContent.value = memory.content;
    elements.smartMemorySave.textContent = 'Update memory';
    elements.smartMemoryCancel.hidden = false;
    elements.smartMemoryStatus.textContent = memory.includeInContext
      ? 'Review your changes. Saving changed content will remove its context approval until you approve it again.'
      : 'Edit this saved memory.';
    elements.smartMemoryTitle.focus();
    return;
  }

  if (button.dataset.plannerAction === 'delete-memory' && window.confirm('Delete this saved memory from this device?')) {
    try {
      persistSmartMemories(removeMemory(state.memories, memory.id));
      elements.smartMemoryStatus.textContent = 'Memory deleted from this device.';
    } catch (error) {
      elements.smartMemoryStatus.textContent = `Memory could not be deleted: ${error.message}`;
    }
  }
}

function openSmartMemoryPanel() {
  setWorkspaceView('dashboard');
  selectNavigation('memory');
  elements.smartMemoryPanel.scrollIntoView({ behavior: 'smooth', block: 'center' });
  elements.smartMemoryTitle.focus({ preventScroll: true });
}

function showFeedback(message = '') {
  elements.feedback.textContent = message;
  elements.dashboardFeedback.textContent = message;
}

function logActivity(message) {
  const occurredAt = new Date();
  const item = document.createElement('li');
  const marker = document.createElement('i');
  const label = document.createElement('span');
  const time = document.createElement('time');
  label.textContent = message;
  time.dateTime = occurredAt.toISOString();
  time.textContent = new Intl.DateTimeFormat(
    'en-US',
    { hour: '2-digit', minute: '2-digit' },
  ).format(occurredAt);
  item.append(marker, label, time);
  elements.activityLog.prepend(item);
  while (elements.activityLog.children.length > 6) elements.activityLog.lastElementChild.remove();
  elements.leftSessionStatus.textContent = 'ACTIVE';
  renderTaskPriority();
}

function syncFullAccess() {
  const enabled = state.preferences.fullAccessEnabled;
  elements.fullAccess.checked = enabled;
  elements.fullAccessMobile.checked = enabled;
  elements.accessNote.textContent = enabled ? 'In-app actions enabled' : 'Browser-safe actions only';
  document.querySelectorAll('[data-requires-full-access]').forEach((control) => {
    control.disabled = !enabled;
    control.title = enabled ? 'Run this action inside J.A.R.V.I.S.' : 'Enable Full Access to use app shortcuts';
  });
  if (!enabled && elements.screenCaptureDialog.open) {
    state.visionCaptureSequence += 1;
    state.visionAbortController?.abort();
    elements.screenCaptureDialog.close();
  }
  if (!enabled && elements.browserResearchDialog.open) {
    state.browserResearchAbortController?.abort();
    elements.browserResearchDialog.close();
  }
  window.dispatchEvent(new Event('jarvis:full-access-change'));
}

function resetAvatarMouth() {
  if (!avatar3dActivated) return;
  avatar3dInstance?.setMouth?.(0);
  avatar3dInstance?.setViseme?.('aa');
}

function syncAvatarAssistantState() {
  if (!avatar3dActivated) return;
  const avatarState = ['listening', 'thinking', 'speaking', 'happy', 'error', 'offline'].includes(state.assistantMode)
    ? state.assistantMode
    : state.holoOnline ? 'normal' : 'offline';
  avatar3dInstance?.setState?.(avatarState);
  if (state.assistantMode !== 'speaking') resetAvatarMouth();
}

function setAssistantState(mode, label) {
  const supportedModes = ['normal', 'listening', 'speaking', 'thinking', 'happy', 'error', 'offline'];
  state.assistantMode = supportedModes.includes(mode) ? mode : 'normal';
  syncAvatarAssistantState();
  elements.assistantState.textContent = label;
  elements.voiceConsoleStatus.textContent = label;
  renderMicrophoneStatus();
  elements.voiceOutputValue.textContent = state.assistantMode === 'speaking'
    ? 'Speaking'
    : 'speechSynthesis' in window ? state.preferences.voiceEnabled ? 'Ready' : 'Off' : 'Not available';
  elements.voiceWaveform.classList.toggle('is-active', ['listening', 'speaking'].includes(state.assistantMode));
  elements.voiceWaveform.classList.toggle('is-listening', state.assistantMode === 'listening');
  elements.voiceWaveform.setAttribute('aria-label', ({
    listening: 'Listening for speech',
    speaking: 'Assistant voice playing',
    thinking: 'Assistant is thinking',
    error: 'Assistant request failed',
    offline: 'Assistant connection unavailable',
  })[state.assistantMode] || 'Voice channel idle');
  updateHologramState();
}

function updateHologramState() {
  const activeMode = ['listening', 'thinking', 'speaking', 'error', 'offline'].includes(state.assistantMode)
    ? state.assistantMode
    : state.holoOnline ? 'online' : '';
  const announcement = activeMode || 'offline';
  elements.holoStates.forEach((item) => {
    const active = item.dataset.holoState === activeMode;
    item.classList.toggle('is-current', active);
    if (active) item.setAttribute('aria-current', 'true');
    else item.removeAttribute('aria-current');
  });
  const voiceActive = ['listening', 'speaking'].includes(state.assistantMode);
  elements.holoWaveform.classList.toggle('is-active', voiceActive);
  elements.holoWaveform.classList.toggle('is-listening', state.assistantMode === 'listening');
  elements.holoWaveform.classList.toggle('is-speaking', state.assistantMode === 'speaking');
  elements.holoWaveform.setAttribute('aria-label', voiceActive
    ? `Voice activity ${state.assistantMode}`
    : 'Voice activity idle');
  elements.holoStateAnnouncement.textContent = announcement === 'online'
    ? 'J.A.R.V.I.S. is online.'
    : announcement === 'offline' ? 'J.A.R.V.I.S. is offline.'
      : announcement === 'error' ? 'J.A.R.V.I.S. encountered an error.'
      : `J.A.R.V.I.S. is ${announcement}.`;
  elements.statePanelLive.textContent = announcement.toUpperCase();
  const mobileMode = state.assistantMode === 'listening' || state.assistantMode === 'thinking'
    || state.assistantMode === 'speaking' ? state.assistantMode : (state.holoOnline ? 'idle' : 'idle');
  window.dispatchEvent(new CustomEvent('jarvis:assistant-state', { detail: { mode: mobileMode } }));
  const avatarState = ['listening', 'thinking', 'speaking', 'error', 'offline'].includes(state.assistantMode)
    ? state.assistantMode
    : state.holoOnline ? 'normal' : 'offline';
  elements.holoStage.classList.toggle('is-offline', avatarState === 'offline');
  elements.holoStage.classList.toggle('is-error', avatarState === 'error');
  const hologramState = avatarState === 'normal' ? 'idle' : avatarState;
  const activityLevel = state.assistantMode === 'listening' || state.assistantMode === 'speaking' ? 0.55 : 0;
  avatar3dInstance?.setHologramState?.(hologramState, activityLevel);
  window.dispatchEvent(new CustomEvent('jarvis:hologram-state', {
    detail: { state: hologramState, level: activityLevel },
  }));
  window.jarvisAvatarAnimation.setSpeaking(state.assistantMode === 'speaking');
  window.jarvisAvatarAnimation.setEyeMode(
    mobileMode === 'idle' ? 'idle' : mobileMode,
  );
}

function updateProjectionButtons() {
  elements.avatarActivateButton.disabled = avatar3dActivationPending || avatar3dActiveMode === 'avatar';
  elements.earthActivateButton.disabled = avatar3dActivationPending || avatar3dActiveMode === 'earth';
  elements.customAvatarButton.disabled = avatar3dActivationPending;
  elements.avatarActivateButton.textContent = avatar3dActivationPending && avatar3dActiveMode === 'loading-avatar'
    ? 'Loading 3D Avatar...'
    : avatar3dActiveMode === 'avatar' ? '3D Avatar Active' : 'Activate 3D Avatar';
  elements.earthActivateButton.textContent = avatar3dActivationPending && avatar3dActiveMode === 'loading-earth'
    ? 'Loading Holographic Earth...'
    : avatar3dActiveMode === 'earth' ? 'Holographic Earth Active' : 'Activate Holographic Earth';
  elements.avatarActivateButton.setAttribute('aria-pressed', String(avatar3dActiveMode === 'avatar'));
  elements.earthActivateButton.setAttribute('aria-pressed', String(avatar3dActiveMode === 'earth'));
}

async function loadReferenceFaceImage() {
  if (typeof Image === 'undefined') return null;
  return new Promise((resolve) => {
    const referenceImage = new Image();
    referenceImage.onload = () => resolve(referenceImage);
    referenceImage.onerror = () => resolve(null);
    referenceImage.src = '/reference-face.jpg';
  });
}

async function getAvatar3dInstance() {
  let avatarModule;
  try {
    avatarModule = await (avatar3dModulePromise ||= import('/avatar3d.bundle.js?avatar=7'));
  } catch (error) {
    avatar3dModulePromise = null;
    throw error;
  }

  avatar3dInstance ||= avatarModule.initializeAvatar3d({
    frame: elements.avatarFrame,
    stage: elements.holoStage,
    canvas: elements.avatarCanvas,
    image: elements.avatarImage,
    referenceImage: await loadReferenceFaceImage(),
    status: elements.avatarStatus,
  });
  window.setHologramState = (hologramState, level01) => avatar3dInstance?.setHologramState?.(hologramState, level01);
  return avatar3dInstance;
}

async function activate3DProjection(mode) {
  const activeMode = mode === 'avatar' ? 'avatar' : 'earth';
  if (avatar3dActivationPending || avatar3dActiveMode === activeMode) return;
  avatar3dActivationPending = true;
  avatar3dActiveMode = `loading-${activeMode}`;
  updateProjectionButtons();
  elements.avatarStatus.textContent = activeMode === 'avatar'
    ? 'Loading the 3D renderer. Your portrait remains visible until it is ready.'
    : 'Building the local holographic Earth. Your portrait remains visible until it is ready.';
  elements.avatarStatus.dataset.state = 'loading';
  elements.avatarFrame.setAttribute('aria-busy', 'true');

  try {
    await getAvatar3dInstance();
    const projectionReady = activeMode === 'avatar'
      ? avatar3dInstance.loadBuiltInAvatar()
      : avatar3dInstance.loadBuiltInGlobe();
    if (projectionReady) {
      avatar3dActiveMode = activeMode;
      avatar3dActivated = activeMode === 'avatar';
      if (avatar3dActivated) syncAvatarAssistantState();
    } else {
      avatar3dActiveMode = '';
      avatar3dActivated = false;
    }
  } catch {
    elements.avatarFrame.setAttribute('aria-busy', 'false');
    avatar3dActiveMode = '';
    avatar3dActivated = false;
    elements.avatarStatus.textContent = activeMode === 'avatar'
      ? 'The 3D avatar could not load. The static portrait is still available; check WebGL or your connection and try again.'
      : 'The holographic Earth could not load. The static portrait is still available; check WebGL or your connection and try again.';
    elements.avatarStatus.dataset.state = 'error';
  } finally {
    avatar3dActivationPending = false;
    updateProjectionButtons();
  }
}

async function loadCustomAvatar(file) {
  if (avatar3dActivationPending) {
    elements.customAvatarFile.value = '';
    elements.avatarStatus.textContent = 'Wait for the current 3D projection to finish before loading a custom avatar.';
    elements.avatarStatus.dataset.state = 'error';
    return;
  }
  const previousMode = avatar3dActiveMode;
  avatar3dActivationPending = true;
  avatar3dActiveMode = 'loading-avatar';
  updateProjectionButtons();
  elements.customAvatarButton.disabled = true;
  elements.avatarStatus.textContent = `Loading ${file.name} locally...`;
  elements.avatarStatus.dataset.state = 'loading';
  elements.avatarFrame.setAttribute('aria-busy', 'true');

  try {
    const avatar = await getAvatar3dInstance();
    const loaded = await avatar.loadModel(file);
    avatar3dActiveMode = loaded ? 'avatar' : avatar.getActiveMode();
    avatar3dActivated = avatar3dActiveMode === 'avatar';
    if (loaded) syncAvatarAssistantState();
  } catch (error) {
    avatar3dActiveMode = avatar3dInstance?.getActiveMode() || previousMode;
    avatar3dActivated = avatar3dActiveMode === 'avatar';
    elements.avatarFrame.setAttribute('aria-busy', 'false');
    elements.avatarStatus.textContent = `Could not load this model: ${error.message || 'unsupported or invalid model'}. The portrait remains available.`;
    elements.avatarStatus.dataset.state = 'error';
  } finally {
    avatar3dActivationPending = false;
    updateProjectionButtons();
    elements.customAvatarFile.value = '';
  }
}

function activate3DAvatar() {
  return activate3DProjection('avatar');
}

function activateHolographicEarth() {
  return activate3DProjection('earth');
}

function setDashboardChatState(mode, message = '', canRetry = false) {
  for (const [container, label, retryButton] of [
    [elements.dashboardChatState, elements.dashboardChatStateLabel, elements.dashboardRetryButton],
    [elements.conversationChatState, elements.conversationChatStateLabel, elements.conversationRetryButton],
  ]) {
    container.hidden = !message;
    container.dataset.state = mode;
    label.textContent = translateUiText(message, state.preferences.language);
    retryButton.hidden = !canRetry;
    retryButton.disabled = state.pending;
  }
}

function messageElement(message) {
  const wrapper = document.createElement('article');
  wrapper.className = `message ${message.role}`;

  const meta = document.createElement('div');
  meta.className = 'message-meta';
  meta.textContent = message.role === 'user' ? 'YOU' : 'J.A.R.V.I.S.';
  wrapper.append(meta);

  if (message.kind === 'search') {
    const results = renderSearchResults(wrapper, message.data, state.preferences.language);
    const summaryPrompt = createSearchSummaryPrompt(message.data);
    if (summaryPrompt) {
      const summarize = document.createElement('button');
      summarize.type = 'button';
      summarize.className = 'search-summary-button';
      summarize.textContent = 'Summarize with AI';
      summarize.setAttribute('aria-label', 'Ask J.A.R.V.I.S. to summarize these search results');
      summarize.disabled = state.pending;
      summarize.addEventListener('click', () => summarizeSearchResults(message.data, summaryPrompt));
      wrapper.append(summarize);
    }
    if (!results.length) {
      const notice = document.createElement('p');
      notice.className = 'search-notice';
      notice.textContent = translateUiText(
        message.data?.notice || 'No source-backed search results were returned.',
        state.preferences.language,
      );
      wrapper.append(notice);
    }
    return wrapper;
  }

  const body = document.createElement('div');
  body.className = 'message-body';
  body.textContent = message.content;
  wrapper.append(body);
  if (message.role === 'assistant' && speechReplayController.getStatus(message) === 'available') {
    const replayButton = document.createElement('button');
    replayButton.type = 'button';
    replayButton.className = 'tts-replay-button';
    replayButton.textContent = 'Tap to Replay';
    replayButton.setAttribute('aria-label', 'Tap to replay this J.A.R.V.I.S. response');
    replayButton.addEventListener('click', () => {
      if (!speechReplayController.beginReplay(message)) return;
      speak(message.content, {
        onStart: () => speechReplayController.markStarted(message),
        onNotStarted: () => speechReplayController.markNotStarted(message),
      });
    });
    wrapper.append(replayButton);
  }
  return wrapper;
}

function renderMessages() {
  const transcripts = [elements.transcript, elements.dashboardTranscript];
  for (const transcript of transcripts) transcript.replaceChildren();
  if (!state.messages.length) {
    for (const transcript of transcripts) {
      const empty = document.createElement('div');
      empty.className = 'empty-state';
      const title = document.createElement('strong');
      title.textContent = 'Your session begins here.';
      const description = document.createElement('span');
      description.textContent = 'Ask a question, start a voice conversation, or search for a source-backed answer.';
      empty.append(title, description);
      transcript.append(empty);
    }
    return;
  }

  for (const transcript of transcripts) {
    for (const message of state.messages) transcript.append(messageElement(message));
    transcript.scrollTop = transcript.scrollHeight;
  }
}

function addMessage(message) {
  state.messages.push(message);
  state.messages = state.messages.slice(-historyLimit);
  renderMessages();
  saveHistory();
}

function renderAgentPlan(steps) {
  elements.agentStepList.replaceChildren();
  for (const step of steps) {
    const item = document.createElement('li');
    item.dataset.status = step.status;
    const label = document.createElement('span');
    label.textContent = step.label;
    const status = document.createElement('strong');
    status.textContent = step.status;
    item.append(label, status);
    if (step.reason) {
      const reason = document.createElement('small');
      reason.textContent = step.reason;
      item.append(reason);
    }
    elements.agentStepList.append(item);
  }
  elements.agentPlanResults.hidden = steps.length === 0;
}

function askAgentPermission({ action, risk, detail }) {
  elements.agentConfirmRisk.textContent = risk === RISK.DANGEROUS ? 'DANGEROUS' : 'CONFIRM';
  elements.agentConfirmAction.textContent = action;
  elements.agentConfirmDetail.textContent = detail || 'This action changes or exports local data.';
  elements.agentConfirmDialog.returnValue = 'deny';
  return new Promise((resolve) => {
    elements.agentConfirmDialog.addEventListener('close', () => {
      const decision = elements.agentConfirmDialog.returnValue;
      if (decision === 'cancel-plan') state.agentAbortController?.abort();
      resolve(decision === 'allow' ? 'allow' : 'deny');
    }, { once: true });
    elements.agentConfirmDialog.showModal();
  });
}

function stopAgentPlan() {
  const controller = state.agentAbortController;
  if (!controller || controller.signal.aborted) return;
  controller.abort();
  elements.agentStopButton.disabled = true;
  if (elements.agentConfirmDialog.open) elements.agentConfirmDialog.close('cancel-plan');
  showFeedback('Stopping the agent plan…');
}

function setAgentMode(enabled) {
  state.agentMode = enabled;
  for (const button of elements.agentModeButtons) {
    button.setAttribute('aria-pressed', String(enabled));
    button.textContent = enabled ? 'Agent on' : 'Agent';
  }
}

async function runAgentRequest(text) {
  let plan;
  try {
    plan = planTask(text);
  } catch (error) {
    showFeedback(error.message);
    state.pending = false;
    elements.send.disabled = false;
    elements.dashboardSend.disabled = false;
    return;
  }
  const controller = new AbortController();
  state.agentAbortController = controller;
  elements.agentStopButton.hidden = false;
  elements.agentStopButton.disabled = false;
  let steps = plan.steps.map((step) => ({ ...step, status: 'pending' }));
  renderAgentPlan(steps);
  setDashboardChatState('thinking', 'J.A.R.V.I.S. is running your approved agent plan.');
  setAssistantState('thinking', 'RUNNING AGENT PLAN');

  const handlers = {
    'ask-ai': async (_params, { signal }) => {
      if (!state.aiConfigured) throw new Error('No AI provider is configured.');
      const context = selectMemoryAwareChatContext(
        state.messages,
        state.memories,
        state.preferences.smartMemoryEnabled && state.memoriesAvailable,
      );
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: apiHeaders(true),
        body: JSON.stringify({ provider: state.aiProvider, messages: context, language: state.preferences.language }),
        signal: AbortSignal.any([signal, AbortSignal.timeout(50_000)]),
      });
      return readChatReply(await readApiResponse(response));
    },
    'browser-read-page': async ({ url, question }, { signal }) => {
      const result = await researchBrowserPage({
        url,
        question,
        headers: apiHeaders(true),
        signal: AbortSignal.any([signal, AbortSignal.timeout(50_000)]),
      });
      return `Source: ${result.url}\n${result.result}`;
    },
    'create-file': async ({ name, content }) => {
      const file = createFile(name, content);
      state.workspaceFiles = [...state.workspaceFiles.filter((item) => item.name !== file.name), file];
      return { name: file.name, size: file.size };
    },
    'export-file': async ({ name }) => {
      const file = state.workspaceFiles.find((item) => item.name === name);
      if (!file) throw new Error(`No workspace file named ${name} is available.`);
      downloadFile(file);
      return { name: file.name, size: file.size };
    },
    'delete-file': async ({ name }) => {
      const existing = state.workspaceFiles.find((item) => item.name === name);
      if (!existing) throw new Error(`No workspace file named ${name} is available.`);
      state.workspaceFiles = state.workspaceFiles.filter((item) => item.name !== name);
      return true;
    },
    'search-notes': async ({ query }) => {
      const matches = state.notes.filter((note) => `${note.title}\n${note.content}`.toLocaleLowerCase().includes(query.toLocaleLowerCase()));
      return matches.length
        ? matches.map((note) => `${note.title}: ${note.content}`).join('\n')
        : 'No saved notes matched that search.';
    },
    'save-memory': async ({ content }) => {
      if (!state.memoriesAvailable) throw new Error('Smart Memory storage is unavailable.');
      const memory = createMemory({ type: 'fact', title: content.slice(0, 100), content });
      persistSmartMemories(upsertMemory(state.memories, memory));
      return memory.title;
    },
    ...Object.fromEntries(['launch-app', 'open-folder', 'clipboard-write', 'clipboard-read', 'notify'].map((name) => [`desktop-${name}`, async (params) => {
      if (!window.jarvisDesktop?.computerAction) throw new Error('Desktop actions need the J.A.R.V.I.S. desktop app.');
      const outcome = await window.jarvisDesktop.computerAction(name, params);
      if (outcome?.denied) throw new Error('You denied this action in the desktop confirmation dialog.');
      if (!outcome?.ok) throw new Error(outcome?.error || 'The desktop action failed.');
      return outcome.text ?? outcome;
    }])),
    'open-url': async ({ url }) => {
      const parsed = new URL(url);
      if (!['https:', 'http:'].includes(parsed.protocol)) throw new Error('Only HTTP and HTTPS links can be opened.');
      const link = document.createElement('a');
      link.href = parsed.href;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      document.body.append(link);
      link.click();
      link.remove();
      return parsed.href;
    },
  };
  const broker = createPermissionBroker({ ask: askAgentPermission });
  try {
    const report = await runPlan(plan, {
      handlers,
      broker,
      signal: controller.signal,
      onProgress: (progress) => {
        steps = steps.map((step) => step.id === progress.id ? { ...step, ...progress } : step);
        renderAgentPlan(steps);
      },
    });
    steps = plan.steps.map((step) => {
      const result = report.steps.find((entry) => entry.id === step.id) || {};
      if (!result.id) return { ...step, status: 'unverified', reason: 'Not run because an earlier step stopped the plan.' };
      const status = ['done', 'denied', 'failed', 'unverified', 'cancelled'].includes(result.status) ? result.status : 'failed';
      return { ...step, ...result, status };
    });
    renderAgentPlan(steps);
    const response = steps.map((step) => {
      const result = typeof step.result === 'string' ? `\n${step.result}` : step.result?.name ? `\nCreated ${step.result.name} (${step.result.size} bytes).` : '';
      return `${step.label}: ${step.status}${step.reason ? ` (${step.reason})` : ''}${result}`;
    }).join('\n');
    addMessage({ role: 'assistant', content: response });
    setDashboardChatState('', '');
    setAssistantState('', report.status === 'cancelled' ? 'AGENT PLAN CANCELLED' : 'AGENT PLAN COMPLETE');
    if (state.preferences.voiceEnabled) speak(response);
  } catch (error) {
    steps = steps.map((step) => step.status === 'pending' ? { ...step, status: 'failed', reason: error.message } : step);
    renderAgentPlan(steps);
    addMessage({ role: 'assistant', content: `Agent plan failed: ${error.message}` });
    setDashboardChatState('error', error.message);
    setAssistantState('error', 'AGENT PLAN FAILED');
  } finally {
    if (state.agentAbortController === controller) state.agentAbortController = null;
    elements.agentStopButton.hidden = true;
    elements.agentStopButton.disabled = true;
    state.pending = false;
    elements.send.disabled = false;
    elements.dashboardSend.disabled = false;
    resumeWakeWordDetection();
  }
}

function openBrowserResearch() {
  if (!state.preferences.fullAccessEnabled) return;
  state.browserResearchAbortController?.abort();
  elements.browserResearchForm.reset();
  elements.browserResearchStatus.textContent = '';
  elements.browserResearchResult.textContent = '';
  elements.browserResearchResult.hidden = true;
  elements.browserResearchSource.hidden = true;
  elements.browserResearchDialog.showModal();
  elements.browserResearchUrl.focus();
}

async function submitBrowserResearch(event) {
  event.preventDefault();
  if (!state.preferences.fullAccessEnabled || state.browserResearchAbortController) return;
  const controller = new AbortController();
  state.browserResearchAbortController = controller;
  elements.browserResearchSubmit.disabled = true;
  elements.browserResearchStop.hidden = false;
  elements.browserResearchStop.disabled = false;
  elements.browserResearchStatus.textContent = 'Researching the public page…';
  elements.browserResearchResult.hidden = true;
  elements.browserResearchSource.hidden = true;
  try {
    const result = await researchBrowserPage({
      url: elements.browserResearchUrl.value.trim(),
      question: elements.browserResearchQuestion.value.trim(),
      headers: apiHeaders(true),
      signal: AbortSignal.any([controller.signal, AbortSignal.timeout(50_000)]),
    });
    if (controller.signal.aborted || !elements.browserResearchDialog.open) return;
    const sourceUrl = new URL(result.url);
    if (!['http:', 'https:'].includes(sourceUrl.protocol)) throw new Error('Browser Research returned an invalid source URL.');
    elements.browserResearchResult.textContent = result.result;
    elements.browserResearchResult.hidden = false;
    elements.browserResearchSource.href = sourceUrl.href;
    elements.browserResearchSource.textContent = `Source: ${sourceUrl.href}`;
    elements.browserResearchSource.hidden = false;
    elements.browserResearchStatus.textContent = 'Research complete.';
    logActivity('Browser Research completed');
  } catch (error) {
    if (!controller.signal.aborted) {
      elements.browserResearchStatus.textContent = getRequestErrorMessage(error, 'Browser Research');
    }
  } finally {
    if (state.browserResearchAbortController === controller) state.browserResearchAbortController = null;
    elements.browserResearchSubmit.disabled = false;
    elements.browserResearchStop.hidden = true;
    elements.browserResearchStop.disabled = true;
  }
}

function stopBrowserResearch() {
  state.browserResearchAbortController?.abort();
  elements.browserResearchStatus.textContent = 'Browser Research stopped.';
}

function getRequestErrorMessage(error, action = 'request') {
  if (error?.name === 'TimeoutError' || error?.name === 'AbortError') {
    return `The ${action} timed out. Check your connection or AI provider, then try again.`;
  }
  if (error instanceof TypeError && /fetch|network/i.test(error.message)) {
    return 'J.A.R.V.I.S. could not reach its server. Check your internet connection and that the server is running.';
  }
  return error?.message || `The ${action} failed. Please try again.`;
}

function apiHeaders(json = false) {
  const headers = {};
  if (json) headers['content-type'] = 'application/json';
  if (state.accessToken) headers.authorization = `Bearer ${state.accessToken}`;
  return headers;
}

async function sendChat(text, {
  retry = false,
  contextOverride = null,
  maxTokens = null,
  singleAttempt = false,
  provider = elements.aiProvider.value,
} = {}) {
  const context = contextOverride || selectMemoryAwareChatContext(
    state.messages,
    state.memories,
    state.preferences.smartMemoryEnabled && state.memoriesAvailable,
  );
  if (!retry) state.lastChatFailure = null;
  setDashboardChatState('thinking', 'J.A.R.V.I.S. is processing your message.');
  setAssistantState('thinking', 'PROCESSING REQUEST');
  try {
    showFeedback('');
    const response = await fetch('/api/chat', {
      method: 'POST',
      headers: apiHeaders(true),
      body: JSON.stringify({
        provider,
        messages: context,
        language: state.preferences.language,
        mode: state.preferences.studyMode ? 'study' : 'standard',
        ...(maxTokens ? { max_tokens: maxTokens } : {}),
        ...(singleAttempt ? { singleAttempt: true } : {}),
      }),
      signal: AbortSignal.timeout(50_000),
    });
    const data = await readApiResponse(response);
    const reply = readChatReply(data);
    state.lastChatFailure = null;
    setDashboardChatState('', '');
    const replyMessage = { role: 'assistant', content: reply };
    addMessage(replyMessage);
    elements.providerNote.textContent = `Connected through ${data.provider}. Search results are retrieved separately and linked to their sources.`;
    elements.modelValue.textContent = data.provider;
    elements.leftAiStatus.textContent = 'AI RESPONDED';
    elements.leftAiDetail.textContent = `Most recent successful reply came from ${data.provider}.`;
    logActivity('Assistant reply received');
    setAssistantState('happy', 'RESPONSE READY');
    if (state.preferences.voiceEnabled) {
      speechReplayController.track(replyMessage);
      reportSpeechDiagnostic('AI reply reaches speak()', { voiceOutputEnabled: true });
      speak(reply, {
        onStart: () => speechReplayController.markStarted(replyMessage),
        onNotStarted: () => speechReplayController.markNotStarted(replyMessage),
      });
    } else {
      reportTtsDiagnostic('TTS utterance skipped', {
        reason: 'speechSynthesis' in window ? 'voice-output-disabled' : 'speech-synthesis-unavailable',
      });
    }
  } catch (error) {
    const message = getRequestErrorMessage(error, 'AI request');
    showFeedback('');
    state.lastChatFailure = { text, message, contextOverride, maxTokens, singleAttempt };
    setDashboardChatState('error', message, true);
    elements.leftAiStatus.textContent = 'REQUEST FAILED';
    elements.leftAiDetail.textContent = message;
    logActivity('Chat request unavailable');
    setAssistantState('error', 'REQUEST FAILED');
  } finally {
    state.pending = false;
    elements.send.disabled = false;
    elements.dashboardSend.disabled = false;
    elements.dashboardRetryButton.disabled = false;
    elements.conversationRetryButton.disabled = false;
    document.querySelectorAll('.search-summary-button').forEach((button) => { button.disabled = false; });
    if (state.assistantMode === 'thinking' && (!state.preferences.voiceEnabled || !('speechSynthesis' in window))) {
      setAssistantState('', 'SYSTEM STANDBY');
    }
    resumeWakeWordDetection();
  }
}

function retryLastChat() {
  if (state.pending || !state.lastChatFailure) return;
  primeVoiceOutput();
  const failure = state.lastChatFailure;
  state.pending = true;
  elements.send.disabled = true;
  elements.dashboardSend.disabled = true;
  setDashboardChatState('thinking', 'Retrying your last message.');
  sendChat(failure.text, {
    retry: true,
    contextOverride: failure.contextOverride,
    maxTokens: failure.maxTokens,
    singleAttempt: failure.singleAttempt,
  });
}

function showTaskGroup(group) {
  setWorkspaceView('dashboard');
  const target = document.querySelector(group === 'pending'
    ? '#pending-tasks-group'
    : '#completed-tasks-group');
  target?.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function handleSmartCommand(command) {
  const openDashboard = () => {
    setWorkspaceView('dashboard');
    selectNavigation('dashboard');
  };
  const focusPlannerSection = (selector, focusSelector) => {
    openDashboard();
    const target = document.querySelector(selector);
    target?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    document.querySelector(focusSelector)?.focus({ preventScroll: true });
  };

  if (command.type === 'dashboard') {
    openDashboard();
    elements.dashboardLayout.scrollIntoView({ behavior: 'smooth', block: 'start' });
    return 'Dashboard opened.';
  }
  if (command.type === 'notes') {
    focusPlannerSection('#notes-section', '#note-title');
    return state.notesAvailable ? 'Notes opened. Your saved notes are stored on this device.' : 'Notes opened, but local note storage is unavailable. Saved data was not changed.';
  }
  if (command.type === 'tasks') {
    focusPlannerSection('#tasks-section', '#task-title');
    return state.tasksAvailable ? 'Tasks opened. Your saved tasks are stored on this device.' : 'Tasks opened, but local task storage is unavailable. Saved data was not changed.';
  }
  if (command.type === 'pending-tasks' || command.type === 'completed-tasks') {
    const group = command.type === 'pending-tasks' ? 'pending' : 'completed';
    const tasks = state.tasks.filter((task) => task.completed === (group === 'completed'));
    showTaskGroup(group);
    if (!state.tasksAvailable) return 'Task data is unavailable; saved data was not changed.';
    const labels = tasks.slice(0, 4).map((task) => task.title).join(', ');
    const remaining = tasks.length > 4 ? `, and ${tasks.length - 4} more` : '';
    return tasks.length
      ? `${group === 'pending' ? 'Pending' : 'Completed'} tasks (${tasks.length}): ${labels}${remaining}.`
      : `There are no ${group} tasks.`;
  }
  if (command.type === 'search-notes') {
    focusPlannerSection('#notes-section', '#note-search');
    if (!state.notesAvailable) return 'Saved note search is unavailable; local data was not changed.';
    elements.noteSearch.value = command.query;
    renderNotes();
    if (!command.query) return 'Notes are open. Enter a phrase in Search notes to filter them.';
    const query = command.query.toLocaleLowerCase();
    const count = state.notes.filter((note) => (
      `${note.title}\n${note.content}`.toLocaleLowerCase().includes(query)
    )).length;
    return count
      ? `Found ${count} saved note${count === 1 ? '' : 's'} matching "${command.query}".`
      : `No saved notes match "${command.query}".`;
  }
  if (command.type === 'start-focus') {
    openDashboard();
    if (state.focusTimerId) return 'The focus timer is already running.';
    toggleFocusTimer();
    return state.focusTaskId
      ? `Focus timer resumed for "${state.tasks.find((task) => task.id === state.focusTaskId)?.title || 'selected task'}".`
      : 'Focus timer started for 25 minutes.';
  }
  if (command.type === 'pause-focus') {
    openDashboard();
    if (!state.focusTimerId) return 'The focus timer is not running.';
    toggleFocusTimer();
    return 'Focus timer paused.';
  }
  if (command.type === 'system-status') {
    openDashboard();
    document.querySelector('#system-panel').scrollIntoView({ behavior: 'smooth', block: 'center' });
    return `System status: server CPU ${elements.cpuValue.textContent}; server memory ${elements.ramValue.textContent}; storage ${elements.diskValue.textContent}; this device ${elements.networkValue.textContent}.`;
  }
  return '';
}

function executeSmartCommand(command, originalText) {
  const response = handleSmartCommand(command);
  addMessage({ role: 'user', content: originalText });
  addMessage({ role: 'assistant', content: response });
  showFeedback(response);
}

async function searchWeb(query) {
  setDashboardChatState('thinking', 'Searching available web sources.');
  setAssistantState('thinking', 'SEARCHING THE WEB');
  try {
    const params = new URLSearchParams({ q: query, lang: state.preferences.language });
    const response = await fetch(`/api/search?${params}`, { headers: apiHeaders(), signal: AbortSignal.timeout(18_000) });
    const data = await readApiResponse(response);
    setDashboardChatState('', '');
    state.accessRequired = data.accessRequired === true;
    const normalizedData = { ...data, results: normalizeSourceResults(data, 8) };
    addMessage({ role: 'assistant', content: '', kind: 'search', data: normalizedData });
    if (typeof data.source === 'string' && data.source.trim()) {
      elements.providerNote.textContent = `Retrieved results from ${data.source}. Results are shown as retrieved; no AI summary is implied.`;
    }
    logActivity(`Web lookup: ${normalizedData.results.length} result${normalizedData.results.length === 1 ? '' : 's'}`);
  } catch (error) {
    const message = translateUiText(
      getRequestErrorMessage(error, 'web search'),
      state.preferences.language,
    );
    showFeedback(message);
    addMessage({ role: 'assistant', content: message });
    setDashboardChatState('error', message);
    setAssistantState('error', 'SEARCH UNAVAILABLE');
  } finally {
    state.pending = false;
    elements.send.disabled = false;
    elements.dashboardSend.disabled = false;
    document.querySelectorAll('.search-summary-button').forEach((button) => { button.disabled = false; });
    if (state.assistantMode === 'thinking') setAssistantState('', 'SYSTEM STANDBY');
    resumeWakeWordDetection();
  }
}

function summarizeSearchResults(data, prompt) {
  if (state.pending) return;
  if (!state.aiConfigured) {
    showFeedback('AI summaries are unavailable because no AI provider is configured. Search results are still available.');
    return;
  }
  if (!prompt) {
    showFeedback('No safe source links are available to summarize.');
    return;
  }
  primeVoiceOutput();
  state.pending = true;
  elements.send.disabled = true;
  elements.dashboardSend.disabled = true;
  document.querySelectorAll('.search-summary-button').forEach((button) => { button.disabled = true; });
  const query = typeof data.query === 'string' ? data.query : 'the retrieved sources';
  addMessage({ role: 'user', content: `Summarize the retrieved search sources for: ${query}` });
  sendChat(prompt, {
    contextOverride: [{ role: 'user', content: prompt }],
    maxTokens: 256,
    singleAttempt: true,
  });
}

function submitMessage(event) {
  event.preventDefault();
  const command = !state.agentMode && !state.pendingAttachment && !state.searchMode
    ? parseSmartCommand(elements.message.value.trim())
    : null;
  if (event.submitter === elements.send && !command) primeVoiceOutput();
  if (state.pending) return;
  const text = elements.message.value.trim();
  if (!text) return;
  const attachment = state.pendingAttachment;
  const outgoingText = attachment ? `${text}\n\n[Attached file: ${attachment.name}]\n${attachment.content}` : text;
  if (outgoingText.length > 4_000) {
    showFeedback('Message and attachment together must be under 4,000 characters. Shorten the message or attach a smaller file.');
    return;
  }
  if (command) {
    elements.message.value = '';
    elements.message.style.height = '';
    showFeedback('');
    executeSmartCommand(command, text);
    return;
  }
  if (state.agentMode && !state.searchMode) {
    elements.message.value = '';
    elements.message.style.height = '';
    state.pendingAttachment = null;
    elements.attachmentNote.hidden = true;
    elements.attachmentNote.textContent = '';
    elements.fileInput.value = '';
    addMessage({ role: 'user', content: outgoingText });
    state.pending = true;
    elements.send.disabled = true;
    elements.dashboardSend.disabled = true;
    runAgentRequest(outgoingText);
    return;
  }
  elements.message.value = '';
  elements.message.style.height = '';
  state.pendingAttachment = null;
  elements.attachmentNote.hidden = true;
  elements.attachmentNote.textContent = '';
  elements.fileInput.value = '';
  showFeedback('');
  if (state.recognitionWakeSession) {
    state.wakeWordResumePending = state.preferences.wakeWordEnabled;
    requestStopListening(state.recognition, 'chat-submit');
  }
  addMessage({ role: 'user', content: outgoingText });
  if (geminiLiveVoice.isConversationActive && !state.searchMode && geminiLiveVoice.sendTextMessage(outgoingText)) {
    state.pending = true;
    state.liveTextPending = true;
    elements.send.disabled = true;
    elements.dashboardSend.disabled = true;
    setAssistantState('thinking', 'PROCESSING LIVE REQUEST');
    showFeedback('J.A.R.V.I.S. is responding over the Live voice session.');
    return;
  }
  if (geminiLiveVoice.isConversationActive && state.searchMode) stopLiveConversation();
  state.pending = true;
  elements.send.disabled = true;
  elements.dashboardSend.disabled = true;
  if (state.searchMode) searchWeb(outgoingText);
  else sendChat(outgoingText);
}

function updateSearchMode() {
  elements.searchToggle.setAttribute('aria-pressed', String(state.searchMode));
  elements.message.placeholder = state.searchMode ? 'Search the web for...' : 'Ask J.A.R.V.I.S. anything...';
  elements.send.querySelector('span').textContent = state.searchMode ? 'Search' : 'Send';
  elements.send.setAttribute('aria-label', state.searchMode ? 'Search the web' : 'Send message');
  elements.send.title = state.searchMode ? 'Search the web' : 'Send message';
}

const localTts = createLocalTts();

function isLocalTtsUsable() {
  return localTts.available && readLocalTtsPreference() && !geminiLiveVoice.isConversationActive;
}

function syncLocalTtsStatus() {
  if (!elements.localTtsStatus) return;
  elements.localTtsStatus.textContent = localTts.available
    ? 'OmniVoice is running locally (Hindi + English).'
    : 'OmniVoice is not running; the standard voice is used. See README → Natural voice.';
  if (elements.localTtsEnabled) {
    elements.localTtsEnabled.disabled = !localTts.available;
    elements.localTtsEnabled.checked = localTts.available && readLocalTtsPreference();
  }
}

function speakWithLocalVoice(speechText, { onStart, onNotStarted } = {}) {
  const playbackId = ++state.speechPlaybackId;
  portraitAnimation.cancelSpeech();
  state.pendingSpeechText = null;
  const language = state.preferences.language === 'hi' ? 'hi' : 'en';
  let started = false;
  const finish = () => {
    state.speechOutputTexts.delete(speechText);
    state.localSpeechActive = false;
    if (playbackId !== state.speechPlaybackId) return;
    stopSpeechInterruptionMonitor();
    portraitAnimation.finishSpeech(playbackId);
    resetAvatarMouth();
    state.speechPlaybackId += 1;
    setAssistantState('', 'SYSTEM STANDBY');
    if (started) logActivity('Voice response complete');
    resumeWakeWordDetection();
  };
  localTts.speak(speechText, {
    language,
    headers: apiHeaders(),
    onStart() {
      if (playbackId !== state.speechPlaybackId) return;
      started = true;
      state.localSpeechActive = true;
      portraitAnimation.startSpeech(playbackId);
      window.dispatchEvent(new CustomEvent('jarvis:assistant-reply', { detail: { text: speechText } }));
      setAssistantState('speaking', 'VOICE OUTPUT');
      startSpeechInterruptionMonitor();
      logActivity('Voice response started (OmniVoice)');
      onStart?.();
    },
    onLevel(level) {
      if (playbackId !== state.speechPlaybackId || state.assistantMode !== 'speaking') return;
      const viseme = level > 0.6 ? 'aa' : level > 0.38 ? 'oh' : level > 0.18 ? 'ee' : 'ih';
      portraitMotion.setSpeechCue(level, viseme, { emphasis: level > 0.7 });
      portraitAnimation.setViseme(playbackId, viseme);
      if (avatar3dActivated && avatar3dInstance) {
        avatar3dInstance.setMouth?.(level, { emphasis: level > 0.7 });
        avatar3dInstance.setViseme?.(viseme);
      }
    },
  }).then(() => finish()).catch((error) => {
    reportTtsDiagnostic('Local voice failed', { error: error?.message || 'unknown', started });
    state.speechOutputTexts.delete(speechText);
    state.localSpeechActive = false;
    if (playbackId !== state.speechPlaybackId) return;
    if (started) { finish(); return; }
    // Nothing was spoken yet: mark the engine unavailable until the next health check, then fall back.
    localTts.setAvailable(false);
    syncLocalTtsStatus();
    state.speechPlaybackId += 1;
    speak(speechText, { onStart, onNotStarted, skipLocal: true });
  });
}

function isGeminiLiveAvailable() {
  return state.aiConfigured
    && state.aiProvider === 'gemini'
    && elements.aiProvider.value === 'gemini'
    && geminiLiveVoice.supported;
}

function syncVoiceOutputAvailability() {
  const liveAvailable = isGeminiLiveAvailable();
  const systemVoiceAvailable = 'speechSynthesis' in window;
  const voiceAvailable = liveAvailable || systemVoiceAvailable || localTts.available;
  elements.voiceEnabled.disabled = !voiceAvailable;
  elements.dashboardVoiceToggle.disabled = !voiceAvailable;
  elements.voiceOutputValue.textContent = liveAvailable
    ? state.preferences.voiceEnabled ? 'Gemini Live' : 'Off'
    : systemVoiceAvailable ? state.preferences.voiceEnabled ? 'Ready' : 'Off' : 'Not available';
}

function selectedGeminiVoiceName() {
  const selected = elements.voice.value;
  return selected.startsWith('gemini:') ? selected.slice('gemini:'.length) : 'Puck';
}

function selectedVoice() {
  return selectSpeechSynthesisVoice(
    state.voices,
    state.preferences.language,
    state.labPreferences.voiceURI || state.preferences.voiceURI,
  );
}

function primeVoiceOutput() {
  if (isGeminiLiveAvailable()) {
    geminiLiveVoice.prime().catch(() => {});
    return true;
  }
  if (!('speechSynthesis' in window) || !state.preferences.voiceEnabled) return false;
  const queued = primeSpeechSynthesis(
    window.speechSynthesis,
    window.SpeechSynthesisUtterance || globalThis.SpeechSynthesisUtterance,
    state.preferences.language,
    Boolean(state.recognition),
  );
  reportTtsDiagnostic('TTS silent priming attempted', {
    language: getSpeechRecognitionLanguage(state.preferences.language),
    recognitionActive: Boolean(state.recognition),
    reason: state.recognition ? 'recognition-active' : 'user-gesture',
    queued,
  });
  return queued;
}

function startListeningFromUserGesture() {
  if (geminiLiveVoice.isConversationActive) {
    stopLiveConversation('Gemini Live voice stopped.');
    return;
  }
  if (isGeminiLiveAvailable()) {
    geminiLiveVoice.prime().catch(() => {});
    state.wakeWordResumePending = false;
    stopSpeechOutput();
    if (state.pending) {
      showFeedback('Wait for the current response to finish before starting Live voice.');
      return;
    }
    if (state.recognition) {
      const recognition = state.recognition;
      state.liveVoiceStartPending = true;
      state.wakeWordResumePending = false;
      recognition.addEventListener('end', startLiveConversation, { once: true });
      requestStopListening(recognition, 'switch-to-gemini-live');
      return;
    }
    startLiveConversation();
    return;
  }
  startListening('command', false, false, true);
}

function setLiveMicControls(active) {
  state.listening = active;
  for (const button of [elements.mic, elements.dashboardMicButton, elements.dashboardVoiceMicButton]) {
    button.classList.toggle('is-active', active);
    button.setAttribute('aria-pressed', String(active));
    button.setAttribute('aria-label', active ? 'Stop voice input' : 'Start voice input');
  }
}

function startLiveAudioPlayback() {
  if (state.livePlaybackId) return;
  state.livePlaybackId = ++state.speechPlaybackId;
  portraitAnimation.startSpeech(state.livePlaybackId);
  window.dispatchEvent(new CustomEvent('jarvis:assistant-reply', { detail: { text: '' } }));
  setAssistantState('speaking', 'LIVE VOICE');
  logActivity('Voice response started');
}

function finishLiveAudioPlayback() {
  if (!state.livePlaybackId) return;
  portraitAnimation.finishSpeech(state.livePlaybackId);
  resetAvatarMouth();
  state.livePlaybackId = 0;
  state.speechPlaybackId += 1;
  if (geminiLiveVoice.isConversationActive) setAssistantState('listening', 'LIVE VOICE');
  else setAssistantState('', 'SYSTEM STANDBY');
}

function syncAvatarAudioLevel(level) {
  if (!Number.isFinite(level) || !state.livePlaybackId || state.assistantMode !== 'speaking') return;
  const viseme = level > 0.6 ? 'aa' : level > 0.38 ? 'oh' : level > 0.18 ? 'ee' : 'ih';
  const emphasis = level > 0.7;
  portraitMotion.setSpeechCue(level, viseme, { emphasis });
  portraitAnimation.setViseme(state.livePlaybackId, viseme);
  if (avatar3dActivated && avatar3dInstance) {
    avatar3dInstance.setMouth?.(level, { emphasis });
    avatar3dInstance.setViseme?.(viseme);
  }
}

function finishLiveConversation(message = '') {
  state.liveReconnectWanted = false;
  window.clearTimeout(state.liveReconnectTimer);
  state.liveReconnectTimer = null;
  state.liveVoiceStartPending = false;
  state.liveTextPending = false;
  state.pending = false;
  setLiveMicControls(false);
  finishLiveAudioPlayback();
  elements.send.disabled = false;
  elements.dashboardSend.disabled = false;
  if (message) showFeedback(message);
  if (state.assistantMode === 'listening' || state.assistantMode === 'speaking') {
    setAssistantState('', 'SYSTEM STANDBY');
  }
  if (state.preferences.wakeWordEnabled) {
    state.wakeWordResumePending = true;
    resumeWakeWordDetection('live-voice-stopped');
  }
}

function startLiveConversation({ reconnect = false } = {}) {
  if (!isGeminiLiveAvailable()) {
    state.liveVoiceStartPending = false;
    startListening('command', false, false, true);
    return;
  }
  window.clearTimeout(state.liveReconnectTimer);
  state.liveReconnectTimer = null;
  if (!reconnect) {
    state.liveReconnectWanted = true;
    state.liveReconnectAttempts = 0;
  }
  state.liveVoiceStartPending = true;
  state.wakeWordResumePending = state.preferences.wakeWordEnabled;
  window.clearTimeout(state.wakeWordRestartTimer);
  state.wakeWordRestartTimer = null;
  setAssistantState('thinking', 'CONNECTING TO GEMINI LIVE');
  showFeedback('Connecting to Gemini Live voice…');
  geminiLiveVoice.startConversation({
    headers: apiHeaders(),
    language: state.preferences.language,
    voiceName: selectedGeminiVoiceName(),
    callbacks: {
      onReady() {
        window.clearTimeout(state.liveReconnectTimer);
        state.liveReconnectTimer = null;
        state.liveVoiceStartPending = false;
        state.microphonePermission = 'granted';
        setLiveMicControls(true);
        setAssistantState('listening', 'LIVE VOICE');
        showFeedback('Listening in Hindi and English. Speak naturally; you can interrupt J.A.R.V.I.S. at any time.');
      },
      onInputTranscript(text, { final }) {
        if (final && text.trim()) addMessage({ role: 'user', content: text.trim() });
      },
      onOutputTranscript(text, { final }) {
        if (!final || !text.trim()) return;
        const message = { role: 'assistant', content: text.trim() };
        addMessage(message);
        speechReplayController.track(message);
        speechReplayController.markStarted(message);
      },
      onAudioStart: startLiveAudioPlayback,
      onAudioEnd: finishLiveAudioPlayback,
      onAudioLevel: syncAvatarAudioLevel,
      shouldPlayAudio: () => state.preferences.voiceEnabled,
      onInterrupted() {
        setAssistantState('listening', 'LIVE VOICE');
      },
      onTurnComplete() {
        if (!state.liveTextPending) return;
        state.liveTextPending = false;
        state.pending = false;
        elements.send.disabled = false;
        elements.dashboardSend.disabled = false;
      },
      onError(error) {
        if (error.code === 'MICROPHONE_TRACK_ENDED') {
          state.liveReconnectWanted = false;
          state.microphonePermission = 'unknown';
          renderMicrophoneStatus();
          if (state.preferences.wakeWordEnabled) {
            disableWakeWord('Microphone access ended. Wake-word detection is off until you enable it again.');
          } else {
            showFeedback('Microphone access ended. Check device permission or reconnect, then tap the microphone to resume.');
          }
          return;
        }
        if (error.code === 'LIVE_SESSION_TIMEOUT') {
          state.liveReconnectWanted = false;
          showFeedback(error.message);
          return;
        }
        showFeedback(error.message || 'Gemini Live voice encountered a connection error.');
      },
      onClosed() {
        const retryDelays = [750, 1_750];
        if (state.liveReconnectWanted && state.liveReconnectAttempts < retryDelays.length) {
          const delay = retryDelays[state.liveReconnectAttempts];
          state.liveReconnectAttempts += 1;
          state.liveVoiceStartPending = false;
          state.liveTextPending = false;
          state.pending = false;
          setLiveMicControls(false);
          finishLiveAudioPlayback();
          elements.send.disabled = false;
          elements.dashboardSend.disabled = false;
          setAssistantState('thinking', 'RECONNECTING TO GEMINI LIVE');
          showFeedback('Gemini Live disconnected. Reconnecting…');
          state.liveReconnectTimer = window.setTimeout(() => {
            if (state.liveReconnectWanted) startLiveConversation({ reconnect: true });
          }, delay);
          return;
        }
        finishLiveConversation('Gemini Live connection ended. Tap the microphone to reconnect.');
      },
    },
  }).catch((error) => {
    finishLiveConversation(error.message || 'Gemini Live voice could not start.');
    setAssistantState('error', 'LIVE VOICE UNAVAILABLE');
  });
}

function stopLiveConversation(message = '') {
  state.liveReconnectWanted = false;
  window.clearTimeout(state.liveReconnectTimer);
  state.liveReconnectTimer = null;
  geminiLiveVoice.stop();
  finishLiveConversation(message);
}

function pageIsFocused() {
  try {
    return typeof document.hasFocus === 'function' && document.hasFocus();
  } catch {
    return false;
  }
}

const speechInterruptionController = createInterruptionController({
  cancelSpeech: () => stopSpeechOutput(),
  onInterrupt: () => {
    showFeedback('Voice response interrupted. Listening for your request.');
    startListening('command');
  },
});

function stopSpeechInterruptionMonitor() {
  state.speechInterruptionMonitorToken += 1;
  state.speechInterruptionMonitorStarting = false;
  speechInterruptionController.setAssistantSpeaking(false);
  state.speechInterruptionMonitor?.stop();
  state.speechInterruptionMonitor = null;
}

async function startSpeechInterruptionMonitor() {
  if (state.speechInterruptionMonitor || state.speechInterruptionMonitorStarting) return;
  const token = ++state.speechInterruptionMonitorToken;
  state.speechInterruptionMonitorStarting = true;
  try {
    const monitor = await startMicrophoneMonitor({
      gate: createNoiseGate(),
      onFrame: (frame) => speechInterruptionController.handleFrame(frame),
    });
    if (token !== state.speechInterruptionMonitorToken || !isSpeechOutputBusy()) {
      monitor.stop();
      return;
    }
    state.speechInterruptionMonitor = monitor;
    speechInterruptionController.setAssistantSpeaking(true);
    elements.voiceConsoleStatus.textContent = 'BARGE-IN READY';
  } catch (error) {
    if (token !== state.speechInterruptionMonitorToken) return;
    speechInterruptionController.setAssistantSpeaking(false);
    elements.voiceConsoleStatus.textContent = 'MIC UNAVAILABLE';
    showFeedback(`Microphone unavailable for voice interruption: ${error.message} Use the text box to continue.`);
  } finally {
    if (token === state.speechInterruptionMonitorToken) state.speechInterruptionMonitorStarting = false;
  }
}

function speak(text, { onStart, onNotStarted, forceBrowser = false, skipLocal = false } = {}) {
  if (!state.preferences.voiceEnabled) {
    reportTtsDiagnostic('TTS utterance skipped', { reason: 'voice-output-disabled' });
    onNotStarted?.();
    return;
  }
  const speechText = String(text || '').trim();
  if (!speechText) {
    reportTtsDiagnostic('TTS utterance skipped', { reason: 'empty-text' });
    onNotStarted?.();
    return;
  }
  if (state.speechOutputTexts.has(speechText)) {
    reportTtsDiagnostic('TTS utterance skipped', { reason: 'duplicate-text' });
    onStart?.();
    return;
  }
  if (!shouldPlaySpeech(document.visibilityState, pageIsFocused())) {
    reportTtsDiagnostic('TTS utterance skipped', { reason: 'page-unfocused' });
    state.pendingSpeechText = null;
    state.pendingSpeechOptions = null;
    setAssistantState('', 'SYSTEM STANDBY');
    showFeedback('Voice output was skipped while J.A.R.V.I.S. was unfocused or in the background. The text reply is available.');
    onNotStarted?.();
    return;
  }
  if (!forceBrowser && !skipLocal && isLocalTtsUsable()) {
    state.speechOutputTexts.add(speechText);
    if (state.recognition) {
      reportTtsDiagnostic('TTS utterance deferred', { reason: 'recognition-active', engine: 'omnivoice' });
      state.pendingSpeechText = speechText;
      state.pendingSpeechOptions = { onStart, onNotStarted };
      requestStopListening(state.recognition, 'tts-deferred');
      return;
    }
    speakWithLocalVoice(speechText, { onStart, onNotStarted });
    return;
  }
  if (!forceBrowser && isGeminiLiveAvailable() && !geminiLiveVoice.isConversationActive) {
    state.speechOutputTexts.add(speechText);
    const requestId = ++state.speechPlaybackId;
    geminiLiveVoice.speakText(speechText, {
      headers: apiHeaders(),
      language: state.preferences.language,
      voiceName: selectedGeminiVoiceName(),
      callbacks: {
        onAudioStart() {
          if (state.speechPlaybackId !== requestId || !state.speechOutputTexts.has(speechText)) return;
          startLiveAudioPlayback();
          startSpeechInterruptionMonitor();
          onStart?.();
        },
        onAudioLevel: syncAvatarAudioLevel,
        onAudioEnd() {
          if (!state.livePlaybackId) return;
          stopSpeechInterruptionMonitor();
          finishLiveAudioPlayback();
          state.speechOutputTexts.delete(speechText);
          logActivity('Voice response complete');
          resumeWakeWordDetection();
        },
      },
    }).then((played) => {
      if (!state.speechOutputTexts.has(speechText)) return;
      state.speechOutputTexts.delete(speechText);
      if (!played && 'speechSynthesis' in window) {
        speak(speechText, { onStart, onNotStarted, forceBrowser: true });
      } else if (!played) {
        onNotStarted?.();
      }
    }).catch((error) => {
      if (!state.speechOutputTexts.has(speechText)) return;
      state.speechOutputTexts.delete(speechText);
      if ('speechSynthesis' in window) speak(speechText, { onStart, onNotStarted, forceBrowser: true });
      else {
        showFeedback(error.message || 'Gemini Live speech could not start.');
        onNotStarted?.();
      }
    });
    return;
  }
  if (geminiLiveVoice.isConversationActive) {
    onNotStarted?.();
    return;
  }
  if (!('speechSynthesis' in window)) {
    reportSpeechDiagnostic('TTS utterance skipped', { reason: 'speech-synthesis-unavailable' });
    onNotStarted?.();
    return;
  }
  state.speechOutputTexts.add(speechText);
  if (state.recognition) {
    reportTtsDiagnostic('TTS utterance deferred', {
      language: getSpeechRecognitionLanguage(state.preferences.language),
      reason: 'recognition-active',
    });
    state.pendingSpeechText = speechText;
    state.pendingSpeechOptions = { onStart, onNotStarted };
    requestStopListening(state.recognition, 'tts-deferred');
    return;
  }
  const playbackId = ++state.speechPlaybackId;
  portraitAnimation.cancelSpeech();
  state.speechStartMonitorCancel?.();
  state.speechStartMonitorCancel = null;
  state.pendingSpeechText = null;
  const voice = selectedVoice();
  const voiceDetails = {
    language: state.preferences.language === 'hi' ? 'hi-IN' : 'en-US',
    voiceName: voice?.name || 'System default',
    voiceLanguage: voice?.lang || 'unknown',
  };
  const queuedAt = performance.now();
  let startedAt = null;
  let utterance;
  try {
    utterance = new (window.SpeechSynthesisUtterance || globalThis.SpeechSynthesisUtterance)(speechText);
  } catch {
    reportTtsDiagnostic('TTS utterance creation failed', voiceDetails);
    state.speechOutputTexts.delete(speechText);
    portraitAnimation.cancelSpeech();
    state.speechPlaybackId += 1;
    setAssistantState('', 'SYSTEM STANDBY');
    showFeedback('Speech output could not start on this device.');
    resumeWakeWordDetection();
    onNotStarted?.();
    return;
  }
  utterance.lang = voiceDetails.language;
  utterance.rate = state.preferences.speechRate;
  utterance.voice = voice;
  let playbackStarted = false;
  const markPlaybackStarted = () => {
    if (playbackStarted || playbackId !== state.speechPlaybackId) return;
    playbackStarted = true;
    portraitAnimation.startSpeech(playbackId);
    window.dispatchEvent(new CustomEvent('jarvis:assistant-reply', { detail: { text: speechText } }));
    state.speechStartMonitorCancel?.();
    state.speechStartMonitorCancel = null;
    setAssistantState('speaking', 'VOICE OUTPUT');
    startSpeechInterruptionMonitor();
    logActivity('Voice response started');
  };
  utterance.onstart = () => {
    if (playbackId !== state.speechPlaybackId) return;
    startedAt = performance.now();
    reportTtsDiagnostic('TTS utterance onstart', {
      ...voiceDetails,
      queueDurationMs: Math.max(0, Math.round(startedAt - queuedAt)),
    });
    markPlaybackStarted();
    onStart?.();
  };
  utterance.onpause = () => {
    if (playbackId !== state.speechPlaybackId) return;
    portraitAnimation.pauseSpeech(playbackId);
    reportTtsDiagnostic('TTS utterance onpause', {
      ...voiceDetails,
      started: playbackStarted,
      ...(startedAt === null ? {} : { durationMs: Math.max(0, Math.round(performance.now() - startedAt)) }),
    });
    setAssistantState('', 'VOICE PAUSED');
  };
  utterance.onresume = () => {
    if (playbackId !== state.speechPlaybackId) return;
    portraitAnimation.resumeSpeech(playbackId);
    reportTtsDiagnostic('TTS utterance onresume', {
      ...voiceDetails,
      started: playbackStarted,
      ...(startedAt === null ? {} : { durationMs: Math.max(0, Math.round(performance.now() - startedAt)) }),
    });
    setAssistantState('speaking', 'VOICE OUTPUT');
  };
  utterance.onboundary = (event) => {
    if (
      playbackId !== state.speechPlaybackId
      || !playbackStarted
      || state.assistantMode !== 'speaking'
    ) return;
    applySpeechBoundaryCue(speechText, event, (opening, viseme) => {
      const boundaryIndex = Number.isInteger(event.charIndex) ? event.charIndex : 0;
      const prefix = speechText.slice(0, boundaryIndex);
      const boundaryWord = speechText.slice(boundaryIndex).match(/^[\p{L}\p{N}']+/u)?.[0] || '';
      const emphasis = opening >= 0.58 || boundaryWord.length >= 8 || /[.!?]\s*$/.test(prefix);
      portraitMotion.setSpeechCue(opening, viseme, { emphasis });
      portraitAnimation.setViseme(playbackId, viseme);
      if (avatar3dActivated && avatar3dInstance) {
        avatar3dInstance.setMouth?.(opening, { emphasis });
        avatar3dInstance.setViseme?.(viseme);
      }
    });
  };
  utterance.onend = () => {
    const endedAt = performance.now();
    reportTtsDiagnostic('TTS utterance onend', {
      ...voiceDetails,
      started: playbackStarted,
      elapsedMs: Math.max(0, Math.round(endedAt - queuedAt)),
      ...(startedAt === null ? {} : {
        queueDurationMs: Math.max(0, Math.round(startedAt - queuedAt)),
        durationMs: Math.max(0, Math.round(endedAt - startedAt)),
      }),
    });
    state.speechOutputTexts.delete(speechText);
    stopSpeechInterruptionMonitor();
    portraitAnimation.finishSpeech(playbackId);
    if (playbackId !== state.speechPlaybackId) return;
    resetAvatarMouth();
    if (!playbackStarted) onNotStarted?.();
    state.speechStartMonitorCancel?.();
    state.speechStartMonitorCancel = null;
    state.speechPlaybackId += 1;
    setAssistantState('', 'SYSTEM STANDBY');
    logActivity('Voice response complete');
    resumeWakeWordDetection();
  };
  utterance.onerror = (event) => {
    const erroredAt = performance.now();
    reportTtsDiagnostic('TTS utterance onerror', {
      ...voiceDetails,
      error: event.error || 'unknown',
      started: playbackStarted,
      elapsedMs: Math.max(0, Math.round(erroredAt - queuedAt)),
      ...(startedAt === null ? {} : {
        queueDurationMs: Math.max(0, Math.round(startedAt - queuedAt)),
        durationMs: Math.max(0, Math.round(erroredAt - startedAt)),
      }),
    });
    state.speechOutputTexts.delete(speechText);
    stopSpeechInterruptionMonitor();
    portraitAnimation.finishSpeech(playbackId);
    if (playbackId !== state.speechPlaybackId) return;
    resetAvatarMouth();
    if (!playbackStarted) onNotStarted?.();
    state.speechStartMonitorCancel?.();
    state.speechStartMonitorCancel = null;
    state.speechPlaybackId += 1;
    setAssistantState('', 'SYSTEM STANDBY');
    showFeedback(getSpeechSynthesisErrorMessage(event.error));
    resumeWakeWordDetection();
  };
  try {
    window.speechSynthesis.speak(utterance);
  } catch (error) {
    reportTtsDiagnostic('TTS utterance queue failed', {
      ...voiceDetails,
      error: error?.name || 'unknown',
    });
    state.speechOutputTexts.delete(speechText);
    portraitAnimation.cancelSpeech();
    state.speechPlaybackId += 1;
    setAssistantState('', 'SYSTEM STANDBY');
    showFeedback('Speech output could not start on this device.');
    resumeWakeWordDetection();
    onNotStarted?.();
    return;
  }
  reportTtsDiagnostic('TTS utterance queued', voiceDetails);
  try {
    window.speechSynthesis.resume?.();
  } catch (error) {
    reportTtsDiagnostic('TTS resume failed', {
      ...voiceDetails,
      error: error?.name || 'unknown',
    });
  }
  if (!playbackStarted) state.speechStartMonitorCancel = monitorSpeechSynthesisStart(window.speechSynthesis, {
    onTimeout: () => {
      if (playbackId !== state.speechPlaybackId) return;
      reportTtsDiagnostic('TTS utterance start timeout', {
        ...voiceDetails,
        started: false,
        elapsedMs: Math.max(0, Math.round(performance.now() - queuedAt)),
      });
      state.speechStartMonitorCancel = null;
      state.speechOutputTexts.delete(speechText);
      portraitAnimation.finishSpeech(playbackId);
      state.speechPlaybackId += 1;
      setAssistantState('', 'SYSTEM STANDBY');
      showFeedback(getSpeechSynthesisErrorMessage('timeout'));
      onNotStarted?.();
      resumeWakeWordDetection();
    },
  });
}

function stopSpeechOutput() {
  stopSpeechInterruptionMonitor();
  resetAvatarMouth();
  portraitAnimation.cancelSpeech();
  state.speechStartMonitorCancel?.();
  state.speechStartMonitorCancel = null;
  state.pendingSpeechText = null;
  state.pendingSpeechOptions = null;
  state.speechOutputTexts.clear();
  state.speechPlaybackId += 1;
  localTts.stop();
  state.localSpeechActive = false;
  geminiLiveVoice.stopSpeechPlayback();
  geminiLiveVoice.stopAudioPlayback();
  try {
    window.speechSynthesis.cancel();
  } catch (error) {
    console.warn('Unable to cancel browser speech synthesis.', error);
  }
  if (state.assistantMode === 'speaking') setAssistantState('', 'SYSTEM STANDBY');
  resumeWakeWordDetection();
}

function updateVoiceList() {
  state.voices = 'speechSynthesis' in window ? window.speechSynthesis.getVoices() : [];
  if (isGeminiLiveAvailable()) {
    const voices = ['Puck', 'Charon', 'Kore', 'Fenrir', 'Aoede', 'Zephyr'];
    elements.voice.replaceChildren(...voices.map((voice) => new Option(`Gemini · ${voice}`, `gemini:${voice}`)));
    elements.voice.value = state.preferences.voiceURI.startsWith('gemini:')
      ? state.preferences.voiceURI
      : 'gemini:Puck';
    elements.voice.disabled = false;
    elements.voiceEnabled.disabled = false;
    elements.voiceSupport.textContent = 'Natural voice generated by Gemini Live';
    updateLabVoiceOptions();
    return;
  }
  if (!('speechSynthesis' in window)) {
    elements.voice.disabled = true;
    elements.voiceEnabled.disabled = !geminiLiveVoice.supported;
    elements.voiceSupport.textContent = geminiLiveVoice.supported
      ? 'Select Google Gemini to use Live speech output'
      : 'Speech output is not supported by this browser';
    updateLabVoiceOptions();
    return;
  }
  elements.voice.replaceChildren(new Option('System default', ''));
  for (const voice of state.voices) {
    const label = `${voice.name} (${voice.lang})${voice.default ? ' · default' : ''}`;
    elements.voice.add(new Option(label, voice.voiceURI));
  }
  const savedVoice = state.preferences.voiceURI.startsWith('gemini:') ? '' : state.preferences.voiceURI;
  elements.voice.value = savedVoice;
  elements.voiceSupport.textContent = state.labPreferences.voiceURI
    ? 'A LAB voice override is active. Your saved J.A.R.V.I.S. voice setting remains unchanged.'
    : state.voices.length ? `${state.voices.length} voice${state.voices.length === 1 ? '' : 's'} available on this device` : 'No system voices are available';
  updateLabVoiceOptions();
  if (!elements.personalizePanel.hidden && personalizeDraft) renderPersonalizePreview(personalizeDraft);
}

function updateLabVoiceOptions(selectedURI = personalizeDraft?.voiceURI ?? state.labPreferences.voiceURI) {
  if (!elements.labVoice) return;
  elements.labVoice.replaceChildren(new Option('System default', ''));
  for (const voice of state.voices) {
    elements.labVoice.add(new Option(redactSensitiveText(`${voice.name} (${voice.lang})${voice.default ? ' · default' : ''}`), voice.voiceURI));
  }
  if (selectedURI && !state.voices.some((voice) => voice.voiceURI === selectedURI)) {
    elements.labVoice.add(new Option('Saved voice unavailable on this device', selectedURI));
  }
  elements.labVoice.value = selectedURI;
  elements.labVoice.disabled = !('speechSynthesis' in window);
  const voiceHelp = document.querySelector('#lab-voice-help');
  voiceHelp.textContent = 'Applied LAB voice overrides output while selected; your saved J.A.R.V.I.S. voice setting remains unchanged. Choose System default to restore it.';
  if (!('speechSynthesis' in window)) voiceHelp.textContent = 'Speech voices are not available in this browser. The LAB preference remains separate.';
}

function readPersonalizeForm() {
  const form = elements.personalizeForm;
  const checkedValue = (name) => form.querySelector(`input[name="${name}"]:checked`)?.value;
  return {
    theme: checkedValue('lab-theme') || DEFAULT_LAB_PREFERENCES.theme,
    accent: checkedValue('lab-accent') || DEFAULT_LAB_PREFERENCES.accent,
    density: elements.labDensity.value,
    voiceURI: elements.labVoice.value,
    widgets: {
      assistant: form.elements.namedItem('lab-widget-assistant').checked,
      status: form.elements.namedItem('lab-widget-status').checked,
      voice: form.elements.namedItem('lab-widget-voice').checked,
      chat: form.elements.namedItem('lab-widget-chat').checked,
      system: form.elements.namedItem('lab-widget-system').checked,
    },
  };
}

function syncPersonalizeForm(preferences) {
  for (const name of ['lab-theme', 'lab-accent']) {
    const value = preferences[name === 'lab-theme' ? 'theme' : 'accent'];
    const radio = elements.personalizeForm.querySelector(`input[name="${name}"][value="${value}"]`);
    if (radio) radio.checked = true;
  }
  elements.labDensity.value = preferences.density;
  updateLabVoiceOptions(preferences.voiceURI);
  for (const [key, checked] of Object.entries(preferences.widgets)) {
    elements.personalizeForm.elements.namedItem(`lab-widget-${key}`).checked = checked;
  }
  renderPersonalizePreview(preferences);
}

function renderPersonalizePreview(preferences) {
  const preview = elements.personalizePreview;
  preview.dataset.theme = preferences.theme;
  preview.dataset.density = preferences.density;
  preview.dataset.accent = preferences.accent;
  preview.style.setProperty('--lab-accent', LAB_ACCENTS[preferences.accent]);
  for (const widget of preview.querySelectorAll('[data-preview-widget]')) {
    widget.hidden = preferences.widgets[widget.dataset.previewWidget] === false;
  }
  const themeName = preferences.theme[0].toUpperCase() + preferences.theme.slice(1);
  const densityName = preferences.density[0].toUpperCase() + preferences.density.slice(1);
  elements.personalizePreviewNote.textContent = `${themeName} theme · ${densityName} layout`;
  elements.personalizePreviewVoice.textContent = redactSensitiveText(elements.labVoice.selectedOptions[0]?.textContent || 'System default voice');
}

function renderLabSafetyStatus() {
  elements.labSafetyChangeState.textContent = LAB_PROJECT_CHANGES_ENABLED
    ? 'Enabled only through audited approval controls.'
    : 'Disabled · project files cannot be changed by J.A.R.V.I.S. LAB.';
}

function openPersonalizePanel() {
  renderLabSafetyStatus();
  personalizeDraft = loadLabPreferences(getLocalStorageSafely());
  syncPersonalizeForm(personalizeDraft);
  elements.aiModifyPanel.hidden = true;
  elements.codeStudioPanel.hidden = true;
  elements.extensionsPanel.hidden = true;
  elements.labModules.hidden = true;
  elements.personalizePanel.hidden = false;
  elements.labSafetyPanel.hidden = true;
  elements.personalizeStatus.textContent = 'Changes are preview-only until applied.';
  elements.personalizeTitle.focus();
}

function closePersonalizePanel() {
  personalizeDraft = null;
  elements.personalizePanel.hidden = true;
  elements.labModules.hidden = false;
  elements.labSafetyPanel.hidden = false;
  document.querySelector('[data-lab-module="personalize"]').focus();
}

function renderLabAiModifyHistory() {
  const history = loadLabAiModifyHistory(localStorage);
  elements.aiModifyHistory.replaceChildren();
  if (!history.length) {
    const empty = document.createElement('li');
    empty.className = 'ai-modify-history-empty';
    empty.textContent = 'No proposal activity yet.';
    elements.aiModifyHistory.append(empty);
    return;
  }
  for (const entry of history.slice().reverse()) {
    const item = document.createElement('li');
    const time = document.createElement('time');
    time.dateTime = new Date(entry.timestamp).toISOString();
    time.textContent = new Date(entry.timestamp).toLocaleString();
    const message = document.createElement('span');
    message.textContent = redactSensitiveText(entry.message);
    item.append(time, message);
    elements.aiModifyHistory.append(item);
  }
}

function recordLabAiModifyEvent(status) {
  try {
    recordLabAiModifyHistory(localStorage, status);
    renderLabAiModifyHistory();
    return true;
  } catch (error) {
    elements.aiModifyStatus.textContent = `Local history could not be saved: ${error.message}`;
    return false;
  }
}

function openLabAiModifyPanel() {
  renderLabSafetyStatus();
  elements.labModules.hidden = true;
  elements.personalizePanel.hidden = true;
  elements.codeStudioPanel.hidden = true;
  elements.extensionsPanel.hidden = true;
  elements.aiModifyPanel.hidden = false;
  elements.labSafetyPanel.hidden = true;
  elements.aiModifyRequest.value = '';
  elements.aiModifyPlanStatus.textContent = 'No plan generated';
  renderLabAiModifyHistory();
  elements.aiModifyTitle.focus();
}

function closeLabAiModifyPanel() {
  elements.aiModifyRequest.value = '';
  elements.aiModifyPanel.hidden = true;
  elements.labModules.hidden = false;
  elements.labSafetyPanel.hidden = false;
  document.querySelector('[data-lab-module="ai-modify"]').focus();
}

function submitLabAiModifyRequest(event) {
  event.preventDefault();
  const outcome = getLabAiModifyRequestStatus(elements.aiModifyRequest.value);
  if (outcome === 'empty') {
    elements.aiModifyStatus.textContent = 'Describe a change before requesting a proposal.';
    elements.aiModifyRequest.focus();
    return;
  }
  if (!recordLabAiModifyEvent(outcome)) return;
  elements.aiModifyPlanStatus.textContent = 'Unavailable · no plan generated';
  elements.aiModifyStatus.textContent = 'AI Modify is not connected. Your request was not sent, and no plan or diff was generated.';
}

function cancelLabAiModifyRequest() {
  if (elements.aiModifyRequest.value.trim() && !recordLabAiModifyEvent('cancelled')) return;
  closeLabAiModifyPanel();
}

function rejectLabAiModifyRequest() {
  if (!elements.aiModifyRequest.value.trim()) {
    elements.aiModifyStatus.textContent = 'There is no generated proposal to reject.';
    return;
  }
  if (!recordLabAiModifyEvent('rejected')) return;
  elements.aiModifyRequest.value = '';
  elements.aiModifyPlanStatus.textContent = 'No plan generated';
  elements.aiModifyStatus.textContent = 'Request rejected and discarded. No proposal was generated or applied.';
}

function openCodeStudioPanel() {
  renderLabSafetyStatus();
  elements.labModules.hidden = true;
  elements.personalizePanel.hidden = true;
  elements.aiModifyPanel.hidden = true;
  elements.extensionsPanel.hidden = true;
  elements.codeStudioPanel.hidden = false;
  elements.labSafetyPanel.hidden = true;
  updateCodeStudioEditorState();
  elements.codeStudioTitle.focus();
}

function closeCodeStudioPanel() {
  elements.codeStudioPanel.hidden = true;
  elements.labModules.hidden = false;
  elements.labSafetyPanel.hidden = false;
  document.querySelector('[data-lab-module="code-studio"]').focus();
}

function updateCodeStudioReview() {
  const code = elements.codeStudioEditor.value;
  const findings = reviewCodeLocally(code);
  elements.codeStudioCount.textContent = `${code.length.toLocaleString()} characters · ${code.split(/\r?\n/).length.toLocaleString()} line${code.split(/\r?\n/).length === 1 ? '' : 's'}`;
  elements.codeStudioFindings.replaceChildren();
  if (!code.trim()) {
    elements.codeStudioReviewSummary.textContent = 'Paste or import code to see local, non-executing review suggestions.';
    const empty = document.createElement('li');
    empty.textContent = 'No review findings.';
    elements.codeStudioFindings.append(empty);
    return;
  }
  elements.codeStudioReviewSummary.textContent = findings.length
    ? `${findings.length} heuristic finding${findings.length === 1 ? '' : 's'} · review manually; this is not a full security audit.`
    : 'No heuristic issues found. This is not a full security audit.';
  if (!findings.length) {
    const empty = document.createElement('li');
    empty.textContent = 'No heuristic findings.';
    elements.codeStudioFindings.append(empty);
    return;
  }
  for (const finding of findings) {
    const item = document.createElement('li');
    const severity = document.createElement('strong');
    severity.textContent = `${finding.severity.toUpperCase()} · line ${finding.line}`;
    const message = document.createElement('span');
    message.textContent = finding.title;
    item.append(severity, message);
    elements.codeStudioFindings.append(item);
  }
}

function updateCodeStudioEditorState() {
  const readOnly = elements.codeStudioReadonly.checked;
  if (readOnly) {
    if (codeStudioPreviewSource === null) codeStudioPreviewSource = elements.codeStudioEditor.value;
    elements.codeStudioEditor.value = redactSensitiveText(codeStudioPreviewSource);
  } else if (codeStudioPreviewSource !== null) {
    elements.codeStudioEditor.value = codeStudioPreviewSource;
    codeStudioPreviewSource = null;
  }
  elements.codeStudioEditor.readOnly = readOnly;
  elements.codeStudioStatus.textContent = readOnly
    ? 'Read-only preview enabled. Credential-like values are masked; switch it off to edit the original local text.'
    : 'Editing local text only. Nothing is executed or written to the project.';
  updateCodeStudioReview();
}

async function importCodeStudioFile() {
  const file = elements.codeStudioFile.files?.[0];
  elements.codeStudioFile.value = '';
  if (!file) return;
  const validation = validateCodeFile(file);
  if (!validation.valid) {
    elements.codeStudioStatus.textContent = validation.reason;
    return;
  }
  try {
    const text = await file.text();
    codeStudioPreviewSource = elements.codeStudioReadonly.checked ? text : null;
    elements.codeStudioEditor.value = elements.codeStudioReadonly.checked ? redactSensitiveText(text) : text;
    elements.codeStudioLanguage.value = validation.language;
    updateCodeStudioReview();
    elements.codeStudioStatus.textContent = redactSensitiveText(
      `${containsSensitiveText(text) ? 'Imported with credential-like values masked' : 'Imported'} ${file.name} as untrusted text for local preview only. It was not executed or saved to the project.`,
    );
  } catch (error) {
    elements.codeStudioStatus.textContent = `Could not read the selected file: ${error.message}`;
  }
}

async function copyCodeStudioText() {
  if (!elements.codeStudioEditor.value) {
    elements.codeStudioStatus.textContent = 'There is no code to copy.';
    return;
  }
  try {
    const source = elements.codeStudioReadonly.checked && codeStudioPreviewSource !== null
      ? codeStudioPreviewSource
      : elements.codeStudioEditor.value;
    const safeText = redactSensitiveText(source);
    if (!await copyTextToClipboard(safeText)) {
      elements.codeStudioStatus.textContent = 'Clipboard access was denied. Select and copy the code manually.';
      return;
    }
    elements.codeStudioStatus.textContent = safeText === source
      ? 'Code copied to this device clipboard only; it was not sent or executed.'
      : 'Code copied with credential-like values redacted. The editor remains unchanged.';
  } catch (error) {
    elements.codeStudioStatus.textContent = `Code could not be copied: ${error.message}`;
  }
}

function exportCodeStudioText() {
  const code = elements.codeStudioReadonly.checked && codeStudioPreviewSource !== null
    ? codeStudioPreviewSource
    : elements.codeStudioEditor.value;
  if (!code) {
    elements.codeStudioStatus.textContent = 'There is no code to export.';
    return;
  }
  if (!window.confirm('Export a separate text copy? Review it for API keys, passwords, tokens, and other secrets first. This downloads to your device and does not modify the project.')) {
    elements.codeStudioStatus.textContent = 'Export canceled. No file was downloaded.';
    return;
  }
  let url = '';
  let link = null;
  try {
    const { blob, fileName } = createCodeExport(code, elements.codeStudioLanguage.value);
    url = URL.createObjectURL(blob);
    link = document.createElement('a');
    link.href = url;
    link.download = fileName;
    link.hidden = true;
    document.body.append(link);
    link.click();
    elements.codeStudioStatus.textContent = containsSensitiveText(code)
      ? `${fileName} downloaded with credential-like values redacted. The editor and project were not changed.`
      : `${fileName} downloaded as a separate plain-text copy. The project was not changed.`;
  } catch (error) {
    elements.codeStudioStatus.textContent = `Code could not be exported: ${error.message}`;
  } finally {
    link?.remove();
    if (url) window.setTimeout(() => URL.revokeObjectURL(url), 0);
  }
}

function clearCodeStudioText() {
  if (!elements.codeStudioEditor.value) {
    elements.codeStudioStatus.textContent = 'The editor is already clear.';
    return;
  }
  elements.codeStudioEditor.value = '';
  codeStudioPreviewSource = null;
  elements.codeStudioReadonly.checked = false;
  updateCodeStudioEditorState();
  updateCodeStudioReview();
  elements.codeStudioStatus.textContent = 'Local editor text cleared.';
}

function prepareCodeStudioImport() {
  if (!window.confirm('Import a local code or text file for preview? It will be treated as untrusted text, stay in this tab, and will not be executed or written to the project. Files are limited to 1 MB.')) {
    elements.codeStudioStatus.textContent = 'Import canceled. No file was opened.';
    return;
  }
  elements.codeStudioFile.click();
}

function extensionStatusLabel(state) {
  return ({
    'pending-review': 'Pending review',
    installed: 'Installed · enabled state (metadata only)',
    disabled: 'Disabled · installed',
  })[state] || 'Unknown state';
}

function renderLabExtensionHistory(history) {
  elements.extensionsHistory.replaceChildren();
  if (!history.length) {
    const empty = document.createElement('li');
    empty.className = 'extensions-history-empty';
    empty.textContent = 'No extension activity yet.';
    elements.extensionsHistory.append(empty);
    return;
  }
  for (const entry of history.slice().reverse()) {
    const item = document.createElement('li');
    const time = document.createElement('time');
    time.dateTime = new Date(entry.timestamp).toISOString();
    time.textContent = new Date(entry.timestamp).toLocaleString();
    const description = document.createElement('span');
    description.textContent = `${redactSensitiveText(entry.extensionName)} · ${entry.action.replaceAll('-', ' ')}`;
    item.append(time, description);
    elements.extensionsHistory.append(item);
  }
}

function renderLabExtensions() {
  let store;
  try {
    store = loadLabExtensions(localStorage);
  } catch (error) {
    elements.extensionsCount.textContent = 'DATA UNAVAILABLE';
    elements.extensionsList.replaceChildren();
    elements.extensionsHistory.replaceChildren();
    elements.extensionsStatus.textContent = redactSensitiveText(`Saved extension data could not be read safely: ${error.message}`);
    return false;
  }
  elements.extensionsCount.textContent = `${store.extensions.length} EXTENSION${store.extensions.length === 1 ? '' : 'S'}`;
  elements.extensionsList.replaceChildren();
  if (!store.extensions.length) {
    const empty = document.createElement('p');
    empty.className = 'extensions-empty';
    empty.textContent = 'No imported extensions.';
    elements.extensionsList.append(empty);
  }
  for (const extension of store.extensions) {
    const card = document.createElement('article');
    card.className = 'extension-card';
    card.dataset.extensionId = extension.id;

    const heading = document.createElement('div');
    heading.className = 'extension-card-heading';
    const title = document.createElement('div');
    const name = document.createElement('h4');
    name.textContent = redactSensitiveText(extension.manifest.name);
    const version = document.createElement('span');
    version.textContent = `Version ${extension.manifest.version}`;
    title.append(name, version);
    const state = document.createElement('span');
    state.className = `extension-state is-${extension.state}`;
    state.textContent = extensionStatusLabel(extension.state);
    heading.append(title, state);

    const description = document.createElement('p');
    description.className = 'extension-description';
    description.textContent = redactSensitiveText(extension.manifest.description || 'No description provided.');

    const permissionHeading = document.createElement('strong');
    permissionHeading.className = 'extension-permission-title';
    permissionHeading.textContent = 'Requested permissions · not granted';
    const permissions = document.createElement('ul');
    permissions.className = 'extension-permissions';
    if (!extension.manifest.permissions.length) {
      const none = document.createElement('li');
      none.textContent = 'No permissions requested.';
      permissions.append(none);
    }
    for (const permission of extension.manifest.permissions) {
      const item = document.createElement('li');
      item.textContent = redactSensitiveText(permission);
      permissions.append(item);
    }

    const fileSummary = document.createElement('p');
    fileSummary.className = 'extension-file-summary';
    fileSummary.textContent = `${Object.keys(extension.files).length} package file${Object.keys(extension.files).length === 1 ? '' : 's'} stored as inert text.`;

    const actions = document.createElement('div');
    actions.className = 'extension-actions';
    const addAction = (action, label, className = 'personalize-secondary-button') => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = className;
      button.dataset.extensionAction = action;
      button.dataset.extensionId = extension.id;
      button.textContent = label;
      actions.append(button);
    };
    if (extension.state === 'pending-review') {
      addAction('approve', 'Review permissions & install', 'personalize-apply-button');
      addAction('reject', 'Reject package');
      addAction('export', 'Export package');
    } else {
      addAction(extension.state === 'disabled' ? 'enable' : 'disable', extension.state === 'disabled' ? 'Enable' : 'Disable');
      addAction('export', 'Export package');
      addAction('remove', 'Remove', 'personalize-secondary-button');
    }
    card.append(heading, description, permissionHeading, permissions, fileSummary, actions);
    elements.extensionsList.append(card);
  }
  renderLabExtensionHistory(store.history);
  return true;
}

function openExtensionsPanel() {
  renderLabSafetyStatus();
  elements.labModules.hidden = true;
  elements.personalizePanel.hidden = true;
  elements.aiModifyPanel.hidden = true;
  elements.codeStudioPanel.hidden = true;
  elements.extensionsPanel.hidden = false;
  elements.labSafetyPanel.hidden = true;
  elements.extensionsStatus.textContent = 'Packages are stored locally as inert data. No extension runtime is available.';
  renderLabExtensions();
  elements.extensionsTitle.focus();
}

function closeExtensionsPanel() {
  elements.extensionsPanel.hidden = true;
  elements.labModules.hidden = false;
  elements.labSafetyPanel.hidden = false;
  document.querySelector('[data-lab-module="extensions"]').focus();
}

function createExtensionId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `extension-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

async function importLabExtension() {
  const file = elements.extensionsFile.files?.[0];
  elements.extensionsFile.value = '';
  if (!file) return;
  const fileStatus = getExtensionPackageFileStatus(file);
  if (!fileStatus.valid) {
    elements.extensionsStatus.textContent = fileStatus.reason;
    return;
  }
  try {
    const packageText = await file.text();
    if (new TextEncoder().encode(packageText).byteLength > EXTENSION_PACKAGE_MAX_BYTES) {
      elements.extensionsStatus.textContent = 'Extension package exceeds the 512 KB limit.';
      return;
    }
    const packageData = validateExtensionPackageText(packageText, file.name);
    if (!packageData.valid) {
      elements.extensionsStatus.textContent = packageData.reason;
      return;
    }
    const extension = addPendingExtension(localStorage, packageData, { id: createExtensionId() });
    if (!renderLabExtensions()) return;
    elements.extensionsStatus.textContent = redactSensitiveText(`${extension.manifest.name} ${extension.manifest.version} added as pending review. Review all requested permissions before approval.`);
  } catch (error) {
    elements.extensionsStatus.textContent = redactSensitiveText(`Package could not be imported: ${error.message}`);
  }
}

function promptExtensionImport() {
  const accepted = window.confirm(
    'Import an untrusted extension package for local metadata review? It will not be executed or granted access to J.A.R.V.I.S. settings, provider keys, or secrets.',
  );
  if (!accepted) {
    elements.extensionsStatus.textContent = 'Import canceled. No package was opened.';
    return;
  }
  elements.extensionsFile.click();
}

function approveLabExtension(extension) {
  const safeName = redactSensitiveText(extension.manifest.name);
  const requested = extension.manifest.permissions.length
    ? extension.manifest.permissions.map((permission) => `• ${redactSensitiveText(permission)}`).join('\n')
    : 'No permissions requested.';
  const accepted = window.confirm(
    `Review ${safeName} ${extension.manifest.version} and approve installation in disabled state?\n\nRequested permissions (not granted):\n${requested}\n\nApproval stores package metadata only. No code runs and no permissions or secret access are granted.`,
  );
  if (!accepted) {
    elements.extensionsStatus.textContent = 'Approval canceled. Package remains pending review.';
    return;
  }
  try {
    setLabExtensionState(localStorage, extension.id, 'disabled');
    if (!renderLabExtensions()) return;
    elements.extensionsStatus.textContent = `${safeName} installed disabled. No runtime access has been granted.`;
  } catch (error) {
    elements.extensionsStatus.textContent = redactSensitiveText(`Extension approval failed: ${error.message}`);
  }
}

function changeLabExtensionState(extension, enabled) {
  if (enabled && !window.confirm(
    `Enable ${redactSensitiveText(extension.manifest.name)} in the manager? This changes metadata state only. The package remains inert; no code runs and no permissions are granted.`,
  )) {
    elements.extensionsStatus.textContent = 'Enable canceled. Extension remains disabled.';
    return;
  }
  try {
    setLabExtensionState(localStorage, extension.id, enabled ? 'installed' : 'disabled');
    if (!renderLabExtensions()) return;
    elements.extensionsStatus.textContent = enabled
      ? `${redactSensitiveText(extension.manifest.name)} marked enabled in metadata only; runtime execution remains unavailable.`
      : `${redactSensitiveText(extension.manifest.name)} disabled.`;
  } catch (error) {
    elements.extensionsStatus.textContent = redactSensitiveText(`Extension state could not be changed: ${error.message}`);
  }
}

function rejectLabExtension(extension) {
  const safeName = redactSensitiveText(extension.manifest.name);
  if (!window.confirm(`Reject and remove pending package "${safeName}"?`)) {
    elements.extensionsStatus.textContent = 'Rejection canceled. Package remains pending review.';
    return;
  }
  try {
    recordLabExtensionRejection(localStorage, extension);
    if (!renderLabExtensions()) return;
    elements.extensionsStatus.textContent = `${safeName} rejected and removed.`;
  } catch (error) {
    elements.extensionsStatus.textContent = redactSensitiveText(`Package could not be rejected: ${error.message}`);
  }
}

function removeManagedLabExtension(extension) {
  const safeName = redactSensitiveText(extension.manifest.name);
  if (!window.confirm(`Remove "${safeName}" and its locally stored package files? This cannot be undone.`)) {
    elements.extensionsStatus.textContent = 'Removal canceled.';
    return;
  }
  try {
    removeLabExtension(localStorage, extension.id);
    if (!renderLabExtensions()) return;
    elements.extensionsStatus.textContent = `${safeName} and its local package data were removed.`;
  } catch (error) {
    elements.extensionsStatus.textContent = redactSensitiveText(`Extension could not be removed: ${error.message}`);
  }
}

function exportManagedLabExtension(extension) {
  if (!window.confirm(
    `Export "${redactSensitiveText(extension.manifest.name)}" as a package download? Credential-like values will be redacted before download.`,
  )) {
    elements.extensionsStatus.textContent = 'Export canceled. No package was downloaded.';
    return;
  }
  let url = '';
  let link = null;
  let downloaded = false;
  try {
    const packageText = serializeLabExtensionPackage(extension);
    const blob = new Blob([packageText], { type: 'application/json;charset=utf-8' });
    url = URL.createObjectURL(blob);
    link = document.createElement('a');
    link.href = url;
    link.download = `${extension.id.replace(/[^a-zA-Z0-9_-]/g, '-')}.jarvis-extension.json`;
    link.hidden = true;
    document.body.append(link);
    link.click();
    downloaded = true;
    recordLabExtensionExport(localStorage, extension);
    if (!renderLabExtensions()) return;
    elements.extensionsStatus.textContent = containsSensitiveText(extension)
      ? `${redactSensitiveText(extension.manifest.name)} exported with credential-like values redacted. The project was not changed.`
      : `${redactSensitiveText(extension.manifest.name)} exported as a separate JSON package. The project was not changed.`;
  } catch (error) {
    elements.extensionsStatus.textContent = downloaded
      ? redactSensitiveText(`Package downloaded, but export history could not be saved: ${error.message}`)
      : redactSensitiveText(`Extension package could not be exported: ${error.message}`);
  } finally {
    link?.remove();
    if (url) window.setTimeout(() => URL.revokeObjectURL(url), 0);
  }
}

function handleLabExtensionAction(event) {
  const button = event.target.closest('[data-extension-action]');
  if (!button) return;
  let extension;
  try {
    extension = loadLabExtensions(localStorage).extensions.find(({ id }) => id === button.dataset.extensionId);
  } catch (error) {
    elements.extensionsStatus.textContent = redactSensitiveText(`Saved extension data could not be read safely: ${error.message}`);
    renderLabExtensions();
    return;
  }
  if (!extension) {
    elements.extensionsStatus.textContent = 'Extension is no longer available. Refresh the manager.';
    renderLabExtensions();
    return;
  }
  const action = button.dataset.extensionAction;
  if (action === 'approve') approveLabExtension(extension);
  else if (action === 'reject') rejectLabExtension(extension);
  else if (action === 'enable') changeLabExtensionState(extension, true);
  else if (action === 'disable') changeLabExtensionState(extension, false);
  else if (action === 'remove') removeManagedLabExtension(extension);
  else if (action === 'export') exportManagedLabExtension(extension);
}

function resetPersonalizeDraft() {
  personalizeDraft = resetLabPreferencesDraft();
  syncPersonalizeForm(personalizeDraft);
  elements.personalizeStatus.textContent = 'Default values are preview-only until you apply them.';
}

function applyPersonalizeDraft() {
  personalizeDraft = readPersonalizeForm();
  let savedPreferences;
  try {
    savedPreferences = saveLabPreferences(personalizeDraft, localStorage);
  } catch (error) {
    elements.personalizeStatus.textContent = 'Preferences could not be saved. Your active settings were not changed.';
    showFeedback(`Personalization preferences could not be saved: ${error.message}`);
    return;
  }
  state.labPreferences = savedPreferences;
  try {
    applyLabPreferences(state.labPreferences, document);
    updateVoiceList();
    elements.personalizeStatus.textContent = 'Preferences applied and saved separately from J.A.R.V.I.S. settings.';
  } catch (error) {
    elements.personalizeStatus.textContent = 'Preferences were saved, but could not be fully applied.';
    showFeedback(`Saved personalization preferences could not be applied: ${error.message}`);
  }
}

function updateWakeWordSupport() {
  const supported = Boolean(getSpeechRecognitionConstructor(window));
  if (!supported || window.isSecureContext === false) {
    elements.wakeWordEnabled.disabled = true;
    elements.wakeWordEnabled.checked = false;
    state.preferences.wakeWordEnabled = false;
    savePreferences();
    elements.wakeWordSupport.textContent = supported
      ? 'Wake-word detection requires HTTPS or localhost.'
      : 'Wake-word detection is not supported by this browser.';
    return false;
  }
  elements.wakeWordEnabled.disabled = false;
  elements.wakeWordEnabled.checked = state.preferences.wakeWordEnabled;
  elements.wakeWordSupport.textContent = 'Say "Hey JARVIS" or "हे जार्विस" while this app is open. Requires microphone permission; recognition may use your browser speech service.';
  return true;
}

function disableWakeWord(message = '') {
  state.preferences.wakeWordEnabled = false;
  state.wakeWordResumePending = false;
  state.wakeWordRestartDelay = 600;
  elements.wakeWordEnabled.checked = false;
  window.clearTimeout(state.wakeWordRestartTimer);
  state.wakeWordRestartTimer = null;
  savePreferences();
  if (message) showFeedback(message);
}

function resumeWakeWordDetection(reason = 'assistant-workflow-complete') {
  if (!state.wakeWordResumePending || !state.preferences.wakeWordEnabled) return;
  if (state.liveVoiceStartPending || geminiLiveVoice.isConversationActive) return;
  if (!shouldRunWakeWord(state.preferences.wakeWordEnabled, document.visibilityState, state.wakeWordPagePaused, state.microphonePermission, pageIsFocused())) return;
  if (state.recognition || state.pending || isSpeechOutputBusy()) return;
  state.wakeWordResumePending = false;
  window.clearTimeout(state.wakeWordRestartTimer);
  let cooldownRestart = wakeWordRecoveryPolicy.cooldownRemainingMs > 0;
  let restartDelay = cooldownRestart
    ? wakeWordRecoveryPolicy.cooldownRemainingMs
    : state.wakeWordRestartDelay;
  if (!cooldownRestart && !wakeWordRecoveryPolicy.canRetry()) {
    restartDelay = wakeWordRecoveryPolicy.startCooldown();
    cooldownRestart = true;
    state.wakeWordRestartDelay = 600;
    showFeedback('Wake-word listening will retry automatically after a short cooldown.');
  }
  reportSpeechDiagnostic(cooldownRestart ? 'Wake-word retry cooldown scheduled' : 'Wake-word automatic restart scheduled', {
    attempt: cooldownRestart ? WAKE_WORD_MAX_RESTART_ATTEMPTS : wakeWordRecoveryPolicy.restartAttempts + 1,
    delayMs: restartDelay,
    reason: cooldownRestart ? 'retry-limit-reached' : reason,
  });
  state.wakeWordRestartTimer = window.setTimeout(() => {
    state.wakeWordRestartTimer = null;
    if (!state.preferences.wakeWordEnabled) return;
    if (!shouldRunWakeWord(state.preferences.wakeWordEnabled, document.visibilityState, state.wakeWordPagePaused, state.microphonePermission, pageIsFocused())) {
      state.wakeWordResumePending = true;
      return;
    }
    if (state.recognition || state.pending || isSpeechOutputBusy() || state.liveVoiceStartPending || geminiLiveVoice.isConversationActive) {
      state.wakeWordResumePending = true;
      resumeWakeWordDetection();
      return;
    }
    if (cooldownRestart) {
      wakeWordRecoveryPolicy.finishCooldown();
      reportSpeechDiagnostic('Wake-word retry cooldown ended', {
        attempt: wakeWordRecoveryPolicy.restartAttempts,
        reason: 'cooldown-expired',
      });
      state.wakeWordResumePending = true;
      resumeWakeWordDetection('retry-cooldown-ended');
      return;
    }
    const attempt = wakeWordRecoveryPolicy.recordRestartAttempt();
    if (attempt === null) {
      state.wakeWordResumePending = true;
      resumeWakeWordDetection('retry-limit-reached');
      return;
    }
    state.wakeWordResumePending = false;
    reportSpeechDiagnostic('Wake-word automatic restart attempted', {
      attempt,
      delayMs: restartDelay,
      reason,
    });
    startListening('wake', false, true);
  }, restartDelay);
}

function scheduleWakeWordRecovery(reason = 'recognition-ended-after-activation') {
  if (!state.preferences.wakeWordEnabled) return;
  state.wakeWordRestartDelay = nextWakeWordRestartDelay(state.wakeWordRestartDelay);
  state.wakeWordResumePending = true;
  resumeWakeWordDetection(reason);
}

function clearRecognitionStartTimer() {
  window.clearTimeout(state.recognitionStartTimer);
  state.recognitionStartTimer = null;
}

function isSpeechOutputBusy() {
  return state.assistantMode === 'speaking'
    || geminiLiveVoice.isSpeaking
    || state.localSpeechActive
    || Boolean(window.speechSynthesis?.speaking)
    || Boolean(window.speechSynthesis?.pending);
}

function startListening(purpose = 'command', wakeHandoff = false, automaticWakeRestart = false, fromUserGesture = false) {
  const Recognition = getSpeechRecognitionConstructor(window);
  if (purpose === 'wake') reportWakeWordStatus('start-attempt');
  if (purpose === 'wake' && automaticWakeRestart && wakeWordRecoveryPolicy.circuitOpen) {
    reportSpeechDiagnostic('Wake-word listening blocked', {
      reason: 'retry-limit-reached',
    });
    return;
  }
  if (!Recognition) {
    if (purpose === 'wake') {
      reportSpeechDiagnostic('Wake-word listening blocked', {
        reason: 'recognition-unavailable',
      });
    }
    const message = 'Voice input is not supported by this browser. Try a current Chrome-based browser over HTTPS.';
    if (purpose === 'wake' || wakeHandoff) disableWakeWord(message);
    else showFeedback(message);
    setAssistantState('error', 'VOICE INPUT UNAVAILABLE');
    return;
  }
  if (state.recognition) {
    if (purpose === 'wake') {
      reportSpeechDiagnostic('Wake-word listening blocked', {
        reason: state.wakeWordManualRetryPending ? 'manual-retry-waiting-for-end' : 'recognition-active',
      });
      state.wakeWordResumePending = true;
      return;
    }
    if (state.recognitionWakeSession) {
      disableWakeWord('Wake-word detection is off. Listening for your request.');
      state.wakeWordManualTakeoverPending = true;
      requestStopListening(state.recognition, 'manual-wake-takeover');
    } else if (state.listening && !recognitionLifecycle.isStopping(state.recognition)) {
      requestStopListening(state.recognition, 'manual-mic-toggle');
    }
    return;
  }
  if (purpose === 'wake' && !state.preferences.wakeWordEnabled) {
    reportSpeechDiagnostic('Wake-word listening blocked', { reason: 'disabled' });
    return;
  }
  const wakeWordBlockReason = getWakeWordListeningBlockReason(
    state.preferences.wakeWordEnabled,
    document.visibilityState,
    state.wakeWordPagePaused,
    state.microphonePermission,
    pageIsFocused(),
  );
  if (purpose === 'wake' && wakeWordBlockReason) {
    reportSpeechDiagnostic('Wake-word listening blocked', {
      reason: wakeWordBlockReason,
    });
    state.wakeWordResumePending = true;
    return;
  }
  if (purpose === 'wake' && (state.pending || isSpeechOutputBusy())) {
    reportSpeechDiagnostic('Wake-word listening blocked', {
      reason: state.pending ? 'assistant-busy' : 'speech-output-busy',
    });
    state.wakeWordResumePending = true;
    return;
  }
  if (window.isSecureContext === false) {
    const message = 'Voice input requires a secure HTTPS connection or localhost.';
    if (purpose === 'wake' || wakeHandoff) disableWakeWord(message);
    else showFeedback(message);
    setAssistantState('error', 'MICROPHONE UNAVAILABLE');
    return;
  }
  if (purpose === 'command' && 'speechSynthesis' in window) stopSpeechOutput();
  if (fromUserGesture) primeVoiceOutput();
  let recognition;
  try {
    recognition = new Recognition();
  } catch (error) {
    if (purpose === 'wake' || wakeHandoff) {
      reportSpeechDiagnostic('SpeechRecognition start failed', {
        error: error?.name || 'unknown',
        language: getSpeechRecognitionLanguage(state.preferences.language),
        purpose: wakeHandoff ? 'wake-command' : purpose,
      });
    }
    const message = 'The browser could not initialize speech recognition. Check microphone permissions and try again.';
    if (purpose === 'wake' || wakeHandoff) disableWakeWord(message);
    else showFeedback(message);
    setAssistantState('error', 'MICROPHONE UNAVAILABLE');
    return;
  }
  if (!recognitionLifecycle.begin(recognition)) {
    if (purpose === 'wake') {
      reportSpeechDiagnostic('Wake-word listening blocked', {
        reason: 'recognition-active',
      });
    }
    return;
  }
  if (purpose === 'wake' && !automaticWakeRestart && state.wakeWordManualRetryPending) {
    wakeWordRecoveryPolicy.resetForManualRetry();
    state.wakeWordManualRetryPending = false;
    state.wakeWordRestartDelay = 600;
  }
  window.clearTimeout(state.wakeWordRestartTimer);
  state.wakeWordRestartTimer = null;
  if (!wakeHandoff) state.wakeWordResumePending = false;
  state.recognitionPurpose = wakeHandoff ? 'wake-command' : purpose;
  state.recognitionWakeSession = purpose === 'wake';
  state.wakeWordTriggered = false;
  state.recognitionStartedAt = null;
  state.recognitionError = null;
  recognition.lang = getSpeechRecognitionLanguage(state.preferences.language);
  recognition.interimResults = true;
  recognition.continuous = purpose === 'wake';
  recognition.maxAlternatives = purpose === 'wake' ? 3 : 1;
  state.recognition = recognition;
  state.listening = true;
  elements.mic.classList.add('is-active');
  elements.mic.setAttribute('aria-label', 'Stop voice input');
  elements.mic.setAttribute('aria-pressed', 'true');
  elements.dashboardMicButton.classList.add('is-active');
  elements.dashboardMicButton.setAttribute('aria-label', 'Stop voice input');
  elements.dashboardMicButton.setAttribute('aria-pressed', 'true');
  setAssistantState('listening', 'STARTING MICROPHONE');
  showFeedback(wakeHandoff
    ? 'Wake phrase heard. Starting command listening; speak when listening is confirmed.'
    : purpose === 'wake'
      ? 'Starting wake-word listening. Your browser may ask for microphone permission.'
      : 'Starting voice input. Speak when listening is confirmed.');
  if (purpose === 'wake' || wakeHandoff) {
    reportSpeechDiagnostic('SpeechRecognition start requested', {
      language: recognition.lang,
      purpose: state.recognitionPurpose,
      continuous: recognition.continuous,
      maxAlternatives: recognition.maxAlternatives,
    });
  }

  recognition.onstart = () => {
    if (!recognitionLifecycle.isCurrent(recognition) || recognitionLifecycle.isStopping(recognition)) return;
    clearRecognitionStartTimer();
    state.microphonePermission = 'granted';
    renderMicrophoneStatus();
    state.recognitionStartedAt = performance.now();
    if (purpose === 'wake' || wakeHandoff) {
      reportSpeechDiagnostic('SpeechRecognition started', {
        language: recognition.lang,
        purpose: state.recognitionPurpose,
      });
    }
    setAssistantState('listening', purpose === 'wake' ? 'WAITING FOR WAKE WORD' : wakeHandoff ? 'WAITING FOR COMMAND' : 'LISTENING');
    showFeedback(purpose === 'wake'
      ? 'Listening for "Hey JARVIS" or "हे जार्विस". Keep J.A.R.V.I.S. open and in the foreground.'
      : wakeHandoff ? 'Listening for your request now.' : 'Listening. Speak now.');
  };

  recognition.onresult = (event) => {
    if (!recognitionLifecycle.isCurrent(recognition) || recognitionLifecycle.isStopping(recognition)) return;
    clearRecognitionStartTimer();
    const { transcript, finalResult } = readSpeechRecognitionResult(event);
    if (state.recognitionWakeSession) {
      const alternatives = readSpeechRecognitionAlternatives(event);
      if (alternatives.length) {
        wakeWordRecoveryPolicy.recordSpeechResult();
        state.wakeWordRestartDelay = 600;
      }
      const matchedTranscript = alternatives.find((candidate) => matchWakeWord(candidate).matched);
      const wakeTranscript = matchedTranscript || transcript;
      const matchResult = matchWakeWord(wakeTranscript);
      reportSpeechDiagnostic('SpeechRecognition results received', {
        language: recognition.lang,
        purpose: state.recognitionPurpose || purpose,
        resultCount: event.results?.length || 0,
        alternativeCount: alternatives.length,
        finalResult,
      });
      reportSpeechDiagnostic('Wake-word match evaluated', {
        language: recognition.lang,
        purpose: state.recognitionPurpose || purpose,
        matched: matchResult.matched,
        activated: matchResult.matched && !state.wakeWordTriggered,
        alreadyActivated: state.wakeWordTriggered,
        finalResult,
      });
      const wakeResult = readWakeWordCommand(
        wakeTranscript,
        state.wakeWordTriggered,
        state.wakeWordTriggered ? elements.message.value : '',
      );
      if (!wakeResult.triggered) return;
      if (wakeResult.activated) {
        state.wakeWordTriggered = true;
        state.recognitionPurpose = 'wake-command';
        elements.message.value = '';
        showFeedback(wakeResult.command
          ? 'Wake word detected. Processing your request.'
          : 'Wake word detected. Say your request now, or repeat the wake phrase with your request.');
        setAssistantState('listening', 'JARVIS ACTIVATED');
      }
      elements.message.value = wakeResult.command;
    } else {
      if (transcript) {
        wakeWordRecoveryPolicy.recordSpeechResult();
        state.wakeWordRestartDelay = 600;
      }
      elements.message.value = transcript;
    }
    if (finalResult && elements.message.value) {
      requestStopListening(recognition, 'final-result-submitted');
      elements.form.requestSubmit();
    }
  };
  recognition.onerror = (event) => {
    if (state.recognition !== recognition) return;
    clearRecognitionStartTimer();
    state.recognitionError = event.error || 'unknown';
    reportSpeechDiagnostic('SpeechRecognition error', {
      error: event.error || 'unknown',
      language: recognition.lang,
      purpose: state.recognitionPurpose || purpose,
    });
    const message = getSpeechRecognitionErrorMessage(event.error);
    const wakeSession = state.recognitionWakeSession;
    if (event.error === 'not-allowed') {
      microphonePermissionGuard.invalidate();
      state.microphonePermission = 'denied';
      renderMicrophoneStatus();
    }
    const wakeCommandSession = state.recognitionPurpose === 'wake-command';
    const wakeWorkflow = wakeSession || wakeCommandSession;
    if (wakeWorkflow && isFatalSpeechRecognitionError(event.error)) {
      disableWakeWord(message);
    } else if (wakeWorkflow && event.error === 'no-speech') {
      showFeedback('No speech detected. Restarting wake-word listening shortly.');
    } else if (!wakeSession || event.error !== 'no-speech') {
      showFeedback(message);
    }
    if (message && event.error !== 'no-speech' && event.error !== 'aborted') setAssistantState('error', 'VOICE INPUT ERROR');
  };
  recognition.onend = () => {
    clearRecognitionStartTimer();
    if (!recognitionLifecycle.isCurrent(recognition)) return;
    const wakeWorkflow = state.recognitionWakeSession || state.recognitionPurpose === 'wake-command';
    const unexpected = wakeWorkflow && !recognitionLifecycle.isStopping(recognition);
    const sessionDurationMs = state.recognitionStartedAt === null
      ? null
      : Math.max(0, Math.round(performance.now() - state.recognitionStartedAt));
    if (wakeWorkflow) {
      reportSpeechDiagnostic('SpeechRecognition ended', {
        language: recognition.lang,
        purpose: state.recognitionPurpose || purpose,
        unexpected,
        wakeWordTriggered: state.wakeWordTriggered,
        ...(sessionDurationMs === null ? {} : { durationMs: sessionDurationMs }),
        ...(state.recognitionError ? { error: state.recognitionError } : {}),
      });
    }
    stopListening(recognition, { unexpected, sessionDurationMs });
  };
  clearRecognitionStartTimer();
  state.recognitionStartTimer = window.setTimeout(() => {
    state.recognitionStartTimer = null;
    if (!recognitionLifecycle.isCurrent(recognition) || recognitionLifecycle.isStopping(recognition)) return;
    const message = 'Speech recognition did not start. Check microphone permission and try again.';
    if (purpose === 'wake' || wakeHandoff) {
      reportSpeechDiagnostic('SpeechRecognition start failed', {
        error: 'timeout',
        language: recognition.lang,
        purpose: state.recognitionPurpose || purpose,
      });
    }
    showFeedback(wakeHandoff || purpose === 'wake'
      ? 'Wake listening did not start. Retrying shortly; check microphone permission if this continues.'
      : message);
    setAssistantState('error', 'MICROPHONE START TIMED OUT');
    requestStopListening(recognition, 'start-timeout');
  }, 10_000);
  try {
    recognition.start();
  } catch (error) {
    clearRecognitionStartTimer();
    const startError = getSpeechRecognitionStartError(error);
    const message = startError.message;
    if (purpose === 'wake' || wakeHandoff) {
      reportSpeechDiagnostic('SpeechRecognition start failed', {
        error: error?.name || 'unknown',
        language: recognition.lang,
        purpose: state.recognitionPurpose || purpose,
      });
    }
    if (startError.permissionDenied) {
      microphonePermissionGuard.invalidate();
      state.microphonePermission = 'denied';
      renderMicrophoneStatus();
    }
    if (startError.permissionDenied || error?.name === 'SecurityError') {
      disableWakeWord(message);
    } else if (purpose === 'wake' || wakeHandoff) {
      showFeedback(`${message} Wake-word listening will retry shortly.`);
      state.wakeWordResumePending = true;
    } else {
      showFeedback(message);
    }
    setAssistantState('error', startError.permissionDenied ? 'MICROPHONE PERMISSION DENIED' : 'MICROPHONE UNAVAILABLE');
    stopListening(recognition, { unexpected: purpose === 'wake' || wakeHandoff });
  }
}

function requestStopListening(recognition = state.recognition, reason = 'explicit-stop') {
  if (!recognition || recognition !== state.recognition || !recognitionLifecycle.requestStop(recognition)) return;
  reportSpeechDiagnostic('SpeechRecognition stop requested', {
    language: recognition.lang,
    purpose: state.recognitionPurpose || 'command',
    reason,
    started: state.recognitionStartedAt !== null,
  });
  try {
    recognition.stop();
  } catch (error) {
    reportSpeechDiagnostic('SpeechRecognition stop failed', {
      error: error?.name || 'unknown',
      language: recognition.lang,
      purpose: state.recognitionPurpose || 'command',
    });
  }
}

function stopListening(recognition = state.recognition, { unexpected = false, sessionDurationMs = null } = {}) {
  if (recognition && (recognition !== state.recognition || !recognitionLifecycle.finish(recognition))) return;
  clearRecognitionStartTimer();
  const wakeSession = state.recognitionWakeSession;
  const wakeWasTriggered = state.wakeWordTriggered;
  const wakeCommandSession = state.recognitionPurpose === 'wake-command';
  const manualWakeRetry = state.wakeWordManualRetryPending;
  if (manualWakeRetry) {
    state.wakeWordManualRetryPending = false;
    wakeWordRecoveryPolicy.resetForManualRetry();
    state.wakeWordRestartDelay = 600;
  }
  if (wakeWordRecoveryPolicy.recordSessionDuration(sessionDurationMs)) state.wakeWordRestartDelay = 600;
  state.recognition = null;
  state.recognitionPurpose = null;
  state.recognitionWakeSession = false;
  state.wakeWordTriggered = false;
  state.recognitionStartedAt = null;
  state.recognitionError = null;
  state.listening = false;
  elements.mic.classList.remove('is-active');
  elements.mic.setAttribute('aria-label', 'Start voice input');
  elements.mic.setAttribute('aria-pressed', 'false');
  elements.dashboardMicButton.classList.remove('is-active');
  elements.dashboardMicButton.setAttribute('aria-label', 'Start voice input');
  elements.dashboardMicButton.setAttribute('aria-pressed', 'false');
  if (state.assistantMode === 'listening') setAssistantState('', 'SYSTEM STANDBY');
  const manualTakeoverPending = state.wakeWordManualTakeoverPending;
  state.wakeWordManualTakeoverPending = false;
  if (manualTakeoverPending && !state.preferences.wakeWordEnabled && isPageForeground(document.visibilityState, pageIsFocused())) {
    startListening('command');
    return;
  }
  const pendingSpeechText = state.pendingSpeechText;
  if (pendingSpeechText) {
    const pendingSpeechOptions = state.pendingSpeechOptions;
    state.pendingSpeechText = null;
    state.pendingSpeechOptions = null;
    state.speechOutputTexts.delete(pendingSpeechText);
    state.wakeWordResumePending ||= wakeSession;
    speak(pendingSpeechText, pendingSpeechOptions || {});
    return;
  }
  if (state.liveVoiceStartPending) {
    state.liveVoiceStartPending = false;
    state.wakeWordResumePending = false;
    return;
  }
  if (manualWakeRetry && state.preferences.wakeWordEnabled) {
    state.wakeWordResumePending = true;
    resumeWakeWordDetection('manual-retry');
    return;
  }
  if (wakeSession && wakeWasTriggered) state.wakeWordRestartDelay = 600;
  if (wakeSession && wakeWasTriggered && state.preferences.wakeWordEnabled && !state.pending
    && isPageForeground(document.visibilityState, pageIsFocused()) && state.microphonePermission !== 'denied') {
    state.wakeWordResumePending = true;
    startListening('command', true);
    return;
  }
  if (wakeCommandSession && state.preferences.wakeWordEnabled && !state.pending) {
    scheduleWakeWordRecovery('recognition-ended-after-activation');
  }
  if ((wakeSession || state.wakeWordResumePending) && state.preferences.wakeWordEnabled) {
    state.wakeWordResumePending = true;
    if (!wakeWasTriggered && unexpected) state.wakeWordRestartDelay = nextWakeWordRestartDelay(state.wakeWordRestartDelay);
    resumeWakeWordDetection(wakeSession ? 'recognition-ended-before-activation' : 'recognition-ended');
  }
}

function applyAvatarTheme(theme) {
  const selectedTheme = AVATAR_THEMES.has(theme) ? theme : 'electric-blue';
  document.documentElement.dataset.avatarTheme = selectedTheme;
  elements.avatarTheme.value = selectedTheme;
}

function syncSettings() {
  applyAvatarTheme(state.preferences.avatarTheme);
  elements.language.value = state.preferences.language;
  elements.speechRate.value = String(state.preferences.speechRate);
  elements.speechRateValue.textContent = Number(state.preferences.speechRate).toFixed(1);
  elements.voiceEnabled.checked = state.preferences.voiceEnabled;
  updateWakeWordSupport();
  elements.memoryEnabled.checked = state.preferences.memoryEnabled;
  elements.smartMemoryEnabled.checked = state.preferences.smartMemoryEnabled;
  elements.smartMemoryEnabledDashboard.checked = state.preferences.smartMemoryEnabled;
  elements.leftMemoryStatus.textContent = state.preferences.memoryEnabled ? 'LOCAL' : 'OFF';
  elements.leftMicStatus.textContent = getSpeechRecognitionConstructor(window) ? 'AVAILABLE' : 'UNSUPPORTED';
  elements.leftLanguageStatus.textContent = state.preferences.language === 'hi' ? 'HINDI' : 'ENGLISH';
  elements.leftModeStatus.textContent = state.preferences.studyMode ? 'STUDY' : 'STANDARD';
  elements.studyIndicator.textContent = state.preferences.studyMode ? 'ON' : 'OFF';
  elements.studyQuickIndicator.textContent = state.preferences.studyMode ? 'ON' : 'OFF';
  elements.dashboardVoiceToggle.setAttribute('aria-pressed', String(state.preferences.voiceEnabled));
  elements.dashboardVoiceLabel.textContent = state.preferences.voiceEnabled ? 'Voice on' : 'Voice off';
  elements.voiceOutputValue.textContent = 'speechSynthesis' in window
    ? state.preferences.voiceEnabled ? 'Ready' : 'Off'
    : 'Not available';
  syncVoiceOutputAvailability();
  syncFullAccess();
  updateVoiceList();
}

async function checkServer() {
  const requestSequence = ++healthRequestSequence;
  updateDeviceMonitor();
  elements.memoryValue.textContent = state.preferences.memoryEnabled ? 'Local storage' : 'Disabled';
  loadSystemMetrics();
  if (!navigator.onLine) {
    if (requestSequence !== healthRequestSequence) return;
    state.holoOnline = false;
    updateHologramState();
    elements.backendConnectionValue.textContent = 'Offline';
    elements.connection.className = 'connection-indicator is-offline';
    elements.connection.lastElementChild.textContent = 'OFFLINE';
    elements.dashboardConnection.textContent = 'OFFLINE';
    elements.leftAiStatus.textContent = 'OFFLINE';
    elements.leftAiDetail.textContent = 'The server cannot be reached while this device is offline.';
    elements.leftSessionStatus.textContent = 'OFFLINE';
    return;
  }
  try {
    const response = await fetch('/api/health', {
      cache: 'no-store',
      signal: AbortSignal.timeout(5_000),
    });
    const data = await readApiResponse(response);
    if (requestSequence !== healthRequestSequence) return;
    state.holoOnline = true;
    updateHologramState();
    state.aiConfigured = data.aiConfigured === true;
    state.aiProvider = data.provider;
    if (state.aiConfigured && !modelManagerInitialized) {
      modelManagerInitialized = true;
      void refreshAIModels();
    }
    state.accessRequired = data.accessRequired === true;
    const ollamaSelected = data.provider === 'ollama';
    const providerLabel = getAIProviderLabel(data.provider);
    const aiReady = data.aiConfigured && (!ollamaSelected || data.aiAvailable);
    if (!state.aiSettingsLoaded) {
      state.aiSettingsLoaded = true;
      elements.aiProvider.value = data.provider || 'gemini';
      elements.aiModel.value = data.model || (ollamaSelected ? 'qwen2.5:3b' : 'gemini-3.8-flash');
      if (data.baseUrl) elements.aiBaseUrl.value = data.baseUrl;
      updateAIProviderFields();
    }
    localTts.setAvailable(data.localTts?.available === true);
    syncLocalTtsStatus();
    updateVoiceList();
    syncVoiceOutputAvailability();
    elements.aiSetupStatus.textContent = data.aiConfigured
      ? `Current: ${providerLabel} · ${data.model} · ${data.providerSource === 'environment' ? 'deployment environment secret' : data.providerSource === 'session' ? 'temporary server-session setting' : 'server configuration'}`
      : 'No AI provider is configured. Set GEMINI_API_KEY on the server, or configure another provider here.';
    elements.connection.className = aiReady ? 'connection-indicator' : 'connection-indicator is-warning';
    elements.connection.lastElementChild.textContent = aiReady
      ? ollamaSelected ? 'OLLAMA READY' : 'AI CONFIGURED'
      : ollamaSelected && !data.ollamaAvailable ? 'OLLAMA OFFLINE'
        : ollamaSelected ? 'MODEL MISSING' : 'NO AI MODEL';
    elements.dashboardConnection.textContent = aiReady ? 'CONNECTED' : 'SETUP REQUIRED';
    elements.providerNote.textContent = !data.aiConfigured
      ? 'No AI provider is configured. Open Settings → AI provider to select Google Gemini, Ollama, or an OpenAI-compatible provider.'
      : ollamaSelected && !data.ollamaAvailable
        ? `Ollama is selected but unreachable at ${data.baseUrl || 'the configured local endpoint'}. Start Ollama there and retry.`
        : ollamaSelected && !data.modelInstalled
          ? `Ollama is running, but ${data.model} is not installed there.`
          : ollamaSelected
            ? `Ollama and ${data.model} are available on the server.`
            : data.providerSource === 'session'
              ? `A temporary ${providerLabel} setting is active in server memory only. Set the provider secret in the hosting environment to keep it across restarts. Live availability is confirmed when you send a message.`
              : 'AI provider is configured through the server environment. Live availability is confirmed when you send a message.';
    if (state.accessRequired) {
      elements.providerNote.textContent += data.accessConfigured
        ? ' This server requires an access key; enter it in Settings.'
        : ' The production server is locked until its administrator configures APP_ACCESS_TOKEN.';
    }
    elements.modelValue.textContent = ollamaSelected
      ? data.aiAvailable ? data.model : data.ollamaAvailable ? 'Model missing' : 'Ollama offline'
      : data.aiConfigured ? 'Configured' : 'Not configured';
    elements.leftAiStatus.textContent = ollamaSelected
      ? data.aiAvailable ? 'OLLAMA READY' : data.ollamaAvailable ? 'MODEL MISSING' : 'OLLAMA OFFLINE'
      : data.aiConfigured ? 'PROVIDER SET' : 'NO MODEL';
    elements.leftAiDetail.textContent = ollamaSelected
      ? data.aiAvailable ? `${data.model} is available on this server.` : data.ollamaAvailable ? `${data.model} is not installed.` : 'Ollama is not reachable from this server.'
      : data.aiConfigured ? 'Provider is configured. Availability is confirmed when you send a message.' : 'Open Settings to configure an AI provider and model.';
    elements.leftSessionStatus.textContent = 'CONNECTED';
    elements.backendConnectionValue.textContent = 'Connected';
    elements.leftMemoryStatus.textContent = state.preferences.memoryEnabled ? 'LOCAL' : 'OFF';
    elements.footerStatus.textContent = aiReady ? 'SERVER AI · LOCAL HISTORY · PERMISSION-BOUND' : 'AI UNAVAILABLE · LOCAL HISTORY · PERMISSION-BOUND';
  } catch {
    if (requestSequence !== healthRequestSequence) return;
    state.holoOnline = false;
    updateHologramState();
    elements.connection.className = 'connection-indicator is-offline';
    elements.connection.lastElementChild.textContent = 'SERVER OFFLINE';
    elements.dashboardConnection.textContent = 'SERVER OFFLINE';
    elements.providerNote.textContent = 'The app server is not responding. Chat and web search require a connection to this server.';
    elements.modelValue.textContent = 'Unavailable';
    elements.leftAiStatus.textContent = 'UNAVAILABLE';
    elements.leftAiDetail.textContent = 'The J.A.R.V.I.S. server did not respond.';
    elements.leftSessionStatus.textContent = 'OFFLINE';
    elements.backendConnectionValue.textContent = 'Unavailable';
  }
}

async function refreshHomeAssistantEntities() {
  elements.homeAssistantRefresh.disabled = true;
  elements.homeAssistantStatus.textContent = 'Checking the server-side Home Assistant connection…';
  elements.homeAssistantEntities.replaceChildren();
  try {
    const response = await fetch('/api/home-assistant/entities', {
      headers: apiHeaders(),
      cache: 'no-store',
      signal: AbortSignal.timeout(7_000),
    });
    const data = await readApiResponse(response);
    const entities = Array.isArray(data.entities) ? data.entities : [];
    if (!entities.length) {
      elements.homeAssistantStatus.textContent = 'Connected, but no allowlisted entities are currently available.';
      return;
    }
    elements.homeAssistantStatus.textContent = `${entities.length} allowlisted entities available. Read-only access.`;
    for (const entity of entities) {
      const item = document.createElement('li');
      const name = document.createElement('strong');
      name.textContent = entity.name || entity.entityId;
      const state = document.createElement('span');
      state.textContent = ` ${entity.state}`;
      const identifier = document.createElement('small');
      identifier.textContent = entity.entityId;
      item.append(name, state, identifier);
      if (entity.canControl && ['on', 'off'].includes(entity.state)) {
        const targetState = entity.state === 'on' ? 'off' : 'on';
        const controlButton = document.createElement('button');
        controlButton.type = 'button';
        controlButton.className = 'secondary-button';
        controlButton.textContent = targetState === 'on' ? 'Turn on' : 'Turn off';
        controlButton.addEventListener('click', () => controlHomeAssistantEntity(entity, targetState, controlButton));
        item.append(controlButton);
      }
      elements.homeAssistantEntities.append(item);
    }
  } catch (error) {
    elements.homeAssistantStatus.textContent = getRequestErrorMessage(error, 'Home Assistant status');
  } finally {
    elements.homeAssistantRefresh.disabled = false;
  }
}

async function controlHomeAssistantEntity(entity, targetState, button) {
  const entityId = entity?.entityId;
  if (!entityId || !entity.canControl || !['on', 'off'].includes(targetState)) return;
  const label = entity.name || entityId;
  if (!window.confirm(`Set ${label} (${entityId}) to ${targetState}?`)) return;

  button.disabled = true;
  elements.homeAssistantStatus.textContent = `Requesting ${targetState} for ${entityId}…`;
  try {
    const response = await fetch('/api/home-assistant/control', {
      method: 'POST',
      headers: apiHeaders(true),
      body: JSON.stringify({ entityId, targetState, confirmed: true }),
      signal: AbortSignal.timeout(7_000),
    });
    const data = await readApiResponse(response);
    logActivity(`Home Assistant ${entityId} set to ${data.entity.state}`);
    await refreshHomeAssistantEntities();
  } catch (error) {
    elements.homeAssistantStatus.textContent = getRequestErrorMessage(error, 'Home Assistant control');
  } finally {
    button.disabled = false;
  }
}

async function refreshGoogleWorkspaceStatus() {
  elements.googleWorkspaceRefresh.disabled = true;
  elements.googleWorkspaceStatus.textContent = 'Checking the server-side Google Workspace connection…';
  try {
    const response = await fetch('/api/google/status', { headers: apiHeaders(), cache: 'no-store' });
    const status = await readApiResponse(response);
    if (!status.configured) {
      elements.googleWorkspaceStatus.textContent = 'Google Workspace is not configured on this server.';
      elements.googleWorkspaceDisconnect.disabled = true;
      return;
    }
    elements.googleWorkspaceStatus.textContent = status.connected
      ? 'Google Workspace is connected. Gmail actions save drafts only.'
      : 'Google Workspace is configured but not connected.';
    elements.googleWorkspaceDisconnect.disabled = !status.connected;
  } catch (error) {
    elements.googleWorkspaceStatus.textContent = getRequestErrorMessage(error, 'Google Workspace status');
    elements.googleWorkspaceDisconnect.disabled = true;
  } finally {
    elements.googleWorkspaceRefresh.disabled = false;
  }
}

async function connectGoogleWorkspace() {
  elements.googleWorkspaceConnect.disabled = true;
  elements.googleWorkspaceStatus.textContent = 'Preparing secure Google authorization…';
  try {
    const response = await fetch('/api/google/connect', {
      method: 'POST',
      headers: apiHeaders(),
      cache: 'no-store',
    });
    const data = await readApiResponse(response);
    const authorizationUrl = new URL(data.authorizationUrl);
    if (authorizationUrl.origin !== 'https://accounts.google.com'
      || authorizationUrl.pathname !== '/o/oauth2/v2/auth') {
      throw new Error('The server returned an invalid Google authorization address.');
    }
    window.location.assign(authorizationUrl.toString());
  } catch (error) {
    elements.googleWorkspaceStatus.textContent = getRequestErrorMessage(error, 'Google connection');
  } finally {
    elements.googleWorkspaceConnect.disabled = false;
  }
}

async function disconnectGoogleWorkspace() {
  if (!window.confirm('Disconnect Google Workspace and revoke this server authorization?')) return;
  elements.googleWorkspaceDisconnect.disabled = true;
  try {
    const response = await fetch('/api/google/disconnect', {
      method: 'POST',
      headers: apiHeaders(),
      cache: 'no-store',
    });
    await readApiResponse(response);
    elements.googleWorkspaceStatus.textContent = 'Google Workspace disconnected and local authorization removed.';
  } catch (error) {
    elements.googleWorkspaceStatus.textContent = getRequestErrorMessage(error, 'Google disconnect');
    elements.googleWorkspaceDisconnect.disabled = false;
  }
}

async function createGoogleDraft(event) {
  event.preventDefault();
  if (!window.confirm(`Save a Gmail draft to ${elements.googleDraftTo.value}? It will not be sent.`)) return;
  elements.googleWorkspaceStatus.textContent = 'Saving Gmail draft…';
  try {
    const response = await fetch('/api/google/drafts', {
      method: 'POST',
      headers: apiHeaders(true),
      body: JSON.stringify({
        to: elements.googleDraftTo.value,
        subject: elements.googleDraftSubject.value,
        body: elements.googleDraftBody.value,
      }),
      signal: AbortSignal.timeout(15_000),
    });
    const result = await readApiResponse(response);
    elements.googleDraftForm.reset();
    elements.googleWorkspaceStatus.textContent = `Gmail draft saved (${result.draftId}). It was not sent.`;
  } catch (error) {
    elements.googleWorkspaceStatus.textContent = getRequestErrorMessage(error, 'Gmail draft');
  }
}

async function refreshGoogleCalendarEvents() {
  elements.googleCalendarRefresh.disabled = true;
  elements.googleCalendarEvents.replaceChildren();
  const start = new Date();
  const end = new Date(start.getTime() + 7 * 24 * 60 * 60_000);
  const query = new URLSearchParams({ timeMin: start.toISOString(), timeMax: end.toISOString() });
  try {
    const response = await fetch(`/api/google/events?${query}`, { headers: apiHeaders(), cache: 'no-store' });
    const data = await readApiResponse(response);
    for (const event of Array.isArray(data.events) ? data.events : []) {
      const item = document.createElement('li');
      const title = document.createElement('strong');
      title.textContent = event.summary;
      const date = document.createElement('time');
      date.dateTime = event.start;
      date.textContent = ` ${new Date(event.start).toLocaleString()}`;
      item.append(title, date);
      elements.googleCalendarEvents.append(item);
    }
    elements.googleWorkspaceStatus.textContent = data.events?.length
      ? `${data.events.length} upcoming calendar events loaded.`
      : 'No upcoming events were found in the next seven days.';
  } catch (error) {
    elements.googleWorkspaceStatus.textContent = getRequestErrorMessage(error, 'Google Calendar');
  } finally {
    elements.googleCalendarRefresh.disabled = false;
  }
}

async function createGoogleCalendarEvent(event) {
  event.preventDefault();
  const summary = elements.googleEventSummary.value.trim();
  const start = new Date(elements.googleEventStart.value);
  const end = new Date(elements.googleEventEnd.value);
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || end <= start) {
    elements.googleWorkspaceStatus.textContent = 'Choose a valid event start and end time.';
    return;
  }
  if (!window.confirm(`Create “${summary}” from ${start.toLocaleString()} to ${end.toLocaleString()} in Google Calendar?`)) return;
  elements.googleWorkspaceStatus.textContent = 'Creating calendar event…';
  try {
    const response = await fetch('/api/google/events', {
      method: 'POST',
      headers: apiHeaders(true),
      body: JSON.stringify({
        summary,
        description: elements.googleEventDescription.value,
        start: start.toISOString(),
        end: end.toISOString(),
        confirmed: true,
      }),
      signal: AbortSignal.timeout(15_000),
    });
    const result = await readApiResponse(response);
    elements.googleEventForm.reset();
    elements.googleWorkspaceStatus.textContent = `Calendar event created: ${result.summary}.`;
    await refreshGoogleCalendarEvents();
  } catch (error) {
    elements.googleWorkspaceStatus.textContent = getRequestErrorMessage(error, 'Google Calendar event');
  }
}

function showGoogleWorkspaceCallbackStatus() {
  const query = new URLSearchParams(window.location.search);
  const result = query.get('google_workspace');
  if (!result) return;
  elements.googleWorkspaceStatus.textContent = result === 'connected'
    ? 'Google Workspace connected successfully.'
    : 'Google Workspace could not be connected. Check consent and server configuration, then retry.';
  query.delete('google_workspace');
  const remainingQuery = query.toString();
  window.history.replaceState(null, '', `${window.location.pathname}${remainingQuery ? `?${remainingQuery}` : ''}${window.location.hash}`);
  if (result === 'connected') void refreshGoogleWorkspaceStatus();
}

async function refreshTelegramStatus() {
  elements.telegramRefresh.disabled = true;
  elements.telegramStatus.textContent = 'Checking server-approved Telegram recipients…';
  elements.telegramRecipient.replaceChildren(new Option('Choose a recipient', ''));
  elements.telegramSend.disabled = true;
  try {
    const response = await fetch('/api/telegram/status', { headers: apiHeaders(), cache: 'no-store' });
    const data = await readApiResponse(response);
    const recipients = Array.isArray(data.recipients) ? data.recipients : [];
    if (!data.configured || !recipients.length) {
      elements.telegramStatus.textContent = 'Telegram is not configured on this server.';
      return;
    }
    for (const chatId of recipients) {
      if (typeof chatId !== 'string' || !/^-?[1-9]\d{0,19}$/.test(chatId)) continue;
      const option = new Option(`Chat ${chatId}`, chatId);
      elements.telegramRecipient.add(option);
    }
    elements.telegramStatus.textContent = `${elements.telegramRecipient.options.length - 1} approved Telegram recipient(s) available.`;
    elements.telegramSend.disabled = elements.telegramRecipient.options.length <= 1;
  } catch (error) {
    elements.telegramStatus.textContent = getRequestErrorMessage(error, 'Telegram status');
  } finally {
    elements.telegramRefresh.disabled = false;
  }
}

async function sendTelegramMessage(event) {
  event.preventDefault();
  const chatId = elements.telegramRecipient.value;
  const text = elements.telegramMessage.value;
  if (!chatId || !text.trim()) return;
  if (!window.confirm(`Send this Telegram message to chat ${chatId}?\n\n${text}`)) return;
  elements.telegramSend.disabled = true;
  elements.telegramStatus.textContent = 'Sending Telegram message…';
  try {
    const response = await fetch('/api/telegram/send', {
      method: 'POST',
      headers: apiHeaders(true),
      body: JSON.stringify({ chatId, text, confirmed: true }),
      signal: AbortSignal.timeout(10_000),
    });
    const result = await readApiResponse(response);
    elements.telegramMessage.value = '';
    elements.telegramStatus.textContent = `Message sent to approved chat ${result.chatId}.`;
  } catch (error) {
    elements.telegramStatus.textContent = getRequestErrorMessage(error, 'Telegram message');
  } finally {
    elements.telegramSend.disabled = !elements.telegramRecipient.value;
  }
}

async function refreshFacebookMessengerStatus() {
  elements.facebookMessengerRefresh.disabled = true;
  elements.facebookMessengerStatus.textContent = 'Checking server-approved Facebook recipients…';
  elements.facebookMessengerRecipient.replaceChildren(new Option('Choose a recipient', ''));
  elements.facebookMessengerSend.disabled = true;
  try {
    const response = await fetch('/api/facebook-messenger/status', { headers: apiHeaders(), cache: 'no-store' });
    const data = await readApiResponse(response);
    const recipients = Array.isArray(data.recipients) ? data.recipients : [];
    if (!data.configured || !recipients.length) {
      elements.facebookMessengerStatus.textContent = 'Facebook Messenger is not configured on this server.';
      return;
    }
    for (const recipientId of recipients) {
      if (typeof recipientId !== 'string' || !/^[1-9]\d{5,19}$/.test(recipientId)) continue;
      elements.facebookMessengerRecipient.add(new Option(`Recipient ${recipientId}`, recipientId));
    }
    elements.facebookMessengerStatus.textContent = `${elements.facebookMessengerRecipient.options.length - 1} approved Facebook recipient(s) available.`;
    elements.facebookMessengerSend.disabled = elements.facebookMessengerRecipient.options.length <= 1;
  } catch (error) {
    elements.facebookMessengerStatus.textContent = getRequestErrorMessage(error, 'Facebook Messenger status');
  } finally {
    elements.facebookMessengerRefresh.disabled = false;
  }
}

async function sendFacebookMessengerMessage(event) {
  event.preventDefault();
  const recipientId = elements.facebookMessengerRecipient.value;
  const text = elements.facebookMessengerMessage.value;
  if (!recipientId || !text.trim()) return;
  if (!window.confirm(`Send this Messenger reply to recipient ${recipientId}?\n\n${text}`)) return;
  elements.facebookMessengerSend.disabled = true;
  elements.facebookMessengerStatus.textContent = 'Sending Facebook Messenger reply…';
  try {
    const response = await fetch('/api/facebook-messenger/send', {
      method: 'POST',
      headers: apiHeaders(true),
      body: JSON.stringify({ recipientId, text, confirmed: true }),
      signal: AbortSignal.timeout(10_000),
    });
    const result = await readApiResponse(response);
    elements.facebookMessengerMessage.value = '';
    elements.facebookMessengerStatus.textContent = `Reply sent to approved Facebook recipient ${result.recipientId}.`;
  } catch (error) {
    elements.facebookMessengerStatus.textContent = getRequestErrorMessage(error, 'Facebook Messenger reply');
  } finally {
    elements.facebookMessengerSend.disabled = !elements.facebookMessengerRecipient.value;
  }
}

function formatBytes(value) {
  if (!Number.isFinite(value) || value < 0) return 'Unavailable';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let amount = value;
  let unit = 0;
  while (amount >= 1024 && unit < units.length - 1) {
    amount /= 1024;
    unit += 1;
  }
  return `${amount.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`;
}

function updateMetricGauge(track, meter, value) {
  const available = Number.isFinite(value) && value >= 0 && value <= 100;
  track.hidden = !available;
  if (available) meter.style.width = `${value}%`;
}

function updateLocalDateTime() {
  const now = new Date();
  elements.localDateTimeValue.dateTime = now.toISOString();
  elements.localDateTimeValue.textContent = localDateTimeFormatter.format(now);
}

function updateDeviceMonitor() {
  const profile = detectDeviceProfile(navigator);
  elements.deviceTypeValue.textContent = profile.deviceType;
  elements.platformValue.textContent = `${profile.browser} · ${profile.platform}`;
  document.querySelectorAll('[data-device-group="mobile"]').forEach((item) => {
    item.hidden = !profile.isMobile;
  });
  document.querySelectorAll('[data-device-group="desktop"]').forEach((item) => {
    item.hidden = profile.isMobile;
  });
  elements.cpuLabel.textContent = 'SERVER CPU';
  elements.ramLabel.textContent = 'SERVER RAM';
  elements.diskLabel.textContent = 'SERVER STORAGE';

  const connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
  const networkParts = [navigator.onLine ? 'Online' : 'Offline'];
  if (navigator.onLine && connection?.effectiveType) networkParts.push(connection.effectiveType);
  elements.networkValue.textContent = networkParts.join(' · ');

  renderMicrophoneStatus();
  elements.voiceOutputValue.textContent = 'speechSynthesis' in window
    ? state.assistantMode === 'speaking' ? 'Speaking' : state.preferences.voiceEnabled ? 'Ready' : 'Off'
    : 'Not available';

  const memory = performance.memory;
  elements.browserMemoryValue.textContent = memory
    && Number.isFinite(memory.usedJSHeapSize)
    && Number.isFinite(memory.jsHeapSizeLimit)
    ? `${formatBytes(memory.usedJSHeapSize)} / ${formatBytes(memory.jsHeapSizeLimit)} JS heap`
    : 'Not available';
  return profile;
}

function renderMicrophoneStatus() {
  const recognitionSupported = Boolean(getSpeechRecognitionConstructor(window));
  const isListening = state.assistantMode === 'listening';
  elements.dashboardMicButton.setAttribute('aria-pressed', String(isListening));
  elements.dashboardVoiceMicButton.setAttribute('aria-pressed', String(isListening));
  const text = !recognitionSupported
    ? 'Not available'
    : state.assistantMode === 'listening' ? 'Listening'
      : state.microphonePermission === 'granted' ? 'Ready'
        : state.microphonePermission === 'denied' ? 'Permission denied'
          : state.microphonePermission === 'prompt' ? 'Permission required'
            : 'Permission status unavailable';
  elements.voiceValue.textContent = text;
}

async function updateMicrophonePermission(permissionStatus) {
  const requestVersion = microphonePermissionGuard.begin();
  if (!elements.voiceValue) return;
  const recognitionSupported = Boolean(getSpeechRecognitionConstructor(window));
  if (!recognitionSupported) {
    elements.voiceValue.textContent = 'Not available';
    return;
  }
  if (!navigator.permissions?.query && !permissionStatus) {
    elements.voiceValue.textContent = 'Permission status unavailable';
    reportSpeechDiagnostic('Microphone permission status', {
      permission: 'unknown',
      reason: 'permissions-api-unavailable',
    });
    return;
  }
  try {
    const status = permissionStatus || await navigator.permissions.query({ name: 'microphone' });
    if (!microphonePermissionGuard.isCurrent(requestVersion)) return;
    state.microphonePermission = status.state;
    reportSpeechDiagnostic('Microphone permission status', {
      permission: status.state,
      source: permissionStatus ? 'change' : 'query',
    });
    renderMicrophoneStatus();
    if (status.state === 'denied') {
      if (state.preferences.wakeWordEnabled) disableWakeWord('Microphone permission was denied. Wake-word detection is off until permission is granted again.');
      reportWakeWordStatus('setting-changed');
      if (state.recognition) requestStopListening(state.recognition, 'microphone-permission-denied');
      renderMicrophoneStatus();
    }
    if (!permissionStatus) status.addEventListener?.('change', () => updateMicrophonePermission(status));
  } catch {
    if (!microphonePermissionGuard.isCurrent(requestVersion)) return;
    state.microphonePermission = 'unknown';
    reportSpeechDiagnostic('Microphone permission status', {
      permission: 'unknown',
      reason: 'query-failed',
    });
    renderMicrophoneStatus();
  }
}

async function updateBatteryStatus() {
  if (!elements.batteryValue || typeof navigator.getBattery !== 'function') {
    if (elements.batteryValue) elements.batteryValue.textContent = 'Not available';
    return;
  }
  try {
    const battery = await navigator.getBattery();
    const renderBattery = () => {
      const percent = Number.isFinite(battery.level) ? `${Math.round(battery.level * 100)}%` : 'Level unavailable';
      elements.batteryValue.textContent = `${percent} · ${battery.charging ? 'Charging' : 'On battery'}`;
    };
    renderBattery();
    battery.addEventListener('levelchange', renderBattery);
    battery.addEventListener('chargingchange', renderBattery);
  } catch {
    elements.batteryValue.textContent = 'Not available';
  }
}

async function loadSystemMetrics() {
  try {
    const response = await fetch('/api/system', { headers: apiHeaders(), signal: AbortSignal.timeout(4_000) });
    const metrics = await readApiResponse(response);
    elements.cpuValue.textContent = metrics.cpuUsagePercent === null
      ? 'Sampling…'
      : `${metrics.cpuUsagePercent}% / ${metrics.cpuCount} cores`;
    elements.ramValue.textContent = `${formatBytes(metrics.memoryUsedBytes)} / ${formatBytes(metrics.memoryTotalBytes)} (${metrics.memoryPercent}%)`;
    elements.diskValue.textContent = `${formatBytes(metrics.diskUsedBytes)} / ${formatBytes(metrics.diskTotalBytes)} (${metrics.diskPercent}%)`;
    updateMetricGauge(elements.cpuMeterTrack, elements.cpuMeter, metrics.cpuUsagePercent);
    updateMetricGauge(elements.ramMeterTrack, elements.ramMeter, metrics.memoryPercent);
    updateMetricGauge(elements.diskMeterTrack, elements.diskMeter, metrics.diskPercent);
    elements.monitorContext.textContent = `Server/container measurements · ${metrics.source} · ${new Date(metrics.measuredAt).toLocaleTimeString()}`;
  } catch {
    elements.cpuValue.textContent = 'Unavailable';
    elements.ramValue.textContent = 'Unavailable';
    elements.diskValue.textContent = 'Unavailable';
    updateMetricGauge(elements.cpuMeterTrack, elements.cpuMeter, null);
    updateMetricGauge(elements.ramMeterTrack, elements.ramMeter, null);
    updateMetricGauge(elements.diskMeterTrack, elements.diskMeter, null);
    elements.monitorContext.textContent = 'Server measurements unavailable. They describe the app host/container, not this device.';
  }
}

function initializeDeviceMonitor() {
  const profile = updateDeviceMonitor();
  updateMicrophonePermission();
  if (profile.isMobile) updateBatteryStatus();

  const connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
  connection?.addEventListener?.('change', updateDeviceMonitor);
}

function pauseVoiceForPageLifecycle() {
  state.wakeWordPagePaused = true;
  window.clearTimeout(state.wakeWordRestartTimer);
  state.wakeWordRestartTimer = null;
  if (geminiLiveVoice.isConversationActive) {
    stopLiveConversation('Gemini Live voice stopped because J.A.R.V.I.S. moved to the background.');
  }
  if (state.pendingSpeechText || state.assistantMode === 'speaking' || state.localSpeechActive
    || window.speechSynthesis?.speaking || window.speechSynthesis?.pending || window.speechSynthesis?.paused) {
    stopSpeechOutput();
    showFeedback('Voice playback stopped when J.A.R.V.I.S. lost focus. The text reply is still available.');
  }
  if (state.recognitionWakeSession && state.preferences.wakeWordEnabled) {
    state.wakeWordResumePending = true;
    showFeedback('Wake-word detection paused while J.A.R.V.I.S. is unfocused or in the background.');
  }
  if (state.recognition) {
    if (!state.recognitionWakeSession) showFeedback('Voice input paused while J.A.R.V.I.S. is unfocused or in the background. Tap the microphone to resume.');
    requestStopListening(state.recognition, 'page-lifecycle');
  }
}

function openSettings() {
  if (!elements.settings.open) elements.settings.showModal();
}

function getAIProviderLabel(provider) {
  if (provider === 'gemini') return 'Google Gemini';
  if (provider === 'ollama') return 'Ollama';
  return 'OpenAI-compatible';
}

function updateAIProviderFields() {
  const provider = elements.aiProvider.value;
  const usesApiKey = provider === 'openai-compatible';
  const usesCustomBaseUrl = provider === 'openai-compatible' || provider === 'ollama';
  elements.aiKeyField.hidden = !usesApiKey;
  elements.aiBaseUrlField.hidden = !usesCustomBaseUrl;
  elements.aiBaseUrl.required = usesCustomBaseUrl;
  elements.aiSettingsSave.hidden = provider === 'gemini';
  elements.aiApiKey.required = provider === 'openai-compatible';
  elements.aiProviderHelp.textContent = provider === 'gemini'
    ? translateUiText(
      'Google Gemini uses the server-side GEMINI_API_KEY environment secret. Copy .env.example to .env for local use, or set GEMINI_API_KEY in your hosting secret manager. The key cannot be entered in this browser.',
      state.preferences.language,
    )
    : provider === 'openai-compatible'
      ? 'Use Google Gemini’s OpenAI-compatible chat completions API or another compatible provider. Saving here stores the key only in server memory until restart. This form cannot change deployment secrets; set AI_API_KEY in your hosting provider’s environment/secrets dashboard for persistence. The key is never saved in this browser or returned by the server. Use a trusted server over HTTPS.'
      : 'Enter a localhost or private-network Ollama URL reachable from the Node server, such as http://127.0.0.1:11434. Public URLs are rejected, and the selected model must already be installed.';
}

async function saveAISettings(provider = elements.aiProvider.value) {
  const usesApiKey = provider === 'openai-compatible';
  const apiKey = usesApiKey ? elements.aiApiKey.value : '';
  elements.aiApiKey.value = '';
  elements.aiSettingsSave.disabled = true;
  elements.aiSettingsEnvironment.disabled = true;
  elements.aiSetupStatus.textContent = 'Saving provider settings…';
  try {
    const response = await fetch('/api/settings/ai', {
      method: 'POST',
      headers: apiHeaders(true),
      body: JSON.stringify(provider === 'environment'
        ? { provider }
        : {
          provider,
          model: elements.aiModel.value.trim(),
          ...(provider === 'openai-compatible' || provider === 'ollama'
            ? { baseUrl: elements.aiBaseUrl.value.trim() }
            : {}),
          ...(usesApiKey ? { apiKey } : {}),
        }),
      signal: AbortSignal.timeout(8_000),
    });
    const data = await readApiResponse(response);
    state.aiSettingsLoaded = true;
    if (data.configured) {
      elements.aiProvider.value = data.provider;
      elements.aiModel.value = data.model;
      if (data.baseUrl) elements.aiBaseUrl.value = data.baseUrl;
      updateAIProviderFields();
      elements.aiSetupStatus.textContent = data.providerSource === 'environment'
        ? `Using deployment environment configuration: ${getAIProviderLabel(data.provider)} · ${data.model}.`
        : `Saved temporarily in this server session: ${getAIProviderLabel(data.provider)} · ${data.model}. Configure the provider secret in the hosting environment to keep it across restarts.`;
    } else {
      elements.aiSetupStatus.textContent = 'No server-side AI provider is configured. For Gemini, set GEMINI_API_KEY in the server environment or deployment secrets.';
    }
    await checkServer();
  } catch (error) {
    elements.aiSetupStatus.textContent = getRequestErrorMessage(error, 'provider settings request');
  } finally {
    elements.aiSettingsSave.disabled = false;
    elements.aiSettingsEnvironment.disabled = false;
  }
}

let discoveredAIModels = [];
let selectedAIModel = '';
let modelManagerInitialized = false;
let testedAIModels = new Map();

function renderAIModelList() {
  if (!elements.aiModelList) return;
  elements.aiModelList.replaceChildren();
  for (const model of discoveredAIModels) {
    const item = document.createElement('li');
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'ai-model-option';
    button.setAttribute('aria-pressed', String(model.id === selectedAIModel));
    const title = document.createElement('strong');
    title.textContent = model.displayName || model.id;
    const detail = document.createElement('span');
    const probe = testedAIModels.get(model.id);
    detail.textContent = probe
      ? `${probe.status} · ${probe.latencyMs} ms`
      : `${model.status || 'Untested'} · Not verified`;
    button.append(title, detail);
    button.addEventListener('click', () => {
      selectedAIModel = model.id;
      elements.aiModel.value = model.id;
      elements.aiModelTest.disabled = false;
      elements.aiModelUse.disabled = testedAIModels.get(model.id)?.verified !== true;
      renderAIModelList();
    });
    item.append(button);
    elements.aiModelList.append(item);
  }
}

async function refreshAIModels() {
  if (!elements.aiModelStatus) return;
  elements.aiModelRefresh.disabled = true;
  elements.aiModelStatus.textContent = 'Discovering models from the active server-configured provider…';
  try {
    const response = await fetch('/api/models', { headers: apiHeaders(), signal: AbortSignal.timeout(12_000), cache: 'no-store' });
    const data = await readApiResponse(response);
    discoveredAIModels = Array.isArray(data.models) ? data.models : [];
    testedAIModels = new Map();
    selectedAIModel = discoveredAIModels.some((model) => model.id === elements.aiModel.value)
      ? elements.aiModel.value
      : discoveredAIModels[0]?.id || '';
    if (selectedAIModel) elements.aiModel.value = selectedAIModel;
    elements.aiModelTest.disabled = !selectedAIModel;
    elements.aiModelUse.disabled = true;
    elements.aiModelStatus.textContent = `${data.status || 'Unavailable'} · ${discoveredAIModels.length} model(s) found · ${Number.isFinite(data.latencyMs) ? `${data.latencyMs} ms` : 'latency unavailable'}. Models must be tested before use.`;
    renderAIModelList();
  } catch (error) {
    discoveredAIModels = [];
    renderAIModelList();
    elements.aiModelStatus.textContent = getRequestErrorMessage(error, 'model discovery');
  } finally {
    elements.aiModelRefresh.disabled = false;
  }
}

async function testSelectedAIModel() {
  const model = selectedAIModel || elements.aiModel.value.trim();
  if (!model) return;
  elements.aiModelTest.disabled = true;
  elements.aiModelStatus.textContent = `Testing ${model} with a small text request…`;
  try {
    const response = await fetch('/api/models/test', {
      method: 'POST', headers: apiHeaders(true), body: JSON.stringify({ model }),
      signal: AbortSignal.timeout(12_000),
    });
    const result = await readApiResponse(response);
    testedAIModels.set(model, result);
    elements.aiModelUse.disabled = result.verified !== true;
    elements.aiModelStatus.textContent = `${result.status}: ${result.message} ${Number.isFinite(result.latencyMs) ? `(${result.latencyMs} ms)` : ''}`;
    renderAIModelList();
  } catch (error) {
    testedAIModels.set(model, { status: 'Unavailable', verified: false, latencyMs: null });
    elements.aiModelUse.disabled = true;
    elements.aiModelStatus.textContent = getRequestErrorMessage(error, 'model test');
    renderAIModelList();
  } finally {
    elements.aiModelTest.disabled = !model;
  }
}

async function useSelectedAIModel() {
  const model = selectedAIModel || elements.aiModel.value.trim();
  if (!model || testedAIModels.get(model)?.verified !== true) return;
  elements.aiModelUse.disabled = true;
  elements.aiModelStatus.textContent = `Applying verified model ${model}…`;
  try {
    const response = await fetch('/api/settings/ai/model', {
      method: 'POST', headers: apiHeaders(true), body: JSON.stringify({ provider: elements.aiProvider.value, model }),
      signal: AbortSignal.timeout(8_000),
    });
    const data = await readApiResponse(response);
    elements.aiModel.value = data.model;
    elements.aiSetupStatus.textContent = `Using verified ${getAIProviderLabel(data.provider)} model: ${data.model}.`;
    elements.aiModelStatus.textContent = `Active model: ${data.model}.`;
    await checkServer();
  } catch (error) {
    elements.aiModelStatus.textContent = getRequestErrorMessage(error, 'model selection');
    elements.aiModelUse.disabled = false;
  }
}

function selectNavigation(destination) {
  document.querySelectorAll('[data-nav]').forEach((item) => item.classList.toggle('is-current', item.dataset.nav === destination));
}

function setWorkspaceView() {
  state.workspaceView = 'dashboard';
  elements.dashboardLayout.hidden = false;
  elements.conversationView.hidden = true;
  if (elements.labLayout) elements.labLayout.hidden = true;
  document.body.classList.add('new-interface');
  document.body.classList.remove('chat-view', 'jarvis-lab-view');
  document.querySelectorAll('[data-nav]').forEach((item) => {
    item.classList.toggle('is-current', item.dataset.nav === 'dashboard');
  });
}

function openJarvisLab() {
  elements.dashboardLayout.hidden = true;
  elements.conversationView.hidden = true;
  elements.labLayout.hidden = false;
  document.body.classList.add('jarvis-lab-view');
  document.body.classList.remove('chat-view');
  document.querySelectorAll('[data-nav]').forEach((item) => {
    item.classList.toggle('is-current', item.dataset.nav === 'lab');
  });
  document.querySelector('#jarvis-lab-title').focus();
}

function returnToJarvisWorkspace() {
  setWorkspaceView(state.workspaceView, { remember: false });
  if (state.workspaceView === 'dashboard') elements.dashboardMessage.focus();
}

function showHistory() {
  elements.historyList.replaceChildren();
  elements.historyCount.textContent = state.preferences.memoryEnabled
    ? `${state.messages.length} messages saved on this device.`
    : 'Conversation history saving is turned off.';
  if (!state.messages.length) {
    const empty = document.createElement('p');
    empty.className = 'settings-disclaimer';
    empty.textContent = 'No saved conversation messages.';
    elements.historyList.append(empty);
  }
  for (const [index, message] of state.messages.entries()) {
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'history-entry';
    const role = document.createElement('strong');
    role.textContent = message.role === 'user' ? 'YOU' : 'J.A.R.V.I.S.';
    const text = document.createElement('span');
    text.textContent = message.content.slice(0, 240) || 'Retrieved web results';
    const number = document.createElement('small');
    number.textContent = String(index + 1).padStart(2, '0');
    row.append(number, role, text);
    row.addEventListener('click', () => {
      setWorkspaceView('dashboard');
      elements.historyDialog.close();
    });
    elements.historyList.append(row);
  }
  elements.historyDialog.showModal();
}

function searchAttachedFiles() {
  const query = elements.fileSearchQuery.value.trim().toLocaleLowerCase();
  elements.fileSearchResults.replaceChildren();
  const attachedFiles = state.messages.flatMap((message, index) => {
    if (message.role !== 'user') return [];
    const match = message.content.match(/^\[Attached file: ([^\]]+)\]\n([\s\S]*)$/m);
    return match ? [{ name: match[1], content: match[2], index }] : [];
  });
  const matches = attachedFiles.filter((file) => !query || `${file.name}\n${file.content}`.toLocaleLowerCase().includes(query));
  if (!matches.length) {
    const empty = document.createElement('p');
    empty.className = 'settings-disclaimer';
    empty.textContent = attachedFiles.length ? 'No attached files match this search.' : 'No attached text files found in saved history.';
    elements.fileSearchResults.append(empty);
    return;
  }
  for (const file of matches) {
    const result = document.createElement('article');
    result.className = 'file-search-result';
    const title = document.createElement('strong');
    title.textContent = `${file.name} · message ${file.index + 1}`;
    const preview = document.createElement('p');
    const excerptIndex = query ? file.content.toLocaleLowerCase().indexOf(query) : 0;
    const start = Math.max(0, excerptIndex - 70);
    preview.textContent = file.content.slice(start, start + 220);
    result.append(title, preview);
    elements.fileSearchResults.append(result);
  }
}

function toggleStudyMode() {
  state.preferences.studyMode = !state.preferences.studyMode;
  elements.studyIndicator.textContent = state.preferences.studyMode ? 'ON' : 'OFF';
  elements.studyQuickIndicator.textContent = state.preferences.studyMode ? 'ON' : 'OFF';
  elements.leftModeStatus.textContent = state.preferences.studyMode ? 'STUDY' : 'STANDARD';
  savePreferences();
  logActivity(state.preferences.studyMode ? 'Study Mode enabled' : 'Study Mode disabled');
  setWorkspaceView('dashboard');
  elements.message.placeholder = state.preferences.studyMode ? 'Ask a question to learn step by step...' : 'Ask J.A.R.V.I.S. anything...';
  elements.dashboardMessage.placeholder = state.preferences.studyMode ? 'Ask a study question...' : 'Ask J.A.R.V.I.S.';
  elements.message.focus();
}

function updateFocusTimerDisplay() {
  const minutes = Math.floor(state.focusRemaining / 60);
  const seconds = state.focusRemaining % 60;
  elements.focusTimerDisplay.textContent = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function persistFocusTimer() {
  try {
    saveFocusTimer(localStorage, state.focusTimerState);
    return true;
  } catch (error) {
    showFeedback(`Focus timer state could not be saved in this browser: ${error.message}`);
    return false;
  }
}

function finishFocusSession({ completedWhileClosed = false, completedTaskTitle = null } = {}) {
  if (state.focusTimerId) window.clearInterval(state.focusTimerId);
  state.focusTimerId = null;
  const task = state.tasks.find((item) => item.id === state.focusTaskId);
  const title = task?.title || completedTaskTitle || state.focusTaskTitle;
  let persistenceError = null;
  const completedTimer = {
    ...state.focusTimerState,
    taskId: state.focusTaskId,
    taskTitle: title || null,
  };
  try {
    state.focusTimerState = completeFocusTimer(localStorage, completedTimer);
  } catch (error) {
    state.focusTimerState = createFocusTimerState();
    persistenceError = error;
  }
  state.focusTaskId = null;
  state.focusTaskTitle = null;
  state.focusRemaining = state.focusTimerState.remainingSeconds;
  updateFocusTimerDisplay();
  elements.focusTimerButton.textContent = 'Start';
  elements.focusTimerButton.setAttribute('aria-pressed', 'false');
  if (persistenceError) {
    showFeedback(`Focus session complete, but its final state could not be saved: ${persistenceError.message}`);
  } else if (completedWhileClosed) {
    showFeedback('Focus session completed while J.A.R.V.I.S. was closed.');
  } else {
    showFeedback('Focus session complete.');
  }
  logActivity(title
    ? `Focus session complete: ${title}`
    : 'Focus session complete');
  renderTaskPriority();
}

function initializeFocusTimer() {
  let restored;
  try {
    restored = loadFocusTimer(localStorage);
  } catch (error) {
    restored = {
      timer: createFocusTimerState(),
      storageAvailable: false,
      issue: error,
      completedWhileClosed: false,
    };
  }
  state.focusTimerState = restored.timer;
  state.focusRemaining = restored.timer.remainingSeconds;
  state.focusTaskId = restored.timer.taskId;
  state.focusTaskTitle = restored.timer.taskTitle;
  updateFocusTimerDisplay();

  if (restored.issue) {
    showFeedback(restored.storageAvailable
      ? `${restored.issue.message} Starting with a fresh focus timer.`
      : `Focus timer storage is unavailable. The timer will work for this session only: ${restored.issue.message}`);
  }
  if (restored.completedWhileClosed) {
    finishFocusSession({
      completedWhileClosed: true,
      completedTaskTitle: restored.completedTaskTitle,
    });
    return;
  }

  if (restored.timer.running) {
    elements.focusTimerButton.textContent = 'Pause';
    elements.focusTimerButton.setAttribute('aria-pressed', 'true');
    state.focusTimerId = window.setInterval(() => {
      state.focusRemaining = getFocusTimerRemaining(state.focusTimerState);
      updateFocusTimerDisplay();
      if (state.focusRemaining <= 0) finishFocusSession();
    }, 1000);
  } else {
    elements.focusTimerButton.textContent = restored.timer.resumable ? 'Resume' : 'Start';
    elements.focusTimerButton.setAttribute('aria-pressed', 'false');
  }
  renderTaskPriority();
}

function toggleFocusTimer() {
  if (state.focusTimerId) {
    state.focusTimerState = pauseFocusTimer(state.focusTimerState);
    state.focusRemaining = state.focusTimerState.remainingSeconds;
    state.focusTimerId = null;
    if (state.focusRemaining <= 0) {
      finishFocusSession();
      return;
    }
    updateFocusTimerDisplay();
    elements.focusTimerButton.textContent = 'Resume';
    elements.focusTimerButton.setAttribute('aria-pressed', 'false');
    persistFocusTimer();
    logActivity('Focus timer paused');
    renderTaskPriority();
    return;
  }

  if (state.focusRemaining <= 0) {
    finishFocusSession();
    return;
  }
  const task = state.tasks.find((item) => item.id === state.focusTaskId);
  state.focusTaskTitle = task?.title || state.focusTaskTitle;
  state.focusTimerState = startFocusTimer({
    ...state.focusTimerState,
    remainingSeconds: state.focusRemaining,
    taskId: state.focusTaskId,
    taskTitle: state.focusTaskTitle,
  });
  state.focusRemaining = getFocusTimerRemaining(state.focusTimerState);
  elements.focusTimerButton.textContent = 'Pause';
  elements.focusTimerButton.setAttribute('aria-pressed', 'true');
  persistFocusTimer();
  state.focusTimerId = window.setInterval(() => {
    state.focusRemaining = getFocusTimerRemaining(state.focusTimerState);
    updateFocusTimerDisplay();
    if (state.focusRemaining <= 0) {
      finishFocusSession();
    }
  }, 1000);
  logActivity(task ? `Focus timer started: ${task.title}` : 'Focus timer started');
  renderTaskPriority();
}

async function startScreenCapture(captureSequence) {
  if (!navigator.mediaDevices?.getDisplayMedia) {
    elements.captureStatus.textContent = 'Screen capture is not supported in this browser.';
    elements.captureFrameButton.textContent = 'Screen capture unavailable';
    return;
  }
  elements.captureFrameButton.disabled = true;
  elements.captureFrameButton.textContent = 'Waiting for screen permission';
  elements.captureStatus.textContent = 'Choose a screen or window in the browser permission picker.';
  try {
    const displayStream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
    if (captureSequence !== state.visionCaptureSequence
      || !elements.screenCaptureDialog.open
      || !state.preferences.fullAccessEnabled) {
      displayStream.getTracks().forEach((track) => track.stop());
      return;
    }
    state.displayStream = displayStream;
    elements.capturePreview.srcObject = state.displayStream;
    elements.capturePreview.hidden = false;
    elements.captureFrameButton.disabled = false;
    elements.captureFrameButton.textContent = 'Capture one frame';
    elements.stopCaptureButton.disabled = false;
    elements.captureStatus.textContent = 'Screen sharing is active only while the browser indicator is visible.';
    state.displayStream.getVideoTracks()[0]?.addEventListener('ended', stopScreenCapture, { once: true });
    logActivity('Screen sharing approved by user');
  } catch (error) {
    if (captureSequence !== state.visionCaptureSequence || !elements.screenCaptureDialog.open) return;
    elements.captureStatus.textContent = error.name === 'NotAllowedError'
      ? 'Screen capture was cancelled or denied.'
      : `Screen capture unavailable: ${error.message}`;
    elements.captureFrameButton.disabled = false;
    elements.captureFrameButton.textContent = 'Choose screen again';
  }
}

async function startCameraCapture() {
  if (!state.preferences.fullAccessEnabled) return;
  if (!navigator.mediaDevices?.getUserMedia) {
    elements.captureStatus.textContent = 'Camera capture is not supported in this browser.';
    return;
  }
  if (state.displayStream) stopScreenCapture();
  const captureSequence = ++state.visionCaptureSequence;
  elements.cameraCaptureButton.disabled = true;
  elements.cameraCaptureButton.textContent = 'Waiting for camera permission';
  elements.captureStatus.textContent = 'Requesting camera access. The browser will show its camera indicator.';
  elements.stopCaptureButton.disabled = false;
  try {
    const cameraStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: 'environment' } },
      audio: false,
    });
    if (captureSequence !== state.visionCaptureSequence
      || !elements.screenCaptureDialog.open
      || !state.preferences.fullAccessEnabled) {
      cameraStream.getTracks().forEach((track) => track.stop());
      return;
    }
    state.cameraStream = cameraStream;
    elements.capturePreview.srcObject = cameraStream;
    elements.capturePreview.hidden = false;
    elements.captureFrameButton.disabled = false;
    elements.captureFrameButton.textContent = 'Capture one frame';
    elements.cameraCaptureButton.disabled = false;
    elements.cameraCaptureButton.textContent = 'Use screen capture';
    elements.stopCaptureButton.disabled = false;
    elements.captureStatus.textContent = 'Camera is active. Its browser indicator remains visible until capture or stop.';
    cameraStream.getVideoTracks()[0]?.addEventListener('ended', stopCameraCapture, { once: true });
    logActivity('Camera access approved by user');
  } catch (error) {
    if (captureSequence !== state.visionCaptureSequence || !elements.screenCaptureDialog.open) return;
    elements.cameraCaptureButton.disabled = false;
    elements.cameraCaptureButton.textContent = 'Use camera';
    elements.captureStatus.textContent = error.name === 'NotAllowedError'
      ? 'Camera access was denied or cancelled.'
      : `Camera capture unavailable: ${error.message}`;
    elements.stopCaptureButton.disabled = !state.displayStream;
  }
}

function stopScreenCapture() {
  state.displayStream?.getTracks().forEach((track) => track.stop());
  state.displayStream = null;
  elements.capturePreview.srcObject = null;
  elements.capturePreview.hidden = true;
  elements.captureFrameButton.disabled = false;
  elements.captureFrameButton.textContent = 'Choose screen again';
  elements.captureStatus.textContent = 'Screen sharing stopped.';
}

function stopCameraCapture() {
  const cameraStream = state.cameraStream;
  cameraStream?.getTracks().forEach((track) => track.stop());
  state.cameraStream = null;
  if (elements.capturePreview.srcObject === cameraStream) {
    elements.capturePreview.srcObject = null;
    elements.capturePreview.hidden = true;
  }
  elements.cameraCaptureButton.disabled = false;
  elements.cameraCaptureButton.textContent = 'Use camera';
  if (!state.displayStream) {
    elements.captureFrameButton.disabled = false;
    elements.captureFrameButton.textContent = 'Choose screen again';
  }
  elements.captureStatus.textContent = 'Camera capture stopped.';
}

function updateVisionSendButton() {
  elements.visionSendButton.disabled = !state.visionFrame
    || state.visionSending
    || !elements.visionQuestion.value.trim();
}

function clearVisionFrame() {
  state.visionFrame = null;
  if (state.captureObjectUrl) URL.revokeObjectURL(state.captureObjectUrl);
  state.captureObjectUrl = null;
  elements.captureFramePreview.removeAttribute('src');
  elements.captureFramePreview.hidden = true;
  elements.downloadCapture.removeAttribute('href');
  elements.downloadCapture.hidden = true;
  elements.visionQuestion.value = '';
  elements.visionQuestion.disabled = true;
  updateVisionSendButton();
}

function openVisionDialog() {
  if (!state.preferences.fullAccessEnabled) return;
  if (elements.applicationDialog.open) elements.applicationDialog.close();
  const captureSequence = ++state.visionCaptureSequence;
  clearVisionFrame();
  elements.captureFrameButton.disabled = true;
  elements.stopCaptureButton.disabled = false;
  elements.captureStatus.textContent = '';
  elements.screenCaptureDialog.showModal();
  startScreenCapture(captureSequence);
}

function emergencyStopVision() {
  state.visionCaptureSequence += 1;
  state.visionAbortController?.abort();
  stopScreenCapture();
  stopCameraCapture();
  clearVisionFrame();
  elements.stopCaptureButton.disabled = true;
  elements.captureFrameButton.disabled = false;
  elements.captureFrameButton.textContent = 'Choose screen again';
  elements.captureStatus.textContent = 'Emergency Stop: camera/screen capture stopped, pending request cancelled, and local preview cleared.';
}

function canvasToJpeg(canvas, quality) {
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
}

async function createVisionFrame(video, canvas) {
  const sourceWidth = video.videoWidth;
  const sourceHeight = video.videoHeight;
  const scale = Math.min(1, maxVisionDimension / Math.max(sourceWidth, sourceHeight));
  let width = Math.max(1, Math.round(sourceWidth * scale));
  let height = Math.max(1, Math.round(sourceHeight * scale));
  const context = canvas.getContext('2d', { alpha: false });
  if (!context) throw new Error('Screen capture is unavailable in this browser.');

  for (let attempt = 0; attempt < 8; attempt += 1) {
    canvas.width = width;
    canvas.height = height;
    context.drawImage(video, 0, 0, width, height);
    const blob = await canvasToJpeg(canvas, Math.max(.48, .82 - attempt * .05));
    if (blob?.type === 'image/jpeg' && blob.size <= maxVisionImageBytes) {
      return { blob, width, height };
    }
    if (!blob) throw new Error('The browser could not encode this screen frame.');
    const nextScale = Math.min(.82, Math.sqrt(maxVisionImageBytes / blob.size) * .9);
    width = Math.max(1, Math.floor(width * nextScale));
    height = Math.max(1, Math.floor(height * nextScale));
  }
  throw new Error('Could not compress this screen frame below 500 KB.');
}

function readBlobAsDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener('load', () => resolve(reader.result), { once: true });
    reader.addEventListener('error', () => reject(new Error('The screen frame could not be prepared for sending.')), { once: true });
    reader.readAsDataURL(blob);
  });
}

async function captureScreenFrame() {
  const video = elements.capturePreview;
  const cameraCapture = Boolean(state.cameraStream);
  if ((!state.displayStream && !state.cameraStream) || !video.videoWidth || !video.videoHeight || state.visionFrame) {
    elements.captureStatus.textContent = 'No active screen or camera stream is available.';
    return;
  }
  elements.captureFrameButton.disabled = true;
  elements.captureStatus.textContent = 'Preparing one local preview. It will not be sent until you choose Send.';
  try {
    const frame = await createVisionFrame(video, elements.captureCanvas);
    state.visionFrame = frame.blob;
    state.captureObjectUrl = URL.createObjectURL(frame.blob);
    elements.captureFramePreview.src = state.captureObjectUrl;
    elements.captureFramePreview.hidden = false;
    elements.downloadCapture.href = state.captureObjectUrl;
    elements.downloadCapture.hidden = false;
    elements.visionQuestion.disabled = false;
    if (cameraCapture) stopCameraCapture();
    else stopScreenCapture();
    elements.captureFrameButton.disabled = true;
    elements.captureStatus.textContent = `Local ${cameraCapture ? 'camera' : 'screen'} preview ready: ${frame.width} × ${frame.height}, ${Math.ceil(frame.blob.size / 1024)} KB. Nothing has been sent.`;
    elements.visionQuestion.focus();
    logActivity(`One ${cameraCapture ? 'camera' : 'screen'} frame captured locally`);
    updateVisionSendButton();
  } catch (error) {
    elements.captureStatus.textContent = error.message;
    elements.captureFrameButton.disabled = !state.displayStream && !state.cameraStream;
  }
}

async function sendVisionFrame() {
  if (!state.preferences.fullAccessEnabled) {
    emergencyStopVision();
    return;
  }
  if (!state.visionFrame || state.visionSending) return;
  const question = elements.visionQuestion.value.trim();
  if (!question || question.length > 500) {
    elements.captureStatus.textContent = 'Enter a question of 1 to 500 characters before sending this frame.';
    return;
  }

  state.visionSending = true;
  const requestSequence = state.visionCaptureSequence;
  const controller = new AbortController();
  state.visionAbortController = controller;
  const timeoutId = window.setTimeout(() => controller.abort(), 50_000);
  updateVisionSendButton();
  elements.captureStatus.textContent = 'Sending this one frame to J.A.R.V.I.S. for analysis...';
  try {
    const image = await readBlobAsDataUrl(state.visionFrame);
    const response = await fetch('/api/vision', {
      method: 'POST',
      headers: apiHeaders(true),
      body: JSON.stringify({ provider: elements.aiProvider.value, question, image }),
      signal: controller.signal,
    });
    const data = await readApiResponse(response);
    addMessage({ role: 'user', content: `[Screen Vision] ${question}` });
    addMessage({ role: 'assistant', content: data.reply });
    logActivity('One screen frame analyzed by J.A.R.V.I.S.');
    elements.captureStatus.textContent = `Analysis complete via ${data.provider}.`;
    elements.screenCaptureDialog.close();
  } catch (error) {
    if (elements.screenCaptureDialog.open && requestSequence === state.visionCaptureSequence) {
      clearVisionFrame();
      elements.captureFrameButton.disabled = false;
      elements.captureFrameButton.textContent = 'Choose screen again';
      elements.captureStatus.textContent = getRequestErrorMessage(error, 'Vision request');
    }
  } finally {
    window.clearTimeout(timeoutId);
    if (state.visionAbortController === controller) state.visionAbortController = null;
    state.visionSending = false;
    updateVisionSendButton();
  }
}

function handleNavigation(event) {
  const button = event.target.closest('[data-nav]');
  if (!button) return;
  if (event.currentTarget === elements.moreNavigationDialog && elements.moreNavigationDialog.open) {
    elements.moreNavigationDialog.close();
  }
  const destination = button.dataset.nav;
  if (destination === 'lab') {
    openJarvisLab();
  } else if (destination === 'dashboard') {
    setWorkspaceView('dashboard');
  } else if (destination === 'chat') {
    setWorkspaceView('dashboard');
    elements.dashboardMessage.focus();
    elements.dashboardChatPanel?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  } else if (destination === 'voice') {
    setWorkspaceView('dashboard');
    startListeningFromUserGesture();
  } else if (destination === 'more') {
    elements.moreNavigationDialog.showModal();
  } else if (destination === 'history') {
    showHistory();
  } else if (destination === 'memory') {
    openSmartMemoryPanel();
  } else if (destination === 'files') {
    elements.fileSearchQuery.value = '';
    searchAttachedFiles();
    elements.fileSearchDialog.showModal();
  } else if (destination === 'applications') {
    elements.applicationDialog.showModal();
  } else if (destination === 'study') {
    toggleStudyMode();
  } else if (destination === 'productivity') {
    setWorkspaceView('dashboard');
    document.querySelector('.focus-timer-row').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    elements.focusTimerButton.focus();
  } else if (destination === 'system') {
    setWorkspaceView('dashboard');
    document.querySelector('#system-title').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  } else if (destination === 'news') {
    setWorkspaceView('dashboard');
    selectNavigation('news');
    document.querySelector('.briefing-panel').open = true;
    if (!elements.briefingResults.childElementCount) loadBriefing();
    document.querySelector('#briefing-title').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  } else if (destination === 'settings') {
    selectNavigation(destination);
    openSettings();
  } else if (destination === 'activity') {
    setWorkspaceView('dashboard');
    selectNavigation(destination);
    document.querySelector('#activity-panel').open = true;
    document.querySelector('#activity-panel').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
}

function handleDashboardFeature(event) {
  const button = event.target.closest('[data-dashboard-feature], [data-avatar-feature]');
  if (!button) return;
  const destination = button.dataset.dashboardFeature || button.dataset.avatarFeature;
  if (destination === 'chat') {
    elements.dashboardMessage.focus();
    document.querySelector('#dashboard-chat-title').scrollIntoView({ behavior: 'smooth', block: 'center' });
  } else if (destination === 'voice') {
    startListeningFromUserGesture();
  } else if (destination === 'files') {
    elements.fileSearchQuery.value = '';
    searchAttachedFiles();
    elements.fileSearchDialog.showModal();
  } else if (destination === 'browser') {
    elements.applicationDialog.showModal();
  } else if (destination === 'system') {
    document.querySelector('#system-panel').scrollIntoView({ behavior: 'smooth', block: 'center' });
  } else if (destination === 'settings') {
    openSettings();
  } else if (destination === 'more') {
    elements.moreNavigationDialog.showModal();
  }
}

async function loadBriefing() {
  elements.briefingButton.disabled = true;
  renderBriefingState(
    elements.briefingResults,
    'Searching available web sources...',
    'en',
  );
  try {
    const query = 'latest technology news';
    const params = new URLSearchParams({ q: query, lang: 'en' });
    const response = await fetch(`/api/search?${params}`, {
      headers: apiHeaders(),
      signal: AbortSignal.timeout(18_000),
    });
    const data = await readApiResponse(response);
    const count = renderBriefingResults(elements.briefingResults, data, 'en');
    logActivity(count
      ? `Briefing retrieved: ${count} source${count === 1 ? '' : 's'}`
      : 'Briefing returned no source-backed results');
  } catch (error) {
    renderBriefingState(
      elements.briefingResults,
      getRequestErrorMessage(error, 'news briefing'),
      'en',
      'error',
    );
    logActivity('Briefing unavailable');
  } finally {
    elements.briefingButton.disabled = false;
  }
}

document.querySelector('#settings-button').addEventListener('click', () => elements.settings.showModal());
elements.dashboardSettingsButton.addEventListener('click', () => elements.settings.showModal());
elements.homeAssistantRefresh.addEventListener('click', refreshHomeAssistantEntities);
elements.googleWorkspaceConnect.addEventListener('click', connectGoogleWorkspace);
elements.googleWorkspaceRefresh.addEventListener('click', refreshGoogleWorkspaceStatus);
elements.googleWorkspaceDisconnect.addEventListener('click', disconnectGoogleWorkspace);
elements.googleDraftForm.addEventListener('submit', createGoogleDraft);
elements.googleCalendarRefresh.addEventListener('click', refreshGoogleCalendarEvents);
elements.googleEventForm.addEventListener('submit', createGoogleCalendarEvent);
elements.telegramRefresh.addEventListener('click', refreshTelegramStatus);
elements.telegramSendForm.addEventListener('submit', sendTelegramMessage);
elements.facebookMessengerRefresh.addEventListener('click', refreshFacebookMessengerStatus);
elements.facebookMessengerSendForm.addEventListener('submit', sendFacebookMessengerMessage);
showGoogleWorkspaceCallbackStatus();
elements.browserResearchOpen.addEventListener('click', openBrowserResearch);
elements.browserResearchForm.addEventListener('submit', submitBrowserResearch);
elements.browserResearchStop.addEventListener('click', stopBrowserResearch);
elements.browserResearchDialog.addEventListener('close', () => {
  state.browserResearchAbortController?.abort();
  elements.browserResearchStatus.textContent = '';
});
const publicShareUrl = getPublicShareUrl(window.location);
if (publicShareUrl) {
  elements.shareStatus.textContent = 'HTTPS link ready. Confirm your host marks it Public before sharing; J.A.R.V.I.S. cannot verify access from other networks.';
} else {
  elements.shareStatus.textContent = 'This address is local or not secure, so it cannot be shared. In a Codespace, run npm run codespaces, set port 4173 visibility to Public in the Ports tab, then reopen JARVIS using its HTTPS forwarded URL.';
  elements.shareLinkButton.disabled = true;
  elements.copyLinkButton.disabled = true;
}

async function copyTextToClipboard(text) {
  if (window.jarvisDesktop?.copyText) {
    try {
      if (await window.jarvisDesktop.copyText(text)) return true;
    } catch {
      // Fall back to the browser clipboard APIs.
    }
  }
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Try the browser's legacy clipboard API below.
    }
  }
  const input = document.createElement('textarea');
  input.value = text;
  input.setAttribute('readonly', '');
  input.style.position = 'fixed';
  input.style.opacity = '0';
  document.body.append(input);
  input.select();
  const copied = document.execCommand('copy');
  input.remove();
  if (!copied) return false;
  return true;
}

async function copyPublicLink() {
  if (!publicShareUrl) return;
  if (!await copyTextToClipboard(publicShareUrl)) {
    throw new Error('Clipboard access was denied. Copy the HTTPS address from the browser address bar instead.');
  }
  elements.shareStatus.textContent = 'Public JARVIS link copied. No keys or private settings were included.';
}

elements.copyLinkButton.addEventListener('click', () => {
  copyPublicLink().catch((error) => {
    elements.shareStatus.textContent = error.message;
  });
});
elements.shareLinkButton.addEventListener('click', async () => {
  if (!publicShareUrl) return;
  if (navigator.share) {
    try {
      await navigator.share({ title: 'J.A.R.V.I.S.', text: 'Open J.A.R.V.I.S.', url: publicShareUrl });
      elements.shareStatus.textContent = 'J.A.R.V.I.S. link shared.';
      return;
    } catch (error) {
      if (error.name === 'AbortError') return;
      elements.shareStatus.textContent = `Sharing failed: ${error.message}`;
      return;
    }
  }
  try {
    await copyPublicLink();
  } catch (error) {
    elements.shareStatus.textContent = error.message;
  }
});
elements.avatarActivateButton.addEventListener('click', activate3DAvatar);
elements.earthActivateButton.addEventListener('click', activateHolographicEarth);
elements.hologramToggle?.addEventListener('click', () => {
  const enabled = elements.hologramToggle.getAttribute('aria-pressed') !== 'true';
  elements.hologramToggle.setAttribute('aria-pressed', String(enabled));
  elements.hologramToggle.textContent = enabled ? 'Hologram On' : 'Hologram Off';
  avatar3dInstance?.setHologramMode?.(enabled);
  if (enabled) void avatar3dInstance?.enableDeviceOrientation?.();
});
elements.hologramQuality?.addEventListener('change', () => {
  portraitMotion.setQuality(elements.hologramQuality.value);
  avatar3dInstance?.setHologramQuality?.(elements.hologramQuality.value);
});
elements.customAvatarButton.addEventListener('click', () => elements.customAvatarFile.click());
elements.customAvatarFile.addEventListener('change', () => {
  const [file] = elements.customAvatarFile.files || [];
  if (file) void loadCustomAvatar(file);
});
document.querySelector('#lab-return-button').addEventListener('click', returnToJarvisWorkspace);
document.querySelector('[data-lab-module="personalize"]').addEventListener('click', openPersonalizePanel);
document.querySelector('[data-lab-module="personalize"]').addEventListener('keydown', (event) => {
  if (event.key !== 'Enter' && event.key !== ' ') return;
  event.preventDefault();
  openPersonalizePanel();
});
document.querySelector('[data-lab-module="ai-modify"]').addEventListener('click', openLabAiModifyPanel);
document.querySelector('[data-lab-module="ai-modify"]').addEventListener('keydown', (event) => {
  if (event.key !== 'Enter' && event.key !== ' ') return;
  event.preventDefault();
  openLabAiModifyPanel();
});
document.querySelector('[data-lab-module="code-studio"]').addEventListener('click', openCodeStudioPanel);
document.querySelector('[data-lab-module="code-studio"]').addEventListener('keydown', (event) => {
  if (event.key !== 'Enter' && event.key !== ' ') return;
  event.preventDefault();
  openCodeStudioPanel();
});
document.querySelector('[data-lab-module="extensions"]').addEventListener('click', openExtensionsPanel);
document.querySelector('[data-lab-module="extensions"]').addEventListener('keydown', (event) => {
  if (event.key !== 'Enter' && event.key !== ' ') return;
  event.preventDefault();
  openExtensionsPanel();
});
document.querySelector('#ai-modify-analyze').addEventListener('click', submitLabAiModifyRequest);
document.querySelector('#ai-modify-back').addEventListener('click', closeLabAiModifyPanel);
document.querySelector('#ai-modify-cancel').addEventListener('click', cancelLabAiModifyRequest);
document.querySelector('#ai-modify-reject').addEventListener('click', rejectLabAiModifyRequest);
document.querySelector('#code-studio-back').addEventListener('click', closeCodeStudioPanel);
elements.codeStudioEditor.addEventListener('input', updateCodeStudioReview);
elements.codeStudioLanguage.addEventListener('change', () => {
  const language = CODE_STUDIO_LANGUAGES.find(({ id }) => id === elements.codeStudioLanguage.value);
  elements.codeStudioStatus.textContent = `${language?.label || 'Plain text'} selected. Syntax highlighting is unavailable; content remains plain text and is never executed.`;
});
elements.codeStudioReadonly.addEventListener('change', updateCodeStudioEditorState);
document.querySelector('#code-studio-import').addEventListener('click', prepareCodeStudioImport);
elements.codeStudioFile.addEventListener('change', importCodeStudioFile);
document.querySelector('#code-studio-copy').addEventListener('click', copyCodeStudioText);
document.querySelector('#code-studio-clear').addEventListener('click', clearCodeStudioText);
document.querySelector('#code-studio-export').addEventListener('click', exportCodeStudioText);
document.querySelector('#extensions-back').addEventListener('click', closeExtensionsPanel);
document.querySelector('#extensions-import').addEventListener('click', promptExtensionImport);
elements.extensionsFile.addEventListener('change', importLabExtension);
elements.extensionsList.addEventListener('click', handleLabExtensionAction);
elements.personalizeForm.addEventListener('change', () => {
  personalizeDraft = readPersonalizeForm();
  renderPersonalizePreview(personalizeDraft);
  elements.personalizeStatus.textContent = 'Changes are preview-only until applied.';
});
document.querySelector('#personalize-cancel').addEventListener('click', closePersonalizePanel);
document.querySelector('#personalize-cancel-footer').addEventListener('click', closePersonalizePanel);
document.querySelector('#personalize-reset').addEventListener('click', resetPersonalizeDraft);
document.querySelector('#personalize-apply').addEventListener('click', applyPersonalizeDraft);
document.querySelector('#more-tools-button').addEventListener('click', () => {
  elements.settings.close();
  elements.moreNavigationDialog.showModal();
});
document.querySelectorAll('.primary-nav, .mobile-nav, .feature-toolbar, .right-rail').forEach((nav) => nav.addEventListener('click', handleNavigation));
document.querySelector('.new-feature-bar').addEventListener('click', handleDashboardFeature);
document.querySelector('.avatar-hero').addEventListener('click', handleDashboardFeature);
elements.briefingButton.addEventListener('click', loadBriefing);
elements.moreNavigationDialog.addEventListener('click', handleNavigation);
document.querySelector('#clear-button').addEventListener('click', () => {
  state.messages = [];
  renderMessages();
  try { localStorage.removeItem(HISTORY_KEY); } catch { showFeedback('Saved history could not be cleared in this browser.'); }
});
document.querySelector('#settings-clear').addEventListener('click', () => {
  if (!window.confirm('Clear saved conversation history, notes, tasks, Smart Memories, focus timer, and preferences from this browser?')) return;
  state.messages = [];
  state.accessToken = '';
  elements.accessToken.value = '';
  renderMessages();
  let storageCleared = true;
  if (state.focusTimerId) window.clearInterval(state.focusTimerId);
  state.focusTimerId = null;
  state.focusTimerState = createFocusTimerState();
  state.focusRemaining = state.focusTimerState.remainingSeconds;
  state.focusTaskId = null;
  state.focusTaskTitle = null;
  elements.focusTimerButton.textContent = 'Start';
  elements.focusTimerButton.setAttribute('aria-pressed', 'false');
  updateFocusTimerDisplay();
  try {
    localStorage.removeItem(HISTORY_KEY);
    localStorage.removeItem(PREFERENCES_KEY);
    localStorage.removeItem(NOTES_STORAGE_KEY);
    localStorage.removeItem(TASKS_STORAGE_KEY);
    localStorage.removeItem(MEMORIES_STORAGE_KEY);
    localStorage.removeItem(LAB_PREFERENCES_KEY);
    localStorage.removeItem(LAB_AI_MODIFY_HISTORY_KEY);
    localStorage.removeItem(FOCUS_TIMER_STORAGE_KEY);
  } catch {
    storageCleared = false;
  }
  state.notes = [];
  state.tasks = [];
  state.memories = [];
  state.dismissedTaskSuggestions.clear();
  state.focusTaskId = null;
  state.notesAvailable = storageCleared;
  state.tasksAvailable = storageCleared;
  state.memoriesAvailable = storageCleared;
  resetNoteForm();
  resetTaskForm();
  setPlannerFormAvailability(elements.noteForm, state.notesAvailable);
  elements.noteSearch.disabled = !state.notesAvailable;
  setPlannerFormAvailability(elements.taskForm, state.tasksAvailable);
  renderNotes();
  renderTasks({ resetDismissed: true });
  resetSmartMemoryForm();
  setSmartMemoryAvailability(state.memoriesAvailable);
  renderSmartMemories();
  elements.smartMemoryStatus.textContent = storageCleared
    ? 'Saved Smart Memories cleared from this device.'
    : 'Saved Smart Memories could not be cleared; editing is disabled to protect the saved data.';
  elements.noteStatus.textContent = storageCleared ? 'Saved notes cleared from this device.' : 'Saved notes could not be cleared; editing is disabled to protect the saved data.';
  elements.taskStatus.textContent = storageCleared ? 'Saved tasks cleared from this device.' : 'Saved tasks could not be cleared; editing is disabled to protect the saved data.';
  state.preferences = { ...defaults };
  state.labPreferences = resetLabPreferencesDraft();
  applyLabPreferences(state.labPreferences, document);
  syncSettings();
  showFeedback(storageCleared
    ? 'Saved data, including local notes, tasks, and Smart Memories, was cleared from this browser.'
    : 'Active settings were reset, but the browser could not confirm that all saved data was cleared.');
});
elements.dashboardCommandForm.addEventListener('submit', (event) => {
  event.preventDefault();
  if (event.submitter === elements.dashboardSend) primeVoiceOutput();
  const text = elements.dashboardMessage.value.trim();
  if (!text) return;
  elements.message.value = text;
  elements.dashboardMessage.value = '';
  elements.form.requestSubmit();
});
elements.dashboardRetryButton.addEventListener('click', retryLastChat);
elements.conversationRetryButton.addEventListener('click', retryLastChat);
elements.dashboardMessage.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
    event.preventDefault();
    primeVoiceOutput();
    elements.dashboardCommandForm.requestSubmit();
  }
});
elements.fileSearchQuery.addEventListener('input', searchAttachedFiles);
document.querySelector('#history-open-chat').addEventListener('click', () => {
  elements.historyDialog.close();
  setWorkspaceView('dashboard');
  elements.message.focus();
});
document.querySelectorAll('[data-quick-action="capture"]').forEach((button) => button.addEventListener('click', () => {
  openVisionDialog();
}));
elements.captureFrameButton.addEventListener('click', () => {
  if (state.displayStream || state.cameraStream) {
    captureScreenFrame();
    return;
  }
  if (!state.preferences.fullAccessEnabled) return;
  const captureSequence = ++state.visionCaptureSequence;
  startScreenCapture(captureSequence);
});
elements.cameraCaptureButton.addEventListener('click', () => {
  if (state.cameraStream) {
    stopCameraCapture();
    const captureSequence = ++state.visionCaptureSequence;
    startScreenCapture(captureSequence);
    return;
  }
  startCameraCapture();
});
elements.visionQuestion.addEventListener('input', updateVisionSendButton);
elements.visionSendButton.addEventListener('click', sendVisionFrame);
elements.stopCaptureButton.addEventListener('click', emergencyStopVision);
elements.screenCaptureDialog.addEventListener('close', () => {
  state.visionCaptureSequence += 1;
  if (state.displayStream) stopScreenCapture();
  if (state.cameraStream) stopCameraCapture();
  elements.stopCaptureButton.disabled = true;
  state.visionAbortController?.abort();
  clearVisionFrame();
  elements.captureStatus.textContent = '';
});
elements.focusTimerButton.addEventListener('click', toggleFocusTimer);
elements.priorityAccept.addEventListener('click', () => {
  const task = state.tasks.find((item) => item.id === state.suggestedTaskId && !item.completed);
  if (!task || !state.tasksAvailable) {
    elements.taskStatus.textContent = 'The suggested task is no longer available. Priorities have been refreshed.';
    renderTaskPriority({ resetDismissed: true });
    return;
  }
  state.focusTaskId = task.id;
  state.focusTaskTitle = task.title;
  if (!state.focusTimerId) {
    toggleFocusTimer();
  } else {
    state.focusTimerState = {
      ...state.focusTimerState,
      taskId: task.id,
      taskTitle: task.title,
    };
    persistFocusTimer();
    logActivity(`Focus task selected for active session: ${task.title}`);
  }
  elements.taskStatus.textContent = `Focus session selected for "${task.title}".`;
});
elements.priorityDismiss.addEventListener('click', () => {
  const task = state.tasks.find((item) => item.id === state.suggestedTaskId);
  if (!task) {
    renderTaskPriority({ resetDismissed: true });
    return;
  }
  state.dismissedTaskSuggestions.add(task.id);
  logActivity(`Priority suggestion dismissed: ${task.title}`);
});
elements.noteForm.addEventListener('submit', (event) => {
  event.preventDefault();
  if (!state.notesAvailable) return;
  try {
    const current = state.editingNoteId
      ? state.notes.find((note) => note.id === state.editingNoteId)
      : null;
    if (state.editingNoteId && !current) throw new Error('This note is no longer available. Reload the dashboard and try again.');
    const note = current
      ? updateNote(current, { title: elements.noteTitle.value, content: elements.noteContent.value })
      : createNote({ title: elements.noteTitle.value, content: elements.noteContent.value });
    const notes = current
      ? state.notes.map((item) => item.id === note.id ? note : item)
      : [...state.notes, note];
    saveNotes(localStorage, notes);
    state.notes = notes;
    resetNoteForm();
    renderNotes();
    elements.noteStatus.textContent = current ? 'Note updated on this device.' : 'Note saved on this device.';
  } catch (error) {
    elements.noteStatus.textContent = `Could not save note: ${error.message}`;
  }
});
elements.noteCancelButton.addEventListener('click', () => {
  resetNoteForm();
  elements.noteStatus.textContent = '';
});
elements.noteSearch.addEventListener('input', renderNotes);
elements.noteList.addEventListener('click', (event) => {
  const button = event.target.closest('button[data-planner-action]');
  if (!button) return;
  const note = state.notes.find((item) => item.id === button.dataset.itemId);
  if (!note) {
    elements.noteStatus.textContent = 'This note is no longer available. Reload the dashboard and try again.';
    return;
  }
  if (button.dataset.plannerAction === 'edit-note') {
    state.editingNoteId = note.id;
    elements.noteTitle.value = note.title;
    elements.noteContent.value = note.content;
    elements.noteSaveButton.textContent = 'Save changes';
    elements.noteCancelButton.hidden = false;
    elements.noteStatus.textContent = 'Editing note.';
    elements.noteTitle.focus();
    return;
  }
  if (button.dataset.plannerAction !== 'delete-note') return;
  try {
    const notes = state.notes.filter((item) => item.id !== note.id);
    saveNotes(localStorage, notes);
    state.notes = notes;
    if (state.editingNoteId === note.id) resetNoteForm();
    renderNotes();
    elements.noteStatus.textContent = 'Note deleted from this device.';
  } catch (error) {
    elements.noteStatus.textContent = `Could not delete note: ${error.message}`;
  }
});
elements.smartMemoryForm.addEventListener('submit', (event) => {
  event.preventDefault();
  if (!state.memoriesAvailable) return;
  try {
    const current = state.editingMemoryId
      ? state.memories.find((memory) => memory.id === state.editingMemoryId)
      : null;
    if (state.editingMemoryId && !current) throw new Error('This memory is no longer available. Reload the dashboard and try again.');
    const fields = {
      type: elements.smartMemoryType.value,
      title: elements.smartMemoryTitle.value,
      content: elements.smartMemoryContent.value,
    };
    const memory = current ? updateMemory(current, fields) : createMemory(fields);
    persistSmartMemories(upsertMemory(state.memories, memory));
    resetSmartMemoryForm();
    elements.smartMemoryStatus.textContent = current
      ? memory.includeInContext
        ? 'Memory updated. Its existing context approval is unchanged.'
        : 'Memory updated. Review it and approve it before it can enter AI context.'
      : 'Memory saved on this device. Review it below and approve it before use in AI context.';
  } catch (error) {
    elements.smartMemoryStatus.textContent = `Could not save memory: ${error.message}`;
  }
});
elements.smartMemorySaveConversation.addEventListener('click', () => {
  if (!state.memoriesAvailable) return;
  try {
    const memory = createMemory(summarizeConversation(state.messages));
    persistSmartMemories(upsertMemory(state.memories, memory));
    elements.smartMemoryStatus.textContent = 'This conversation summary was saved. Review it below before approving it for AI context.';
  } catch (error) {
    elements.smartMemoryStatus.textContent = `Conversation summary could not be saved: ${error.message}`;
  }
});
elements.smartMemoryExport.addEventListener('click', () => {
  try {
    const file = createFile('jarvis-memories.json', exportMemories(state.memories));
    downloadFile(file);
    elements.smartMemoryStatus.textContent = `Exported ${state.memories.length} saved memories.`;
  } catch (error) {
    elements.smartMemoryStatus.textContent = `Memories could not be exported: ${error.message}`;
  }
});
elements.smartMemoryExportEncrypted.addEventListener('click', async () => {
  try {
    const backup = await encryptMemories(JSON.parse(exportMemories(state.memories)).memories, elements.smartMemoryPassphrase.value);
    downloadFile(createFile('jarvis-memories.encrypted.json', backup));
    elements.smartMemoryStatus.textContent = `Exported ${state.memories.length} memories, encrypted. Keep the passphrase: it cannot be recovered.`;
  } catch (error) {
    elements.smartMemoryStatus.textContent = `Encrypted export failed: ${error.message}`;
  } finally {
    elements.smartMemoryPassphrase.value = '';
  }
});
elements.smartMemoryImportButton.addEventListener('click', () => elements.smartMemoryImportFile.click());
elements.smartMemoryImportFile.addEventListener('change', async () => {
  const file = elements.smartMemoryImportFile.files?.[0];
  if (!file) return;
  try {
    if (file.size > 1_000_000) throw new RangeError('Memory import files are limited to 1 MB.');
    let text = await file.text();
    if (text.includes('"jarvis-memory-backup"')) {
      text = JSON.stringify({ app: 'jarvis-memory-export', version: 1, memories: await decryptMemories(text, elements.smartMemoryPassphrase.value) });
      elements.smartMemoryPassphrase.value = '';
    }
    const imported = importMemories(text, state.memories);
    persistSmartMemories(imported.memories);
    elements.smartMemoryStatus.textContent = `Imported ${imported.added} memories; skipped ${imported.skipped.length}. Imported memories need review and approval.`;
  } catch (error) {
    elements.smartMemoryStatus.textContent = `Memories could not be imported: ${error.message}`;
  } finally {
    elements.smartMemoryImportFile.value = '';
  }
});
elements.smartMemoryCancel.addEventListener('click', () => {
  resetSmartMemoryForm();
  elements.smartMemoryStatus.textContent = '';
});
elements.smartMemorySearch.addEventListener('input', renderSmartMemories);
elements.smartMemoryList.addEventListener('click', handleSmartMemoryAction);
elements.smartMemoryList.addEventListener('change', (event) => {
  const checkbox = event.target.closest('input[data-memory-approval-id]');
  if (!checkbox) return;
  const memory = state.memories.find((item) => item.id === checkbox.dataset.memoryApprovalId);
  if (!memory) return;
  try {
    const updated = setMemoryContextApproval(memory, checkbox.checked);
    persistSmartMemories(upsertMemory(state.memories, updated));
    elements.smartMemoryStatus.textContent = updated.includeInContext
      ? 'This reviewed memory is approved for relevant AI context.'
      : 'This memory will no longer be included in AI context.';
  } catch (error) {
    renderSmartMemories();
    elements.smartMemoryStatus.textContent = `Memory approval could not be saved: ${error.message}`;
  }
});
elements.smartMemoryClear.addEventListener('click', () => {
  if (!window.confirm('Permanently clear all Smart Memories stored in this browser?')) return;
  try {
    localStorage.removeItem(MEMORIES_STORAGE_KEY);
    state.memories = [];
    state.memoriesAvailable = true;
    setSmartMemoryAvailability(true);
    resetSmartMemoryForm();
    renderSmartMemories();
    elements.smartMemoryStatus.textContent = 'All Smart Memories were cleared from this device.';
  } catch (error) {
    elements.smartMemoryStatus.textContent = `Saved memories could not be cleared: ${error.message}`;
  }
});
elements.taskForm.addEventListener('submit', (event) => {
  event.preventDefault();
  if (!state.tasksAvailable) return;
  try {
    const current = state.editingTaskId
      ? state.tasks.find((task) => task.id === state.editingTaskId)
      : null;
    if (state.editingTaskId && !current) throw new Error('This task is no longer available. Reload the dashboard and try again.');
    const task = current
      ? updateTask(current, { title: elements.taskTitle.value, details: elements.taskDetails.value })
      : createTask({ title: elements.taskTitle.value, details: elements.taskDetails.value });
    const tasks = current
      ? state.tasks.map((item) => item.id === task.id ? task : item)
      : [...state.tasks, task];
    saveTasks(localStorage, tasks);
    state.tasks = tasks;
    resetTaskForm();
    renderTasks({ resetDismissed: true });
    elements.taskStatus.textContent = current ? 'Task updated on this device.' : 'Task saved on this device.';
  } catch (error) {
    elements.taskStatus.textContent = `Could not save task: ${error.message}`;
  }
});
elements.taskCancelButton.addEventListener('click', () => {
  resetTaskForm();
  elements.taskStatus.textContent = '';
});
const handleTaskListClick = (event) => {
  const button = event.target.closest('button[data-planner-action]');
  if (!button) return;
  const task = state.tasks.find((item) => item.id === button.dataset.itemId);
  if (!task) {
    elements.taskStatus.textContent = 'This task is no longer available. Reload the dashboard and try again.';
    return;
  }
  if (button.dataset.plannerAction === 'edit-task') {
    state.editingTaskId = task.id;
    elements.taskTitle.value = task.title;
    elements.taskDetails.value = task.content;
    elements.taskSaveButton.textContent = 'Save changes';
    elements.taskCancelButton.hidden = false;
    elements.taskStatus.textContent = 'Editing task.';
    elements.taskTitle.focus();
    return;
  }
  if (button.dataset.plannerAction !== 'delete-task') return;
  try {
    const tasks = state.tasks.filter((item) => item.id !== task.id);
    saveTasks(localStorage, tasks);
    state.tasks = tasks;
    if (state.editingTaskId === task.id) resetTaskForm();
    renderTasks({ resetDismissed: true });
    elements.taskStatus.textContent = 'Task deleted from this device.';
  } catch (error) {
    elements.taskStatus.textContent = `Could not delete task: ${error.message}`;
  }
};
elements.pendingTaskList.addEventListener('click', handleTaskListClick);
elements.completedTaskList.addEventListener('click', handleTaskListClick);
const handleTaskCompletionChange = (event) => {
  const checkbox = event.target.closest('input[type="checkbox"][data-task-id]');
  if (!checkbox || !state.tasksAvailable) return;
  const task = state.tasks.find((item) => item.id === checkbox.dataset.taskId);
  if (!task) {
    elements.taskStatus.textContent = 'This task is no longer available. Reload the dashboard and try again.';
    return;
  }
  try {
    const updated = setTaskCompleted(task, checkbox.checked);
    const tasks = state.tasks.map((item) => item.id === updated.id ? updated : item);
    saveTasks(localStorage, tasks);
    state.tasks = tasks;
    renderTasks({ resetDismissed: true });
    elements.taskStatus.textContent = updated.completed ? 'Task marked complete.' : 'Task marked pending.';
  } catch (error) {
    checkbox.checked = task.completed;
    elements.taskStatus.textContent = `Could not update task: ${error.message}`;
  }
};
elements.pendingTaskList.addEventListener('change', handleTaskCompletionChange);
elements.completedTaskList.addEventListener('change', handleTaskCompletionChange);
document.querySelector('[data-quick-action="files"]').addEventListener('click', () => {
  elements.fileSearchQuery.value = '';
  searchAttachedFiles();
  elements.fileSearchDialog.showModal();
});
document.querySelector('[data-quick-action="applications"]').addEventListener('click', () => elements.applicationDialog.showModal());
elements.form.addEventListener('submit', submitMessage);
elements.agentModeButtons.forEach((button) => button.addEventListener('click', () => setAgentMode(!state.agentMode)));
elements.agentStopButton.addEventListener('click', stopAgentPlan);
elements.message.addEventListener('input', () => {
  elements.message.style.height = 'auto';
  elements.message.style.height = `${Math.min(elements.message.scrollHeight, 140)}px`;
});
elements.message.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
    event.preventDefault();
    primeVoiceOutput();
    elements.form.requestSubmit();
  }
});
elements.searchToggle.addEventListener('click', () => {
  state.searchMode = !state.searchMode;
  updateSearchMode();
  elements.message.focus();
});
elements.mic.addEventListener('click', startListeningFromUserGesture);
elements.attachButton.addEventListener('click', () => elements.fileInput.click());
elements.dashboardAttachButton.addEventListener('click', () => elements.fileInput.click());
function renderWorkspaceFiles() {
  elements.fileWorkspaceList.replaceChildren();
  state.workspaceFiles.forEach((file, index) => {
    const item = document.createElement('li');
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.workspaceFileIndex = String(index);
    button.textContent = `${file.name} · ${file.size} bytes`;
    item.append(button);
    elements.fileWorkspaceList.append(item);
  });
  elements.fileExportButton.disabled = state.workspaceFiles.length === 0;
}

function setActiveWorkspaceFile(file) {
  state.activeWorkspaceFile = file;
  elements.fileWorkspaceContent.value = new TextDecoder().decode(file.data);
  elements.fileWorkspaceContent.disabled = false;
  elements.fileSaveButton.disabled = false;
  elements.fileDownloadButton.disabled = false;
}

async function openZipWorkspaceEntry(index) {
  if (!state.uploadedZip) return;
  const metadata = state.uploadedZip.entries[index];
  if (!metadata?.safe || metadata.directory) return;
  try {
    const entry = listZipEntries(state.uploadedZip.bytes)[index];
    const bytes = await readZipEntry(state.uploadedZip.bytes, entry);
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    if (text.includes('\u0000')) throw new Error('This ZIP entry is binary and cannot be edited as text.');
    const name = metadata.name.split('/').pop();
    setActiveWorkspaceFile(createFile(name, text));
    elements.dashboardFileStatus.textContent = `Opened ${metadata.name}. Save edits to add it to the workspace.`;
  } catch (error) {
    elements.dashboardFileStatus.textContent = error.message;
  }
}

elements.fileWorkspaceList.addEventListener('click', (event) => {
  const button = event.target.closest('button[data-workspace-file-index]');
  if (!button) return;
  const file = state.workspaceFiles[Number(button.dataset.workspaceFileIndex)];
  if (file) setActiveWorkspaceFile(file);
});
elements.fileZipEntries.addEventListener('click', (event) => {
  const button = event.target.closest('button[data-zip-entry-index]');
  if (button && !button.disabled) openZipWorkspaceEntry(Number(button.dataset.zipEntryIndex));
});
elements.fileCreateForm.addEventListener('submit', (event) => {
  event.preventDefault();
  try {
    const file = createFile(elements.fileCreateName.value.trim(), elements.fileCreateContent.value);
    state.workspaceFiles = [...state.workspaceFiles.filter((item) => item.name !== file.name), file];
    renderWorkspaceFiles();
    setActiveWorkspaceFile(file);
    elements.fileCreateForm.reset();
    elements.dashboardFileStatus.textContent = `${file.name} created in the local workspace.`;
  } catch (error) {
    elements.dashboardFileStatus.textContent = error.message;
  }
});
elements.fileSaveButton.addEventListener('click', () => {
  if (!state.activeWorkspaceFile) return;
  try {
    const file = editFile(state.activeWorkspaceFile, () => elements.fileWorkspaceContent.value);
    state.workspaceFiles = [...state.workspaceFiles.filter((item) => item.name !== file.name), file];
    renderWorkspaceFiles();
    setActiveWorkspaceFile(file);
    elements.dashboardFileStatus.textContent = `${file.name} edits saved in the local workspace.`;
  } catch (error) {
    elements.dashboardFileStatus.textContent = error.message;
  }
});
elements.fileDownloadButton.addEventListener('click', () => {
  if (!state.activeWorkspaceFile) return;
  downloadFile(state.activeWorkspaceFile);
  elements.dashboardFileStatus.textContent = `Downloading ${state.activeWorkspaceFile.name}.`;
});
elements.fileExportButton.addEventListener('click', () => {
  try {
    downloadFile(createZip(state.workspaceFiles));
    elements.dashboardFileStatus.textContent = `Exported ${state.workspaceFiles.length} workspace files as a ZIP.`;
  } catch (error) {
    elements.dashboardFileStatus.textContent = error.message;
  }
});
elements.fileInput.addEventListener('change', async () => {
  const file = elements.fileInput.files?.[0];
  if (!file) return;
  try {
    const uploaded = await readUploadedFile(file);
    state.pendingAttachment = null;
    state.uploadedZip = null;
    elements.attachmentNote.hidden = true;
    elements.attachmentNote.textContent = '';
    elements.fileZipEntries.replaceChildren();
    if (uploaded.kind === 'unsupported') {
      elements.dashboardFileStatus.textContent = uploaded.reason;
      showFeedback(uploaded.reason);
      return;
    }
    if (uploaded.kind === 'zip') {
      state.uploadedZip = uploaded;
      uploaded.entries.forEach((entry, index) => {
        if (entry.directory) return;
        const item = document.createElement('li');
        const button = document.createElement('button');
        button.type = 'button';
        button.dataset.zipEntryIndex = String(index);
        button.disabled = !entry.safe;
        button.textContent = `${entry.name} · ${entry.size} bytes${entry.safe ? '' : ' · unsafe path'}`;
        item.append(button);
        elements.fileZipEntries.append(item);
      });
      elements.dashboardFileStatus.textContent = `Read ZIP archive: ${uploaded.entries.filter((entry) => !entry.directory).length} file entries. Choose an entry to inspect.`;
      return;
    }
    const workspaceFile = createFile(file.name, uploaded.text);
    state.workspaceFiles = [...state.workspaceFiles.filter((item) => item.name !== workspaceFile.name), workspaceFile];
    renderWorkspaceFiles();
    setActiveWorkspaceFile(workspaceFile);
    if (file.size <= 16_000 && uploaded.text.length <= 2_500 && uploaded.text.trim()) {
      state.pendingAttachment = { name: file.name, content: uploaded.text };
      elements.attachmentNote.textContent = `${file.name} ready. Its text will be included with your next message.`;
      elements.attachmentNote.hidden = false;
      elements.dashboardFileStatus.textContent = `${file.name} loaded and ready to attach`;
      logActivity('Text attachment prepared');
    } else {
      elements.dashboardFileStatus.textContent = `${file.name} loaded. Chat attachments remain limited to 16 KB and 2,500 characters.`;
    }
    showFeedback('');
  } catch (error) {
    state.pendingAttachment = null;
    elements.dashboardFileStatus.textContent = error.message || 'This file could not be read.';
    showFeedback(error.message || 'This file could not be read.');
  } finally {
    elements.fileInput.value = '';
  }
});
elements.fullAccess.addEventListener('change', () => {
  state.preferences.fullAccessEnabled = elements.fullAccess.checked;
  syncFullAccess();
  savePreferences();
  logActivity(state.preferences.fullAccessEnabled ? 'In-app quick actions enabled' : 'In-app quick actions disabled');
});
elements.fullAccessMobile.addEventListener('change', () => {
  elements.fullAccess.checked = elements.fullAccessMobile.checked;
  elements.fullAccess.dispatchEvent(new Event('change', { bubbles: true }));
});
document.querySelectorAll('[data-quick-action]').forEach((button) => button.addEventListener('click', () => {
  if (button.dataset.quickAction === 'chat') {
    setWorkspaceView('dashboard');
    elements.message.focus();
    return;
  }
  if (button.dataset.quickAction === 'study') {
    toggleStudyMode();
    return;
  }
  if (!state.preferences.fullAccessEnabled) return;
  if (button.dataset.quickAction === 'voice') {
    startListeningFromUserGesture();
  }
  if (button.dataset.quickAction === 'search') {
    setWorkspaceView('dashboard');
    state.searchMode = true;
    updateSearchMode();
    elements.message.focus();
    document.querySelector('.conversation').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
}));
elements.language.addEventListener('change', () => {
  state.preferences.language = elements.language.value;
  updateVoiceList();
  savePreferences();
  updateAIProviderFields();
  if (state.recognitionWakeSession) requestStopListening(state.recognition, 'language-changed');
});
elements.avatarTheme.addEventListener('change', () => {
  state.preferences.avatarTheme = AVATAR_THEMES.has(elements.avatarTheme.value)
    ? elements.avatarTheme.value
    : 'electric-blue';
  applyAvatarTheme(state.preferences.avatarTheme);
  savePreferences();
});
elements.accessToken.addEventListener('input', () => {
  state.accessToken = elements.accessToken.value.trim();
});
elements.aiProvider.addEventListener('change', () => {
  discoveredAIModels = [];
  testedAIModels.clear();
  selectedAIModel = '';
  if (elements.aiModelList) elements.aiModelList.replaceChildren();
  if (elements.aiModelTest) elements.aiModelTest.disabled = true;
  if (elements.aiModelUse) elements.aiModelUse.disabled = true;
  if (elements.aiModelStatus) elements.aiModelStatus.textContent = 'Save the new provider configuration before discovering its models.';
  elements.aiModel.value = elements.aiProvider.value === 'ollama' ? 'qwen2.5:3b' : 'gemini-3.8-flash';
  elements.aiBaseUrl.value = elements.aiProvider.value === 'ollama'
    ? 'http://127.0.0.1:11434'
    : 'https://generativelanguage.googleapis.com/v1beta/openai/';
  elements.aiApiKey.value = '';
  updateAIProviderFields();
  updateVoiceList();
});
elements.aiSettingsForm.addEventListener('submit', (event) => {
  event.preventDefault();
  saveAISettings();
});
elements.aiModelRefresh?.addEventListener('click', refreshAIModels);
elements.aiModelTest?.addEventListener('click', testSelectedAIModel);
elements.aiModelUse?.addEventListener('click', useSelectedAIModel);
elements.aiModelMode?.addEventListener('change', () => {
  const verified = discoveredAIModels.filter((model) => testedAIModels.get(model.id)?.verified === true);
  const mode = elements.aiModelMode.value;
  const candidate = mode === 'manual' ? null : verified.find((model) => {
    const id = model.id.toLowerCase();
    if (mode === 'fast' || mode === 'lightweight') return /flash|mini|small|instant|:3b|:1b/.test(id);
    if (mode === 'smart') return /pro|opus|sonnet|large|:14b|:32b/.test(id);
    return true;
  }) || verified[0];
  if (candidate) { selectedAIModel = candidate.id; elements.aiModel.value = candidate.id; renderAIModelList(); }
  elements.aiModelStatus.textContent = mode === 'manual'
    ? 'Manual mode: choose a model and test it before applying.'
    : candidate ? `${mode} mode suggestion: ${candidate.id}. Test/apply it if needed.` : `No verified model matches ${mode} mode yet. Discover and test models first.`;
});
elements.aiSettingsEnvironment.addEventListener('click', () => saveAISettings('environment'));
elements.voice.addEventListener('change', () => {
  state.preferences.voiceURI = elements.voice.value;
  savePreferences();
});
elements.speechRate.addEventListener('input', () => {
  state.preferences.speechRate = Number(elements.speechRate.value);
  elements.speechRateValue.textContent = state.preferences.speechRate.toFixed(1);
  savePreferences();
});
elements.localTtsEnabled?.addEventListener('change', () => {
  writeLocalTtsPreference(elements.localTtsEnabled.checked);
  if (!elements.localTtsEnabled.checked) localTts.stop();
});
elements.voiceEnabled.addEventListener('change', () => {
  state.preferences.voiceEnabled = elements.voiceEnabled.checked;
  elements.dashboardVoiceToggle.setAttribute('aria-pressed', String(state.preferences.voiceEnabled));
  elements.dashboardVoiceLabel.textContent = state.preferences.voiceEnabled ? 'Voice on' : 'Voice off';
  if (!state.preferences.voiceEnabled) stopSpeechOutput();
  else primeVoiceOutput();
  savePreferences();
});
elements.wakeWordEnabled.addEventListener('change', () => {
  state.preferences.wakeWordEnabled = elements.wakeWordEnabled.checked;
  state.wakeWordResumePending = false;
  if (state.preferences.wakeWordEnabled && wakeWordRecoveryPolicy.circuitOpen) {
    state.wakeWordManualRetryPending = true;
  } else if (!state.preferences.wakeWordEnabled) {
    state.wakeWordManualRetryPending = false;
  }
  window.clearTimeout(state.wakeWordRestartTimer);
  state.wakeWordRestartTimer = null;
  savePreferences();
  reportWakeWordStatus('permission-updated');
  if (state.preferences.wakeWordEnabled) {
    state.wakeWordManualTakeoverPending = false;
    startListening('wake', false, false, true);
  } else {
    if (state.recognitionWakeSession) requestStopListening(state.recognition, 'wake-word-disabled');
    showFeedback('Wake-word detection is off.');
  }
});
elements.dashboardMicButton.addEventListener('click', () => {
  startListeningFromUserGesture();
});
elements.dashboardVoiceMicButton.addEventListener('click', () => {
  startListeningFromUserGesture();
});
elements.dashboardVoiceToggle.addEventListener('click', () => {
  elements.voiceEnabled.checked = !elements.voiceEnabled.checked;
  elements.voiceEnabled.dispatchEvent(new Event('change', { bubbles: true }));
});
elements.memoryEnabled.addEventListener('change', () => {
  state.preferences.memoryEnabled = elements.memoryEnabled.checked;
  elements.leftMemoryStatus.textContent = state.preferences.memoryEnabled ? 'LOCAL' : 'OFF';
  if (!state.preferences.memoryEnabled) {
    try { localStorage.removeItem(HISTORY_KEY); } catch { showFeedback('Saved history could not be removed.'); }
  } else {
    saveHistory();
  }
  savePreferences();
});
elements.smartMemoryEnabled.addEventListener('change', () => {
  setSmartMemoryEnabled(elements.smartMemoryEnabled.checked);
});
elements.smartMemoryEnabledDashboard.addEventListener('change', () => {
  setSmartMemoryEnabled(elements.smartMemoryEnabledDashboard.checked);
});
function releaseSpeechAudioPreview() {
  elements.speechAudioPreview.pause();
  elements.speechAudioPreview.removeAttribute('src');
  elements.speechAudioPreview.load();
  elements.speechAudioPreview.hidden = true;
  if (speechAudioPreviewUrl) URL.revokeObjectURL(speechAudioPreviewUrl);
  speechAudioPreviewUrl = '';
}

elements.speechAudioFile.addEventListener('change', () => {
  const file = elements.speechAudioFile.files?.[0];
  if (!file) return;
  releaseSpeechAudioPreview();
  if (file.type && !file.type.startsWith('audio/')) {
    elements.speechAudioFile.value = '';
    elements.speechAudioClear.hidden = true;
    elements.speechAudioStatus.textContent = 'Choose a supported audio file.';
    return;
  }
  speechAudioPreviewUrl = URL.createObjectURL(file);
  elements.speechAudioPreview.src = speechAudioPreviewUrl;
  elements.speechAudioPreview.hidden = false;
  elements.speechAudioClear.hidden = false;
  elements.speechAudioStatus.textContent = `${file.name} selected locally.`;
});

elements.speechAudioClear.addEventListener('click', () => {
  releaseSpeechAudioPreview();
  elements.speechAudioFile.value = '';
  elements.speechAudioClear.hidden = true;
  elements.speechAudioStatus.textContent = 'No audio selected';
});

document.querySelector('#preview-voice').addEventListener('click', () => {
  if (!('speechSynthesis' in window) && !isLocalTtsUsable()) {
    showFeedback('Speech output is not supported by this browser.');
    return;
  }
  speak(state.preferences.language === 'hi' ? 'नमस्ते, मैं आपकी सहायता के लिए तैयार हूँ।' : 'Hello. I am ready to assist you.');
});
window.addEventListener('online', checkServer);
window.addEventListener('offline', checkServer);
window.addEventListener('storage', (event) => {
  if (event.key === TASKS_STORAGE_KEY) {
    try {
      state.tasks = loadTasks(localStorage);
      state.tasksAvailable = true;
      setPlannerFormAvailability(elements.taskForm, true);
      renderTasks({ resetDismissed: true });
      elements.taskStatus.textContent = 'Tasks updated from another tab on this device.';
    } catch (error) {
      state.tasksAvailable = false;
      setPlannerFormAvailability(elements.taskForm, false);
      elements.taskStatus.textContent = `Updated task data could not be loaded: ${error.message}`;
    }
    return;
  }
  if (event.key === MEMORIES_STORAGE_KEY) {
    try {
      state.memories = loadMemories(localStorage);
      state.memoriesAvailable = true;
      setSmartMemoryAvailability(true);
      renderSmartMemories();
      elements.smartMemoryStatus.textContent = 'Memories updated from another tab on this device.';
    } catch (error) {
      state.memoriesAvailable = false;
      setSmartMemoryAvailability(false);
      renderSmartMemories();
      elements.smartMemoryStatus.textContent = `Updated memory data could not be loaded and will not be overwritten: ${error.message}`;
    }
    return;
  }
  if (event.key === PREFERENCES_KEY) {
    state.preferences.smartMemoryEnabled = loadPreferences().smartMemoryEnabled;
    elements.smartMemoryEnabled.checked = state.preferences.smartMemoryEnabled;
    elements.smartMemoryEnabledDashboard.checked = state.preferences.smartMemoryEnabled;
    elements.smartMemoryStatus.textContent = state.preferences.smartMemoryEnabled
      ? 'Smart Memory is on.'
      : 'Smart Memory is off.';
  }
});
const resumeVoiceForPageLifecycle = () => {
  const focused = pageIsFocused();
  if (!isPageForeground(document.visibilityState, focused)) {
    pauseVoiceForPageLifecycle();
    return;
  }
  state.wakeWordPagePaused = false;
  if (shouldRunWakeWord(state.preferences.wakeWordEnabled, document.visibilityState, state.wakeWordPagePaused, state.microphonePermission, focused)) {
    state.wakeWordResumePending = true;
    resumeWakeWordDetection();
  }
};
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') {
    pauseVoiceForPageLifecycle();
  } else {
    updateLocalDateTime();
    resumeVoiceForPageLifecycle();
  }
});
window.addEventListener('blur', pauseVoiceForPageLifecycle);
window.addEventListener('focus', resumeVoiceForPageLifecycle);
window.addEventListener('pagehide', (event) => {
  pauseVoiceForPageLifecycle();
  if (!event.persisted) portraitMotion.destroy();
});
window.addEventListener('pageshow', resumeVoiceForPageLifecycle);
window.addEventListener('beforeinstallprompt', (event) => {
  event.preventDefault();
  state.installPrompt = event;
  updateInstallButton();
});
window.addEventListener('appinstalled', () => {
  state.installPrompt = null;
  elements.install.hidden = true;
});

function isInstalledApp() {
  return window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
}

function updateInstallButton() {
  elements.install.hidden = isInstalledApp() || new URLSearchParams(location.search).has('desktop-app');
}

function showInstallInstructions() {
  const userAgent = navigator.userAgent;
  if (/android/i.test(userAgent)) {
    elements.installInstructions.textContent = 'In Chrome on Android, open the browser menu (three dots) and choose Install app or Add to Home screen, then confirm.';
  } else if (/windows/i.test(userAgent) && /edg\//i.test(userAgent)) {
    elements.installInstructions.textContent = 'In Microsoft Edge on Windows, select the Apps icon in the address bar, or open Settings and more > Apps > Install this site as an app.';
  } else if (/windows/i.test(userAgent)) {
    elements.installInstructions.textContent = 'In Chrome on Windows, select the install icon in the address bar, or open the menu > Cast, save, and share > Install page as app.';
  } else if (/iphone|ipad|ipod/i.test(userAgent)) {
    elements.installInstructions.textContent = 'In Safari, tap Share, choose Add to Home Screen, then confirm.';
  } else {
    elements.installInstructions.textContent = 'Use your browser menu or address-bar install icon and choose Install J.A.R.V.I.S. or Install this site as an app.';
  }
  if (!elements.installHelp.open) elements.installHelp.showModal();
}

elements.install.addEventListener('click', async () => {
  if (isInstalledApp()) {
    updateInstallButton();
    return;
  }
  if (!state.installPrompt) {
    showInstallInstructions();
    return;
  }
  try {
    const prompt = state.installPrompt;
    state.installPrompt = null;
    await prompt.prompt();
    const choice = await prompt.userChoice;
    if (choice.outcome === 'accepted') elements.install.hidden = true;
    else showInstallInstructions();
  } catch {
    showInstallInstructions();
  }
});

state.messages = loadHistory();
initializeLocalPlanner();
initializeFocusTimer();
initializeSmartMemories();
applyLabPreferences(state.labPreferences, document);
syncSettings();
reportWakeWordStatus('startup');
if (state.preferences.wakeWordEnabled && !elements.wakeWordEnabled.disabled) startListening('wake');
renderMessages();
initializeAppHubs({
  onActivity: logActivity,
  onOpenVision: openVisionDialog,
  canLaunchIntent: () => state.preferences.fullAccessEnabled,
  openDesktopExternal: window.jarvisDesktop?.openExternalUrl.bind(window.jarvisDesktop),
  copyUserText: copyTextToClipboard,
});
updateSearchMode();
setWorkspaceView(state.workspaceView, { remember: false });
initializeDeviceMonitor();
updateLocalDateTime();
window.setInterval(() => {
  updateLocalDateTime();
  loadSystemMetrics();
}, 30_000);
checkServer();
logActivity('Interface initialized');
updateInstallButton();

if ('speechSynthesis' in window) window.speechSynthesis.addEventListener('voiceschanged', updateVoiceList);
if ('serviceWorker' in navigator && !window.JARVIS_RUNTIME?.isNativeShell && (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1')) {
  navigator.serviceWorker.register('/service-worker.js?avatar=67', { updateViaCache: 'none' }).then((registration) => {
    if (!registration || typeof registration.update !== 'function') {
      console.warn('J.A.R.V.I.S. could not check for an application update because this browser did not provide a service worker registration.');
      return;
    }
    const updateWorker = () => {
      registration.update().catch((error) => {
        console.warn('J.A.R.V.I.S. could not check for an application update.', error);
      });
    };
    updateWorker();
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) updateWorker();
    });
  }).catch((error) => {
    console.error('J.A.R.V.I.S. could not register its offline application cache.', error);
  });
}

window.dispatchEvent(new Event('jarvis:app-ready'));