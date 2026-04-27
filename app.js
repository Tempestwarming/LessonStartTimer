const STORAGE_KEY = "do_now_app_state_v7";
const MIN_MINUTES = 1;
const MAX_MINUTES = 120;

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

const elements = {
  learningQuestion: $("#learningQuestion"),
  activityInstructions: $("#activityInstructions"),
  dictateQuestionButton: $("#dictateQuestionButton"),
  dictateActivityButton: $("#dictateActivityButton"),
  minutesInput: $("#minutesInput"),
  timerDisplay: $("#timerDisplay"),
  timerDisplayWrap: $("#timerDisplayWrap"),
  timerStatus: $("#timerStatus"),
  timerBarFill: $("#timerBarFill"),
  startTimerButton: $("#startTimer"),
  pauseTimerButton: $("#pauseTimer"),
  resetTimerButton: $("#resetTimer"),
  stopBeepButton: $("#stopBeep"),
  dateTimeBar: $("#dateTimeBar"),
  presetButtons: $$(".preset-btn"),
};

const state = {
  totalSeconds: Number.parseInt(elements.minutesInput.value, 10) * 60,
  remainingSeconds: Number.parseInt(elements.minutesInput.value, 10) * 60,
  timerId: null,
  endsAt: null,
  isRunning: false,
  audioContext: null,
  beepId: null,
  oneMinuteWarningPlayed: false,
  lastTenSecondPlayed: new Set(),
};

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function setStatus(message) {
  elements.timerStatus.textContent = message;
}

function saveState() {
  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({
      learningQuestion: elements.learningQuestion.value,
      activityInstructions: elements.activityInstructions.value,
      minutesInput: elements.minutesInput.value,
      remainingSeconds: state.remainingSeconds,
      totalSeconds: state.totalSeconds,
    }),
  );
}

function loadState() {
  try {
    const savedState = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (!savedState) return;

    if (typeof savedState.learningQuestion === "string") {
      elements.learningQuestion.value = savedState.learningQuestion;
    }

    if (typeof savedState.activityInstructions === "string") {
      elements.activityInstructions.value = savedState.activityInstructions;
    }

    if (savedState.minutesInput !== undefined) {
      elements.minutesInput.value = savedState.minutesInput;
    }

    if (Number.isFinite(savedState.totalSeconds) && savedState.totalSeconds > 0) {
      state.totalSeconds = savedState.totalSeconds;
    }

    if (Number.isFinite(savedState.remainingSeconds) && savedState.remainingSeconds >= 0) {
      state.remainingSeconds = savedState.remainingSeconds;
    }
  } catch {
    localStorage.removeItem(STORAGE_KEY);
  }
}

function getOrdinal(day) {
  if (day > 3 && day < 21) return "th";

  switch (day % 10) {
    case 1:
      return "st";
    case 2:
      return "nd";
    case 3:
      return "rd";
    default:
      return "th";
  }
}

function updateDateTime() {
  const now = new Date();
  const weekday = now.toLocaleDateString("en-GB", { weekday: "long" });
  const month = now.toLocaleDateString("en-GB", { month: "long" });
  const day = now.getDate();
  const time = now.toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
  });

  elements.dateTimeBar.textContent = `${weekday} the ${day}${getOrdinal(day)} of ${month} ${now.getFullYear()} - ${time}`;
}

function formatTime(seconds) {
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`;
}

function updateDisplay() {
  elements.timerDisplay.value = formatTime(state.remainingSeconds);
  elements.timerDisplay.textContent = formatTime(state.remainingSeconds);
}

function updateTimerBar() {
  const ratio = state.totalSeconds > 0 ? state.remainingSeconds / state.totalSeconds : 0;
  const percentage = clamp(ratio * 100, 0, 100);

  elements.timerBarFill.style.height = `${percentage}%`;
  elements.timerBarFill.classList.toggle("is-danger", percentage <= 25);
  elements.timerBarFill.classList.toggle("is-warning", percentage > 25 && percentage <= 50);
}

function updateLastThirtyWarning() {
  elements.timerDisplayWrap.classList.toggle(
    "is-warning",
    state.isRunning && state.remainingSeconds <= 30 && state.remainingSeconds > 0,
  );
}

function renderTimer() {
  updateDisplay();
  updateTimerBar();
  updateLastThirtyWarning();
}

function resetWarningState() {
  state.oneMinuteWarningPlayed = false;
  state.lastTenSecondPlayed.clear();
  elements.timerDisplayWrap.classList.remove("is-flashing");
}

function getMinutesInputValue() {
  const minutes = Number.parseInt(elements.minutesInput.value, 10);
  return clamp(Number.isFinite(minutes) ? minutes : 5, MIN_MINUTES, MAX_MINUTES);
}

function syncTimerFromInput() {
  const minutes = getMinutesInputValue();
  elements.minutesInput.value = minutes;
  state.totalSeconds = minutes * 60;
  state.remainingSeconds = state.totalSeconds;
  state.endsAt = null;
  resetWarningState();
  renderTimer();
  setStatus(`Timer set for ${minutes} minute${minutes === 1 ? "" : "s"}.`);
  saveState();
}

function stopTimerInterval() {
  if (state.timerId) {
    window.clearInterval(state.timerId);
    state.timerId = null;
  }

  state.endsAt = null;
  state.isRunning = false;
  updateLastThirtyWarning();
}

function ensureAudioContext() {
  if (!state.audioContext) {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    state.audioContext = new AudioContext();
  }

  if (state.audioContext.state === "suspended") {
    state.audioContext.resume();
  }
}

function playTone(frequency, duration, volume = 0.18, type = "sine") {
  ensureAudioContext();

  const oscillator = state.audioContext.createOscillator();
  const gainNode = state.audioContext.createGain();
  const start = state.audioContext.currentTime;

  oscillator.type = type;
  oscillator.frequency.setValueAtTime(frequency, start);
  gainNode.gain.setValueAtTime(0.0001, start);
  gainNode.gain.exponentialRampToValueAtTime(volume, start + 0.01);
  gainNode.gain.exponentialRampToValueAtTime(0.0001, start + duration);

  oscillator.connect(gainNode);
  gainNode.connect(state.audioContext.destination);
  oscillator.start();
  oscillator.stop(start + duration + 0.02);
}

function playOneMinuteWarning() {
  playTone(740, 0.18, 0.12, "triangle");
  window.setTimeout(() => playTone(740, 0.18, 0.12, "triangle"), 260);
}

function playLastTenTick() {
  playTone(980, 0.08, 0.1, "square");
}

function playEndAlarmTone() {
  playTone(880, 0.24, 0.2, "sine");
}

function stopBeeping() {
  if (state.beepId) {
    window.clearInterval(state.beepId);
    state.beepId = null;
  }
}

function startBeeping() {
  stopBeeping();
  playEndAlarmTone();
  state.beepId = window.setInterval(playEndAlarmTone, 900);
}

function handleCountdownAlerts() {
  if (state.remainingSeconds === 60 && !state.oneMinuteWarningPlayed) {
    playOneMinuteWarning();
    state.oneMinuteWarningPlayed = true;
    setStatus("One minute remaining.");
  }

  if (
    state.remainingSeconds <= 10 &&
    state.remainingSeconds > 0 &&
    !state.lastTenSecondPlayed.has(state.remainingSeconds)
  ) {
    playLastTenTick();
    state.lastTenSecondPlayed.add(state.remainingSeconds);
  }
}

function finishTimer() {
  stopTimerInterval();
  state.remainingSeconds = 0;
  setStatus("Time is up.");
  elements.timerDisplayWrap.classList.add("is-flashing");
  renderTimer();
  startBeeping();
  saveState();
}

function tickTimer() {
  const nextRemaining = Math.max(0, Math.ceil((state.endsAt - Date.now()) / 1000));

  if (nextRemaining !== state.remainingSeconds) {
    state.remainingSeconds = nextRemaining;
    renderTimer();
    handleCountdownAlerts();
    saveState();
  }

  if (state.remainingSeconds <= 0) {
    finishTimer();
  }
}

function startTimer() {
  if (state.isRunning) return;

  if (state.remainingSeconds <= 0) {
    syncTimerFromInput();
  }

  stopBeeping();
  state.isRunning = true;
  state.endsAt = Date.now() + state.remainingSeconds * 1000;
  setStatus("Timer is running.");
  renderTimer();
  saveState();

  tickTimer();
  state.timerId = window.setInterval(tickTimer, 250);
}

function pauseTimer() {
  if (!state.isRunning) return;

  tickTimer();
  stopTimerInterval();
  setStatus("Timer paused.");
  saveState();
}

function resetTimer() {
  stopTimerInterval();
  stopBeeping();
  syncTimerFromInput();
  setStatus("Timer reset.");
}

function stopTimerAndAlarm() {
  stopBeeping();
  stopTimerInterval();
  setStatus(state.remainingSeconds === 0 ? "Alarm stopped." : "Timer stopped.");
  saveState();
}

async function enterFullScreen() {
  if (document.fullscreenElement) return;

  try {
    await document.documentElement.requestFullscreen();
  } catch {
    setStatus("Full screen was blocked by the browser.");
  }
}

function autoFitText(element, options) {
  element.style.fontSize = `${options.max}px`;
  element.style.lineHeight = options.lineHeight;

  while (element.scrollHeight > element.clientHeight + 2 && Number.parseFloat(element.style.fontSize) > options.min) {
    element.style.fontSize = `${Number.parseFloat(element.style.fontSize) - options.step}px`;
  }
}

function refreshAutoFit() {
  autoFitText(elements.learningQuestion, { max: 48, min: 18, step: 1, lineHeight: 1.22 });
  autoFitText(elements.activityInstructions, { max: 40, min: 16, step: 1, lineHeight: 1.38 });
}

function applyPreset(minutes) {
  elements.minutesInput.value = minutes;
  syncTimerFromInput();
  setStatus(`Timer preset applied: ${minutes} minute${minutes === 1 ? "" : "s"}.`);
}

function isTypingInField() {
  const activeElement = document.activeElement;
  if (!activeElement) return false;
  return ["input", "textarea"].includes(activeElement.tagName.toLowerCase());
}

function handleKeyboardShortcuts(event) {
  const typing = isTypingInField();

  if (event.key === " " && !typing) {
    event.preventDefault();
    state.isRunning ? pauseTimer() : startTimer();
    return;
  }

  if (typing && !event.altKey && !event.ctrlKey && !event.metaKey) return;

  switch (event.key.toLowerCase()) {
    case "r":
      resetTimer();
      break;
    case "1":
      applyPreset(1);
      break;
    case "2":
      applyPreset(2);
      break;
    case "5":
      applyPreset(5);
      break;
    case "f":
      enterFullScreen();
      break;
    default:
      break;
  }
}

function appendDictation(target, transcript) {
  target.value = target.value.trim() ? `${target.value}\n${transcript}` : transcript;
  refreshAutoFit();
  saveState();
}

function setupSpeechRecognition() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

  if (!SpeechRecognition) {
    elements.dictateQuestionButton.disabled = true;
    elements.dictateActivityButton.disabled = true;
    elements.dictateQuestionButton.title = "Dictation is not supported in this browser.";
    elements.dictateActivityButton.title = "Dictation is not supported in this browser.";
    return;
  }

  const recognition = new SpeechRecognition();
  recognition.lang = "en-GB";
  recognition.interimResults = false;
  recognition.maxAlternatives = 1;

  let activeTarget = null;
  let activeButton = null;

  function startDictation(targetElement, buttonElement) {
    activeTarget = targetElement;
    activeButton = buttonElement;
    targetElement.focus();

    try {
      recognition.start();
    } catch {
      setStatus("Dictation is already listening.");
    }
  }

  elements.dictateQuestionButton.addEventListener("click", () => {
    startDictation(elements.learningQuestion, elements.dictateQuestionButton);
  });

  elements.dictateActivityButton.addEventListener("click", () => {
    startDictation(elements.activityInstructions, elements.dictateActivityButton);
  });

  recognition.addEventListener("start", () => {
    elements.dictateQuestionButton.disabled = true;
    elements.dictateActivityButton.disabled = true;
    if (activeButton) activeButton.textContent = "Listening...";
  });

  recognition.addEventListener("result", (event) => {
    const transcript = event.results[0][0].transcript.trim();
    if (activeTarget && transcript) appendDictation(activeTarget, transcript);
  });

  recognition.addEventListener("end", () => {
    elements.dictateQuestionButton.disabled = false;
    elements.dictateActivityButton.disabled = false;
    elements.dictateQuestionButton.textContent = "Dictate";
    elements.dictateActivityButton.textContent = "Dictate";
    activeTarget = null;
    activeButton = null;
  });
}

function bindEvents() {
  elements.minutesInput.addEventListener("input", () => {
    if (!state.isRunning) syncTimerFromInput();
  });

  [elements.learningQuestion, elements.activityInstructions].forEach((textarea) => {
    textarea.addEventListener("input", () => {
      refreshAutoFit();
      saveState();
    });
  });

  elements.presetButtons.forEach((button) => {
    button.addEventListener("click", () => applyPreset(Number.parseInt(button.dataset.minutes, 10)));
  });

  elements.startTimerButton.addEventListener("click", startTimer);
  elements.pauseTimerButton.addEventListener("click", pauseTimer);
  elements.resetTimerButton.addEventListener("click", resetTimer);
  elements.stopBeepButton.addEventListener("click", stopTimerAndAlarm);

  window.addEventListener("resize", refreshAutoFit);
  window.addEventListener("keydown", handleKeyboardShortcuts);
}

function init() {
  loadState();
  bindEvents();
  setupSpeechRecognition();
  updateDateTime();
  window.setInterval(updateDateTime, 1000);
  renderTimer();
  requestAnimationFrame(refreshAutoFit);
}

init();
