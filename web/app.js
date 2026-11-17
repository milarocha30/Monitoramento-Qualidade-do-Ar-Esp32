/**
 * AeroGuard IoT - Monitoramento da Qualidade do Ar com ESP32
 * Single Page Application Logic & ThingSpeak Integration
 */

// ThingSpeak API Configuration
const CONFIG = {
  CHANNEL_ID: "3577130",
  READ_API_KEY: "86735BGSD3R77O2F",
  RESULTS_COUNT: 30,
  POLL_INTERVAL_SEC: 20,
  get API_URL() {
    return `https://api.thingspeak.com/channels/${this.CHANNEL_ID}/feeds.json?api_key=${this.READ_API_KEY}&results=${this.RESULTS_COUNT}`;
  }
};

// Application State
const state = {
  feeds: [],
  channelInfo: null,
  lastUpdated: null,
  countdown: CONFIG.POLL_INTERVAL_SEC,
  timerInterval: null,
  activeTab: 'dashboard',
  soundEnabled: true,
  isLoading: false,
};

// Thresholds calibrated with ESP32 Firmware
const THRESHOLDS = {
  MQ135: [0.05, 0.10, 0.20, 0.35],
  TVOC: [65, 220, 660, 2200],
  ECO2: [600, 1000, 1500, 2500],
  NAMES: ["EXCELENTE", "BOA", "MODERADA", "RUIM", "MUITO RUIM"]
};

// Navigation Tab Switcher
function switchTab(tabId) {
  state.activeTab = tabId;
  const tabs = ['dashboard', 'history', 'alerts'];
  
  tabs.forEach(tab => {
    const view = document.getElementById(`view-${tab}`);
    const btn = document.getElementById(`tab-${tab}`);
    
    if (tab === tabId) {
      view.classList.remove('hidden');
      btn.classList.add('active');
      btn.classList.remove('text-slate-400');
      btn.classList.add('text-white');
    } else {
      view.classList.add('hidden');
      btn.classList.remove('active');
      btn.classList.remove('text-white');
      btn.classList.add('text-slate-400');
    }
  });
}

// Calculate level matching ESP32 firmware function
function calculateLevel(value, limits) {
  for (let i = 0; i < 4; i++) {
    if (value < limits[i]) return i;
  }
  return 4;
}

// Parse feed entry into typed numbers
function parseFeedEntry(feed) {
  const eco2 = feed.field1 !== null && feed.field1 !== undefined ? parseFloat(feed.field1) : 400;
  const tvoc = feed.field2 !== null && feed.field2 !== undefined ? parseFloat(feed.field2) : 0;
  const mq135 = feed.field3 !== null && feed.field3 !== undefined ? parseFloat(feed.field3) : 0.0;
  const alertFlag = feed.field4 !== null && feed.field4 !== undefined ? parseInt(feed.field4, 10) : 0;
  
  // Nível Geral: use field5 if present, or compute mathematically as per firmware
  let generalLevel = 0;
  if (feed.field5 !== null && feed.field5 !== undefined && feed.field5 !== "") {
    generalLevel = parseInt(feed.field5, 10);
  } else {
    const nT = calculateLevel(tvoc, THRESHOLDS.TVOC);
    const nC = calculateLevel(eco2, THRESHOLDS.ECO2);
    const nM = calculateLevel(mq135, THRESHOLDS.MQ135);
    generalLevel = Math.max(nT, Math.max(nC, nM));
  }

  return {
    entryId: feed.entry_id,
    createdAt: new Date(feed.created_at),
    eco2: isNaN(eco2) ? 400 : eco2,
    tvoc: isNaN(tvoc) ? 0 : tvoc,
    mq135: isNaN(mq135) ? 0 : mq135,
    alertFlag: alertFlag === 1 ? 1 : 0,
    generalLevel: isNaN(generalLevel) ? 0 : generalLevel
  };
}

// Fetch telemetry data from ThingSpeak REST API
async function fetchThingSpeakData() {
  if (state.isLoading) return;
  state.isLoading = true;

  const refreshIcon = document.getElementById('refresh-icon');
  const pingIndicator = document.getElementById('ping-indicator');
  const statusDot = document.getElementById('status-dot');
  
  if (refreshIcon) refreshIcon.classList.add('fa-spin');

  try {
    const response = await fetch(CONFIG.API_URL);
    if (!response.ok) {
      throw new Error(`Erro HTTP ${response.status}: ${response.statusText}`);
    }

    const data = await response.json();
    state.channelInfo = data.channel;
    
    if (data.feeds && Array.isArray(data.feeds) && data.feeds.length > 0) {
      state.feeds = data.feeds.map(parseFeedEntry);
      state.lastUpdated = new Date();
      
      // Update connection indicator to connected
      if (statusDot) {
        statusDot.className = "relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500";
      }
      if (pingIndicator) {
        pingIndicator.className = "animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75";
      }

      console.log(`[AeroGuard] ${state.feeds.length} feeds recebidos com sucesso.`);
    } else {
      console.warn('[AeroGuard] Resposta da API não contém feeds válidos.');
    }
  } catch (err) {
    console.error('[AeroGuard] Erro ao buscar telemetria do ThingSpeak:', err);
    
    // Update indicator to warn
    if (statusDot) {
      statusDot.className = "relative inline-flex rounded-full h-2.5 w-2.5 bg-amber-500";
    }
    if (pingIndicator) {
      pingIndicator.className = "animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75";
    }
  } finally {
    state.isLoading = false;
    if (refreshIcon) refreshIcon.classList.remove('fa-spin');
    state.countdown = CONFIG.POLL_INTERVAL_SEC;
  }
}

// Polling interval timer countdown handler
function startPollingTimer() {
  if (state.timerInterval) clearInterval(state.timerInterval);

  state.countdown = CONFIG.POLL_INTERVAL_SEC;
  const timerEl = document.getElementById('countdown-timer');

  state.timerInterval = setInterval(() => {
    state.countdown--;
    if (timerEl) {
      timerEl.textContent = `${state.countdown}s`;
    }

    if (state.countdown <= 0) {
      fetchThingSpeakData();
    }
  }, 1000);
}

// Event Listeners Initialization
document.addEventListener('DOMContentLoaded', () => {
  // Manual refresh button
  const btnRefresh = document.getElementById('btn-refresh');
  if (btnRefresh) {
    btnRefresh.addEventListener('click', () => {
      fetchThingSpeakData();
    });
  }

  // Initial fetch and start polling
  fetchThingSpeakData();
  startPollingTimer();
});
