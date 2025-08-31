// ECG Multi-Lead Recording System
class ECGRecordingSystem {
  constructor() {
    this.isConnected = false;
    this.isRecording = false;
    this.currentSession = null;
    this.recordingData = [];
    this.currentLeadIndex = 0;
    this.recordingTimer = null;
    this.countdownTimer = null;
    this.previewChart = null;
    this.mqttClient = null;
    this.chartStartTime = null;
    
    // Lead configurations for 3-electrode simulation
    this.leadConfigurations = {
      3: [
        { name: 'Lead I', position: 'Standard Limb Lead I', description: 'Right arm (-) to Left arm (+)' },
        { name: 'Lead II', position: 'Standard Limb Lead II', description: 'Right arm (-) to Left leg (+)' },
        { name: 'Lead III', position: 'Standard Limb Lead III', description: 'Left arm (-) to Left leg (+)' }
      ],
      6: [
        { name: 'Lead I', position: 'Standard Limb Lead I', description: 'Right arm (-) to Left arm (+)' },
        { name: 'Lead II', position: 'Standard Limb Lead II', description: 'Right arm (-) to Left leg (+)' },
        { name: 'Lead III', position: 'Standard Limb Lead III', description: 'Left arm (-) to Left leg (+)' },
        { name: 'aVR', position: 'Augmented Vector Right', description: 'Right arm reference' },
        { name: 'aVL', position: 'Augmented Vector Left', description: 'Left arm reference' },
        { name: 'aVF', position: 'Augmented Vector Foot', description: 'Left leg reference' }
      ],
      12: [
        { name: 'Lead I', position: 'Standard Limb Lead I', description: 'Right arm (-) to Left arm (+)' },
        { name: 'Lead II', position: 'Standard Limb Lead II', description: 'Right arm (-) to Left leg (+)' },
        { name: 'Lead III', position: 'Standard Limb Lead III', description: 'Left arm (-) to Left leg (+)' },
        { name: 'aVR', position: 'Augmented Vector Right', description: 'Right arm reference' },
        { name: 'aVL', position: 'Augmented Vector Left', description: 'Left arm reference' },
        { name: 'aVF', position: 'Augmented Vector Foot', description: 'Left leg reference' },
        { name: 'V1', position: 'Precordial V1', description: '4th intercostal space, right sternal border' },
        { name: 'V2', position: 'Precordial V2', description: '4th intercostal space, left sternal border' },
        { name: 'V3', position: 'Precordial V3', description: 'Between V2 and V4' },
        { name: 'V4', position: 'Precordial V4', description: '5th intercostal space, midclavicular line' },
        { name: 'V5', position: 'Precordial V5', description: '5th intercostal space, anterior axillary line' },
        { name: 'V6', position: 'Precordial V6', description: '5th intercostal space, midaxillary line' }
      ]
    };

    this.init();
  }

  init() {
    this.setupEventListeners();
    this.initializePreviewChart();
    this.updateUI();
  }

  setupEventListeners() {
    // Navigation
    document.getElementById('realTimeBtn').addEventListener('click', () => {
      window.location.href = 'index.html'; // Change from 'ecg-chart.html' if needed
    });

    // Recording setup
    document.getElementById('startSessionBtn').addEventListener('click', () => {
      this.startRecordingSession();
    });

    document.getElementById('demoSessionBtn').addEventListener('click', () => {
      this.startDemoSession();
    });

    // Recording controls
    document.getElementById('startRecordingBtn').addEventListener('click', () => {
      this.startRecording();
    });

    document.getElementById('skipRecordingBtn').addEventListener('click', () => {
      this.skipCurrentRecording();
    });

    document.getElementById('stopSessionBtn').addEventListener('click', () => {
      this.stopSession();
    });

    // Report generation
    document.getElementById('generateReportBtn').addEventListener('click', () => {
      this.generateReport();
    });

    document.getElementById('exportDataBtn').addEventListener('click', () => {
      this.exportRawData();
    });

    document.getElementById('newSessionBtn').addEventListener('click', () => {
      this.startNewSession();
    });

    // Report actions
    document.getElementById('downloadPdfBtn').addEventListener('click', () => {
      this.downloadPDF();
    });

    document.getElementById('printReportBtn').addEventListener('click', () => {
      window.print();
    });

    document.getElementById('backToRecordingsBtn').addEventListener('click', () => {
      this.showCompletedRecordings();
    });
  }

  initializePreviewChart() {
    const ctx = document.getElementById('previewChart').getContext('2d');

    if (!ctx) {
      console.error('Preview Chart canvas element not found!');
      return;
    }

    this.previewChart = new Chart(ctx, {
      type: 'line',
      data: {
        datasets: [{
          label: 'ECG Signal',
          data: [],
          borderColor: '#ff0000',
          backgroundColor: 'transparent',
          borderWidth: 2,
          pointRadius: 0,
          tension: 0,
          fill: false
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: false,
        parsing: {
          xAxisKey: 'x',
          yAxisKey: 'y'
        },
        plugins: {
          legend: {
            display: false
          }
        },
        scales: {
          x: {
            type: 'linear',
            display: true,
            title: {
              display: true,
              text: 'Time (s)'
            }
          },
          y: {
            type: 'linear',
            display: true,
            min: -2.0,
            max: 2.0,
            title: {
              display: true,
              text: 'mV'
            }
          }
        }
      }
    });
  }

  async startRecordingSession() {
    // Validate inputs
    const patientName = document.getElementById('patientName').value.trim();
    const patientAge = document.getElementById('patientAge').value;
    const patientGender = document.getElementById('patientGender').value;
    const numReadings = parseInt(document.getElementById('numReadings').value);
    const deviceId = document.getElementById('deviceId').value.trim();

    if (!patientName) {
      if (window.notifications) {
        window.notifications.warning('Missing Patient Name', 'Please enter patient name before starting recording session.');
      } else {
        alert('Please enter patient name');
      }
      return;
    }

    if (!deviceId) {
      if (window.notifications) {
        window.notifications.warning('Missing Device ID', 'Please enter device ID before starting recording session.');
      } else {
        alert('Please enter device ID');
      }
      return;
    }

    // Create new session
    this.currentSession = {
      id: Date.now(),
      patientName,
      patientAge: patientAge || null,
      patientGender: patientGender || null,
      numReadings,
      deviceId,
      startTime: new Date(),
      recordings: [],
      completed: false
    };

    this.currentLeadIndex = 0;
    this.recordingData = [];

    // Show connection status and attempt connection
    this.showConnectionStatus();
    await this.connectToDevice();
  }

  async connectToDevice() {
    const deviceId = this.currentSession.deviceId;
    const connectionMessage = document.getElementById('connectionMessage');
    const connectionDot = document.getElementById('connectionDot');
    const connectionText = document.getElementById('connectionText');

    try {
      connectionMessage.textContent = 'Connecting to MQTT broker...';
      connectionDot.className = 'indicator-dot connecting';
      connectionText.textContent = 'Connecting';

      // MQTT connection setup (similar to main app)
      const brokerUrl = 'wss://cd07331e117b4586bf2b979e80f68084.s1.eu.hivemq.cloud:8884/mqtt';
      this.mqttClient = mqtt.connect(brokerUrl, {
        username: 'harsh',
        password: 'Harsh@12',
        clientId: `ecg-recording-${Math.random().toString(16).substr(2, 8)}`,
        clean: true,
        connectTimeout: 10000,
        reconnectPeriod: 5000
      });

      // Device heartbeat tracking
      this.lastDataReceived = 0;
      this.deviceHeartbeatInterval = null;
      this.connectionTimeout = null;

      this.mqttClient.on('connect', () => {
        console.debug('[DEBUG] MQTT connected');
        connectionMessage.textContent = `Connected to MQTT broker. Waiting for device ${deviceId}...`;
        connectionDot.className = 'indicator-dot connecting';
        connectionText.textContent = 'Waiting for Device';

        // Subscribe to device topic
        const topic = `iot/devices/${deviceId}`;
        this.mqttClient.subscribe(topic);

        // Start connection timeout - if no data received in 15 seconds, show error
        this.connectionTimeout = setTimeout(() => {
          if (!this.isConnected) {
            connectionMessage.textContent = `Device ${deviceId} not responding. Please check if device is powered on and connected.`;
            connectionDot.className = 'indicator-dot';
            connectionText.textContent = 'Device Offline';
            this.handleDeviceTimeout();
          }
        }, 15000);

        // Start device heartbeat monitoring
        this.startDeviceHeartbeatMonitoring();
      });

      this.mqttClient.on('message', (topic, message) => {
        console.debug('[DEBUG] MQTT message received:', topic, message.toString());
        try {
          const data = JSON.parse(message.toString());

          if (!this.isConnected) {
            this.isConnected = true;
            // Show green screen with WiFi name
            this.showWiFiConnectedScreen(data.ssid || 'Unknown');
            // ...existing code...
          }
          // ...existing code...
        } catch (error) {
          console.error('Error processing MQTT message:', error);
        }
      });

      this.mqttClient.on('error', (error) => {
        console.error('[DEBUG] MQTT connection error:', error);
        connectionMessage.textContent = 'MQTT connection failed. Please check internet connection.';
        connectionDot.className = 'indicator-dot';
        connectionText.textContent = 'Connection Failed';
        this.handleConnectionError();
      });

      this.mqttClient.on('close', () => {
        console.debug('[DEBUG] MQTT connection closed');
        this.isConnected = false;
        connectionMessage.textContent = 'Connection lost. Attempting to reconnect...';
        connectionDot.className = 'indicator-dot connecting';
        connectionText.textContent = 'Reconnecting';
      });

    } catch (error) {
      console.error('Connection error:', error);
      connectionMessage.textContent = 'Connection failed. Please try again.';
      connectionDot.className = 'indicator-dot';
      connectionText.textContent = 'Failed';
      this.handleConnectionError();
    }
  }

  startDeviceHeartbeatMonitoring() {
    // Check every 5 seconds if device is still sending data
    this.deviceHeartbeatInterval = setInterval(() => {
      if (this.isConnected && Date.now() - this.lastDataReceived > 10000) {
        // No data received for 10 seconds - device might be offline
        this.handleDeviceTimeout();
      }
    }, 5000);
  }

  handleDeviceTimeout() {
    this.isConnected = false;
    const connectionMessage = document.getElementById('connectionMessage');
    const connectionDot = document.getElementById('connectionDot');
    const connectionText = document.getElementById('connectionText');

    connectionMessage.textContent = 'Device appears to be offline. Please check device power and connection.';
    connectionDot.className = 'indicator-dot';
    connectionText.textContent = 'Device Offline';

    // Debug log
    console.debug('[DEBUG] Device timeout triggered. Last data received at:', new Date(this.lastDataReceived));
    console.debug('[DEBUG] Current time:', new Date());
    console.debug('[DEBUG] Time since last data (ms):', Date.now() - this.lastDataReceived);

    // Clean up intervals
    if (this.deviceHeartbeatInterval) {
      clearInterval(this.deviceHeartbeatInterval);
      this.deviceHeartbeatInterval = null;
    }
  }

  handleConnectionError() {
    this.isConnected = false;

    // Clean up intervals and timeouts
    if (this.deviceHeartbeatInterval) {
      clearInterval(this.deviceHeartbeatInterval);
      this.deviceHeartbeatInterval = null;
    }

    if (this.connectionTimeout) {
      clearTimeout(this.connectionTimeout);
      this.connectionTimeout = null;
    }
  }

  adcToMillivolts(adcValue) {
    // Medical-grade ECG conversion for AD8232 sensor
    // ESP32 ADC: 0-4095 (12-bit) representing 0-3.3V
    // AD8232 outputs: 0-3.3V with 1.65V as baseline (no signal)

    // Convert ADC to voltage
    const voltage = (adcValue / 4095.0) * 3.3;

    // Remove DC offset (1.65V baseline)
    const centeredVoltage = voltage - 1.65;

    // Convert to millivolts with proper scaling for AD8232
    // AD8232 has internal gain, typical ECG range after amplification
    const millivolts = (centeredVoltage / 1.5) * 5.0; // Scale to realistic ECG range

    return Math.round(millivolts * 1000) / 1000; // Round to 3 decimal places
  }

  processECGData(data) {
    const millivolts = this.adcToMillivolts(data.ecg_value);

    if (!this.isRecording) {
      // Update preview chart with millivolt values
      this.updatePreviewChart({ ...data, millivolts });
      return;
    }

    // Store recording data with both ADC and millivolt values
    this.recordingData.push({
      timestamp: Date.now(),
      value: parseInt(data.ecg_value),
      millivolts: millivolts,
      sequence: data.sequence,
      signalQuality: data.signal_quality
    });

    // Update preview chart with millivolt values
    this.updatePreviewChart({ ...data, millivolts });

    // Update signal quality display
    document.getElementById('signalQuality').textContent = `${data.signal_quality}%`;
  }

  updatePreviewChart(data) {
    if (!this.previewChart) {
      console.warn('Preview chart not initialized');
      return;
    }

    const chart = this.previewChart;
    const maxPoints = 500; // Show 5 seconds at 100Hz

    // Calculate millivolt value
    const millivolts = data.millivolts || this.adcToMillivolts(data.ecg_value);

    // Validate the data
    if (!isFinite(millivolts)) {
      console.warn('Invalid millivolt value:', millivolts);
      return;
    }

    // Calculate time in seconds
    const currentTime = Date.now();
    if (!this.chartStartTime) {
      this.chartStartTime = currentTime;
    }
    const timeSeconds = (currentTime - this.chartStartTime) / 1000;

    // Add new data point with x,y coordinates
    chart.data.datasets[0].data.push({
      x: timeSeconds,
      y: millivolts
    });

    // Remove old data points
    if (chart.data.datasets[0].data.length > maxPoints) {
      chart.data.datasets[0].data.shift();
    }

    try {
      chart.update('none');
    } catch (error) {
      console.error('Error updating preview chart:', error);
    }
  }

  showConnectionStatus() {
    document.getElementById('connectionStatus').style.display = 'block';
    document.getElementById('recordingProgress').style.display = 'none';
    document.getElementById('completedRecordings').style.display = 'none';
    document.getElementById('reportSection').style.display = 'none';
  }

  showRecordingProgress() {
    document.getElementById('connectionStatus').style.display = 'none';
    document.getElementById('recordingProgress').style.display = 'block';
    document.getElementById('completedRecordings').style.display = 'none';
    document.getElementById('reportSection').style.display = 'none';

    this.updateRecordingProgress();
    this.updateLeadGuide();
    this.enableRecordingControls();
  }

  updateRecordingProgress() {
    const leads = this.leadConfigurations[this.currentSession?.numReadings];
    const currentLead = leads ? leads[this.currentLeadIndex] : undefined;
    const progress = `${this.currentLeadIndex + 1}/${this.currentSession?.numReadings || '?'}`;

    if (!currentLead) {
      document.getElementById('currentLead').textContent = 'Unknown Lead';
      document.getElementById('sessionProgress').textContent = progress;
      document.getElementById('recordingTime').textContent = this.isRecording ? 'Recording...' : 'Ready';
      console.warn('[DEBUG] updateRecordingProgress: currentLead is undefined', {
        numReadings: this.currentSession?.numReadings,
        currentLeadIndex: this.currentLeadIndex,
        leads
      });
      return;
    }

    document.getElementById('currentLead').textContent = currentLead.name;
    document.getElementById('sessionProgress').textContent = progress;
    document.getElementById('recordingTime').textContent = this.isRecording ? 'Recording...' : 'Ready';
  }

  updateLeadGuide() {
    const currentLead = this.leadConfigurations[this.currentSession.numReadings][this.currentLeadIndex];
    const instruction = document.getElementById('placementInstruction');
    const diagram = document.getElementById('electrodeDiagram');

    instruction.textContent = `Position electrodes for ${currentLead.name}: ${currentLead.description}`;
    
    // Create simple electrode placement diagram
    diagram.innerHTML = `
      <div style="font-size: 18px; color: #2196F3; margin-bottom: 10px;">
        <strong>${currentLead.name}</strong>
      </div>
      <div style="font-size: 16px; color: #555; margin-bottom: 15px;">
        ${currentLead.position}
      </div>
      <div style="font-size: 14px; color: #777; line-height: 1.5;">
        ${currentLead.description}
      </div>
      <div style="margin-top: 15px; padding: 10px; background: #fff3cd; border-radius: 5px; font-size: 14px;">
        <strong>Note:</strong> Ensure good electrode contact and stable signal before recording.
      </div>
    `;
  }

  enableRecordingControls() {
    document.getElementById('startRecordingBtn').disabled = false;
    document.getElementById('skipRecordingBtn').disabled = false;
    document.getElementById('stopSessionBtn').disabled = false;
  }

  startRecording() {
    if (!this.isConnected) {
      alert('Device not connected. Please check connection.');
      return;
    }

    // Check if we have recent data (within last 10 seconds)
    const timeSinceLastData = Date.now() - this.lastDataReceived;
    if (timeSinceLastData > 10000) {
      alert('Cannot start recording: No ECG data received in the last 10 seconds. Please ensure device is connected and sending data.');
      return;
    }

    this.isRecording = true;
    this.recordingData = [];

    // Disable controls during recording
    document.getElementById('startRecordingBtn').disabled = true;
    document.getElementById('skipRecordingBtn').disabled = true;

    // Show countdown timer
    this.showCountdownTimer();

    // Start 10-second recording
    this.startCountdown(10);
  }

  startCountdown(seconds) {
    let remainingTime = seconds;
    const timerText = document.getElementById('timerText');

    timerText.textContent = remainingTime;

    this.countdownTimer = setInterval(() => {
      remainingTime--;
      timerText.textContent = remainingTime;

      if (remainingTime <= 0) {
        this.stopRecording();
      }
    }, 1000);
  }

  stopRecording() {
    this.isRecording = false;

    if (this.countdownTimer) {
      clearInterval(this.countdownTimer);
      this.countdownTimer = null;
    }

    // Hide countdown timer
    document.getElementById('countdownTimer').style.display = 'none';

    // Save recording data
    this.saveCurrentRecording();

    // Move to next lead or complete session
    this.currentLeadIndex++;

    if (this.currentLeadIndex >= this.currentSession.numReadings) {
      this.completeSession();
    } else {
      this.updateRecordingProgress();
      this.updateLeadGuide();
      this.enableRecordingControls();
    }
  }

  saveCurrentRecording() {
    const currentLead = this.leadConfigurations[this.currentSession.numReadings][this.currentLeadIndex];

    const recording = {
      leadName: currentLead.name,
      leadPosition: currentLead.position,
      leadDescription: currentLead.description,
      timestamp: new Date(),
      duration: 10, // seconds
      data: [...this.recordingData],
      analysis: this.analyzeRecording(this.recordingData)
    };

    this.currentSession.recordings.push(recording);
    console.log(`Saved recording for ${currentLead.name}:`, recording);
  }

  analyzeRecording(data) {
    if (data.length === 0) return null;

    // Enhanced analysis of the 10-second recording
    const values = data.map(d => d.value);
    const timestamps = data.map(d => d.timestamp);

    // Calculate basic statistics
    const min = Math.min(...values);
    const max = Math.max(...values);
    const avg = values.reduce((a, b) => a + b, 0) / values.length;

    // Estimate heart rate from peaks
    const heartRate = this.estimateHeartRate(values, timestamps);

    // Calculate signal quality
    const signalQuality = data.length > 0 ?
      data.reduce((sum, d) => sum + (d.signalQuality || 0), 0) / data.length : 0;

    // Advanced ECG analysis
    const ecgIntervals = this.calculateECGIntervals(values, timestamps);
    const morphologyAnalysis = this.analyzeMorphology(values, timestamps);

    return {
      duration: 10,
      dataPoints: data.length,
      minValue: min,
      maxValue: max,
      avgValue: Math.round(avg),
      estimatedHeartRate: heartRate,
      signalQuality: Math.round(signalQuality),
      intervals: ecgIntervals,
      morphology: morphologyAnalysis,
      timestamp: new Date()
    };
  }

  calculateECGIntervals(values, timestamps) {
    // Find R peaks for interval calculation
    const rPeaks = this.findRPeaks(values, timestamps);

    if (rPeaks.length === 0) {
      return {
        pr: null,
        qrs: null,
        qt: null,
        qtc: null,
        rr: null
      };
    }

    // Use the most prominent R peak for analysis
    const rPeakIndex = rPeaks[Math.floor(rPeaks.length / 2)];

    // Calculate intervals (similar to main app logic)
    const pr = this.calculatePRInterval(values, rPeakIndex);
    const qrs = this.calculateQRSDuration(values, rPeakIndex);
    const qt = this.calculateQTInterval(values, rPeakIndex);
    const qtc = qt && this.estimatedHeartRate ?
      Math.round(qt / Math.sqrt((60 / this.estimatedHeartRate))) : null;

    // Calculate RR interval if multiple peaks
    let rr = null;
    if (rPeaks.length >= 2) {
      const rrIntervals = [];
      for (let i = 1; i < rPeaks.length; i++) {
        rrIntervals.push((timestamps[rPeaks[i]] - timestamps[rPeaks[i-1]]));
      }
      rr = Math.round(rrIntervals.reduce((a, b) => a + b, 0) / rrIntervals.length);
    }

    return { pr, qrs, qt, qtc, rr };
  }

  findRPeaks(values, timestamps) {
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
          peaks.push(i);
          i += 30; // Skip next 300ms to avoid double detection
        }
      }
    }

    return peaks;
  }

  calculatePRInterval(values, rPeakIndex) {
    // Simplified PR interval calculation
    // Look for P wave 80-200ms before R peak
    const searchStart = Math.max(0, rPeakIndex - 20); // -200ms
    const searchEnd = Math.max(0, rPeakIndex - 8);    // -80ms

    if (searchEnd <= searchStart) return null;

    // Find P wave peak in search region
    const searchRegion = values.slice(searchStart, searchEnd);
    const baseline = values.slice(0, 50).reduce((a, b) => a + b, 0) / 50;

    let pPeakIndex = -1;
    let maxPAmplitude = 0;

    for (let i = 0; i < searchRegion.length; i++) {
      const amplitude = Math.abs(searchRegion[i] - baseline);
      if (amplitude > maxPAmplitude && amplitude > 50) {
        maxPAmplitude = amplitude;
        pPeakIndex = searchStart + i;
      }
    }

    if (pPeakIndex === -1) return null;

    // PR interval from P onset to QRS onset (approximate)
    const prInterval = (rPeakIndex - pPeakIndex - 3) * 10; // Convert to ms

    return (prInterval >= 80 && prInterval <= 300) ? Math.round(prInterval) : null;
  }

  calculateQRSDuration(values, rPeakIndex) {
    // QRS duration calculation
    const qrsStart = Math.max(0, rPeakIndex - 5);  // -50ms
    const qrsEnd = Math.min(values.length - 1, rPeakIndex + 8); // +80ms

    const baseline = values.slice(0, 50).reduce((a, b) => a + b, 0) / 50;
    const threshold = 30; // Threshold for returning to baseline

    // Find QRS onset
    let qrsOnset = rPeakIndex;
    for (let i = rPeakIndex - 1; i >= qrsStart; i--) {
      if (Math.abs(values[i] - baseline) < threshold) {
        qrsOnset = i;
        break;
      }
    }

    // Find QRS offset
    let qrsOffset = rPeakIndex;
    for (let i = rPeakIndex + 1; i <= qrsEnd; i++) {
      if (Math.abs(values[i] - baseline) < threshold) {
        qrsOffset = i;
        break;
      }
    }

    const qrsDuration = (qrsOffset - qrsOnset) * 10; // Convert to ms

    return (qrsDuration >= 40 && qrsDuration <= 200) ? Math.round(qrsDuration) : null;
  }

  calculateQTInterval(values, rPeakIndex) {
    // QT interval calculation
    const searchStart = Math.min(values.length - 1, rPeakIndex + 10); // +100ms
    const searchEnd = Math.min(values.length - 1, rPeakIndex + 50);   // +500ms

    if (searchEnd <= searchStart) return null;

    const baseline = values.slice(0, 50).reduce((a, b) => a + b, 0) / 50;

    // Find T wave end (return to baseline)
    let tWaveEnd = -1;
    for (let i = searchEnd; i >= searchStart; i--) {
      if (Math.abs(values[i] - baseline) < 30) {
        tWaveEnd = i;
        break;
      }
    }

    if (tWaveEnd === -1) return null;

    const qtInterval = (tWaveEnd - rPeakIndex + 5) * 10; // Convert to ms

    return (qtInterval >= 250 && qtInterval <= 600) ? Math.round(qtInterval) : null;
  }

  analyzeMorphology(values, timestamps) {
    // Basic morphology analysis
    const rPeaks = this.findRPeaks(values, timestamps);

    if (rPeaks.length === 0) {
      return {
        pWave: { detected: false, amplitude: 0 },
        qrsComplex: { detected: false, amplitude: 0 },
        tWave: { detected: false, amplitude: 0 },
        rhythm: 'Unknown'
      };
    }

    const rPeakIndex = rPeaks[0];
    const baseline = values.slice(0, 50).reduce((a, b) => a + b, 0) / 50;

    // QRS amplitude
    const qrsAmplitude = Math.abs(values[rPeakIndex] - baseline);

    // Simple rhythm analysis
    let rhythm = 'Regular';
    if (rPeaks.length >= 3) {
      const intervals = [];
      for (let i = 1; i < rPeaks.length; i++) {
        intervals.push(rPeaks[i] - rPeaks[i-1]);
      }
      const variance = intervals.reduce((a, b) => a + Math.pow(b - intervals[0], 2), 0) / intervals.length;
      if (variance > 100) rhythm = 'Irregular';
    }

    return {
      pWave: { detected: true, amplitude: Math.round(qrsAmplitude * 0.1) },
      qrsComplex: { detected: true, amplitude: Math.round(qrsAmplitude) },
      tWave: { detected: true, amplitude: Math.round(qrsAmplitude * 0.3) },
      rhythm: rhythm
    };
  }

  estimateHeartRate(values, timestamps) {
    // Enhanced peak detection with adaptive threshold
    const peaks = [];

    // Calculate adaptive threshold
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    const variance = values.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / values.length;
    const stdDev = Math.sqrt(variance);
    const threshold = mean + (stdDev * 1.5);

    // Minimum distance between peaks (300ms at 100Hz = 30 samples)
    const minPeakDistance = 30;

    // Find R peaks using improved algorithm
    for (let i = minPeakDistance; i < values.length - minPeakDistance; i++) {
      if (values[i] > threshold) {
        // Check if this is a local maximum
        let isLocalMax = true;
        for (let j = i - 5; j <= i + 5; j++) {
          if (j !== i && values[j] >= values[i]) {
            isLocalMax = false;
            break;
          }
        }

        if (isLocalMax) {
          // Check minimum distance from last peak
          if (peaks.length === 0 || (timestamps[i] - peaks[peaks.length - 1]) >= 300) {
            peaks.push(timestamps[i]);
          }
        }
      }
    }

    if (peaks.length < 2) return 0;

    // Calculate RR intervals and filter outliers
    const intervals = [];
    for (let i = 1; i < peaks.length; i++) {
      const interval = peaks[i] - peaks[i-1];
      // Filter reasonable intervals (300ms to 2000ms = 200-30 BPM)
      if (interval >= 300 && interval <= 2000) {
        intervals.push(interval);
      }
    }

    if (intervals.length === 0) return 0;

    // Calculate median interval for better accuracy
    intervals.sort((a, b) => a - b);
    const medianInterval = intervals[Math.floor(intervals.length / 2)];
    const heartRate = 60000 / medianInterval; // Convert ms to BPM

    return Math.round(heartRate);
  }

  skipCurrentRecording() {
    // Save empty recording with skip flag
    const currentLead = this.leadConfigurations[this.currentSession.numReadings][this.currentLeadIndex];

    const recording = {
      leadName: currentLead.name,
      leadPosition: currentLead.position,
      leadDescription: currentLead.description,
      timestamp: new Date(),
      duration: 0,
      data: [],
      analysis: null,
      skipped: true
    };

    this.currentSession.recordings.push(recording);

    // Move to next lead
    this.currentLeadIndex++;

    if (this.currentLeadIndex >= this.currentSession.numReadings) {
      this.completeSession();
    } else {
      this.updateRecordingProgress();
      this.updateLeadGuide();
    }
  }

  showCountdownTimer() {
    document.getElementById('countdownTimer').style.display = 'block';
  }

  completeSession() {
    this.currentSession.completed = true;
    this.currentSession.endTime = new Date();

    // Disconnect from device or stop demo
    if (this.currentSession.isDemo) {
      if (this.demoInterval) {
        clearInterval(this.demoInterval);
        this.demoInterval = null;
      }
      this.isConnected = false;
    } else if (this.mqttClient) {
      this.mqttClient.end();
      this.isConnected = false;
    }

    // Show completed recordings
    this.showCompletedRecordings();
  }

  showCompletedRecordings() {
    document.getElementById('connectionStatus').style.display = 'none';
    document.getElementById('recordingProgress').style.display = 'none';
    document.getElementById('completedRecordings').style.display = 'block';
    document.getElementById('reportSection').style.display = 'none';

    this.displayRecordingsList();
    this.enableReportGeneration();
  }

  displayRecordingsList() {
    const recordingsList = document.getElementById('recordingsList');
    recordingsList.innerHTML = '';

    if (!this.currentSession || this.currentSession.recordings.length === 0) {
      recordingsList.innerHTML = '<p>No recordings available.</p>';
      return;
    }

    this.currentSession.recordings.forEach((recording, index) => {
      const recordingItem = document.createElement('div');
      recordingItem.className = 'recording-item';

      const statusIcon = recording.skipped ? '⏭️' : '✅';
      const duration = recording.skipped ? 'Skipped' : `${recording.duration}s`;
      const heartRate = recording.analysis ? `${recording.analysis.estimatedHeartRate} BPM` : 'N/A';
      const quality = recording.analysis ? `${recording.analysis.signalQuality}%` : 'N/A';

      recordingItem.innerHTML = `
        <div class="recording-info">
          <div class="recording-title">${statusIcon} ${recording.leadName}</div>
          <div class="recording-details">
            ${recording.leadPosition} • Duration: ${duration} • HR: ${heartRate} • Quality: ${quality}
          </div>
        </div>
      `;

      recordingsList.appendChild(recordingItem);
    });
  }

  enableReportGeneration() {
    const hasValidRecordings = this.currentSession.recordings.some(r => !r.skipped);
    document.getElementById('generateReportBtn').disabled = !hasValidRecordings;
    document.getElementById('exportDataBtn').disabled = false;
  }

  generateReport() {
    if (!this.currentSession) return;

    // Check if we have valid recordings
    const validRecordings = this.currentSession.recordings.filter(r => !r.skipped);
    if (validRecordings.length === 0) {
      alert('Cannot generate report: No valid recordings available. Please complete at least one recording session.');
      return;
    }

    // Check if recordings are recent (within last 5 minutes for multi-lead)
    const oldestRecording = Math.min(...this.currentSession.recordings.map(r => r.timestamp.getTime()));
    const timeSinceOldest = Date.now() - oldestRecording;

    if (timeSinceOldest > 300000) { // 5 minutes
      const proceed = confirm('Warning: Some recordings are more than 5 minutes old. Generate report anyway?');
      if (!proceed) return;
    }

    document.getElementById('connectionStatus').style.display = 'none';
    document.getElementById('recordingProgress').style.display = 'none';
    document.getElementById('completedRecordings').style.display = 'none';
    document.getElementById('reportSection').style.display = 'block';

    this.createReportContent();
  }

  createReportContent() {
    const reportHeader = document.getElementById('reportHeader');
    const reportContent = document.getElementById('reportContent');

    // Create report header
    const session = this.currentSession;
    const sessionDate = session.startTime.toLocaleDateString();
    const sessionTime = session.startTime.toLocaleTimeString();

    reportHeader.innerHTML = `
      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 30px; margin-bottom: 20px;">
        <div>
          <h3>Patient Information</h3>
          <p><strong>Name:</strong> ${session.patientName}</p>
          <p><strong>Age:</strong> ${session.patientAge || 'Not specified'}</p>
          <p><strong>Gender:</strong> ${session.patientGender || 'Not specified'}</p>
        </div>
        <div>
          <h3>Recording Session</h3>
          <p><strong>Date:</strong> ${sessionDate}</p>
          <p><strong>Time:</strong> ${sessionTime}</p>
          <p><strong>Device ID:</strong> ${session.deviceId}</p>
          <p><strong>Total Leads:</strong> ${session.numReadings}</p>
        </div>
      </div>
    `;

    // Create report content
    const validRecordings = session.recordings.filter(r => !r.skipped);
    const skippedRecordings = session.recordings.filter(r => r.skipped);

    let reportHTML = `
      <div class="report-summary">
        <h3>Recording Summary</h3>
        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 20px; margin-bottom: 30px;">
          <div class="summary-card">
            <div class="summary-label">Total Recordings</div>
            <div class="summary-value">${session.recordings.length}</div>
          </div>
          <div class="summary-card">
            <div class="summary-label">Valid Recordings</div>
            <div class="summary-value">${validRecordings.length}</div>
          </div>
          <div class="summary-card">
            <div class="summary-label">Skipped Recordings</div>
            <div class="summary-value">${skippedRecordings.length}</div>
          </div>
          <div class="summary-card">
            <div class="summary-label">Average Heart Rate</div>
            <div class="summary-value">${this.calculateAverageHeartRate(validRecordings)} BPM</div>
          </div>
        </div>
      </div>

      <div class="lead-analysis">
        <h3>Lead-by-Lead Analysis</h3>
        <div class="analysis-table">
          <table style="width: 100%; border-collapse: collapse; margin-bottom: 30px;">
            <thead>
              <tr style="background: #f8f9fa;">
                <th style="padding: 12px; border: 1px solid #ddd; text-align: left;">Lead</th>
                <th style="padding: 12px; border: 1px solid #ddd; text-align: center;">Status</th>
                <th style="padding: 12px; border: 1px solid #ddd; text-align: center;">Heart Rate</th>
                <th style="padding: 12px; border: 1px solid #ddd; text-align: center;">Signal Quality</th>
                <th style="padding: 12px; border: 1px solid #ddd; text-align: center;">Data Points</th>
              </tr>
            </thead>
            <tbody>
    `;

    session.recordings.forEach(recording => {
      const status = recording.skipped ?
        '<span style="color: #ff9800;">Skipped</span>' :
        '<span style="color: #4caf50;">Recorded</span>';

      const heartRate = recording.analysis ?
        `${recording.analysis.estimatedHeartRate} BPM` : 'N/A';

      const quality = recording.analysis ?
        `${recording.analysis.signalQuality}%` : 'N/A';

      const dataPoints = recording.analysis ?
        recording.analysis.dataPoints : '0';

      reportHTML += `
        <tr>
          <td style="padding: 12px; border: 1px solid #ddd;"><strong>${recording.leadName}</strong><br><small>${recording.leadPosition}</small></td>
          <td style="padding: 12px; border: 1px solid #ddd; text-align: center;">${status}</td>
          <td style="padding: 12px; border: 1px solid #ddd; text-align: center;">${heartRate}</td>
          <td style="padding: 12px; border: 1px solid #ddd; text-align: center;">${quality}</td>
          <td style="padding: 12px; border: 1px solid #ddd; text-align: center;">${dataPoints}</td>
        </tr>
      `;
    });

    reportHTML += `
            </tbody>
          </table>
        </div>
      </div>

      <div class="waveform-display">
        <h3>12-Lead ECG Waveform Display</h3>
        <div id="twelveLeadDisplay" class="twelve-lead-grid">
          ${this.generate12LeadWaveforms(session.recordings)}
        </div>
      </div>

      <div class="clinical-interpretation">
        <h3>Clinical Interpretation</h3>
        <div style="background: #fff3cd; padding: 20px; border-radius: 8px; border-left: 4px solid #ffc107;">
          <p><strong>Note:</strong> This is a simulated 12-lead ECG using 3-electrode recordings from different body positions.</p>
          <p><strong>Limitations:</strong> True 12-lead ECG requires simultaneous recording from all leads. This simulation provides educational value but should not be used for clinical diagnosis.</p>
          ${this.generateClinicalNotes(validRecordings)}
        </div>
      </div>
    `;

    reportContent.innerHTML = reportHTML;
  }

  calculateAverageHeartRate(recordings) {
    const validHeartRates = recordings
      .filter(r => r.analysis && r.analysis.estimatedHeartRate > 0)
      .map(r => r.analysis.estimatedHeartRate);

    if (validHeartRates.length === 0) return 'N/A';

    const average = validHeartRates.reduce((a, b) => a + b, 0) / validHeartRates.length;
    return Math.round(average);
  }

  generate12LeadWaveforms(recordings) {
    // Create a 12-lead ECG display grid
    const leadOrder = ['I', 'aVR', 'V1', 'V4', 'II', 'aVL', 'V2', 'V5', 'III', 'aVF', 'V3', 'V6'];

    let waveformHTML = '<div class="lead-grid-container">';

    // Create 4 rows x 3 columns grid (standard 12-lead format)
    for (let row = 0; row < 4; row++) {
      waveformHTML += '<div class="lead-row">';

      for (let col = 0; col < 3; col++) {
        const leadIndex = row * 3 + col;
        const leadName = leadOrder[leadIndex];

        // Find recording for this lead
        const recording = recordings.find(r =>
          r.leadName === leadName ||
          r.leadName === `Lead ${leadName}` ||
          r.leadName.includes(leadName)
        );

        waveformHTML += `
          <div class="lead-strip">
            <div class="lead-header">
              <span class="lead-name">${leadName}</span>
              <span class="lead-info">
                ${recording ?
                  `HR: ${recording.analysis?.estimatedHeartRate || '--'} BPM` :
                  'No Data'
                }
              </span>
            </div>
            <div class="lead-waveform" id="waveform-${leadName}">
              <canvas width="300" height="80"></canvas>
            </div>
          </div>
        `;
      }

      waveformHTML += '</div>';
    }

    waveformHTML += '</div>';

    // Add rhythm strip at bottom
    waveformHTML += `
      <div class="rhythm-strip">
        <div class="lead-header">
          <span class="lead-name">Rhythm Strip (Lead II)</span>
          <span class="lead-info">10 seconds, 25mm/s</span>
        </div>
        <div class="rhythm-waveform" id="rhythm-strip">
          <canvas width="800" height="120"></canvas>
        </div>
      </div>
    `;

    // Schedule waveform drawing after DOM update
    setTimeout(() => {
      this.drawWaveforms(recordings);
    }, 100);

    return waveformHTML;
  }

  drawWaveforms(recordings) {
    recordings.forEach(recording => {
      if (recording.skipped || !recording.data || recording.data.length === 0) return;

      // Find canvas for this lead
      const leadName = recording.leadName.replace('Lead ', '');
      const canvas = document.querySelector(`#waveform-${leadName} canvas`);

      if (canvas) {
        this.drawECGWaveform(canvas, recording.data, recording.leadName);
      }
    });

    // Draw rhythm strip (use Lead II if available)
    const leadII = recordings.find(r => r.leadName.includes('II') && !r.skipped);
    if (leadII) {
      const rhythmCanvas = document.querySelector('#rhythm-strip canvas');
      if (rhythmCanvas) {
        this.drawRhythmStrip(rhythmCanvas, leadII.data);
      }
    }
  }

  drawECGWaveform(canvas, data, leadName) {
    const ctx = canvas.getContext('2d');
    const width = canvas.width;
    const height = canvas.height;

    // Clear canvas
    ctx.clearRect(0, 0, width, height);

    // Draw grid
    this.drawECGGrid(ctx, width, height, false);

    if (!data || data.length === 0) {
      // Draw "No Data" message
      ctx.fillStyle = '#666';
      ctx.font = '12px Arial';
      ctx.textAlign = 'center';
      ctx.fillText('No Data', width / 2, height / 2);
      return;
    }

    // Prepare data
    const values = data.map(d => d.value);
    const minVal = Math.min(...values);
    const maxVal = Math.max(...values);
    const range = maxVal - minVal || 1;

    // Draw waveform in red color
    ctx.strokeStyle = '#dc3545';
    ctx.lineWidth = 1.5;
    ctx.beginPath();

    for (let i = 0; i < values.length; i++) {
      const x = (i / values.length) * width;
      const y = height - ((values[i] - minVal) / range) * (height - 20) - 10;

      if (i === 0) {
        ctx.moveTo(x, y);
      } else {
        ctx.lineTo(x, y);
      }
    }

    ctx.stroke();

    // Add lead label
    ctx.fillStyle = '#000';
    ctx.font = 'bold 10px Arial';
    ctx.textAlign = 'left';
    ctx.fillText(leadName, 5, 15);
  }

  drawRhythmStrip(canvas, data) {
    const ctx = canvas.getContext('2d');
    const width = canvas.width;
    const height = canvas.height;

    // Clear canvas
    ctx.clearRect(0, 0, width, height);

    // Draw grid
    this.drawECGGrid(ctx, width, height, true);

    if (!data || data.length === 0) return;

    // Prepare data
    const values = data.map(d => d.value);
    const minVal = Math.min(...values);
    const maxVal = Math.max(...values);
    const range = maxVal - minVal || 1;

    // Draw waveform in red color
    ctx.strokeStyle = '#dc3545';
    ctx.lineWidth = 2;
    ctx.beginPath();

    for (let i = 0; i < values.length; i++) {
      const x = (i / values.length) * width;
      const y = height - ((values[i] - minVal) / range) * (height - 40) - 20;

      if (i === 0) {
        ctx.moveTo(x, y);
      } else {
        ctx.lineTo(x, y);
      }
    }

    ctx.stroke();
  }

  drawECGGrid(ctx, width, height, isRhythmStrip = false) {
    // Draw ECG grid background
    ctx.strokeStyle = '#ffcccc';
    ctx.lineWidth = 0.5;

    // Major grid lines (5mm squares)
    const majorSpacing = isRhythmStrip ? 25 : 20;

    // Vertical lines
    for (let x = 0; x <= width; x += majorSpacing) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
      ctx.stroke();
    }

    // Horizontal lines
    for (let y = 0; y <= height; y += majorSpacing) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
      ctx.stroke();
    }

    // Minor grid lines (1mm squares)
    ctx.strokeStyle = '#ffe6e6';
    ctx.lineWidth = 0.25;

    const minorSpacing = majorSpacing / 5;

    // Vertical minor lines
    for (let x = 0; x <= width; x += minorSpacing) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
      ctx.stroke();
    }

    // Horizontal minor lines
    for (let y = 0; y <= height; y += minorSpacing) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
      ctx.stroke();
    }
  }

  generateClinicalNotes(recordings) {
    if (recordings.length === 0) {
      return '<p><strong>Clinical Notes:</strong> No valid recordings available for analysis.</p>';
    }

    const heartRates = recordings
      .filter(r => r.analysis && r.analysis.estimatedHeartRate > 0)
      .map(r => r.analysis.estimatedHeartRate);

    let notes = '<p><strong>Clinical Notes:</strong></p><ul>';

    if (heartRates.length > 0) {
      const avgHR = heartRates.reduce((a, b) => a + b, 0) / heartRates.length;
      const minHR = Math.min(...heartRates);
      const maxHR = Math.max(...heartRates);

      if (avgHR < 60) {
        notes += '<li>Bradycardia detected (HR < 60 BPM)</li>';
      } else if (avgHR > 100) {
        notes += '<li>Tachycardia detected (HR > 100 BPM)</li>';
      } else {
        notes += '<li>Normal heart rate range (60-100 BPM)</li>';
      }

      if (maxHR - minHR > 20) {
        notes += '<li>Heart rate variability noted between leads</li>';
      }
    }

    // Add interval analysis
    const intervalsData = recordings
      .filter(r => r.analysis && r.analysis.intervals)
      .map(r => r.analysis.intervals);

    if (intervalsData.length > 0) {
      const avgPR = intervalsData.filter(i => i.pr).reduce((sum, i) => sum + i.pr, 0) / intervalsData.filter(i => i.pr).length;
      const avgQRS = intervalsData.filter(i => i.qrs).reduce((sum, i) => sum + i.qrs, 0) / intervalsData.filter(i => i.qrs).length;
      const avgQT = intervalsData.filter(i => i.qt).reduce((sum, i) => sum + i.qt, 0) / intervalsData.filter(i => i.qt).length;

      if (avgPR && (avgPR < 120 || avgPR > 200)) {
        notes += `<li>PR interval abnormal: ${Math.round(avgPR)}ms (Normal: 120-200ms)</li>`;
      }

      if (avgQRS && (avgQRS < 80 || avgQRS > 120)) {
        notes += `<li>QRS duration abnormal: ${Math.round(avgQRS)}ms (Normal: 80-120ms)</li>`;
      }

      if (avgQT && (avgQT < 350 || avgQT > 450)) {
        notes += `<li>QT interval abnormal: ${Math.round(avgQT)}ms (Normal: 350-450ms)</li>`;
      }
    }

    const avgQuality = recordings
      .filter(r => r.analysis && r.analysis.signalQuality)
      .reduce((sum, r) => sum + r.analysis.signalQuality, 0) / recordings.length;

    if (avgQuality < 70) {
      notes += '<li>Poor signal quality detected - consider repeating recording</li>';
    } else if (avgQuality > 90) {
      notes += '<li>Excellent signal quality achieved</li>';
    }

    notes += '</ul>';
    return notes;
  }

  exportRawData() {
    if (!this.currentSession) return;

    const exportData = {
      session: {
        id: this.currentSession.id,
        patientName: this.currentSession.patientName,
        patientAge: this.currentSession.patientAge,
        patientGender: this.currentSession.patientGender,
        deviceId: this.currentSession.deviceId,
        startTime: this.currentSession.startTime,
        endTime: this.currentSession.endTime,
        numReadings: this.currentSession.numReadings
      },
      recordings: this.currentSession.recordings
    };

    const dataStr = JSON.stringify(exportData, null, 2);
    const dataBlob = new Blob([dataStr], { type: 'application/json' });

    const link = document.createElement('a');
    link.href = URL.createObjectURL(dataBlob);
    link.download = `ecg_recording_${this.currentSession.patientName.replace(/\s+/g, '_')}_${Date.now()}.json`;
    link.click();
  }

  async downloadPDF() {
    if (!this.currentSession) return;

    try {
      const { jsPDF } = window.jspdf;
      const doc = new jsPDF();

      // Set up document
      doc.setFontSize(20);
      doc.text('ECG Multi-Lead Recording Report', 20, 20);

      // Patient information
      doc.setFontSize(14);
      doc.text('Patient Information', 20, 40);
      doc.setFontSize(12);
      doc.text(`Name: ${this.currentSession.patientName}`, 20, 50);
      doc.text(`Age: ${this.currentSession.patientAge || 'Not specified'}`, 20, 60);
      doc.text(`Gender: ${this.currentSession.patientGender || 'Not specified'}`, 20, 70);

      // Session information
      doc.setFontSize(14);
      doc.text('Recording Session', 120, 40);
      doc.setFontSize(12);
      doc.text(`Date: ${this.currentSession.startTime.toLocaleDateString()}`, 120, 50);
      doc.text(`Time: ${this.currentSession.startTime.toLocaleTimeString()}`, 120, 60);
      doc.text(`Device ID: ${this.currentSession.deviceId}`, 120, 70);
      doc.text(`Total Leads: ${this.currentSession.numReadings}`, 120, 80);

      // Recording summary
      const validRecordings = this.currentSession.recordings.filter(r => !r.skipped);
      const avgHR = this.calculateAverageHeartRate(validRecordings);

      doc.setFontSize(14);
      doc.text('Recording Summary', 20, 100);
      doc.setFontSize(12);
      doc.text(`Total Recordings: ${this.currentSession.recordings.length}`, 20, 110);
      doc.text(`Valid Recordings: ${validRecordings.length}`, 20, 120);
      doc.text(`Average Heart Rate: ${avgHR} BPM`, 20, 130);

      // Lead analysis table
      doc.setFontSize(14);
      doc.text('Lead Analysis', 20, 150);

      let yPos = 160;
      doc.setFontSize(10);
      doc.text('Lead', 20, yPos);
      doc.text('Status', 60, yPos);
      doc.text('Heart Rate', 100, yPos);
      doc.text('Quality', 140, yPos);
      doc.text('Data Points', 170, yPos);

      yPos += 10;
      this.currentSession.recordings.forEach((recording, index) => {
        if (yPos > 270) {
          doc.addPage();
          yPos = 20;
        }

        const status = recording.skipped ? 'Skipped' : 'Recorded';
        const heartRate = recording.analysis ? `${recording.analysis.estimatedHeartRate}` : 'N/A';
        const quality = recording.analysis ? `${recording.analysis.signalQuality}%` : 'N/A';
        const dataPoints = recording.analysis ? recording.analysis.dataPoints : '0';

        doc.text(recording.leadName, 20, yPos);
        doc.text(status, 60, yPos);
        doc.text(heartRate, 100, yPos);
        doc.text(quality, 140, yPos);
        doc.text(dataPoints.toString(), 170, yPos);

        yPos += 8;
      });

      // Add waveform screenshots if available
      try {
        const waveformElement = document.getElementById('twelveLeadDisplay');
        if (waveformElement && window.html2canvas) {
          doc.addPage();
          doc.setFontSize(14);
          doc.text('12-Lead ECG Waveforms', 20, 20);

          const canvas = await html2canvas(waveformElement, {
            backgroundColor: '#ffffff',
            scale: 1
          });

          const imgData = canvas.toDataURL('image/png');
          const imgWidth = 170;
          const imgHeight = (canvas.height * imgWidth) / canvas.width;

          doc.addImage(imgData, 'PNG', 20, 30, imgWidth, Math.min(imgHeight, 200));
        }
      } catch (error) {
        console.error('Error adding waveform screenshots:', error);
      }

      // Clinical notes
      if (yPos > 220) {
        doc.addPage();
        yPos = 20;
      } else {
        yPos += 20;
      }

      doc.setFontSize(14);
      doc.text('Clinical Notes', 20, yPos);
      yPos += 10;

      doc.setFontSize(10);
      doc.text('This is a simulated 12-lead ECG using 3-electrode recordings', 20, yPos);
      yPos += 8;
      doc.text('from different body positions. This simulation provides educational', 20, yPos);
      yPos += 8;
      doc.text('value but should not be used for clinical diagnosis.', 20, yPos);

      // Save the PDF
      const fileName = `ecg_report_${this.currentSession.patientName.replace(/\s+/g, '_')}_${Date.now()}.pdf`;
      doc.save(fileName);

    } catch (error) {
      console.error('Error generating PDF:', error);
      alert('Error generating PDF. Please ensure jsPDF library is loaded.');
    }
  }

  startNewSession() {
    // Reset all state
    this.currentSession = null;
    this.recordingData = [];
    this.currentLeadIndex = 0;
    this.isConnected = false;
    this.isRecording = false;

    // Clean up connections
    if (this.mqttClient) {
      this.mqttClient.end();
      this.mqttClient = null;
    }

    if (this.demoInterval) {
      clearInterval(this.demoInterval);
      this.demoInterval = null;
    }

    // Clear form
    document.getElementById('patientName').value = '';
    document.getElementById('patientAge').value = '';
    document.getElementById('patientGender').value = '';
    document.getElementById('numReadings').value = '12';

    // Show setup section
    document.getElementById('connectionStatus').style.display = 'none';
    document.getElementById('recordingProgress').style.display = 'none';
    document.getElementById('completedRecordings').style.display = 'none';
    document.getElementById('reportSection').style.display = 'none';
  }

  stopSession() {
    if (confirm('Are you sure you want to stop the current recording session?')) {
      if (this.isRecording) {
        this.stopRecording();
      }

      if (this.currentSession && this.currentSession.recordings.length > 0) {
        this.completeSession();
      } else {
        this.startNewSession();
      }
    }
  }

  async startDemoSession() {
    // Validate inputs
    const patientName = document.getElementById('patientName').value.trim() || 'Demo Patient';
    const patientAge = document.getElementById('patientAge').value || 35;
    const patientGender = document.getElementById('patientGender').value || 'male';
    const numReadings = parseInt(document.getElementById('numReadings').value);

    // Create demo session
    this.currentSession = {
      id: Date.now(),
      patientName,
      patientAge,
      patientGender,
      numReadings,
      deviceId: 'DEMO',
      startTime: new Date(),
      recordings: [],
      completed: false,
      isDemo: true
    };

    this.currentLeadIndex = 0;
    this.recordingData = [];

    // Skip connection and go directly to recording
    this.isConnected = true;
    this.showRecordingProgress();
    this.startDemoDataGeneration();
  }

  startDemoDataGeneration() {
    // Generate demo ECG data similar to main app
    let sampleIndex = 0;
    const heartRate = 75; // BPM
    const samplingRate = 100; // Hz
    const samplesPerBeat = (60 / heartRate) * samplingRate;

    this.demoInterval = setInterval(() => {
      if (!this.isConnected) {
        clearInterval(this.demoInterval);
        return;
      }

      // Generate realistic ECG waveform
      const ecgValue = this.generateECGSample(sampleIndex, samplesPerBeat);

      // Simulate ESP32 data format
      const data = {
        device_id: 'DEMO',
        timestamp: Date.now(),
        ecg_value: ecgValue,
        sequence: sampleIndex,
        signal_quality: 95 + Math.random() * 5 // 95-100%
      };

      this.processECGData(data);
      sampleIndex++;

    }, 10); // 100Hz sampling rate
  }

  generateECGSample(sampleIndex, samplesPerBeat) {
    // Generate a realistic ECG waveform
    const t = (sampleIndex % samplesPerBeat) / samplesPerBeat;
    const baseline = 2048;

    // P wave (0.08-0.12 of cycle)
    let ecgValue = baseline;
    if (t >= 0.08 && t <= 0.12) {
      const pPhase = (t - 0.08) / 0.04;
      ecgValue += 100 * Math.sin(pPhase * Math.PI);
    }

    // QRS complex (0.15-0.25 of cycle)
    if (t >= 0.15 && t <= 0.25) {
      const qrsPhase = (t - 0.15) / 0.10;
      if (qrsPhase < 0.3) {
        // Q wave
        ecgValue -= 50 * Math.sin(qrsPhase * Math.PI / 0.3);
      } else if (qrsPhase < 0.7) {
        // R wave
        ecgValue += 800 * Math.sin((qrsPhase - 0.3) * Math.PI / 0.4);
      } else {
        // S wave
        ecgValue -= 100 * Math.sin((qrsPhase - 0.7) * Math.PI / 0.3);
      }
    }

    // T wave (0.35-0.55 of cycle)
    if (t >= 0.35 && t <= 0.55) {
      const tPhase = (t - 0.35) / 0.20;
      ecgValue += 200 * Math.sin(tPhase * Math.PI);
    }

    // Add some noise
    ecgValue += (Math.random() - 0.5) * 20;

    return Math.round(Math.max(0, Math.min(4095, ecgValue)));
  }

  updateUI() {
    // Update UI based on current state
  }

  showWiFiConnectedScreen(ssid) {
    const statusDiv = document.getElementById('connectionStatus');
    statusDiv.innerHTML = `
      <div style="background:#e8f5e9; color:#388e3c; padding:40px; border-radius:16px; text-align:center;">
        <div style="font-size:48px;">&#x2714;</div>
        <h2>Connected</h2>
        <p>WiFi: <strong>${ssid}</strong></p>
      </div>
    `;
    statusDiv.style.display = 'block';
  }
}

// Initialize the recording system when page loads
document.addEventListener('DOMContentLoaded', () => {
  new ECGRecordingSystem();

  // Initialize notification system if not already available
  if (!window.notifications) {
    // Copy the NotificationSystem class from main app
    class NotificationSystem {
      constructor() {
        this.container = document.getElementById('notificationContainer');
        this.notifications = [];
      }

      show(title, message, type = 'info', duration = 5000) {
        const notification = this.createNotification(title, message, type, duration);
        this.container.appendChild(notification);
        this.notifications.push(notification);

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
    }

    window.notifications = new NotificationSystem();
  }
});
