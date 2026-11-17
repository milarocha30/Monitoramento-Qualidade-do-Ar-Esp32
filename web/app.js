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
  chartInstance: null,
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

  if (tabId === 'dashboard' && state.chartInstance) {
    state.chartInstance.resize();
  }
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

// Format Date / Time (pt-BR)
function formatTime(date) {
  return date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function formatDate(date) {
  return date.toLocaleDateString('pt-BR');
}

// ============================================================================
// CHART.JS DYNAMIC VISUALIZATION ENGINE
// ============================================================================
function initChart() {
  const ctx = document.getElementById('airQualityChart');
  if (!ctx) return;

  const chartCtx = ctx.getContext('2d');

  // Gradient Fills
  const gradientEco2 = chartCtx.createLinearGradient(0, 0, 0, 300);
  gradientEco2.addColorStop(0, 'rgba(16, 185, 129, 0.28)');
  gradientEco2.addColorStop(1, 'rgba(16, 185, 129, 0.0)');

  const gradientTvoc = chartCtx.createLinearGradient(0, 0, 0, 300);
  gradientTvoc.addColorStop(0, 'rgba(6, 182, 212, 0.25)');
  gradientTvoc.addColorStop(1, 'rgba(6, 182, 212, 0.0)');

  const gradientMq135 = chartCtx.createLinearGradient(0, 0, 0, 300);
  gradientMq135.addColorStop(0, 'rgba(245, 158, 11, 0.25)');
  gradientMq135.addColorStop(1, 'rgba(245, 158, 11, 0.0)');

  state.chartInstance = new Chart(chartCtx, {
    type: 'line',
    data: {
      labels: [],
      datasets: [
        {
          label: 'eCO2 (ppm)',
          data: [],
          borderColor: '#10b981',
          backgroundColor: gradientEco2,
          borderWidth: 2.2,
          pointBackgroundColor: '#10b981',
          pointBorderColor: '#0f172a',
          pointBorderWidth: 1.5,
          pointRadius: 3,
          pointHoverRadius: 6,
          fill: true,
          tension: 0.35,
          yAxisID: 'y'
        },
        {
          label: 'TVOC (ppb)',
          data: [],
          borderColor: '#06b6d4',
          backgroundColor: gradientTvoc,
          borderWidth: 2,
          pointBackgroundColor: '#06b6d4',
          pointBorderColor: '#0f172a',
          pointBorderWidth: 1.5,
          pointRadius: 3,
          pointHoverRadius: 6,
          fill: true,
          tension: 0.35,
          yAxisID: 'y1'
        },
        {
          label: 'MQ-135 (ΔV)',
          data: [],
          borderColor: '#f59e0b',
          backgroundColor: gradientMq135,
          borderWidth: 2,
          pointBackgroundColor: '#f59e0b',
          pointBorderColor: '#0f172a',
          pointBorderWidth: 1.5,
          pointRadius: 3,
          pointHoverRadius: 6,
          fill: true,
          tension: 0.35,
          yAxisID: 'y2'
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: {
        mode: 'index',
        intersect: false,
      },
      plugins: {
        legend: {
          display: false, // Handled via our custom buttons
        },
        tooltip: {
          backgroundColor: 'rgba(15, 23, 42, 0.95)',
          titleColor: '#f8fafc',
          bodyColor: '#cbd5e1',
          borderColor: 'rgba(51, 65, 85, 0.8)',
          borderWidth: 1,
          padding: 12,
          boxPadding: 6,
          usePointStyle: true,
          callbacks: {
            title: function (items) {
              return `Horário: ${items[0].label}`;
            },
            label: function (context) {
              const datasetLabel = context.dataset.label || '';
              const value = context.parsed.y;
              if (datasetLabel.includes('eCO2')) {
                return ` ${datasetLabel}: ${value.toFixed(0)} ppm`;
              } else if (datasetLabel.includes('TVOC')) {
                return ` ${datasetLabel}: ${value.toFixed(0)} ppb`;
              } else if (datasetLabel.includes('MQ-135')) {
                return ` ${datasetLabel}: ${value.toFixed(3)} V`;
              }
              return ` ${datasetLabel}: ${value}`;
            }
          }
        }
      },
      scales: {
        x: {
          grid: {
            color: 'rgba(51, 65, 85, 0.25)',
            borderColor: 'rgba(51, 65, 85, 0.6)'
          },
          ticks: {
            color: '#94a3b8',
            font: { family: 'Inter', size: 10 },
            maxRotation: 45,
            minRotation: 0,
            autoSkip: true,
            maxTicksLimit: 10
          }
        },
        y: {
          type: 'linear',
          display: true,
          position: 'left',
          title: {
            display: true,
            text: 'eCO2 (ppm)',
            color: '#10b981',
            font: { family: 'Inter', size: 10, weight: 'bold' }
          },
          grid: {
            color: 'rgba(51, 65, 85, 0.25)'
          },
          ticks: {
            color: '#10b981',
            font: { family: 'Inter', size: 10 },
            callback: value => `${value}`
          }
        },
        y1: {
          type: 'linear',
          display: true,
          position: 'right',
          title: {
            display: true,
            text: 'TVOC (ppb)',
            color: '#06b6d4',
            font: { family: 'Inter', size: 10, weight: 'bold' }
          },
          grid: {
            drawOnChartArea: false
          },
          ticks: {
            color: '#06b6d4',
            font: { family: 'Inter', size: 10 }
          }
        },
        y2: {
          type: 'linear',
          display: false, // share right side or toggle
          position: 'right',
          grid: {
            drawOnChartArea: false
          },
          ticks: {
            color: '#f59e0b',
            font: { family: 'Inter', size: 10 }
          }
        }
      }
    }
  });
}

// Toggle individual dataset on Chart
function toggleDataset(index) {
  if (!state.chartInstance) return;
  
  const isVisible = state.chartInstance.isDatasetVisible(index);
  state.chartInstance.setDatasetVisibility(index, !isVisible);
  
  // Also toggle scale visibility if relevant
  if (index === 2) {
    state.chartInstance.options.scales.y2.display = !isVisible;
  }

  state.chartInstance.update();

  // Update button visual state
  const btnIds = ['toggle-eco2', 'toggle-tvoc', 'toggle-mq135'];
  const btn = document.getElementById(btnIds[index]);
  if (btn) {
    if (!isVisible) {
      btn.classList.add('active');
      btn.classList.remove('inactive');
    } else {
      btn.classList.remove('active');
      btn.classList.add('inactive');
    }
  }
}

// Update Chart with new feeds
function updateChartData(feeds) {
  if (!state.chartInstance || !feeds || feeds.length === 0) return;

  const labels = feeds.map(f => formatTime(f.createdAt));
  const eco2Data = feeds.map(f => f.eco2);
  const tvocData = feeds.map(f => f.tvoc);
  const mq135Data = feeds.map(f => f.mq135);

  state.chartInstance.data.labels = labels;
  state.chartInstance.data.datasets[0].data = eco2Data;
  state.chartInstance.data.datasets[1].data = tvocData;
  state.chartInstance.data.datasets[2].data = mq135Data;

  state.chartInstance.update();

  // Hide chart loader spinner
  const chartLoader = document.getElementById('chart-loader');
  if (chartLoader) {
    chartLoader.classList.add('opacity-0');
    setTimeout(() => {
      chartLoader.classList.add('hidden');
    }, 300);
  }
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

      // Update Chart visualization
      updateChartData(state.feeds);

      console.log(`[AeroGuard] ${state.feeds.length} feeds recebidos com sucesso.`);
    } else {
      console.warn('[AeroGuard] Resposta da API não contém feeds válidos.');
    }
  } catch (err) {
    console.error('[AeroGuard] Erro ao buscar telemetria do ThingSpeak:', err);
    
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
  // Initialize Chart.js
  initChart();

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
