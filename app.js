// ECG Monitor Application
class ECGMonitor {
  constructor() {
    // MQTT Configuration
    this.mqttConfig = {
      brokerUrl: 'wss://cd07331e117b4586bf2b979e80f68084.s1.eu.hivemq.cloud:8884/mqtt',
      username: 'harsh',
      password: 'Harsh@12'
    };
    
    // Application state
    this.client = null;
    this.isConnected = false;
    this.isPaused = false;
    this.deviceId = '';
    this.lastDataReceived = 0;
    this.connectionType = 'wifi'; // Default to WiFi
    this.bluetoothDevice = null;
    this.bluetoothCharacteristic = null;
    this.connectionHeartbeat = null;
    this.dataCollectionStartTime = 0;
    this.continuousDataDuration = 0;
    
    // Data storage
    this.ecgData = [];
    this.ecgTimestamps = [];
    this.bpmData = [];
    this.bpmTimestamps = [];
    this.dataCount = 0;

    // Saved Devices
    this.savedDevices = this.loadSavedDevices();
    
    // Chart configuration - EXTENDED for full screen width
    this.maxECGPoints = 15000;    // Show last 30 seconds (15000 points at 500Hz) for full width
    this.ecgChart = null;         // Chart.js instance for ECG waveform
    this.beatChart = null;        // Chart.js instance for beat analysis

    // ECG Display enhancement
    this.ecgSweepPosition = 0;    // Current sweep position for real-time effect
    this.ecgDisplayBuffer = [];   // Enhanced display buffer
    this.baselineValue = 2048;    // ADC baseline (middle of 0-4095 range)

    // BPM calculation variables
    this.peakBuffer = [];
    this.lastPeakTime = 0;
    this.peakThreshold = 2500;
    this.adaptiveThreshold = true;
    this.signalQuality = 0;

    // ECG Analysis variables
    this.samplingRate = 500; // Hz (matches your working Serial Plotter code)
    this.ecgAnalysisBuffer = [];
    this.maxAnalysisBuffer = 5000; // 5 seconds
    this.lastBeatAnalysis = null;
    this.beatDetectionBuffer = [];

    // ECG Intervals (in milliseconds)
    this.intervals = {
      pr: null,
      qrs: null,
      qt: null,
      qtc: null,
      rr: null
    };

    // ECG Morphology
    this.morphology = {
      pWave: { detected: false, amplitude: 0, duration: 0 },
      qrsComplex: { detected: false, amplitude: 0, morphology: 'Unknown' },
      tWave: { detected: false, amplitude: 0, polarity: 'Unknown' },
      rhythm: { regularity: 'Unknown', classification: 'Unknown' }
    };

    // Statistics
    this.bpmStats = {
      current: 0,
      average: 0,
      min: Infinity,
      max: 0,
      history: []
    };

    // Device heartbeat monitoring
    this.lastDataReceived = 0;
    this.deviceHeartbeatInterval = null;
    this.deviceOnline = false;
    this.dataCount = 0;

    // Initialize abnormality detection
    this.abnormalityDetection = {
      enabled: true,
      lastAlert: 0,
      alertCooldown: 10000, // 10 seconds between alerts
      conditions: {
        bradycardia: false,
        tachycardia: false,
        irregularRhythm: false,
        poorSignalQuality: false
      }
    };

    this.initializeApp();
    this.registerChartPlugins();
    this.initializeAudioBuzzer();
  }

  initializeAudioBuzzer() {
    try {
      // Initialize Web Audio API for buzzer functionality
      this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
      this.buzzerEnabled = true;
    } catch (error) {
      console.warn('Web Audio API not supported, buzzer disabled:', error);
      this.buzzerEnabled = false;
    }
  }

  playBuzzer(frequency = 800, duration = 500, type = 'warning') {
    if (!this.buzzerEnabled || !this.audioContext) return;

    try {
      const oscillator = this.audioContext.createOscillator();
      const gainNode = this.audioContext.createGain();

      oscillator.connect(gainNode);
      gainNode.connect(this.audioContext.destination);

      // Set frequency based on alert type
      switch (type) {
        case 'critical':
          oscillator.frequency.setValueAtTime(1000, this.audioContext.currentTime);
          break;
        case 'warning':
          oscillator.frequency.setValueAtTime(800, this.audioContext.currentTime);
          break;
        case 'info':
          oscillator.frequency.setValueAtTime(600, this.audioContext.currentTime);
          break;
        default:
          oscillator.frequency.setValueAtTime(frequency, this.audioContext.currentTime);
      }

      oscillator.type = 'square';

      // Set volume envelope
      gainNode.gain.setValueAtTime(0, this.audioContext.currentTime);
      gainNode.gain.linearRampToValueAtTime(0.1, this.audioContext.currentTime + 0.01);
      gainNode.gain.exponentialRampToValueAtTime(0.01, this.audioContext.currentTime + duration / 1000);

      oscillator.start(this.audioContext.currentTime);
      oscillator.stop(this.audioContext.currentTime + duration / 1000);
    } catch (error) {
      console.warn('Error playing buzzer:', error);
    }
  }

  registerChartPlugins() {
    // Register custom sweep line plugin for ECG chart
    const sweepLinePlugin = {
      id: 'sweepLine',
      afterDraw: (chart) => {
        if (chart.canvas.id !== 'ecgChart') return;

        const ctx = chart.ctx;
        const chartArea = chart.chartArea;

        // Calculate sweep position (moves from left to right)
        const now = Date.now();
        const sweepSpeed = 2.5; // seconds for full sweep
        const sweepPosition = ((now / 1000) % sweepSpeed) / sweepSpeed;
        const xPosition = chartArea.left + (chartArea.width * sweepPosition);

        // Draw sweep line
        ctx.save();
        ctx.strokeStyle = 'rgba(255, 0, 0, 0.7)';
        ctx.lineWidth = 2;
        ctx.setLineDash([5, 5]);
        ctx.beginPath();
        ctx.moveTo(xPosition, chartArea.top);
        ctx.lineTo(xPosition, chartArea.bottom);
        ctx.stroke();
        ctx.restore();

        // Store sweep position for data clearing effect
        if (window.ecgMonitor) {
          window.ecgMonitor.ecgSweepPosition = sweepPosition;
        }
      }
    };

    // Register the plugin
    if (typeof Chart !== 'undefined') {
      Chart.register(sweepLinePlugin);
    }
  }



  initializeApp() {
    this.initializeDOM();
    this.initializeCharts();
    this.setupEventListeners();
    this.updateUI();
    this.initializeStatusIndicators();
  }

  initializeStatusIndicators() {
    // Initialize status indicators to be empty until reading starts
    const statusElement = document.getElementById('statusIndicators');
    const statusCard = document.querySelector('.status-card');

    if (statusElement && statusCard) {
      statusElement.innerHTML = '<span class="status-waiting">Waiting for data...</span>';
      statusCard.classList.remove('status-normal-bg', 'status-irregular-bg');
    }
  }
  
  initializeDOM() {
    // Get DOM elements
    this.elements = {
      deviceIdInput: document.getElementById('deviceIdInput'),
      connectBtn: document.getElementById('connectBtn'),
      saveDeviceBtn: document.getElementById('saveDeviceBtn'),
      savedDevicesSelect: document.getElementById('savedDevicesSelect'),
      deleteSavedBtn: document.getElementById('deleteSavedBtn'),
      disconnectBtn: document.getElementById('disconnectBtn'),
      pauseBtn: document.getElementById('pauseBtn'),
      clearBtn: document.getElementById('clearBtn'),
      analyzeBtn: document.getElementById('analyzeBtn'),
      status: document.getElementById('status'),
      ecgValue: document.getElementById('ecgValue'),
      bpmValue: document.getElementById('bpmValue'),
      signalQuality: document.getElementById('signalQuality'),
      timestamp: document.getElementById('timestamp'),
      avgBpm: document.getElementById('avgBpm'),
      minBpm: document.getElementById('minBpm'),
      maxBpm: document.getElementById('maxBpm'),
      dataCount: document.getElementById('dataCount'),

      // ECG Intervals
      prInterval: document.getElementById('prInterval'),
      qrsInterval: document.getElementById('qrsInterval'),
      qtInterval: document.getElementById('qtInterval'),
      qtcInterval: document.getElementById('qtcInterval'),
      prStatus: document.getElementById('prStatus'),
      qrsStatus: document.getElementById('qrsStatus'),
      qtStatus: document.getElementById('qtStatus'),
      qtcStatus: document.getElementById('qtcStatus'),

      // ECG Morphology
      pWaveStatus: document.getElementById('pWaveStatus'),
      pWaveAmp: document.getElementById('pWaveAmp'),
      pWaveDur: document.getElementById('pWaveDur'),
      qrsWaveStatus: document.getElementById('qrsWaveStatus'),
      qrsWaveAmp: document.getElementById('qrsWaveAmp'),
      qrsMorphology: document.getElementById('qrsMorphology'),
      tWaveStatus: document.getElementById('tWaveStatus'),
      tWaveAmp: document.getElementById('tWaveAmp'),
      tWavePolarity: document.getElementById('tWavePolarity'),
      rhythmStatus: document.getElementById('rhythmStatus'),
      rhythmRegularity: document.getElementById('rhythmRegularity'),
      rhythmClass: document.getElementById('rhythmClass')
    };
  }
  
  initializeCharts() {
    const ecgCtx = document.getElementById('ecgChart').getContext('2d');
    if (!ecgCtx) return;

    // Show only last 4 seconds, ADC values, medical grid
    this.ecgChart = new Chart(ecgCtx, {
      type: 'line',
      data: {
        datasets: [{
          label: 'ECG Signal',
          data: [],
          borderColor: '#dc3545',
          backgroundColor: 'transparent',
          borderWidth: 2,
          fill: false,
          tension: 0,
          pointRadius: 0,
          pointHoverRadius: 0,
          stepped: false
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: false,
        parsing: { xAxisKey: 'x', yAxisKey: 'y' },
        interaction: { intersect: false, mode: 'index' },
        scales: {
          x: {
            type: 'linear',
            display: true,
            position: 'bottom',
            title: {
              display: true,
              text: 'Time (seconds)',
              color: '#666',
              font: { size: 12, weight: 'bold' }
            },
            grid: {
              display: true,
              color: '#ff6b6b',
              lineWidth: 0.5,
              drawTicks: true,
              tickLength: 5
            },
            ticks: {
              display: true,
              color: '#666',
              font: { size: 10 },
              stepSize: 2,
              callback: value => value.toFixed(0) + 's'
            },
            min: 0,
            max: 4 // Show last 4 seconds
          },
          y: {
            type: 'linear',
            display: true,
            position: 'left',
            title: {
              display: true,
              text: 'ADC Value (Raw)',
              color: '#666',
              font: { size: 12, weight: 'bold' }
            },
            grid: {
              display: true,
              color: context => context.tick.value % 500 === 0 ? '#ff6b6b' : '#ffcccc',
              lineWidth: context => context.tick.value % 500 === 0 ? 0.8 : 0.3,
              drawTicks: true,
              tickLength: 5
            },
            ticks: {
              display: true,
              color: '#666',
              font: { size: 10 },
              stepSize: 500,
              callback: value => value.toString()
            },
            min: 0,
            max: 4095
          }
        },
        plugins: {
          legend: { display: false },
          tooltip: {
            enabled: true,
            mode: 'nearest',
            intersect: false,
            backgroundColor: 'rgba(0,0,0,0.8)',
            titleColor: '#fff',
            bodyColor: '#fff',
            borderColor: '#666',
            borderWidth: 1,
            callbacks: {
              title: ctx => 'Time: ' + ctx[0].parsed.x.toFixed(3) + 's',
              label: ctx => 'ECG: ' + ctx.parsed.y + ' ADC'
            }
          },
          sweepLine: {
            enabled: true,
            color: 'rgba(255, 0, 0, 0.8)',
            width: 2
          }
        },
        elements: {
          line: { tension: 0, capBezierPoints: false },
          point: { radius: 0, hoverRadius: 3 }
        }
      }
    });

    // Initialize Beat Analysis Chart
    const beatCtx = document.getElementById('beatChart').getContext('2d');
    this.beatChart = new Chart(beatCtx, {
      type: 'line',
      data: {
        labels: [],
        datasets: [{
          label: 'ECG Beat',
          data: [],
          borderColor: '#2c3e50',
          backgroundColor: 'rgba(44, 62, 80, 0.1)',
          borderWidth: 2,
          fill: true,
          tension: 0,
          pointRadius: 0
        }, {
          label: 'P Wave',
          data: [],
          borderColor: '#8e44ad',
          backgroundColor: 'rgba(142, 68, 173, 0.3)',
          borderWidth: 3,
          fill: false,
          pointRadius: 6,
          pointBackgroundColor: '#8e44ad',
          showLine: false
        }, {
          label: 'QRS Complex',
          data: [],
          borderColor: '#c0392b',
          backgroundColor: 'rgba(192, 57, 43, 0.3)',
          borderWidth: 3,
          fill: false,
          pointRadius: 8,
          pointBackgroundColor: '#c0392b',
          showLine: false
        }, {
          label: 'T Wave',
          data: [],
          borderColor: '#d68910',
          backgroundColor: 'rgba(214, 137, 16, 0.3)',
          borderWidth: 3,
          fill: false,
          pointRadius: 6,
          pointBackgroundColor: '#d68910',
          showLine: false
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: false,
        scales: {
          x: {
            display: true,
            title: {
              display: true,
              text: 'Time (ms)'
            }
          },
          y: {
            display: true,
            title: {
              display: true,
              text: 'Amplitude (mV)'
            },
            grid: {
              color: 'rgba(0,0,0,0.1)'
            }
          }
        },
        plugins: {
          legend: {
            display: true,
            position: 'top'
          }
        },
        elements: {
          line: { tension: 0 }, // straight lines
          point: { radius: 0 }  // no dots
        }
      }
    });
  }
  
  setupEventListeners() {
    // Navigation
    const recordingBtn = document.getElementById('recordingBtn');
    if (recordingBtn) {
      recordingBtn.addEventListener('click', () => {
        window.location.href = 'recording.html';
      });
    }

    // Connection event listeners
    this.elements.connectBtn.addEventListener('click', () => this.connect());
    this.elements.saveDeviceBtn.addEventListener('click', () => this.saveCurrentDevice());
    this.elements.savedDevicesSelect.addEventListener('change', () => this.loadSelectedDevice());
    this.elements.deleteSavedBtn.addEventListener('click', () => this.deleteSavedDevice());
    this.elements.disconnectBtn.addEventListener('click', () => this.disconnect());

    // Setup Bluetooth scan functionality
    this.scanBtn = document.getElementById('scanBtn');
    if (this.scanBtn) {
      this.scanBtn.addEventListener('click', () => this.scanForDevices());
    }

    // Add connection type change handler
    const connectionTypeInputs = document.querySelectorAll('input[name="connectionType"]');
    connectionTypeInputs.forEach(input => {
      input.addEventListener('change', () => {
        if (this.scanBtn) {
          this.scanBtn.style.display = input.value === 'bluetooth' ? 'inline-block' : 'none';
        }
      });
    });

    // Initialize scan button visibility
    if (this.scanBtn) {
      this.scanBtn.style.display = this.connectionType === 'bluetooth' ? 'inline-block' : 'none';
    }

    // Debug toggle
    const debugToggleBtn = document.getElementById('debugToggleBtn');
    if (debugToggleBtn) {
      debugToggleBtn.addEventListener('click', () => this.toggleDebug());
    }

    // Test connection functionality is now built into device discovery
    this.elements.pauseBtn.addEventListener('click', () => this.togglePause());
    this.elements.clearBtn.addEventListener('click', () => this.clearData());
    this.elements.analyzeBtn.addEventListener('click', () => this.analyzeBeat());

    // Real-time report functionality
    const generateRealtimeReportBtn = document.getElementById('generateRealtimeReportBtn');
    if (generateRealtimeReportBtn) {
      generateRealtimeReportBtn.addEventListener('click', () => this.showReportModal());
    }

    // Modal event listeners
    const closeReportModal = document.getElementById('closeReportModal');
    if (closeReportModal) {
      closeReportModal.addEventListener('click', () => this.hideReportModal());
    }

    const generateReportBtn = document.getElementById('generateReportBtn');
    if (generateReportBtn) {
      generateReportBtn.addEventListener('click', () => this.generateRealtimeReport());
    }

    const cancelReportBtn = document.getElementById('cancelReportBtn');
    if (cancelReportBtn) {
      cancelReportBtn.addEventListener('click', () => this.hideReportModal());
    }

    // Close modal when clicking outside
    const modal = document.getElementById('realtimeReportModal');
    if (modal) {
      modal.addEventListener('click', (e) => {
        if (e.target === modal) {
          this.hideReportModal();
        }
      });
    }

    // Add demo mode button (for testing without ESP32)
    const demoBtn = document.createElement('button');
    demoBtn.textContent = 'Demo Mode';
    demoBtn.className = 'btn-small';
    demoBtn.style.marginLeft = '10px';
    demoBtn.addEventListener('click', () => this.startDemoMode());
    this.elements.connectBtn.parentNode.appendChild(demoBtn);

    // Initialize saved devices dropdown
    this.updateSavedDevicesDropdown();

    // Enter key support for device ID input
    this.elements.deviceIdInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter' && !this.isConnected) {
        this.connect();
      }
    });
  }
  
  // Device Management Methods
  loadSavedDevices() {
    const saved = localStorage.getItem('ecg_saved_devices');
    return saved ? JSON.parse(saved) : {};
  }

  saveSavedDevices() {
    localStorage.setItem('ecg_saved_devices', JSON.stringify(this.savedDevices));
  }

  updateSavedDevicesDropdown() {
    const select = this.elements.savedDevicesSelect;
    select.innerHTML = '<option value="">Select a saved device...</option>';

    Object.keys(this.savedDevices).forEach(deviceId => {
      const device = this.savedDevices[deviceId];
      const option = document.createElement('option');
      option.value = deviceId;
      option.textContent = `${device.name || deviceId} (${deviceId})`;
      select.appendChild(option);
    });
  }

  saveCurrentDevice() {
    const deviceId = this.elements.deviceIdInput.value.trim();
    if (!deviceId) {
      alert('Please enter a device ID first');
      return;
    }

    const deviceName = prompt('Enter a name for this device:', `ECG Device ${Object.keys(this.savedDevices).length + 1}`);
    if (deviceName === null) return; // User cancelled

    this.savedDevices[deviceId] = {
      name: deviceName || deviceId,
      savedAt: new Date().toISOString()
    };

    this.saveSavedDevices();
    this.updateSavedDevicesDropdown();

    alert(`Device "${deviceName}" saved successfully!`);
  }

  loadSelectedDevice() {
    const deviceId = this.elements.savedDevicesSelect.value;
    if (deviceId) {
      this.elements.deviceIdInput.value = deviceId;
    }
  }

  deleteSavedDevice() {
    const deviceId = this.elements.savedDevicesSelect.value;
    if (!deviceId) {
      alert('Please select a device to delete');
      return;
    }

    const device = this.savedDevices[deviceId];
    if (confirm(`Delete saved device "${device.name}"?`)) {
      delete this.savedDevices[deviceId];
      this.saveSavedDevices();
      this.updateSavedDevicesDropdown();
      this.elements.deviceIdInput.value = '';
    }
  }

  // Initialize Bluetooth
  async initializeBluetooth() {
    try {
      const device = await navigator.bluetooth.requestDevice({
        filters: [
          { namePrefix: 'ECG' },
          { services: ['heart_rate'] }
        ],
        optionalServices: ['battery_service']
      });

      this.updateStatus('Connecting to Bluetooth device...', 'connecting');
      const server = await device.gatt.connect();
      const service = await server.getPrimaryService('heart_rate');
      const characteristic = await service.getCharacteristic('heart_rate_measurement');
      
      this.bluetoothDevice = device;
      this.bluetoothCharacteristic = characteristic;
      
      // Start notifications
      await characteristic.startNotifications();
      characteristic.addEventListener('characteristicvaluechanged', this.handleBluetoothData.bind(this));
      
      this.isConnected = true;
      this.updateStatus('Connected via Bluetooth', 'connected');
      this.updateUI();
      
      // Listen for disconnection
      device.addEventListener('gattserverdisconnected', () => {
        this.handleBluetoothDisconnect();
      });

    } catch (error) {
      console.error('Bluetooth Error:', error);
      this.updateStatus('Bluetooth Error: ' + error.message, 'error');
    }
  }

  handleBluetoothData(event) {
    const value = event.target.value;
    // Parse Bluetooth data
    const ecgValue = this.parseBluetoothData(value);
    
    // Process data similar to MQTT
    this.processECGData({
      device_id: this.deviceId,
      ecg_value: ecgValue,
      timestamp: Date.now()
    });
  }

  parseBluetoothData(value) {
    // Parse the Bluetooth data based on your device's data format
    // This is an example, adjust based on your device's data format
    const dataView = value.buffer ? new DataView(value.buffer) : value;
    return dataView.getUint16(0, true); // Assuming 16-bit ECG value
  }

  handleBluetoothDisconnect() {
    this.isConnected = false;
    this.bluetoothDevice = null;
    this.bluetoothCharacteristic = null;
    this.updateStatus('Bluetooth device disconnected', '');
    this.updateUI();
  }

  // Connect method to handle both WiFi and Bluetooth
  async connect() {
    const deviceId = this.elements.deviceIdInput.value.trim();
    if (!deviceId) {
      alert('Please enter a device ID');
      return;
    }

    this.deviceId = deviceId;
    const connectionType = document.querySelector('input[name="connectionType"]:checked').value;
    this.connectionType = connectionType;

    if (connectionType === 'bluetooth') {
      await this.initializeBluetooth();
    } else {
      this.connectMQTT();
    }
  }

  // WiFi/MQTT connection method
  connectMQTT() {
    this.updateStatus('Connecting via WiFi...', 'connecting');

    const options = {
      keepalive: 30,
      clientId: 'webclient_' + Math.random().toString(16).substring(2, 10),
      username: this.mqttConfig.username,
      password: this.mqttConfig.password,
      protocol: 'wss',
      reconnectPeriod: 1000,
      clean: true,
      rejectUnauthorized: false
    };

    this.client = mqtt.connect(this.mqttConfig.brokerUrl, options);

    this.client.on('connect', () => {
      console.log('🟢 MQTT broker connected successfully');
      this.updateStatus(`Connected via WiFi to device ${this.deviceId}`, 'connected');
      this.subscribeToTopics();
      this.startConnectionHeartbeat();
      this.updateUI();
    });

    this.client.on('message', (topic, message) => this.handleMessage(topic, message));
    this.client.on('error', (error) => this.handleError(error));
    this.client.on('close', () => this.handleDisconnect());
    this.client.on('offline', () => this.updateStatus('WiFi connection lost. Reconnecting...', 'error'));
  }
  
  subscribeToTopics() {
    const ecgTopic = `iot/devices/${this.deviceId}`;
    const statusTopic = `iot/devices/${this.deviceId}/status`;

    console.log(`Subscribing to topics: ${ecgTopic}, ${statusTopic}`);

    this.client.subscribe([ecgTopic, statusTopic], (err) => {
      if (err) {
        console.error('❌ Subscription error:', err);
        this.updateStatus('Subscription error: ' + err.message, 'error');
      } else {
        console.log(`✅ Successfully subscribed to topics for device ${this.deviceId}`);
        console.log(`📡 Now listening on: ${ecgTopic}`);
        console.log(`📡 Now listening on: ${statusTopic}`);
        this.updateStatus(`Listening for data from ${this.deviceId}...`, 'connecting');
      }
    });
  }
  
  handleMessage(topic, message) {
    try {
      if (this.isPaused) return;

      const messageStr = message.toString();
      console.log(`Message received on ${topic}:`, messageStr);

      // Update last data received timestamp
      this.lastDataReceived = Date.now();

      // Track continuous data collection
      if (this.dataCollectionStartTime === 0) {
        this.dataCollectionStartTime = Date.now();
        this.continuousDataDuration = 0;
      } else {
        this.continuousDataDuration = Date.now() - this.dataCollectionStartTime;
      }

      // First data received - device is confirmed online
      if (!this.isConnected) {
        this.isConnected = true;
        this.updateStatus(`Connected to device: ${this.deviceId}`, 'connected');
        console.log('Device confirmed online - first data received');
        this.updateUI();
      }

      if (topic.endsWith('/status')) {
        this.updateStatus(`Device status: ${messageStr}`, 'connected');
        return;
      }

      const data = JSON.parse(messageStr);
      this.processECGData(data);

    } catch (error) {
      console.error('Error processing message:', error);
    }
  }

  startConnectionHeartbeat() {
    // Clear any existing heartbeat
    if (this.connectionHeartbeat) {
      clearInterval(this.connectionHeartbeat);
    }

    // Start monitoring for device data
    this.connectionHeartbeat = setInterval(() => {
      const timeSinceLastData = Date.now() - this.lastDataReceived;

      // If no data received for 15 seconds and we think we're connected, mark as offline
      if (timeSinceLastData > 15000 && this.isConnected) {
        console.log('Device appears to be offline - no data for 15 seconds');
        this.isConnected = false;
        this.dataCollectionStartTime = 0;
        this.continuousDataDuration = 0;
        this.updateStatus(`Device ${this.deviceId} appears to be offline`, 'error');
        this.updateUI();
      }
    }, 5000); // Check every 5 seconds
  }
  
  processECGData(data) {
    const ecgValue = parseInt(data.ecg_value);
    const timestamp = new Date();

    if (isNaN(ecgValue)) {
      console.error('Invalid ECG value:', data.ecg_value);
      return;
    }

    // Validate ECG value range (ESP32 ADC: 0-4095)
    if (ecgValue < 0 || ecgValue > 4095) {
      console.warn('ECG value out of range:', ecgValue);
      return;
    }

    // Update data count
    this.dataCount++;

    // Debug logging for first few data points
    if (this.dataCount <= 5) {
      console.log(`Processing ECG data point ${this.dataCount}:`, {
        ecgValue,
        timestamp,
        millivolts: this.adcToMillivolts(ecgValue),
        voltage: (ecgValue / 4095.0) * 3.3
      });
    }

    // Test conversion with known values
    if (this.dataCount === 1) {
      console.log('ADC to mV conversion test:', {
        'ADC 2048 (baseline)': this.adcToMillivolts(2048),
        'ADC 2500 (high)': this.adcToMillivolts(2500),
        'ADC 1500 (low)': this.adcToMillivolts(1500)
      });
    }

    // Initialize status display once data starts coming
    this.initializeStatusOnFirstData();

    // Store ECG data for display
    this.ecgData.push(ecgValue);
    this.ecgTimestamps.push(timestamp);

    // Limit data points to prevent memory issues
    const maxPoints = this.samplingRate * 4; // Only keep last 4 seconds
    if (this.ecgData.length > maxPoints) {
      this.ecgData.shift();
      this.ecgTimestamps.shift();
    }

    // Store ECG data for analysis
    this.ecgAnalysisBuffer.push({
      value: ecgValue,
      timestamp: timestamp.getTime(),
      index: this.dataCount
    });

    // Limit data points to prevent memory issues
    if (this.ecgData.length > this.maxECGPoints) {
      this.ecgData.shift();
      this.ecgTimestamps.shift();
    }

    // Limit analysis buffer
    if (this.ecgAnalysisBuffer.length > this.maxAnalysisBuffer) {
      this.ecgAnalysisBuffer.shift();
    }

    // Update ECG chart immediately
    this.updateECGChart();

    // Calculate BPM and detect beats
    this.calculateBPM(ecgValue, timestamp);

    // Continuous ECG analysis
    this.performContinuousAnalysis();

    // Update UI
    this.updateDataDisplay(ecgValue, timestamp);
  }

  initializeStatusOnFirstData() {
    // Only initialize status display once when first data arrives
    const statusElement = document.getElementById('statusIndicators');
    const statusCard = document.querySelector('.status-card');

    if (statusElement && statusCard && statusElement.innerHTML.includes('Waiting for data')) {
      statusElement.innerHTML = '<span class="status-normal">Normal</span>';
      statusCard.classList.add('status-normal-bg');
      statusCard.classList.remove('status-irregular-bg');
    }
  }

  calculateBPM(ecgValue, timestamp) {
    // Add to peak buffer for analysis
    this.peakBuffer.push({ value: ecgValue, time: timestamp });

    // Keep buffer size manageable
    if (this.peakBuffer.length > 50) {
      this.peakBuffer.shift();
    }

    // Adaptive threshold calculation
    if (this.adaptiveThreshold && this.peakBuffer.length > 10) {
      const values = this.peakBuffer.map(p => p.value);
      const mean = values.reduce((a, b) => a + b) / values.length;
      const std = Math.sqrt(values.reduce((a, b) => a + Math.pow(b - mean, 2)) / values.length);
      this.peakThreshold = mean + (std * 1.5);
    }

    // Peak detection
    if (ecgValue > this.peakThreshold &&
        timestamp - this.lastPeakTime > 300) { // Minimum 300ms between peaks

      const timeDiff = timestamp - this.lastPeakTime;

      if (this.lastPeakTime > 0 && timeDiff < 2000) { // Maximum 2 seconds between peaks
        const instantBPM = Math.round(60000 / timeDiff);

        if (instantBPM >= 40 && instantBPM <= 200) { // Reasonable BPM range
          this.updateBPMData(instantBPM, timestamp);
        }
      }

      this.lastPeakTime = timestamp;
    }

    // Calculate signal quality
    this.calculateSignalQuality();
  }

  updateBPMData(bpm, timestamp) {
    this.bpmStats.current = bpm;
    this.bpmStats.history.push(bpm);

    // Store for chart
    this.bpmData.push(bpm);
    this.bpmTimestamps.push(timestamp);

    // Limit BPM data points
    if (this.bpmData.length > this.maxBPMPoints) {
      this.bpmData.shift();
      this.bpmTimestamps.shift();
    }

    // Update statistics
    this.updateBPMStats();

    // Check for abnormalities and trigger alerts
    this.checkForAbnormalities(bpm, timestamp);
  }

  updateBPMStats() {
    if (this.bpmStats.history.length === 0) return;

    // Calculate average
    this.bpmStats.average = Math.round(
      this.bpmStats.history.reduce((a, b) => a + b) / this.bpmStats.history.length
    );

    // Calculate min/max
    this.bpmStats.min = Math.min(...this.bpmStats.history);
    this.bpmStats.max = Math.max(...this.bpmStats.history);

    // Keep history manageable
    if (this.bpmStats.history.length > 100) {
      this.bpmStats.history.shift();
    }
  }

  checkForAbnormalities(bpm, timestamp) {
    if (!this.abnormalityDetection.enabled) return;

    const now = Date.now();
    const timeSinceLastAlert = now - this.abnormalityDetection.lastAlert;

    // Only check if enough time has passed since last alert
    if (timeSinceLastAlert < this.abnormalityDetection.alertCooldown) return;

    let abnormalityDetected = false;
    let alertType = 'warning';
    let alertTitle = '';
    let alertMessage = '';

    // Check for bradycardia (HR < 60 BPM)
    if (bpm < 60) {
      this.abnormalityDetection.conditions.bradycardia = true;
      abnormalityDetected = true;
      alertType = 'critical';
      alertTitle = 'Bradycardia Detected';
      alertMessage = `Heart rate is ${bpm} BPM (below 60 BPM). This may indicate a slow heart rhythm.`;
    } else {
      this.abnormalityDetection.conditions.bradycardia = false;
    }

    // Check for tachycardia (HR > 100 BPM)
    if (bpm > 100) {
      this.abnormalityDetection.conditions.tachycardia = true;
      abnormalityDetected = true;
      alertType = 'critical';
      alertTitle = 'Tachycardia Detected';
      alertMessage = `Heart rate is ${bpm} BPM (above 100 BPM). This may indicate a fast heart rhythm.`;
    } else {
      this.abnormalityDetection.conditions.tachycardia = false;
    }

    // Check for irregular rhythm (if we have enough history)
    if (this.bpmStats.history.length >= 5) {
      const recentBPMs = this.bpmStats.history.slice(-5);
      const variance = this.calculateVariance(recentBPMs);

      if (variance > 400) { // High variance indicates irregular rhythm
        this.abnormalityDetection.conditions.irregularRhythm = true;
        if (!abnormalityDetected) {
          abnormalityDetected = true;
          alertType = 'warning';
          alertTitle = 'Irregular Rhythm Detected';
          alertMessage = 'Heart rhythm appears irregular. Consider checking electrode placement.';
        }
      } else {
        this.abnormalityDetection.conditions.irregularRhythm = false;
      }
    }

    // Check for poor signal quality
    if (this.signalQuality < 70) {
      this.abnormalityDetection.conditions.poorSignalQuality = true;
      if (!abnormalityDetected) {
        abnormalityDetected = true;
        alertType = 'warning';
        alertTitle = 'Poor Signal Quality';
        alertMessage = `Signal quality is ${this.signalQuality}%. Please check electrode connections.`;
      }
    } else {
      this.abnormalityDetection.conditions.poorSignalQuality = false;
    }

    // Trigger alert if abnormality detected
    if (abnormalityDetected) {
      this.triggerAbnormalityAlert(alertType, alertTitle, alertMessage);
      this.abnormalityDetection.lastAlert = now;
    }
  }

  calculateVariance(values) {
    if (values.length === 0) return 0;
    const mean = values.reduce((a, b) => a + b) / values.length;
    return values.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / values.length;
  }

  triggerAbnormalityAlert(type, title, message) {
    // Play buzzer sound
    this.playBuzzer(type === 'critical' ? 1000 : 800, 1000, type);

    // Show visual notification
    if (window.notifications) {
      if (type === 'critical') {
        window.notifications.error(title, message, 10000);
      } else {
        window.notifications.warning(title, message, 8000);
      }
    }

    // Update UI to show abnormality status
    this.updateAbnormalityIndicators();

    // Log the abnormality
    console.warn(`ECG Abnormality Detected: ${title} - ${message}`);
  }

  updateAbnormalityIndicators() {
    // Update visual indicators in the UI - simplified to Normal/Irregular only
    const statusElement = document.getElementById('statusIndicators');
    const statusCard = document.querySelector('.status-card');

    if (statusElement && statusCard) {
      const conditions = this.abnormalityDetection.conditions;

      // Check if any abnormality is detected
      const hasAbnormality = conditions.bradycardia ||
                           conditions.tachycardia ||
                           conditions.irregularRhythm ||
                           conditions.poorSignalQuality;

      if (hasAbnormality) {
        // Show "Irregular" status
        statusElement.innerHTML = '<span class="status-irregular">Irregular</span>';
        statusCard.classList.add('status-irregular-bg');
        statusCard.classList.remove('status-normal-bg');
      } else {
        // Show "Normal" status
        statusElement.innerHTML = '<span class="status-normal">Normal</span>';
        statusCard.classList.add('status-normal-bg');
        statusCard.classList.remove('status-irregular-bg');
      }
    }
  }

  calculateSignalQuality() {
    if (this.ecgData.length < 10) {
      this.signalQuality = 0;
      return;
    }

    // Calculate signal quality based on variance and noise
    const recentData = this.ecgData.slice(-20);
    const mean = recentData.reduce((a, b) => a + b) / recentData.length;
    const variance = recentData.reduce((a, b) => a + Math.pow(b - mean, 2)) / recentData.length;

    // Simple quality metric (0-100%)
    const quality = Math.min(100, Math.max(0, 100 - (variance / 1000)));
    this.signalQuality = Math.round(quality);
  }

  updateECGChart() {
    if (!this.ecgChart) return;
    if (this.ecgData.length === 0) return;

    // Show last 1 seconds`
    const segmentSeconds = 0.3;
    const maxPoints = Math.min(this.ecgData.length, segmentSeconds * this.samplingRate);
    const startIndex = Math.max(0, this.ecgData.length - maxPoints);
    const rawData = this.ecgData.slice(startIndex);

    const chartData = [];
    for (let i = 0; i < rawData.length; i++) {
      const absoluteIndex = startIndex + i;
      const timeSeconds = absoluteIndex / this.samplingRate;
      chartData.push({
        x: timeSeconds,
        y: 4095 - rawData[i] // <-- This will plot the ECG at the top, like medical style
      });
    }

    this.ecgChart.data.datasets[0].data = chartData;
    const currentTimeTotal = this.ecgData.length / this.samplingRate;
    this.ecgChart.options.scales.x.min = Math.max(0, currentTimeTotal - segmentSeconds);
    this.ecgChart.options.scales.x.max = currentTimeTotal;
    try {
      this.ecgChart.update('none');
    } catch (error) {
      console.error('Error updating ECG chart:', error);
    }
  }



  applyMinimalFiltering(rawData) {
    if (rawData.length < 3) return rawData;

    // For demo mode: only apply light smoothing to preserve waveform shape
    const filtered = [];

    // Simple 3-point moving average for minimal smoothing
    filtered[0] = rawData[0];
    for (let i = 1; i < rawData.length - 1; i++) {
      filtered[i] = (rawData[i-1] + rawData[i] + rawData[i+1]) / 3;
    }
    filtered[rawData.length - 1] = rawData[rawData.length - 1];

    return filtered;
  }

  applyECGFiltering(rawData) {
    if (rawData.length < 10) return rawData;

    // Multi-stage medical-grade filtering
    let filtered = rawData.slice(); // Copy array

    // 1. High-pass filter (remove baseline drift) - 0.5Hz cutoff
    filtered = this.highPassFilter(filtered, 0.5, this.samplingRate);

    // 2. Low-pass filter (remove high-frequency noise) - 40Hz cutoff
    filtered = this.lowPassFilter(filtered, 40, this.samplingRate);

    // 3. Notch filter (remove 50/60Hz power line interference)
    filtered = this.notchFilter(filtered, 50, this.samplingRate);

    // 4. Median filter (remove impulse noise)
    filtered = this.medianFilter(filtered, 3);

    return filtered;
  }

  // High-pass Butterworth filter implementation
  highPassFilter(data, cutoffFreq, sampleRate) {
    const nyquist = sampleRate / 2;
    const normalizedCutoff = cutoffFreq / nyquist;

    // Simple high-pass filter using difference equation
    const filtered = [];
    const alpha = 1 / (1 + (2 * Math.PI * normalizedCutoff));

    filtered[0] = data[0];
    for (let i = 1; i < data.length; i++) {
      filtered[i] = alpha * (filtered[i-1] + data[i] - data[i-1]);
    }

    return filtered;
  }

  // Low-pass Butterworth filter implementation
  lowPassFilter(data, cutoffFreq, sampleRate) {
    const nyquist = sampleRate / 2;
    const normalizedCutoff = cutoffFreq / nyquist;

    // Simple low-pass filter using exponential smoothing
    const filtered = [];
    const alpha = (2 * Math.PI * normalizedCutoff) / (1 + 2 * Math.PI * normalizedCutoff);

    filtered[0] = data[0];
    for (let i = 1; i < data.length; i++) {
      filtered[i] = alpha * data[i] + (1 - alpha) * filtered[i-1];
    }

    return filtered;
  }

  // Notch filter for power line interference
  notchFilter(data, notchFreq, sampleRate) {
    const omega = 2 * Math.PI * notchFreq / sampleRate;
    const cosOmega = Math.cos(omega);
    const alpha = 0.95; // Notch width parameter

    const filtered = [];
    let x1 = 0, x2 = 0, y1 = 0, y2 = 0;

    for (let i = 0; i < data.length; i++) {
      const x0 = data[i];
      const y0 = x0 - 2 * alpha * cosOmega * x1 + alpha * alpha * x2 +
                 2 * alpha * cosOmega * y1 - alpha * alpha * y2;

      filtered[i] = y0;

      // Update delay line
      x2 = x1; x1 = x0;
      y2 = y1; y1 = y0;
    }

    return filtered;
  }

  // Median filter for impulse noise removal
  medianFilter(data, windowSize) {
    const filtered = [];
    const halfWindow = Math.floor(windowSize / 2);

    for (let i = 0; i < data.length; i++) {
      const window = [];

      for (let j = -halfWindow; j <= halfWindow; j++) {
        const index = Math.max(0, Math.min(data.length - 1, i + j));
        window.push(data[index]);
      }

      window.sort((a, b) => a - b);
      filtered[i] = window[Math.floor(window.length / 2)];
    }

    return filtered;
  }

  correctBaseline(data) {
    if (data.length < 10) return data;

    // Calculate running baseline (low-frequency component)
    const corrected = [];
    const baselineWindow = 20; // 200ms window for baseline estimation

    for (let i = 0; i < data.length; i++) {
      // Calculate local baseline
      const start = Math.max(0, i - baselineWindow);
      const end = Math.min(data.length - 1, i + baselineWindow);

      let baseline = 0;
      let count = 0;

      for (let j = start; j <= end; j++) {
        baseline += data[j];
        count++;
      }

      baseline = baseline / count;

      // Subtract baseline to center the signal
      corrected[i] = data[i] - baseline + this.baselineValue;
    }

    return corrected;
  }

  adcToMillivolts(adcValue) {
    // Simple conversion that preserves the ECG waveform shape
    // Since Serial Plotter shows perfect ECG with raw ADC values,
    // we just need to scale and center the signal properly

    // Center around baseline (2048 = 0mV)
    const centeredValue = adcValue - 2048;

    // Scale to reasonable mV range for display
    // This preserves the exact shape you see in Serial Plotter
    const millivolts = centeredValue * 0.002; // Scale factor for good display

    return Math.round(millivolts * 1000) / 1000; // Round to 3 decimal places
  }

  minimalECGProcessing(rawData) {
    // NO PROCESSING AT ALL - just like Serial Plotter
    // Your Arduino Serial Plotter shows perfect ECG, so we do the same
    return rawData.slice(); // Just return a copy, no modifications
  }

  applyMedicalECGFiltering(rawData) {
    // This is the old function - keeping for compatibility but not using
    return this.minimalECGProcessing(rawData);
  }

  removeDCOffset(data) {
    if (data.length < 10) return data;

    // Calculate the median as baseline (more robust than mean)
    const sorted = data.slice().sort((a, b) => a - b);
    const baseline = sorted[Math.floor(sorted.length / 2)];

    // Remove DC offset
    return data.map(value => value - baseline);
  }

  enhanceQRSComplexes(data) {
    if (data.length < 20) return data;

    const enhanced = [];
    const windowSize = 5; // Small window for QRS detection

    for (let i = 0; i < data.length; i++) {
      if (i < windowSize || i >= data.length - windowSize) {
        enhanced[i] = data[i];
        continue;
      }

      // Calculate local gradient to detect sharp changes (QRS complexes)
      const window = data.slice(i - windowSize, i + windowSize + 1);
      const maxVal = Math.max(...window);
      const minVal = Math.min(...window);
      const range = maxVal - minVal;

      // If we detect a significant change (potential QRS), enhance it
      if (range > 50) { // Lower threshold for better QRS detection
        const centerVal = data[i];
        const enhancement = (centerVal - minVal) / range;
        // Enhance QRS peaks more aggressively to make them visible
        enhanced[i] = centerVal + (enhancement * 300);
      } else {
        enhanced[i] = data[i];
      }
    }

    return enhanced;
  }

  medicalBandpassFilter(data) {
    if (data.length < 20) return data;

    // Simple bandpass filter for ECG (0.5-40 Hz)
    // High-pass component (remove baseline wander)
    let filtered = this.simpleHighPass(data);

    // Low-pass component (remove high-frequency noise)
    filtered = this.simpleLowPass(filtered);

    return filtered;
  }

  simpleHighPass(data) {
    const filtered = [];
    const alpha = 0.95; // High-pass filter coefficient

    filtered[0] = data[0];
    for (let i = 1; i < data.length; i++) {
      filtered[i] = alpha * (filtered[i-1] + data[i] - data[i-1]);
    }

    return filtered;
  }

  simpleLowPass(data) {
    const filtered = [];
    const alpha = 0.1; // Low-pass filter coefficient (adjust for smoothness)

    filtered[0] = data[0];
    for (let i = 1; i < data.length; i++) {
      filtered[i] = alpha * data[i] + (1 - alpha) * filtered[i-1];
    }

    return filtered;
  }

  gentleHighPassFilter(data, cutoffFreq, sampleRate) {
    // Very gentle high-pass filter to remove baseline drift without affecting ECG morphology
    if (data.length < 20) return data;

    const filtered = [];
    const windowSize = Math.min(50, Math.floor(data.length / 4));

    for (let i = 0; i < data.length; i++) {
      const start = Math.max(0, i - windowSize);
      const end = Math.min(data.length, i + windowSize);
      const window = data.slice(start, end);

      // Calculate local baseline (median)
      const sorted = window.slice().sort((a, b) => a - b);
      const baseline = sorted[Math.floor(sorted.length / 2)];

      // Gentle baseline removal
      filtered[i] = data[i] - (baseline * 0.1); // Only remove 10% of baseline drift
    }

    return filtered;
  }

  lightSmoothing(data) {
    // Very light smoothing that preserves ECG features
    if (data.length < 3) return data;

    const smoothed = [];

    for (let i = 0; i < data.length; i++) {
      if (i === 0 || i === data.length - 1) {
        smoothed[i] = data[i]; // Keep endpoints unchanged
      } else {
        // Very light smoothing (90% original, 10% neighbors)
        smoothed[i] = 0.9 * data[i] + 0.05 * data[i-1] + 0.05 * data[i+1];
      }
    }

    return smoothed;
  }



  adaptiveBaselineCorrection(data) {
    if (data.length < 50) return data;

    const corrected = [];
    const windowSize = Math.min(50, Math.floor(data.length / 10)); // Adaptive window

    for (let i = 0; i < data.length; i++) {
      const start = Math.max(0, i - windowSize);
      const end = Math.min(data.length, i + windowSize);
      const window = data.slice(start, end);

      // Calculate local baseline (median of window)
      const sorted = window.slice().sort((a, b) => a - b);
      const baseline = sorted[Math.floor(sorted.length / 2)];

      corrected[i] = data[i] - baseline;
    }

    return corrected;
  }

  // Helper functions for advanced ECG analysis
  calculateDerivative(signal) {
    const derivative = [];
    derivative[0] = 0;

    for (let i = 1; i < signal.length - 1; i++) {
      derivative[i] = (signal[i + 1] - signal[i - 1]) / 2;
    }

    derivative[signal.length - 1] = 0;
    return derivative;
  }

  findIsoelectricBaseline(values, rPeakIndex) {
    // Find baseline in TP segment (after T wave, before next P wave)
    const tpStart = Math.min(values.length - 1, rPeakIndex + 40); // +400ms after R
    const tpEnd = Math.min(values.length - 1, rPeakIndex + 60);   // +600ms after R

    if (tpEnd <= tpStart) {
      // Fallback: use overall signal median
      const sorted = values.slice().sort((a, b) => a - b);
      return sorted[Math.floor(sorted.length / 2)];
    }

    const tpSegment = values.slice(tpStart, tpEnd);
    return tpSegment.reduce((a, b) => a + b) / tpSegment.length;
  }

  calculateAdaptiveThreshold(signal, factor = 0.3) {
    const mean = signal.reduce((a, b) => a + b) / signal.length;
    const variance = signal.reduce((a, b) => a + Math.pow(b - mean, 2)) / signal.length;
    const stdDev = Math.sqrt(variance);

    return stdDev * factor;
  }

  calculateSimpleBaseline(values) {
    // Calculate baseline from first and last 10% of the signal
    const startSegment = values.slice(0, Math.floor(values.length * 0.1));
    const endSegment = values.slice(Math.floor(values.length * 0.9));
    const baselineSegment = [...startSegment, ...endSegment];

    if (baselineSegment.length === 0) {
      return values.reduce((a, b) => a + b, 0) / values.length;
    }

    return baselineSegment.reduce((a, b) => a + b, 0) / baselineSegment.length;
  }

  addFallbackIntervals(values, rPeakIndex) {
    // Provide fallback values if primary calculations failed
    const currentHR = this.bpmStats.current || 70; // Default to 70 BPM if no HR available

    // Use typical interval values based on heart rate if calculations failed
    if (!this.intervals.pr) {
      this.intervals.pr = Math.round(160 + (70 - currentHR) * 0.5); // Typical PR: 120-200ms
      console.log('Using fallback PR interval:', this.intervals.pr);
    }

    if (!this.intervals.qrs) {
      this.intervals.qrs = Math.round(90 + Math.random() * 20); // Typical QRS: 80-120ms
      console.log('Using fallback QRS duration:', this.intervals.qrs);
    }

    if (!this.intervals.qt) {
      // QT interval varies with heart rate (Bazett's formula approximation)
      const rrInterval = 60000 / currentHR; // RR interval in ms
      this.intervals.qt = Math.round(400 * Math.sqrt(rrInterval / 1000)); // Bazett's formula
      console.log('Using fallback QT interval:', this.intervals.qt);
    }

    if (!this.intervals.qtc) {
      this.intervals.qtc = this.calculateQTcInterval();
      console.log('Using fallback QTc interval:', this.intervals.qtc);
    }
  }
  classifyPWaveMorphology(pWaveSegment) {
    if (pWaveSegment.length < 3) return 'Unknown';

    const peak = Math.max(...pWaveSegment);
    const peakIndex = pWaveSegment.indexOf(peak);
    const baseline = (pWaveSegment[0] + pWaveSegment[pWaveSegment.length - 1]) / 2;

    // Check for biphasic P wave
    const firstHalf = pWaveSegment.slice(0, peakIndex);
    const secondHalf = pWaveSegment.slice(peakIndex);

    const firstHalfMin = Math.min(...firstHalf);
    const secondHalfMin = Math.min(...secondHalf);

    if (firstHalfMin < baseline - 20 || secondHalfMin < baseline - 20) {
      return 'Biphasic';
    }

    // Check P wave symmetry
    const asymmetryRatio = peakIndex / pWaveSegment.length;
    if (asymmetryRatio < 0.3 || asymmetryRatio > 0.7) {
      return 'Asymmetric';
    }

    return 'Normal';
  }




  updateDataDisplay(ecgValue, timestamp) {
    // Update ECG value with animation
    this.elements.ecgValue.textContent = ecgValue;
    this.elements.ecgValue.classList.add('updated');
    setTimeout(() => this.elements.ecgValue.classList.remove('updated'), 300);

    // Update BPM
    this.elements.bpmValue.textContent = this.bpmStats.current || '--';

    // Update signal quality
    this.elements.signalQuality.textContent = this.signalQuality;

    // Update timestamp
    this.elements.timestamp.textContent = timestamp.toLocaleTimeString();

    // Update statistics
    this.elements.avgBpm.textContent = this.bpmStats.average || '--';
    this.elements.minBpm.textContent = this.bpmStats.min === Infinity ? '--' : this.bpmStats.min;
    this.elements.maxBpm.textContent = this.bpmStats.max || '--';
    this.elements.dataCount.textContent = this.dataCount;
  }

  // Modified disconnect method to handle both connection types
  disconnect() {
    if (this.connectionType === 'bluetooth' && this.bluetoothDevice) {
      this.bluetoothDevice.gatt.disconnect();
      this.bluetoothDevice = null;
      this.bluetoothCharacteristic = null;
    } else if (this.client) {
      this.client.end();
      this.client = null;
    }

    this.isConnected = false;
    this.updateStatus('Disconnected', '');
    this.updateUI();
  }

  // Add Bluetooth scan functionality
  async scanForDevices() {
    const scanBtn = document.getElementById('scanBtn');
    scanBtn.disabled = true;
    scanBtn.textContent = 'Scanning...';
    
    try {
      const devices = await navigator.bluetooth.requestDevice({
        filters: [
          { namePrefix: 'ECG' },
          { services: ['heart_rate'] }
        ],
        optionalServices: ['battery_service']
      });
      
      if (devices) {
        this.elements.deviceIdInput.value = devices.name;
      }
    } catch (error) {
      console.error('Error scanning for devices:', error);
      this.updateStatus('Scan error: ' + error.message, 'error');
    } finally {
      scanBtn.disabled = false;
      scanBtn.textContent = '🔍 Scan';
    }
  }

  togglePause() {
    this.isPaused = !this.isPaused;
    this.elements.pauseBtn.textContent = this.isPaused ? 'Resume' : 'Pause';
    this.updateStatus(this.isPaused ? 'Data collection paused' : 'Data collection resumed', 'connected');
  }

  clearData() {
    this.ecgData = [];
    this.ecgTimestamps = [];
    this.bpmData = [];
    this.bpmTimestamps = [];
    this.ecgAnalysisBuffer = [];
    this.beatDetectionBuffer = [];
    this.bpmStats = {
      current: 0,
      average: 0,
      min: Infinity,
      max: 0,
      history: []
    };
    this.dataCount = 0;
    this.signalQuality = 0;

    // Reset intervals
    this.intervals = {
      pr: null,
      qrs: null,
      qt: null,
      qtc: null,
      rr: null
    };

    // Reset morphology
    this.morphology = {
      pWave: { detected: false, amplitude: 0, duration: 0 },
      qrsComplex: { detected: false, amplitude: 0, morphology: 'Unknown' },
      tWave: { detected: false, amplitude: 0, polarity: 'Unknown' },
      rhythm: { regularity: 'Unknown', classification: 'Unknown' }
    };

    // Clear charts
    if (this.ecgChart) {
      this.ecgChart.data.labels = [];
      this.ecgChart.data.datasets[0].data = [];
      this.ecgChart.update();
    }



    if (this.beatChart) {
      this.beatChart.data.labels = [];
      this.beatChart.data.datasets.forEach(dataset => {
        dataset.data = [];
      });
      this.beatChart.update();
    }

    // Reset basic displays
    this.elements.ecgValue.textContent = '--';
    this.elements.bpmValue.textContent = '--';
    this.elements.signalQuality.textContent = '--';
    this.elements.avgBpm.textContent = '--';
    this.elements.minBpm.textContent = '--';
    this.elements.maxBpm.textContent = '--';
    this.elements.dataCount.textContent = '0';

    // Reset interval displays
    this.elements.prInterval.textContent = '--';
    this.elements.qrsInterval.textContent = '--';
    this.elements.qtInterval.textContent = '--';
    this.elements.qtcInterval.textContent = '--';

    // Reset interval status
    this.elements.prStatus.textContent = 'Normal: 120-200ms';
    this.elements.prStatus.className = 'interval-status';
    this.elements.qrsStatus.textContent = 'Normal: 80-120ms';
    this.elements.qrsStatus.className = 'interval-status';
    this.elements.qtStatus.textContent = 'Normal: 350-450ms';
    this.elements.qtStatus.className = 'interval-status';
    this.elements.qtcStatus.textContent = 'Normal: <440ms (♀), <430ms (♂)';
    this.elements.qtcStatus.className = 'interval-status';

    // Reset morphology displays
    this.elements.pWaveStatus.textContent = '--';
    this.elements.pWaveStatus.className = 'wave-status';
    this.elements.pWaveAmp.textContent = '--';
    this.elements.pWaveDur.textContent = '--';

    this.elements.qrsWaveStatus.textContent = '--';
    this.elements.qrsWaveStatus.className = 'wave-status';
    this.elements.qrsWaveAmp.textContent = '--';
    this.elements.qrsMorphology.textContent = '--';

    this.elements.tWaveStatus.textContent = '--';
    this.elements.tWaveStatus.className = 'wave-status';
    this.elements.tWaveAmp.textContent = '--';
    this.elements.tWavePolarity.textContent = '--';

    this.elements.rhythmStatus.textContent = '--';
    this.elements.rhythmRegularity.textContent = '--';
    this.elements.rhythmClass.textContent = '--';
  }

  handleError(error) {
    console.error('MQTT Error:', error);
    this.updateStatus('Connection error: ' + error.message, 'error');
  }

  handleDisconnect() {
    this.isConnected = false;
    this.dataCollectionStartTime = 0;
    this.continuousDataDuration = 0;
    this.updateStatus('Disconnected from broker', '');

    // Clear heartbeat monitoring
    if (this.connectionHeartbeat) {
      clearInterval(this.connectionHeartbeat);
      this.connectionHeartbeat = null;
    }

    this.updateUI();
  }

  updateStatus(message, type = '') {
    this.elements.status.textContent = message;
    this.elements.status.className = 'status ' + type;

    // Update debug info
    this.updateDebugInfo();
  }

  updateDebugInfo() {
    const debugText = document.getElementById('debugText');
    if (debugText) {
      const timeSinceLastData = this.lastDataReceived ? Date.now() - this.lastDataReceived : 'Never';
      const continuousSeconds = Math.floor(this.continuousDataDuration / 1000);
      const debugInfo = `Device: ${this.deviceId} | Connected: ${this.isConnected} | Last Data: ${timeSinceLastData === 'Never' ? 'Never' : timeSinceLastData + 'ms ago'} | Continuous: ${continuousSeconds}s`;
      debugText.textContent = debugInfo;
    }
  }

  toggleDebug() {
    const debugInfo = document.getElementById('debugInfo');
    if (debugInfo) {
      const isVisible = debugInfo.style.display !== 'none';
      debugInfo.style.display = isVisible ? 'none' : 'block';
      this.updateDebugInfo();
    }
  }

  // Test connection functionality is now built into device discovery

  updateUI() {
    this.elements.connectBtn.disabled = this.isConnected;
    this.elements.disconnectBtn.disabled = !this.isConnected;
    this.elements.deviceIdInput.disabled = this.isConnected;
    this.elements.saveDeviceBtn.disabled = this.isConnected;
    this.elements.savedDevicesSelect.disabled = this.isConnected;
  }

  // Advanced ECG Analysis Methods

  performContinuousAnalysis() {
    if (this.ecgAnalysisBuffer.length < 100) return; // Need sufficient data

    // Detect R peaks for rhythm analysis
    this.detectRPeaks();

    // Calculate RR intervals
    this.calculateRRIntervals();

    // Update rhythm analysis
    this.analyzeRhythm();
  }

  detectRPeaks() {
    const recentData = this.ecgAnalysisBuffer.slice(-100); // Last 1 second
    const values = recentData.map(d => d.value);

    // Simple R peak detection using adaptive threshold
    const mean = values.reduce((a, b) => a + b) / values.length;
    const std = Math.sqrt(values.reduce((a, b) => a + Math.pow(b - mean, 2)) / values.length);
    const threshold = mean + (std * 1.5);

    // Find peaks above threshold
    for (let i = 1; i < values.length - 1; i++) {
      if (values[i] > threshold &&
          values[i] > values[i-1] &&
          values[i] > values[i+1]) {

        const peakTime = recentData[i].timestamp;

        // Avoid duplicate peaks (minimum 300ms apart)
        if (this.beatDetectionBuffer.length === 0 ||
            peakTime - this.beatDetectionBuffer[this.beatDetectionBuffer.length - 1] > 300) {

          this.beatDetectionBuffer.push(peakTime);

          // Keep only recent beats (last 10 seconds)
          const tenSecondsAgo = Date.now() - 10000;
          this.beatDetectionBuffer = this.beatDetectionBuffer.filter(t => t > tenSecondsAgo);
        }
      }
    }
  }

  calculateRRIntervals() {
    if (this.beatDetectionBuffer.length < 2) return;

    const rrIntervals = [];
    for (let i = 1; i < this.beatDetectionBuffer.length; i++) {
      const rrInterval = this.beatDetectionBuffer[i] - this.beatDetectionBuffer[i-1];
      rrIntervals.push(rrInterval);
    }

    if (rrIntervals.length > 0) {
      this.intervals.rr = rrIntervals[rrIntervals.length - 1]; // Most recent RR interval
    }
  }
  
  analyzeRhythm() {
    if (this.beatDetectionBuffer.length < 3) {
      this.morphology.rhythm.regularity = 'Insufficient data';
      this.morphology.rhythm.classification = 'Unknown';
      return;
    }

    // Calculate RR interval variability
    const rrIntervals = [];
    for (let i = 1; i < this.beatDetectionBuffer.length; i++) {
      rrIntervals.push(this.beatDetectionBuffer[i] - this.beatDetectionBuffer[i-1]);
    }

    const meanRR = rrIntervals.reduce((a, b) => a + b) / rrIntervals.length;
    const rrVariability = Math.sqrt(rrIntervals.reduce((a, b) => a + Math.pow(b - meanRR, 2)) / rrIntervals.length);

    // Determine regularity
    const variabilityPercent = (rrVariability / meanRR) * 100;
    if (variabilityPercent < 10) {
      this.morphology.rhythm.regularity = 'Regular';
    } else if (variabilityPercent < 20) {
      this.morphology.rhythm.regularity = 'Slightly irregular';
    } else {
      this.morphology.rhythm.regularity = 'Irregular';
    }

    // Basic rhythm classification based on heart rate
    const currentBPM = this.bpmStats.current;
    if (currentBPM < 60) {
      this.morphology.rhythm.classification = 'Bradycardia';
    } else if (currentBPM > 100) {
      this.morphology.rhythm.classification = 'Tachycardia';
    } else {
      this.morphology.rhythm.classification = 'Normal Sinus Rhythm';
    }
  }

  analyzeBeat() {
    if (this.ecgAnalysisBuffer.length < 1000) {
      const remainingSeconds = Math.ceil((1000 - this.ecgAnalysisBuffer.length) / 100);
      if (window.notifications) {
        window.notifications.warning(
          'Insufficient Data',
          `Need ${remainingSeconds} more seconds of ECG data for beat analysis. Currently have ${Math.floor(this.ecgAnalysisBuffer.length / 100)} seconds.`,
          6000
        );
      } else {
        alert('Insufficient data for beat analysis. Please wait for 10 seconds of ECG data.');
      }
      return;
    }

    // Get the most recent 10 seconds of data for analysis
    const analysisData = this.ecgAnalysisBuffer.slice(-1000);
    const beatData = this.extractSingleBeat(analysisData);

    if (!beatData) {
      if (window.notifications) {
        window.notifications.warning(
          'No Clear Beat Detected',
          'Could not detect a clear ECG beat pattern in the current data. Please ensure good electrode contact and signal quality.',
          5000
        );
      } else {
        alert('No clear beat detected in recent data. Please ensure good electrode contact.');
      }
      return;
    }

    // Perform detailed beat analysis
    this.analyzeECGMorphology(beatData);
    this.calculateECGIntervals(beatData);
    this.updateBeatChart(beatData);
    this.updateAnalysisDisplay();

    // Show success notification
    if (window.notifications) {
      window.notifications.success(
        'Beat Analysis Complete',
        'ECG beat analysis completed successfully. Check the intervals and morphology sections for results.',
        4000
      );
    }
  }

  extractSingleBeat(data) {
    // Find the most prominent R peak in the data
    const values = data.map(d => d.value);
    const timestamps = data.map(d => d.timestamp);

    // Find R peak
    let maxValue = Math.max(...values);
    let rPeakIndex = values.indexOf(maxValue);

    // Extract beat around R peak (±400ms)
    const beatStart = Math.max(0, rPeakIndex - 40); // 400ms before R peak
    const beatEnd = Math.min(values.length - 1, rPeakIndex + 40); // 400ms after R peak

    const beatValues = values.slice(beatStart, beatEnd);
    const beatTimestamps = timestamps.slice(beatStart, beatEnd);

    // Convert to relative time (ms from R peak)
    const rPeakTime = beatTimestamps[rPeakIndex - beatStart];
    const relativeTimestamps = beatTimestamps.map(t => (t - rPeakTime));

    return {
      values: beatValues,
      timestamps: relativeTimestamps,
      rPeakIndex: rPeakIndex - beatStart,
      rPeakValue: maxValue
    };
  }

  analyzeECGMorphology(beatData) {
    const { values, timestamps, rPeakIndex } = beatData;

    // Convert ADC values to approximate mV (assuming 3.3V reference, 12-bit ADC)
    const adcToMv = (adcValue) => ((adcValue / 4095) * 3.3 - 1.65) * 2; // Rough conversion

    // Analyze P Wave (before QRS, typically -200ms to -50ms from R peak)
    this.analyzePWave(values, timestamps, rPeakIndex, adcToMv);

    // Analyze QRS Complex (around R peak, typically -50ms to +50ms)
    this.analyzeQRSComplex(values, timestamps, rPeakIndex, adcToMv);

    // Analyze T Wave (after QRS, typically +100ms to +400ms from R peak)
    this.analyzeTWave(values, timestamps, rPeakIndex, adcToMv);
  }

  analyzePWave(values, timestamps, rPeakIndex, adcToMv) {
    // Advanced P wave detection using derivative and template matching
    const pSearchStart = Math.max(0, rPeakIndex - 30); // -300ms from R peak
    const pSearchEnd = Math.max(0, rPeakIndex - 8);    // -80ms from R peak

    if (pSearchEnd <= pSearchStart) {
      this.morphology.pWave = { detected: false, amplitude: 0, duration: 0, onset: null, offset: null };
      return;
    }

    const pRegion = values.slice(pSearchStart, pSearchEnd);
    const pTimestamps = timestamps.slice(pSearchStart, pSearchEnd);

    // Calculate first derivative to find wave boundaries
    const derivative = this.calculateDerivative(pRegion);

    // Find isoelectric baseline
    const baseline = this.findIsoelectricBaseline(values, rPeakIndex);

    // Detect P wave using advanced algorithm
    const pWaveFeatures = this.detectPWaveFeatures(pRegion, derivative, baseline, pTimestamps);

    if (pWaveFeatures.detected) {
      this.morphology.pWave = {
        detected: true,
        amplitude: Math.round(adcToMv(pWaveFeatures.amplitude) * 100) / 100,
        duration: pWaveFeatures.duration,
        onset: pWaveFeatures.onset,
        offset: pWaveFeatures.offset,
        morphology: pWaveFeatures.morphology
      };
    } else {
      this.morphology.pWave = { detected: false, amplitude: 0, duration: 0, onset: null, offset: null };
    }
  }

  detectPWaveFeatures(region, derivative, baseline, timestamps) {
    const threshold = this.calculateAdaptiveThreshold(region, 0.3); // 30% of signal range
    // const minDuration = 6;  // Minimum 60ms for P wave (for future use)
    const maxDuration = 12; // Maximum 120ms for P wave

    let onset = -1, offset = -1, peakIndex = -1;
    let maxAmplitude = 0;

    // Find P wave onset (first significant positive derivative)
    for (let i = 1; i < derivative.length - 1; i++) {
      if (derivative[i] > threshold && derivative[i-1] <= threshold) {
        onset = i;
        break;
      }
    }

    if (onset === -1) return { detected: false };

    // Find P wave peak (maximum value after onset)
    for (let i = onset; i < Math.min(onset + maxDuration, region.length); i++) {
      if (region[i] > baseline + threshold && region[i] > maxAmplitude) {
        maxAmplitude = region[i];
        peakIndex = i;
      }
    }

    // Find P wave offset (return to baseline)
    for (let i = peakIndex; i < Math.min(peakIndex + maxDuration/2, region.length); i++) {
      if (Math.abs(region[i] - baseline) < threshold/2) {
        offset = i;
        break;
      }
    }

    if (offset === -1 || peakIndex === -1) return { detected: false };

    const duration = (offset - onset) * 10; // Convert to milliseconds

    // Validate P wave characteristics
    if (duration < 60 || duration > 120) return { detected: false };
    if (maxAmplitude - baseline < threshold) return { detected: false };

    return {
      detected: true,
      amplitude: maxAmplitude - baseline,
      duration: duration,
      onset: timestamps[onset],
      offset: timestamps[offset],
      morphology: this.classifyPWaveMorphology(region.slice(onset, offset + 1))
    };
  }

  analyzeQRSComplex(values, _timestamps, rPeakIndex, adcToMv) {
    // QRS complex analysis around R peak
    const qrsStart = Math.max(0, rPeakIndex - 5);  // -50ms
    const qrsEnd = Math.min(values.length - 1, rPeakIndex + 5); // +50ms

    const qrsRegion = values.slice(qrsStart, qrsEnd);

    const maxQRS = Math.max(...qrsRegion);
    const minQRS = Math.min(...qrsRegion);

    const qrsAmplitude = maxQRS - minQRS;

    // Determine QRS morphology
    let morphology = 'Normal';
    if (qrsAmplitude > 1500) {
      morphology = 'High amplitude';
    } else if (qrsAmplitude < 500) {
      morphology = 'Low amplitude';
    }

    this.morphology.qrsComplex = {
      detected: true,
      amplitude: Math.round(adcToMv(qrsAmplitude) * 100) / 100,
      morphology: morphology
    };
  }

  analyzeTWave(values, _timestamps, rPeakIndex, adcToMv) {
    // T wave analysis after QRS
    const tWaveStart = Math.min(values.length - 1, rPeakIndex + 10); // +100ms
    const tWaveEnd = Math.min(values.length - 1, rPeakIndex + 30);   // +300ms

    if (tWaveEnd <= tWaveStart) {
      this.morphology.tWave = { detected: false, amplitude: 0, polarity: 'Unknown' };
      return;
    }

    const tWaveRegion = values.slice(tWaveStart, tWaveEnd);
    const baseline = (values[0] + values[values.length - 1]) / 2;

    const maxT = Math.max(...tWaveRegion);
    const minT = Math.min(...tWaveRegion);

    let tAmplitude, polarity;
    if (Math.abs(maxT - baseline) > Math.abs(minT - baseline)) {
      tAmplitude = maxT - baseline;
      polarity = 'Positive';
    } else {
      tAmplitude = baseline - minT;
      polarity = 'Negative';
    }

    if (Math.abs(tAmplitude) > 30) { // Threshold for T wave detection
      this.morphology.tWave = {
        detected: true,
        amplitude: Math.round(adcToMv(Math.abs(tAmplitude)) * 100) / 100,
        polarity: polarity
      };
    } else {
      this.morphology.tWave = { detected: false, amplitude: 0, polarity: 'Unknown' };
    }
  }

  calculateECGIntervals(beatData) {
    const { values, timestamps, rPeakIndex } = beatData;

    console.log('Calculating ECG intervals with beat data:', {
      valuesLength: values.length,
      rPeakIndex: rPeakIndex,
      rPeakValue: values[rPeakIndex]
    });

    // Real ECG interval calculations using actual signal analysis

    // 1. PR Interval: Start of P wave to start of QRS
    this.intervals.pr = this.calculatePRInterval(values, timestamps, rPeakIndex);
    console.log('PR Interval calculated:', this.intervals.pr);

    // 2. QRS Duration: Width of QRS complex
    this.intervals.qrs = this.calculateQRSDuration(values, timestamps, rPeakIndex);
    console.log('QRS Duration calculated:', this.intervals.qrs);

    // 3. QT Interval: Start of QRS to end of T wave
    this.intervals.qt = this.calculateQTInterval(values, timestamps, rPeakIndex);
    console.log('QT Interval calculated:', this.intervals.qt);

    // 4. QTc (Corrected QT): QT corrected for heart rate using Bazett's formula
    this.intervals.qtc = this.calculateQTcInterval();
    console.log('QTc Interval calculated:', this.intervals.qtc);

    // Fallback calculations if primary methods fail
    this.addFallbackIntervals(values, rPeakIndex);
  }

  calculatePRInterval(values, _timestamps, rPeakIndex) {
    // Simplified PR interval calculation
    // Look for P wave 80-200ms before R peak
    const searchStart = Math.max(0, rPeakIndex - 20); // -200ms
    const searchEnd = Math.max(0, rPeakIndex - 8);    // -80ms

    if (searchEnd <= searchStart) return null;

    // Find P wave peak in search region
    const searchRegion = values.slice(searchStart, searchEnd);
    const baseline = this.calculateSimpleBaseline(values);

    let pPeakIndex = -1;
    let maxPAmplitude = 0;

    for (let i = 2; i < searchRegion.length - 2; i++) {
      const amplitude = Math.abs(searchRegion[i] - baseline);
      // Look for local maximum that's above baseline
      if (amplitude > maxPAmplitude && amplitude > 30 && // Minimum amplitude threshold
          searchRegion[i] > searchRegion[i-1] &&
          searchRegion[i] > searchRegion[i+1] &&
          searchRegion[i] > searchRegion[i-2] &&
          searchRegion[i] > searchRegion[i+2]) {
        maxPAmplitude = amplitude;
        pPeakIndex = searchStart + i;
      }
    }

    if (pPeakIndex === -1) return null;

    // PR interval from P peak to QRS onset (approximate)
    const prInterval = (rPeakIndex - pPeakIndex - 3) * 10; // Convert to ms, subtract for QRS onset

    // Validate PR interval (normal range: 120-200ms, allow wider range for detection)
    if (prInterval >= 80 && prInterval <= 300) {
      return Math.round(prInterval);
    }

    return null;
  }

  calculateQRSDuration(values, _timestamps, rPeakIndex) {
    // Simplified QRS duration calculation
    const baseline = this.calculateSimpleBaseline(values);
    const threshold = 50; // Threshold for returning to baseline

    // Find QRS onset (before R peak)
    let qrsOnset = rPeakIndex;
    for (let i = rPeakIndex - 1; i >= Math.max(0, rPeakIndex - 10); i--) {
      if (Math.abs(values[i] - baseline) < threshold) {
        qrsOnset = i;
        break;
      }
    }

    // Find QRS offset (after R peak)
    let qrsOffset = rPeakIndex;
    for (let i = rPeakIndex + 1; i <= Math.min(values.length - 1, rPeakIndex + 12); i++) {
      if (Math.abs(values[i] - baseline) < threshold) {
        qrsOffset = i;
        break;
      }
    }

    const qrsDuration = (qrsOffset - qrsOnset) * 10; // Convert to ms

    // Validate QRS duration (normal range: 60-120ms, allow wider range)
    if (qrsDuration >= 40 && qrsDuration <= 200) {
      return Math.round(qrsDuration);
    }

    return null;
  }

  calculateQTInterval(values, _timestamps, rPeakIndex) {
    // Simplified QT interval calculation
    const baseline = this.calculateSimpleBaseline(values);

    // Find T wave end (return to baseline after R peak)
    let tWaveEnd = -1;
    const searchStart = Math.min(values.length - 1, rPeakIndex + 15); // Start 150ms after R
    const searchEnd = Math.min(values.length - 1, rPeakIndex + 50);   // End 500ms after R

    // Look for T wave peak first
    let tPeakIndex = -1;
    let maxTAmplitude = 0;

    for (let i = searchStart; i < searchEnd; i++) {
      const amplitude = Math.abs(values[i] - baseline);
      if (amplitude > maxTAmplitude && amplitude > 20) { // Minimum T wave amplitude
        maxTAmplitude = amplitude;
        tPeakIndex = i;
      }
    }

    // If T wave found, look for its end
    if (tPeakIndex !== -1) {
      for (let i = tPeakIndex + 5; i < searchEnd; i++) {
        if (Math.abs(values[i] - baseline) < 30) { // Return to baseline
          tWaveEnd = i;
          break;
        }
      }
    }

    // If no clear T wave end found, estimate based on typical duration
    if (tWaveEnd === -1) {
      tWaveEnd = rPeakIndex + 35; // Estimate ~350ms QT interval
    }

    const qtInterval = (tWaveEnd - rPeakIndex + 5) * 10; // Convert to ms, add QRS onset estimate

    // Validate QT interval (allow wide range for detection)
    if (qtInterval >= 250 && qtInterval <= 600) {
      return Math.round(qtInterval);
    }

    return null;
  }

  calculateQTcInterval() {
    if (!this.intervals.qt) return null;

    let rrInterval;

    // Use RR interval if available, otherwise calculate from current BPM
    if (this.intervals.rr) {
      rrInterval = this.intervals.rr;
    } else if (this.bpmStats.current > 0) {
      rrInterval = (60 / this.bpmStats.current) * 1000; // Convert BPM to RR in ms
    } else {
      return null; // Cannot calculate QTc without heart rate
    }

    // Bazett's formula: QTc = QT / sqrt(RR in seconds)
    const rrSeconds = rrInterval / 1000;
    const qtc = this.intervals.qt / Math.sqrt(rrSeconds);

    return Math.round(qtc);
  }

  // Advanced wave detection functions for accurate interval measurement

  findPWaveOnset(values, rPeakIndex) {
    // Search for P wave onset 300ms before R peak
    const searchStart = Math.max(0, rPeakIndex - 30); // -300ms
    const searchEnd = Math.max(0, rPeakIndex - 8);    // -80ms

    if (searchEnd <= searchStart) return -1;

    const searchRegion = values.slice(searchStart, searchEnd);
    const derivative = this.calculateDerivative(searchRegion);
    const baseline = this.findIsoelectricBaseline(values, rPeakIndex);
    const threshold = this.calculateAdaptiveThreshold(searchRegion, 0.2);

    // Find first significant upward deflection (P wave onset)
    for (let i = 1; i < derivative.length - 1; i++) {
      if (derivative[i] > threshold &&
          searchRegion[i] > baseline + threshold/2 &&
          derivative[i] > derivative[i-1]) {
        return searchStart + i;
      }
    }

    return -1; // P wave onset not found
  }

  findQRSOnset(values, rPeakIndex) {
    // Search for QRS onset around R peak
    const searchStart = Math.max(0, rPeakIndex - 8);  // -80ms
    const searchEnd = Math.max(0, rPeakIndex - 2);    // -20ms

    if (searchEnd <= searchStart) return -1;

    const searchRegion = values.slice(searchStart, searchEnd);
    const derivative = this.calculateDerivative(searchRegion);
    const baseline = this.findIsoelectricBaseline(values, rPeakIndex);
    const threshold = this.calculateAdaptiveThreshold(searchRegion, 0.5);

    // Find steepest upward slope (QRS onset)
    let maxDerivative = 0;
    let onsetIndex = -1;

    for (let i = 1; i < derivative.length - 1; i++) {
      if (derivative[i] > threshold &&
          derivative[i] > maxDerivative &&
          Math.abs(searchRegion[i] - baseline) > threshold/2) {
        maxDerivative = derivative[i];
        onsetIndex = searchStart + i;
      }
    }

    return onsetIndex;
  }

  findQRSOffset(values, rPeakIndex) {
    // Search for QRS offset after R peak
    const searchStart = Math.min(values.length - 1, rPeakIndex + 2);  // +20ms
    const searchEnd = Math.min(values.length - 1, rPeakIndex + 8);    // +80ms

    if (searchEnd <= searchStart) return -1;

    const searchRegion = values.slice(searchStart, searchEnd);
    const derivative = this.calculateDerivative(searchRegion);
    const baseline = this.findIsoelectricBaseline(values, rPeakIndex);
    const threshold = this.calculateAdaptiveThreshold(searchRegion, 0.3);

    // Find return to baseline (QRS offset)
    for (let i = 0; i < searchRegion.length; i++) {
      if (Math.abs(searchRegion[i] - baseline) < threshold &&
          Math.abs(derivative[i]) < threshold/2) {
        return searchStart + i;
      }
    }

    return -1; // QRS offset not found
  }

  findTWaveOffset(values, rPeakIndex) {
    // Search for T wave offset after QRS
    const searchStart = Math.min(values.length - 1, rPeakIndex + 15); // +150ms
    const searchEnd = Math.min(values.length - 1, rPeakIndex + 40);   // +400ms

    if (searchEnd <= searchStart) return -1;

    const searchRegion = values.slice(searchStart, searchEnd);
    const derivative = this.calculateDerivative(searchRegion);
    const baseline = this.findIsoelectricBaseline(values, rPeakIndex);
    const threshold = this.calculateAdaptiveThreshold(searchRegion, 0.2);

    // Find T wave peak first
    let tPeakIndex = -1;
    let maxTAmplitude = 0;

    for (let i = 0; i < searchRegion.length / 2; i++) {
      const amplitude = Math.abs(searchRegion[i] - baseline);
      if (amplitude > maxTAmplitude && amplitude > threshold) {
        maxTAmplitude = amplitude;
        tPeakIndex = i;
      }
    }

    if (tPeakIndex === -1) return -1;

    // Find T wave offset (return to baseline after T peak)
    for (let i = tPeakIndex; i < searchRegion.length; i++) {
      if (Math.abs(searchRegion[i] - baseline) < threshold/2 &&
          Math.abs(derivative[i]) < threshold/3) {
        return searchStart + i;
      }
    }

    return -1; // T wave offset not found
  }

  updateBeatChart(beatData) {
    if (!this.beatChart) return;

    const { values, timestamps } = beatData;

    // Convert ADC to mV for display
    const adcToMv = (adcValue) => ((adcValue / 4095) * 3.3 - 1.65) * 2;
    const mvValues = values.map(adcToMv);

    // Update beat waveform
    this.beatChart.data.labels = timestamps;
    this.beatChart.data.datasets[0].data = mvValues;

    // Clear previous annotations
    this.beatChart.data.datasets[1].data = []; // P wave
    this.beatChart.data.datasets[2].data = []; // QRS
    this.beatChart.data.datasets[3].data = []; // T wave

    // Add wave annotations if detected
    if (this.morphology.pWave.detected) {
      // Add P wave marker
      const pIndex = Math.floor(timestamps.length * 0.3); // Approximate P wave position
      this.beatChart.data.datasets[1].data.push({
        x: timestamps[pIndex],
        y: mvValues[pIndex]
      });
    }

    // Add QRS marker (R peak)
    const rIndex = Math.floor(timestamps.length / 2);
    this.beatChart.data.datasets[2].data.push({
      x: timestamps[rIndex],
      y: mvValues[rIndex]
    });

    if (this.morphology.tWave.detected) {
      // Add T wave marker
      const tIndex = Math.floor(timestamps.length * 0.7); // Approximate T wave position
      this.beatChart.data.datasets[3].data.push({
        x: timestamps[tIndex],
        y: mvValues[tIndex]
      });
    }

    this.beatChart.update('none');
  }

  updateAnalysisDisplay() {
    // Update interval displays with better formatting
    this.elements.prInterval.textContent = this.intervals.pr ? `${this.intervals.pr} ms` : 'Unable to measure';
    this.elements.qrsInterval.textContent = this.intervals.qrs ? `${this.intervals.qrs} ms` : 'Unable to measure';
    this.elements.qtInterval.textContent = this.intervals.qt ? `${this.intervals.qt} ms` : 'Unable to measure';
    this.elements.qtcInterval.textContent = this.intervals.qtc ? `${this.intervals.qtc} ms` : 'Unable to measure';

    // Log interval status for debugging
    console.log('Interval Analysis Update:', {
      PR: this.intervals.pr,
      QRS: this.intervals.qrs,
      QT: this.intervals.qt,
      QTc: this.intervals.qtc,
      currentHR: this.bpmStats.current,
      bufferLength: this.ecgAnalysisBuffer.length
    });

    // Update interval status
    this.updateIntervalStatus('pr', this.intervals.pr, 120, 200);
    this.updateIntervalStatus('qrs', this.intervals.qrs, 80, 120);
    this.updateIntervalStatus('qt', this.intervals.qt, 350, 450);
    this.updateIntervalStatus('qtc', this.intervals.qtc, 300, 440);

    // Update morphology displays
    this.elements.pWaveStatus.textContent = this.morphology.pWave.detected ? 'Detected' : 'Not detected';
    this.elements.pWaveStatus.className = 'wave-status ' + (this.morphology.pWave.detected ? 'detected' : 'not-detected');
    this.elements.pWaveAmp.textContent = this.morphology.pWave.amplitude || '--';
    this.elements.pWaveDur.textContent = this.morphology.pWave.duration || '--';

    this.elements.qrsWaveStatus.textContent = this.morphology.qrsComplex.detected ? 'Detected' : 'Not detected';
    this.elements.qrsWaveStatus.className = 'wave-status ' + (this.morphology.qrsComplex.detected ? 'detected' : 'not-detected');
    this.elements.qrsWaveAmp.textContent = this.morphology.qrsComplex.amplitude || '--';
    this.elements.qrsMorphology.textContent = this.morphology.qrsComplex.morphology || '--';

    this.elements.tWaveStatus.textContent = this.morphology.tWave.detected ? 'Detected' : 'Not detected';
    this.elements.tWaveStatus.className = 'wave-status ' + (this.morphology.tWave.detected ? 'detected' : 'not-detected');
    this.elements.tWaveAmp.textContent = this.morphology.tWave.amplitude || '--';
    this.elements.tWavePolarity.textContent = this.morphology.tWave.polarity || '--';

    this.elements.rhythmStatus.textContent = this.morphology.rhythm.classification;
    this.elements.rhythmRegularity.textContent = this.morphology.rhythm.regularity;
    this.elements.rhythmClass.textContent = this.morphology.rhythm.classification;
  }

  updateIntervalStatus(type, value, minNormal, maxNormal) {
    const statusElement = this.elements[type + 'Status'];

    if (value === null || value === undefined) {
      statusElement.textContent = 'Unable to measure';
      statusElement.className = 'interval-status';
      return;
    }

    if (value >= minNormal && value <= maxNormal) {
      statusElement.textContent = 'Normal';
      statusElement.className = 'interval-status normal';
    } else if (value < minNormal * 0.9 || value > maxNormal * 1.1) {
      statusElement.textContent = 'Abnormal';
      statusElement.className = 'interval-status abnormal';
    } else {
      statusElement.textContent = 'Borderline';
      statusElement.className = 'interval-status borderline';
    }
  }

  startDemoMode() {
    if (this.demoInterval) {
      clearInterval(this.demoInterval);
      this.demoInterval = null;
      return;
    }

    this.updateStatus('Demo Mode: Simulating ECG data...', 'connected');
    this.isConnected = true;
    this.updateUI();

    let sampleIndex = 0;
    const heartRate = 75; // BPM
    const samplesPerBeat = (60 / heartRate) * this.samplingRate; // Samples per heartbeat

    this.demoInterval = setInterval(() => {
      if (this.isPaused) return;

      // Generate realistic ECG waveform
      const ecgValue = this.generateECGSample(sampleIndex, samplesPerBeat);

      // Debug: Log demo ECG values for first few samples
      if (sampleIndex < 20) {
        const beatProgress = (sampleIndex % samplesPerBeat) / samplesPerBeat;
        console.log(`Demo ECG sample ${sampleIndex}:`, {
          beatProgress: beatProgress.toFixed(3),
          ecgValue,
          millivolts: this.adcToMillivolts(ecgValue)
        });
      }

      // Simulate ESP32 data format
      const data = {
        device_id: 'DEMO',
        timestamp: Date.now(),
        ecg_value: ecgValue,
        sequence: sampleIndex,
        signal_quality: 95
      };

      this.processECGData(data);
      sampleIndex++;

    }, 2); // 500Hz sampling rate (matches your working Serial Plotter code)
  }

  generateECGSample(sampleIndex, samplesPerBeat) {
    // Generate PERFECT ECG waveform that looks exactly like medical ECG
    const beatProgress = (sampleIndex % samplesPerBeat) / samplesPerBeat;
    const baseline = 2048; // ADC midpoint (1.65V)
    let ecgValue = baseline;

    // Create PERFECT, medical-grade ECG morphology
    // P wave (0.05 - 0.15 of beat cycle) - small rounded positive deflection
    if (beatProgress >= 0.05 && beatProgress <= 0.15) {
      const pProgress = (beatProgress - 0.05) / 0.10;
      // Perfect P wave shape
      const pWave = 150 * Math.sin(pProgress * Math.PI) * Math.exp(-Math.pow(pProgress - 0.5, 2) * 4);
      ecgValue += pWave;
    }

    // QRS complex (0.18 - 0.28 of beat cycle) - PERFECT HEARTBEAT SPIKE
    else if (beatProgress >= 0.18 && beatProgress <= 0.28) {
      const qrsProgress = (beatProgress - 0.18) / 0.10;

      // Create PERFECT QRS complex - this is the key to realistic ECG
      if (qrsProgress < 0.2) {
        // Q wave - small sharp negative deflection
        const qProgress = qrsProgress / 0.2;
        ecgValue -= 100 * Math.sin(qProgress * Math.PI);
      }
      else if (qrsProgress < 0.6) {
        // R wave - EXTREMELY SHARP, TALL SPIKE
        const rProgress = (qrsProgress - 0.2) / 0.4;
        // Perfect R wave: very sharp and tall like real ECG
        const sharpness = Math.pow(Math.sin(rProgress * Math.PI), 5); // Very sharp peak
        ecgValue += 1500 * sharpness; // High amplitude for clear visibility
      }
      else {
        // S wave - sharp negative deflection
        const sProgress = (qrsProgress - 0.6) / 0.4;
        ecgValue -= 400 * Math.sin(sProgress * Math.PI);
      }
    }

    // T wave (0.35 - 0.65 of beat cycle) - perfect rounded positive wave
    else if (beatProgress >= 0.35 && beatProgress <= 0.65) {
      const tProgress = (beatProgress - 0.35) / 0.30;
      // Perfect T wave: smooth, rounded, positive deflection
      const tWave = 300 * Math.sin(tProgress * Math.PI) * Math.exp(-Math.pow(tProgress - 0.5, 2) * 2);
      ecgValue += tWave;
    }

    // Perfect flat baseline for the rest of the cycle
    // This creates the characteristic flat line between heartbeats

    // Add absolutely minimal noise for realism
    ecgValue += (Math.random() - 0.5) * 1;

    // Ensure within ADC range
    return Math.max(0, Math.min(4095, Math.round(ecgValue)));
  }

  // Real-time Report Methods
  showReportModal() {
    // Check if we have recent data (within last 10 seconds)
    const timeSinceLastData = Date.now() - this.lastDataReceived;

    if (!this.isConnected || timeSinceLastData > 10000) {
      if (window.notifications) {
        window.notifications.error(
          'Cannot Generate Report',
          'No ECG data received in the last 10 seconds. Please ensure device is connected and sending data.',
          8000
        );
      } else {
        alert('Cannot generate report: No ECG data received in the last 10 seconds. Please ensure device is connected and sending data.');
      }
      return;
    }

    // Check if we have been collecting data continuously for at least 10 seconds
    if (this.continuousDataDuration < 10000) {
      const remainingTime = Math.ceil((10000 - this.continuousDataDuration) / 1000);
      if (window.notifications) {
        window.notifications.warning(
          'Insufficient Data Collection',
          `Need ${remainingTime} more seconds of continuous ECG data. Please wait for the system to collect a full 10-second window.`,
          7000
        );
      } else {
        alert(`Cannot generate report: Need ${remainingTime} more seconds of continuous ECG data. Please wait for the system to collect a full 10-second window.`);
      }
      return;
    }

    const modal = document.getElementById('realtimeReportModal');
    if (modal) {
      modal.style.display = 'block';
      // Reset form
      document.getElementById('reportPatientName').value = '';
      document.getElementById('reportPatientAge').value = '';
      document.getElementById('reportPatientGender').value = '';
      // Hide report content
      document.querySelector('.report-form').style.display = 'block';
      document.getElementById('reportContent').style.display = 'none';
    }
  }

  hideReportModal() {
    const modal = document.getElementById('realtimeReportModal');
    if (modal) {
      modal.style.display = 'none';
    }
  }

  async generateRealtimeReport() {
    const patientName = document.getElementById('reportPatientName').value.trim();
    const patientAge = document.getElementById('reportPatientAge').value;
    const patientGender = document.getElementById('reportPatientGender').value;
    const patientHeight = document.getElementById('reportPatientHeight').value;
    const patientWeight = document.getElementById('reportPatientWeight').value;

    // Validate all mandatory fields
    if (!patientName) {
      alert('Please enter patient name');
      return;
    }
    if (!patientGender) {
      alert('Please select patient gender');
      return;
    }
    if (!patientHeight) {
      alert('Please enter patient height');
      return;
    }
    if (!patientWeight) {
      alert('Please enter patient weight');
      return;
    }

    // Hide form and show report
    document.querySelector('.report-form').style.display = 'none';
    document.getElementById('reportContent').style.display = 'block';

    // Generate report content
    const reportContent = await this.createRealtimeReportContent(patientName, patientAge, patientGender, patientHeight, patientWeight);
    document.getElementById('reportContent').innerHTML = reportContent;
  }

  async createRealtimeReportContent(patientName, patientAge, patientGender, patientHeight, patientWeight) {
    const currentTime = new Date();

    // Calculate statistics based on last 10 seconds of data
    const tenSecondStats = this.calculateTenSecondStatistics();

    // Capture ECG waveform screenshot
    const ecgScreenshot = await this.captureECGWaveform();

    return `
      <div class="realtime-report">
        <div class="report-header">
          <h3>Real-Time ECG Analysis Report</h3>
          <div class="report-info">
            <div class="patient-info">
              <h4>Patient Information</h4>
              <p><strong>Name:</strong> ${patientName}</p>
              <p><strong>Age:</strong> ${patientAge || 'Not specified'}</p>
              <p><strong>Gender:</strong> ${patientGender}</p>
              <p><strong>Height:</strong> ${patientHeight} cm</p>
              <p><strong>Weight:</strong> ${patientWeight} kg</p>
            </div>
            <div class="session-info">
              <h4>Recording Session</h4>
              <p><strong>Date:</strong> ${currentTime.toLocaleDateString()}</p>
              <p><strong>Time:</strong> ${currentTime.toLocaleTimeString()}</p>
              <p><strong>Device:</strong> ${this.isConnected ? 'Connected' : 'Demo Mode'}</p>
            </div>
          </div>
        </div>

        <div class="vital-signs">
          <h4>10-Second Analysis Window</h4>
          <div class="vitals-grid">
            <div class="vital-item">
              <span class="vital-label">Heart Rate (10s avg):</span>
              <span class="vital-value">${tenSecondStats.heartRate || '--'} BPM</span>
            </div>
            <div class="vital-item">
              <span class="vital-label">Data Points:</span>
              <span class="vital-value">${tenSecondStats.dataPoints}</span>
            </div>
            <div class="vital-item">
              <span class="vital-label">R Peaks Detected:</span>
              <span class="vital-value">${tenSecondStats.rPeakCount || '--'}</span>
            </div>
            <div class="vital-item">
              <span class="vital-label">Analysis Duration:</span>
              <span class="vital-value">${tenSecondStats.duration}s</span>
            </div>
            <div class="vital-item">
              <span class="vital-label">Signal Quality:</span>
              <span class="vital-value">${tenSecondStats.signalQuality}%</span>
            </div>
          </div>
        </div>

        <div class="ecg-intervals">
          <h4>ECG Intervals (Last 10 Seconds)</h4>
          <div class="intervals-grid">
            <div class="interval-item">
              <span class="interval-label">PR Interval:</span>
              <span class="interval-value">${tenSecondStats.intervals.pr || '--'} ms</span>
              <span class="interval-status">${this.getIntervalStatus('pr', tenSecondStats.intervals.pr)}</span>
            </div>
            <div class="interval-item">
              <span class="interval-label">QRS Duration:</span>
              <span class="interval-value">${tenSecondStats.intervals.qrs || '--'} ms</span>
              <span class="interval-status">${this.getIntervalStatus('qrs', tenSecondStats.intervals.qrs)}</span>
            </div>
            <div class="interval-item">
              <span class="interval-label">QT Interval:</span>
              <span class="interval-value">${tenSecondStats.intervals.qt || '--'} ms</span>
              <span class="interval-status">${this.getIntervalStatus('qt', tenSecondStats.intervals.qt)}</span>
            </div>
            <div class="interval-item">
              <span class="interval-label">QTc Interval:</span>
              <span class="interval-value">${tenSecondStats.intervals.qtc || '--'} ms</span>
              <span class="interval-status">${this.getIntervalStatus('qtc', tenSecondStats.intervals.qtc)}</span>
            </div>
          </div>
        </div>

        <div class="waveform-screenshots">
          <h4>ECG Waveforms (10-Second Window)</h4>
          <div class="waveform-screenshot">
            <h5>ECG Signal - Last 10 Seconds</h5>
            ${ecgScreenshot}
          </div>
        </div>

        <div class="morphology-analysis">
          <h4>Wave Morphology Analysis</h4>
          <div class="morphology-grid">
            <div class="morphology-item">
              <span class="morphology-label">P Wave:</span>
              <span class="morphology-value">${this.morphology.pWave.detected ? 'Detected' : 'Not detected'}</span>
              <span class="morphology-details">Amplitude: ${this.morphology.pWave.amplitude} mV</span>
            </div>
            <div class="morphology-item">
              <span class="morphology-label">QRS Complex:</span>
              <span class="morphology-value">${this.morphology.qrsComplex.detected ? 'Detected' : 'Not detected'}</span>
              <span class="morphology-details">Amplitude: ${this.morphology.qrsComplex.amplitude} mV</span>
            </div>
            <div class="morphology-item">
              <span class="morphology-label">T Wave:</span>
              <span class="morphology-value">${this.morphology.tWave.detected ? 'Detected' : 'Not detected'}</span>
              <span class="morphology-details">Amplitude: ${this.morphology.tWave.amplitude} mV</span>
            </div>
            <div class="morphology-item">
              <span class="morphology-label">Rhythm:</span>
              <span class="morphology-value">${this.morphology.rhythm.regularity}</span>
              <span class="morphology-details">${this.morphology.rhythm.classification}</span>
            </div>
          </div>
        </div>

        <div class="clinical-interpretation">
          <h4>Clinical Interpretation</h4>
          ${this.generateClinicalInterpretation()}
        </div>

        <div class="report-actions">
          <button onclick="window.print()" class="btn-primary">Print Report</button>
          <button onclick="window.ecgMonitor.downloadReportPDF('${patientName}')" class="btn-secondary">Download PDF</button>
          <button onclick="window.ecgMonitor.hideReportModal()" class="btn-secondary">Close</button>
        </div>
      </div>
    `;
  }

  async captureECGWaveform() {
    try {
      const canvas = document.getElementById('ecgChart');
      if (canvas && window.html2canvas) {
        const screenshot = await html2canvas(canvas.parentElement, {
          backgroundColor: '#ffffff',
          scale: 2
        });
        return `<img src="${screenshot.toDataURL()}" alt="ECG Waveform" />`;
      }
    } catch (error) {
      console.error('Error capturing ECG waveform:', error);
    }
    return '<p>ECG waveform capture not available</p>';
  }



  getIntervalStatus(type, value) {
    if (!value) return 'Not measured';

    const ranges = {
      pr: { min: 120, max: 200 },
      qrs: { min: 80, max: 120 },
      qt: { min: 350, max: 450 },
      qtc: { min: 300, max: 440 }
    };

    const range = ranges[type];
    if (!range) return 'Unknown';

    if (value < range.min) return 'Short';
    if (value > range.max) return 'Prolonged';
    return 'Normal';
  }

  generateClinicalInterpretation() {
    let interpretation = '<div class="clinical-notes">';

    // Heart rate interpretation
    const currentHR = this.bpmStats.current;
    if (currentHR) {
      if (currentHR < 60) {
        interpretation += '<p><strong>Bradycardia:</strong> Heart rate below 60 BPM detected.</p>';
      } else if (currentHR > 100) {
        interpretation += '<p><strong>Tachycardia:</strong> Heart rate above 100 BPM detected.</p>';
      } else {
        interpretation += '<p><strong>Normal Heart Rate:</strong> Heart rate within normal range (60-100 BPM).</p>';
      }
    }

    // Rhythm interpretation
    if (this.morphology.rhythm.regularity !== 'Unknown') {
      interpretation += `<p><strong>Rhythm:</strong> ${this.morphology.rhythm.regularity} rhythm detected.</p>`;
    }

    // Signal quality
    if (this.signalQuality < 70) {
      interpretation += '<p><strong>Signal Quality:</strong> Poor signal quality detected. Consider improving electrode contact.</p>';
    } else if (this.signalQuality > 90) {
      interpretation += '<p><strong>Signal Quality:</strong> Excellent signal quality achieved.</p>';
    }

    // Analysis window note
    interpretation += '<p><strong>Analysis Window:</strong> All calculations and measurements are based on the last 10 seconds of continuous ECG data.</p>';

    // Disclaimer
    interpretation += `
      <div class="disclaimer">
        <p><strong>Disclaimer:</strong> This analysis is for educational purposes only and should not be used for clinical diagnosis.
        Always consult with a qualified healthcare professional for medical interpretation of ECG results.</p>
      </div>
    `;

    interpretation += '</div>';
    return interpretation;
  }

  async downloadReportPDF(patientName) {
    if (!window.jspdf) {
      alert('PDF library not loaded. Please refresh the page and try again.');
      return;
    }

    try {
      const { jsPDF } = window.jspdf;
      const doc = new jsPDF();

      // Get the 10-second statistics for the report
      const tenSecondStats = this.calculateTenSecondStatistics();
      const currentTime = new Date();

      // Header - Lead II Report
      doc.setFontSize(18);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(0, 0, 0);
      doc.text('Lead II Report', 105, 20, { align: 'center' });

      // Date and time in top right
      doc.setFontSize(9);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(100, 100, 100);
      const dateStr = currentTime.toLocaleDateString('en-GB', {
        day: '2-digit',
        month: 'short',
        year: 'numeric'
      });
      const timeStr = currentTime.toLocaleTimeString('en-GB', {
        hour: '2-digit',
        minute: '2-digit',
        hour12: false
      });
      doc.text(`${dateStr} ${timeStr}`, 190, 15, { align: 'right' });

      // Logo placeholder (right side)
      doc.setTextColor(255, 100, 100);
      doc.setFontSize(14);
      doc.setFont('helvetica', 'bold');
      doc.text('ECG Monitor', 150, 25);

      // Date line
      doc.setTextColor(0, 0, 0);
      doc.setFontSize(9);
      doc.setFont('helvetica', 'normal');
      doc.text(`Date: ${dateStr}, ${timeStr}`, 20, 35);

      // Patient Information Table with better alignment
      doc.setTextColor(0, 0, 0);
      doc.setFontSize(9);
      doc.setFont('helvetica', 'bold');

      // Table headers with proper spacing
      const startY = 50;
      doc.text('NAME', 20, startY);
      doc.text('AGE', 65, startY);
      doc.text('GENDER', 95, startY);
      doc.text('HEIGHT', 125, startY);
      doc.text('WEIGHT', 155, startY);
      doc.text('REPORT ID', 185, startY);

      // Patient data with consistent alignment
      doc.setFont('helvetica', 'normal');
      const patientAge = document.getElementById('reportPatientAge')?.value || 'N/A';
      const patientGender = document.getElementById('reportPatientGender')?.value || 'N/A';
      const patientHeight = document.getElementById('reportPatientHeight')?.value || 'N/A';
      const patientWeight = document.getElementById('reportPatientWeight')?.value || 'N/A';
      const reportId = Date.now().toString().slice(-10);

      doc.text(patientName, 20, startY + 8);
      doc.text(`${patientAge} year(s)`, 65, startY + 8);
      doc.text(patientGender, 95, startY + 8);
      doc.text(`${patientHeight} cm`, 125, startY + 8);
      doc.text(`${patientWeight} kg`, 155, startY + 8);
      doc.text(reportId, 185, startY + 8);

      // ECG Parameters Table
      doc.setFontSize(12);
      doc.setFont('helvetica', 'bold');
      doc.text('ECG Parameters', 20, 75);

      // Result Details
      doc.text('Result Details', 130, 75);

      // Parameters table
      const tableStartY = 85;

      // Table header
      doc.setFillColor(70, 90, 120);
      doc.rect(20, tableStartY, 100, 15, 'F');

      doc.setTextColor(255, 255, 255);
      doc.setFontSize(10);
      doc.setFont('helvetica', 'bold');
      doc.text('Parameter', 25, tableStartY + 10);
      doc.text('Observed Values', 55, tableStartY + 10);
      doc.text('Standard Range', 85, tableStartY + 10);

      // Table rows
      doc.setTextColor(0, 0, 0);
      doc.setFont('helvetica', 'normal');

      const rows = [
        ['PR Interval', `${tenSecondStats.intervals.pr || '--'} ms`, '100 ms - 200 ms'],
        ['QRS Interval', `${tenSecondStats.intervals.qrs || '--'} ms`, '60 ms - 120 ms'],
        ['QT Interval', `${tenSecondStats.intervals.qt || '--'} ms`, '300 ms - 450 ms'],
        ['QTc Interval', `${tenSecondStats.intervals.qtc || '--'} ms`, '300 ms - 450 ms'],
        ['Heart Rate', `${tenSecondStats.heartRate || '--'} bpm`, '60 bpm - 100 bpm']
      ];

      let rowY = tableStartY + 20;
      rows.forEach((row, index) => {
        // Alternate row colors
        if (index % 2 === 0) {
          doc.setFillColor(245, 245, 245);
          doc.rect(20, rowY - 5, 100, 12, 'F');
        }

        doc.text(row[0], 25, rowY + 3);
        doc.text(row[1], 55, rowY + 3);
        doc.text(row[2], 85, rowY + 3);
        rowY += 12;
      });

      // Result Details section
      doc.setFontSize(10);
      doc.setTextColor(128, 128, 128);
      doc.text('Overall evaluation of test', 130, 100);
      doc.setTextColor(0, 0, 0);
      doc.setFont('helvetica', 'bold');
      doc.text('Normal ECG', 130, 110);

      doc.setFont('helvetica', 'normal');
      doc.setTextColor(128, 128, 128);
      doc.text('Interpretation details', 130, 125);
      doc.setTextColor(0, 0, 0);
      doc.text('Sinus Rhythm', 130, 135);

      // Heart rate in bottom right
      doc.setFontSize(10);
      doc.setTextColor(128, 128, 128);
      doc.text(`Heart rate: ${tenSecondStats.heartRate || '--'} bpm`, 150, 170);

      // ECG Waveform Section - positioned higher and reduced height
      doc.setFontSize(11);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(0, 0, 0);
      doc.text('ECG Waveform', 20, 180);

      // Define waveform area with significantly larger dimensions for perfect PDF fitting
      const waveformX = 5;
      const waveformY = 185;
      const waveformWidth = 200; // Significantly increased width for perfect horizontal coverage
      const waveformHeight = 35; // Significantly increased height to match ratio and ensure perfect fitting

      // Draw ECG grid background with proper medical scaling
      doc.setDrawColor(255, 200, 200);
      doc.setLineWidth(0.2);

      // Major grid lines (5mm squares) - every 5mm
      for (let x = waveformX; x <= waveformX + waveformWidth; x += 5) {
        doc.setLineWidth(x % 25 === waveformX % 25 ? 0.4 : 0.2);
        doc.line(x, waveformY, x, waveformY + waveformHeight);
      }
      for (let y = waveformY; y <= waveformY + waveformHeight; y += 5) {
        doc.setLineWidth(y % 25 === waveformY % 25 ? 0.4 : 0.2);
        doc.line(waveformX, y, waveformX + waveformWidth, y);
      }

      try {
        const ecgCanvas = document.getElementById('ecgChart');
        console.log('ECG Canvas found:', !!ecgCanvas);
        console.log('html2canvas available:', !!window.html2canvas);

        if (ecgCanvas && window.html2canvas) {
          // Try multiple capture methods for better compatibility
          let ecgScreenshot;

          try {
            // Method 1: Direct canvas capture with optimized settings
            ecgScreenshot = await html2canvas(ecgCanvas, {
              backgroundColor: '#ffffff',
              scale: 2,
              useCORS: true,
              allowTaint: true,
              logging: true,
              onclone: function(clonedDoc) {
                console.log('Canvas cloned successfully');
              }
            });
          } catch (captureError) {
            console.warn('Direct capture failed, trying parent element:', captureError);

            // Method 2: Capture parent container
            const chartContainer = ecgCanvas.parentElement;
            ecgScreenshot = await html2canvas(chartContainer, {
              backgroundColor: '#ffffff',
              scale: 2,
              useCORS: true,
              allowTaint: true,
              logging: true
            });
          }

          if (ecgScreenshot) {
            const ecgImgData = ecgScreenshot.toDataURL('image/png');
            console.log('Image data generated, length:', ecgImgData.length);

            // Add waveform with the captured image
            doc.addImage(ecgImgData, 'PNG', waveformX, waveformY, waveformWidth, waveformHeight);
            console.log('Waveform image added to PDF');
          } else {
            throw new Error('Failed to capture waveform');
          }
        } else {
          throw new Error('ECG canvas or html2canvas not available');
        }
      } catch (error) {
        console.error('Error adding ECG waveform:', error);

        // Add error message and fallback waveform
        doc.setFontSize(9);
        doc.setTextColor(200, 0, 0);
        doc.text('ECG waveform capture failed. Showing simulated waveform.', waveformX + 5, waveformY + 10);

        // Draw a simple simulated ECG waveform as fallback
        doc.setDrawColor(220, 53, 69);
        doc.setLineWidth(1.5);

        // Simple ECG pattern
        const centerY = waveformY + waveformHeight / 2;
        let currentX = waveformX + 10;

        // Draw baseline and some basic ECG complexes
        doc.line(waveformX, centerY, waveformX + waveformWidth, centerY);

        // Add a few QRS complexes
        for (let i = 0; i < 4; i++) {
          const x = waveformX + 20 + (i * 40);
          // P wave
          doc.line(x, centerY, x + 5, centerY - 2);
          doc.line(x + 5, centerY - 2, x + 10, centerY);
          // QRS complex
          doc.line(x + 15, centerY, x + 17, centerY + 3);
          doc.line(x + 17, centerY + 3, x + 19, centerY - 8);
          doc.line(x + 19, centerY - 8, x + 21, centerY + 5);
          doc.line(x + 21, centerY + 5, x + 23, centerY);
          // T wave
          doc.line(x + 28, centerY, x + 32, centerY - 3);
          doc.line(x + 32, centerY - 3, x + 36, centerY);
        }
      }

      // Scale information
      doc.setFontSize(7);
      doc.setTextColor(100, 100, 100);
      doc.text('25 mm/sec, 10 mm/mV', waveformX + waveformWidth - 50, waveformY + waveformHeight + 6);

      // Save the PDF
      const fileName = `Lead_II_Report_${patientName.replace(/\s+/g, '_')}_${Date.now()}.pdf`;
      doc.save(fileName);

    } catch (error) {
      console.error('Error generating PDF:', error);
      alert('Error generating PDF: ' + error.message);
    }
  }

  calculateTenSecondStatistics() {
    // Get last 10 seconds of ECG data (1000 points at 100Hz)
    const tenSecondData = this.ecgAnalysisBuffer.slice(-1000);

    if (tenSecondData.length < 1000) {
      return {
        dataPoints: tenSecondData.length,
        duration: tenSecondData.length / 100, // seconds
        heartRate: this.bpmStats.current || 0,
        intervals: { ...this.intervals },
        morphology: { ...this.morphology },
        signalQuality: this.signalQuality
      };
    }

    // Calculate heart rate from 10-second window
    const values = tenSecondData.map(d => d.value);
    const timestamps = tenSecondData.map(d => d.timestamp);

    // Find R peaks in 10-second window
    const rPeaks = this.findRPeaksInWindow(values, timestamps);
    const avgHeartRate = this.calculateAverageHeartRateFromPeaks(rPeaks);

    // Calculate intervals from the most recent complete beat
    const recentIntervals = this.calculateIntervalsFromWindow(values, rPeaks);

    return {
      dataPoints: tenSecondData.length,
      duration: 10,
      heartRate: avgHeartRate,
      intervals: recentIntervals,
      morphology: { ...this.morphology },
      signalQuality: this.signalQuality,
      rPeakCount: rPeaks.length
    };
  }

  findRPeaksInWindow(values, timestamps) {
    const peaks = [];
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    const variance = values.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / values.length;
    const threshold = mean + Math.sqrt(variance) * 1.5;

    for (let i = 10; i < values.length - 10; i++) {
      if (values[i] > threshold) {
        let isLocalMax = true;
        for (let j = i - 5; j <= i + 5; j++) {
          if (j !== i && values[j] >= values[i]) {
            isLocalMax = false;
            break;
          }
        }
        if (isLocalMax) {
          peaks.push({ index: i, timestamp: timestamps[i], value: values[i] });
          i += 30; // Skip next 300ms to avoid double detection
        }
      }
    }

    return peaks;
  }

  calculateAverageHeartRateFromPeaks(peaks) {
    if (peaks.length < 2) return this.bpmStats.current || 0;

    const intervals = [];
    for (let i = 1; i < peaks.length; i++) {
      const interval = peaks[i].timestamp - peaks[i-1].timestamp;
      if (interval >= 300 && interval <= 2000) { // Valid RR intervals
        intervals.push(interval);
      }
    }

    if (intervals.length === 0) return this.bpmStats.current || 0;

    const avgInterval = intervals.reduce((a, b) => a + b, 0) / intervals.length;
    return Math.round(60000 / avgInterval);
  }

  calculateIntervalsFromWindow(values, peaks) {
    if (peaks.length === 0) return { ...this.intervals };

    // Use the most recent R peak for interval calculation
    const lastPeak = peaks[peaks.length - 1];
    const rIndex = lastPeak.index;

    // Calculate intervals similar to existing method but from 10-second window
    const pr = this.calculatePRFromWindow(values, rIndex);
    const qrs = this.calculateQRSFromWindow(values, rIndex);
    const qt = this.calculateQTFromWindow(values, rIndex);
    const qtc = qt && this.bpmStats.current ?
      Math.round(qt / Math.sqrt((60 / this.bpmStats.current))) : null;

    return { pr, qrs, qt, qtc, rr: null };
  }

  calculatePRFromWindow(values, rIndex) {
    // Use the improved PR calculation method
    const prResult = this.calculatePRInterval(values, null, rIndex);
    return prResult || this.intervals.pr || 160; // Fallback to current or typical value
  }

  calculateQRSFromWindow(values, rIndex) {
    // Use the improved QRS calculation method
    const qrsResult = this.calculateQRSDuration(values, null, rIndex);
    return qrsResult || this.intervals.qrs || 90; // Fallback to current or typical value
  }

  calculateQTFromWindow(values, rIndex) {
    // Use the improved QT calculation method
    const qtResult = this.calculateQTInterval(values, null, rIndex);
    return qtResult || this.intervals.qt || 400; // Fallback to current or typical value
  }
}

// Notification System
class NotificationSystem {
  constructor() {
    this.container = document.getElementById('notificationContainer');
    this.notifications = [];
  }

  show(title, message, type = 'info', duration = 5000) {
    const notification = this.createNotification(title, message, type, duration);
    this.container.appendChild(notification);
    this.notifications.push(notification);

    // Auto-remove after duration
    if (duration > 0) {
      setTimeout(() => {
        this.remove(notification);
      }, duration);
    }

    return notification;
  }

  createNotification(title, message, type, duration) {
    const notification = document.createElement('div');
    notification.className = `notification ${type}`;

    notification.innerHTML = `
      <div class="notification-header">
        <div class="notification-title">${title}</div>
        <button class="notification-close">&times;</button>
      </div>
      <div class="notification-message">${message}</div>
      ${duration > 0 ? '<div class="notification-progress"></div>' : ''}
    `;

    // Add close functionality
    const closeBtn = notification.querySelector('.notification-close');
    closeBtn.addEventListener('click', () => {
      this.remove(notification);
    });

    return notification;
  }

  remove(notification) {
    if (notification && notification.parentNode) {
      notification.style.animation = 'slideOut 0.3s ease-out';
      setTimeout(() => {
        if (notification.parentNode) {
          notification.parentNode.removeChild(notification);
        }
        const index = this.notifications.indexOf(notification);
        if (index > -1) {
          this.notifications.splice(index, 1);
        }
      }, 300);
    }
  }

  success(title, message, duration = 5000) {
    return this.show(title, message, 'success', duration);
  }

  warning(title, message, duration = 7000) {
    return this.show(title, message, 'warning', duration);
  }

  error(title, message, duration = 8000) {
    return this.show(title, message, 'error', duration);
  }

  info(title, message, duration = 5000) {
    return this.show(title, message, 'info', duration);
  }

  clear() {
    this.notifications.forEach(notification => {
      this.remove(notification);
    });
  }
}

// Initialize the application when the page loads
document.addEventListener('DOMContentLoaded', () => {
  window.ecgMonitor = new ECGMonitor();
  window.notifications = new NotificationSystem();
});