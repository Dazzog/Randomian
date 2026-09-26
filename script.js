const VIDEO_EXTENSIONS = ['mp4', 'webm', 'ogg', 'ogv', 'mov', 'mkv', 'avi', 'm4v', 'wmv'];

const setupEl = document.getElementById('setup');
const statusEl = document.getElementById('status');
const pickBtn = document.getElementById('pickBtn');
const spotStatusEl = document.getElementById('spotStatus');
const pickSpotsBtn = document.getElementById('pickSpotsBtn');
const logStatusEl = document.getElementById('logStatus');
const pickLogFileBtn = document.getElementById('pickLogFileBtn');
const startBtn = document.getElementById('startBtn');

const playerEl = document.getElementById('player');
const videoEl = document.getElementById('video');
const fileNameEl = document.getElementById('fileName');
const counterEl = document.getElementById('counter');
const prevBtn = document.getElementById('prevBtn');
const pauseBtn = document.getElementById('pauseBtn');
const nextBtn = document.getElementById('nextBtn');
const reshuffleBtn = document.getElementById('reshuffleBtn');
const exitBtn = document.getElementById('exitBtn');
const titlePopupEl = document.getElementById('titlePopup');
const titlePopupBarEl = document.getElementById('titlePopupBar');
const titlePopupEyebrowEl = document.getElementById('titlePopupEyebrow');
const titlePopupTitleEl = document.getElementById('titlePopupTitle');
const progressBar = document.getElementById('progressBar');
const topProgressBarEl = document.getElementById('topProgressBar');
const topProgressBarFill = document.getElementById('topProgressBarFill');
const timeCurrentEl = document.getElementById('timeCurrent');
const timeDurationEl = document.getElementById('timeDuration');

const END_POPUP_LEAD_TIME = 10; // Sekunden vor Videoende erneut einblenden
const END_POPUP_VISIBLE_TIME = 5000; // ms, die die Bauchbinde davor stehen bleibt
const START_POPUP_DELAY = 5000; // ms nach Videostart, bevor die Bauchbinde erscheint
const START_POPUP_VISIBLE_TIME = 5000; // ms, die die Bauchbinde danach stehen bleibt
const CONTROLS_HIDE_DELAY = 2500; // ms Inaktivität, bis die Steuerelemente verschwinden

let playlist = [];
let currentIndex = -1;
let spotPlaylist = [];
let spotQueueIndex = 0;
let videosSinceSpot = 0;
let spotThreshold = randomSpotThreshold();
let isSpotPlaying = false;
let currentObjectUrl = null;
let endingPopupShown = false;
let isSeeking = false;
let titlePopupShowTimeout = null;
let titlePopupHideTimeout = null;
let titlePopupWidthResetTimeout = null;
let controlsHideTimeout = null;

function scheduleControlsHide() {
  clearTimeout(controlsHideTimeout);
  controlsHideTimeout = setTimeout(() => {
    if (isSeeking) {
      scheduleControlsHide();
    } else {
      playerEl.classList.remove('controls-visible');
    }
  }, CONTROLS_HIDE_DELAY);
}

function showControls() {
  playerEl.classList.add('controls-visible');
  scheduleControlsHide();
}

function formatTime(seconds) {
  if (!isFinite(seconds) || seconds < 0) return '0:00';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

function stripExtension(name) {
  return name.replace(/\.[^./\\]+$/, '');
}

function formatTitleForDisplay(name) {
  const title = stripExtension(name);
  // Unterstriche nur durch Leerzeichen ersetzen, wenn der Titel noch keine echten Leerzeichen hat
  // (sonst würden z. B. "mein_video 2" und "mein video_2" ununterscheidbar werden).
  return title.includes(' ') ? title : title.replace(/_/g, ' ');
}

let logFileHandle = null;

async function pickLogFile() {
  if (!window.showSaveFilePicker) {
    logStatusEl.textContent = 'Direktes Datei-Logging wird von diesem Browser nicht unterstützt (nur Chrome/Edge).';
    return;
  }
  try {
    logFileHandle = await window.showSaveFilePicker({
      suggestedName: 'history.log',
      types: [{ description: 'Log-Datei', accept: { 'text/plain': ['.log', '.txt'] } }],
    });
    logStatusEl.textContent = `✓ Log-Datei gewählt: ${logFileHandle.name}`;
    logStatusEl.classList.add('success');
  } catch (err) {
    if (err.name !== 'AbortError') {
      logStatusEl.classList.remove('success');
      logStatusEl.textContent = 'Fehler beim Wählen der Log-Datei: ' + err.message;
    }
  }
}

async function appendToLogFile(line) {
  if (!logFileHandle) return;
  try {
    const file = await logFileHandle.getFile();
    const writable = await logFileHandle.createWritable({ keepExistingData: true });
    await writable.write({ type: 'write', position: file.size, data: line });
    await writable.close();
  } catch (err) {
    console.warn('Konnte Log-Zeile nicht in die Datei schreiben:', err);
  }
}

function logPlaybackStart(file, type) {
  if (!logFileHandle) return;
  const label = new Date().toLocaleString('de-DE');
  const line = `[${label}] ${type === 'spot' ? 'Spot' : 'Video'} gestartet: ${file.name}\n`;
  appendToLogFile(line);
}

const TITLE_MIN_FONT_SIZE = 14; // px, Untergrenze beim Schrumpfen überlanger Titel

function fitTitleFontSize() {
  titlePopupTitleEl.style.fontSize = ''; // zurück auf den responsiven CSS-Wert (clamp)
  const available = titlePopupTitleEl.clientWidth;
  if (!available || titlePopupTitleEl.scrollWidth <= available) return;

  const baseSize = parseFloat(getComputedStyle(titlePopupTitleEl).fontSize);
  let size = Math.max(baseSize * (available / titlePopupTitleEl.scrollWidth), TITLE_MIN_FONT_SIZE);
  titlePopupTitleEl.style.fontSize = `${size}px`;

  // Sicherheitsnetz: Kerning/Rundung kann knapp danebenliegen, notfalls nachschärfen.
  let guard = 0;
  while (titlePopupTitleEl.scrollWidth > titlePopupTitleEl.clientWidth && size > TITLE_MIN_FONT_SIZE && guard < 5) {
    size = Math.max(size - 1, TITLE_MIN_FONT_SIZE);
    titlePopupTitleEl.style.fontSize = `${size}px`;
    guard++;
  }
}

function showTitlePopup(text, eyebrow = 'Jetzt läuft', autoHideDelay = null) {
  clearTimeout(titlePopupHideTimeout);

  if (!titlePopupEl.classList.contains('show')) {
    // Bauchbinde ist aktuell weg: einmalig von unten reinfahren.
    titlePopupEyebrowEl.textContent = eyebrow;
    titlePopupTitleEl.textContent = text;
    fitTitleFontSize();
    titlePopupEl.classList.add('show');
  } else {
    // Bauchbinde steht bereits (Übergang zwischen zwei Videos): nur Text animiert tauschen,
    // die Balkenbreite wird dabei sanft an den neuen Text angepasst.
    clearTimeout(titlePopupWidthResetTimeout);
    const startWidth = titlePopupBarEl.getBoundingClientRect().width;
    titlePopupBarEl.style.width = `${startWidth}px`;

    titlePopupEyebrowEl.classList.add('swap-out');
    titlePopupTitleEl.classList.add('swap-out');
    setTimeout(() => {
      titlePopupEyebrowEl.textContent = eyebrow;
      titlePopupTitleEl.textContent = text;
      fitTitleFontSize();
      titlePopupEyebrowEl.classList.remove('swap-out');
      titlePopupTitleEl.classList.remove('swap-out');

      titlePopupBarEl.style.width = 'auto';
      const targetWidth = titlePopupBarEl.getBoundingClientRect().width;
      titlePopupBarEl.style.width = `${startWidth}px`;
      void titlePopupBarEl.offsetWidth; // reflow erzwingen, damit die Breite von hier aus animiert
      titlePopupBarEl.style.width = `${targetWidth}px`;

      titlePopupWidthResetTimeout = setTimeout(() => {
        titlePopupBarEl.style.width = '';
      }, 400);
    }, 220);
  }

  if (autoHideDelay !== null) {
    titlePopupHideTimeout = setTimeout(hideTitlePopup, autoHideDelay);
  }
}

function hideTitlePopup() {
  clearTimeout(titlePopupShowTimeout);
  clearTimeout(titlePopupHideTimeout);
  clearTimeout(titlePopupWidthResetTimeout);
  titlePopupEl.classList.remove('show');
  titlePopupBarEl.style.width = '';
}

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function randomSpotThreshold() {
  return 3 + Math.floor(Math.random() * 4); // 3 bis 6 (inklusiv)
}

function getNextSpot() {
  if (!spotPlaylist.length) return null;
  if (spotQueueIndex >= spotPlaylist.length) {
    spotPlaylist = shuffle(spotPlaylist);
    spotQueueIndex = 0;
  }
  return spotPlaylist[spotQueueIndex++];
}

function isVideoFile(name) {
  const ext = name.split('.').pop().toLowerCase();
  return VIDEO_EXTENSIONS.includes(ext);
}

async function collectVideoFiles(dirHandle) {
  const files = [];
  async function walk(handle) {
    for await (const [name, entry] of handle.entries()) {
      if (entry.kind === 'file') {
        if (isVideoFile(name)) {
          const file = await entry.getFile();
          files.push(file);
        }
      } else if (entry.kind === 'directory') {
        await walk(entry);
      }
    }
  }
  await walk(dirHandle);
  return files;
}

// Fallback for browsers without File System Access API: <input webkitdirectory>
function collectFromFileList(fileList) {
  return Array.from(fileList).filter(f => isVideoFile(f.name));
}

async function chooseVideoFiles() {
  if (window.showDirectoryPicker) {
    const dirHandle = await window.showDirectoryPicker();
    return collectVideoFiles(dirHandle);
  }
  return pickWithInputFallback();
}

async function pickDirectory() {
  statusEl.classList.remove('success');
  statusEl.textContent = 'Ordner wird gelesen…';
  pickBtn.disabled = true;
  try {
    const files = await chooseVideoFiles();

    if (!files.length) {
      statusEl.textContent = 'Keine Videodateien im gewählten Ordner gefunden.';
      pickBtn.disabled = false;
      return;
    }

    playlist = shuffle(files);
    statusEl.textContent = `✓ ${files.length} Video(s) gefunden und gemischt. Bereit zum Start.`;
    statusEl.classList.add('success');
    startBtn.disabled = false;
  } catch (err) {
    if (err.name !== 'AbortError') {
      statusEl.textContent = 'Fehler beim Lesen des Ordners: ' + err.message;
    }
  } finally {
    pickBtn.disabled = false;
  }
}

async function pickSpotsDirectory() {
  spotStatusEl.classList.remove('success');
  spotStatusEl.textContent = 'Spots-Ordner wird gelesen…';
  pickSpotsBtn.disabled = true;
  try {
    const files = await chooseVideoFiles();
    spotPlaylist = shuffle(files);
    spotQueueIndex = 0;
    if (files.length) {
      spotStatusEl.textContent = `✓ ${files.length} Spot(s) geladen – laufen alle 3–6 Videos dazwischen.`;
      spotStatusEl.classList.add('success');
    } else {
      spotStatusEl.textContent = 'Keine Videodateien im gewählten Ordner gefunden.';
    }
  } catch (err) {
    if (err.name !== 'AbortError') {
      spotStatusEl.textContent = 'Fehler beim Lesen des Spots-Ordners: ' + err.message;
    }
  } finally {
    pickSpotsBtn.disabled = false;
  }
}

function pickWithInputFallback() {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.webkitdirectory = true;
    input.multiple = true;
    input.onchange = () => resolve(collectFromFileList(input.files));
    input.click();
  });
}

function updateTopProgressBar() {
  const visible = !isSpotPlaying;
  topProgressBarEl.style.display = visible ? '' : 'none';
}

function playIndex(index) {
  if (index < 0 || index >= playlist.length) return;

  currentIndex = index;
  isSpotPlaying = false;
  updateTopProgressBar();

  const file = playlist[currentIndex];
  if (currentObjectUrl) URL.revokeObjectURL(currentObjectUrl);
  currentObjectUrl = URL.createObjectURL(file);
  videoEl.src = currentObjectUrl;
  logPlaybackStart(file, 'video');
  fileNameEl.textContent = file.name;
  counterEl.textContent = `${currentIndex + 1} / ${playlist.length}`;
  endingPopupShown = false;
  isSeeking = false;
  progressBar.value = 0;
  progressBar.style.setProperty('--progress', '0%');
  timeCurrentEl.textContent = '0:00';
  timeDurationEl.textContent = '0:00';
  hideTitlePopup(); // eine noch sichtbare Bauchbinde des vorigen Videos sofort ausblenden
  titlePopupShowTimeout = setTimeout(() => {
    showTitlePopup(formatTitleForDisplay(file.name), 'Jetzt läuft', START_POPUP_VISIBLE_TIME);
  }, START_POPUP_DELAY);
  videoEl.onended = playNext;
  videoEl.play();
}

videoEl.addEventListener('timeupdate', () => {
  if (currentIndex < 0) return;

  const { duration, currentTime } = videoEl;

  if (!isSpotPlaying && isFinite(duration) && duration > 0) {
    topProgressBarFill.style.width = `${(currentTime / duration) * 100}%`;
  }

  if (!isSeeking && isFinite(duration) && duration > 0) {
    progressBar.value = (currentTime / duration) * 100;
    progressBar.style.setProperty('--progress', `${(currentTime / duration) * 100}%`);
    timeCurrentEl.textContent = formatTime(currentTime);
  }

  if (isSpotPlaying || endingPopupShown || !isFinite(duration) || duration <= END_POPUP_LEAD_TIME * 2) return;
  if (duration - currentTime <= END_POPUP_LEAD_TIME) {
    endingPopupShown = true;
    showTitlePopup(formatTitleForDisplay(playlist[currentIndex].name), 'Das war', END_POPUP_VISIBLE_TIME);
  }
});

videoEl.addEventListener('loadedmetadata', () => {
  timeDurationEl.textContent = formatTime(videoEl.duration);
});

progressBar.addEventListener('input', () => {
  isSeeking = true;
  if (isFinite(videoEl.duration)) {
    const time = (progressBar.value / 100) * videoEl.duration;
    timeCurrentEl.textContent = formatTime(time);
    progressBar.style.setProperty('--progress', `${progressBar.value}%`);
  }
});

progressBar.addEventListener('change', () => {
  if (isFinite(videoEl.duration)) {
    videoEl.currentTime = (progressBar.value / 100) * videoEl.duration;
  }
  isSeeking = false;
});

function playNext({ afterSpot = false } = {}) {
  if (!afterSpot && spotPlaylist.length) {
    videosSinceSpot++;
    if (videosSinceSpot >= spotThreshold) {
      videosSinceSpot = 0;
      spotThreshold = randomSpotThreshold();
      playSpot();
      return;
    }
  }

  if (currentIndex + 1 >= playlist.length) {
    playlist = shuffle(playlist);
    playIndex(0);
  } else {
    playIndex(currentIndex + 1);
  }
}

function playSpot() {
  const file = getNextSpot();
  if (!file) {
    playNext({ afterSpot: true });
    return;
  }

  isSpotPlaying = true;
  updateTopProgressBar();

  clearTimeout(titlePopupShowTimeout);
  hideTitlePopup();

  if (currentObjectUrl) URL.revokeObjectURL(currentObjectUrl);
  currentObjectUrl = URL.createObjectURL(file);
  videoEl.src = currentObjectUrl;
  videoEl.play();
  logPlaybackStart(file, 'spot');
  fileNameEl.textContent = file.name;
  isSeeking = false;
  progressBar.value = 0;
  progressBar.style.setProperty('--progress', '0%');
  timeCurrentEl.textContent = '0:00';
  timeDurationEl.textContent = '0:00';

  videoEl.onended = () => {
    isSpotPlaying = false;
    playNext({ afterSpot: true });
  };
}

function playPrev() {
  if (currentIndex <= 0) return;
  playIndex(currentIndex - 1);
}

async function startPlayback() {
  if (!playlist.length) return;
  setupEl.style.display = 'none';
  playerEl.classList.add('active');
  showControls();
  try {
    await playerEl.requestFullscreen();
  } catch (e) {
    // Vollbild evtl. nicht verfügbar – Wiedergabe läuft trotzdem weiter.
  }
  playIndex(0);
}

function stopPlayback() {
  videoEl.pause();
  videoEl.removeAttribute('src');
  videoEl.load();
  isSpotPlaying = false;
  updateTopProgressBar();
  if (currentObjectUrl) {
    URL.revokeObjectURL(currentObjectUrl);
    currentObjectUrl = null;
  }
  playerEl.classList.remove('active');
  playerEl.classList.remove('controls-visible');
  clearTimeout(controlsHideTimeout);
  hideTitlePopup();
  setupEl.style.display = 'flex';
  if (document.fullscreenElement) {
    document.exitFullscreen().catch(() => {});
  }
}

playerEl.addEventListener('mousemove', showControls);

pickBtn.addEventListener('click', pickDirectory);
pickSpotsBtn.addEventListener('click', pickSpotsDirectory);
pickLogFileBtn.addEventListener('click', pickLogFile);
startBtn.addEventListener('click', startPlayback);

prevBtn.addEventListener('click', playPrev);
nextBtn.addEventListener('click', playNext);
reshuffleBtn.addEventListener('click', () => {
  playlist = shuffle(playlist);
  playIndex(0);
});
pauseBtn.addEventListener('click', () => {
  if (videoEl.paused) {
    videoEl.play();
    pauseBtn.textContent = '⏸ Pause';
  } else {
    videoEl.pause();
    pauseBtn.textContent = '▶ Weiter';
  }
});
exitBtn.addEventListener('click', stopPlayback);

document.addEventListener('keydown', (e) => {
  if (!playerEl.classList.contains('active')) return;
  if (e.target === progressBar) return; // Slider soll Pfeiltasten selbst verarbeiten
  if (e.key === 'ArrowRight') playNext();
  else if (e.key === 'ArrowLeft') playPrev();
  else if (e.key === ' ') { e.preventDefault(); pauseBtn.click(); }
  else if (e.key === 'Escape') stopPlayback();
});

document.addEventListener('fullscreenchange', () => {
  if (!document.fullscreenElement && playerEl.classList.contains('active')) {
    stopPlayback();
  }
});
