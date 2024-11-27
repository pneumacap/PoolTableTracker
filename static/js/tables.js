document.addEventListener('DOMContentLoaded', function() {
    let RATE_PER_HOUR = 30.0;
    let PEAK_RATE = 45.0;
    let PEAK_START = '19:00';
    let PEAK_END = '01:00';
    let MINIMUM_MINUTES = 30;
    const tables = {};
    let startModal, summaryModal;
    let selectedTableId;

    // Initialize tables and SSE
    initializeTables();
    initializeSSE();
    initializeModals();

    function initializeTables() {
        document.querySelectorAll('[data-table-id]').forEach(tableEl => {
            const tableId = tableEl.dataset.tableId;
            tables[tableId] = {
                element: tableEl,
                timer: null,
                startTime: null,
                lastRateCheck: null,
                isPeakRate: false
            };

            // Add event listeners
            tableEl.querySelector('.btn-start').addEventListener('click', () => showStartModal(tableId));
            tableEl.querySelector('.btn-stop').addEventListener('click', () => stopSession(tableId));
        });
    }

    function initializeModals() {
        startModal = new bootstrap.Modal(document.getElementById('startSessionModal'));
        summaryModal = new bootstrap.Modal(document.getElementById('sessionSummaryModal'));
        
        const confirmStartBtn = document.getElementById('confirmStart');
        confirmStartBtn.addEventListener('click', startSession);
        
        document.getElementById('customerName').addEventListener('keypress', (e) => {
            if (e.key === 'Enter' && e.target.value.trim()) {
                e.preventDefault();
                startSession();
            }
        });
    }

    function initializeSSE() {
        const connectSSE = () => {
            const eventSource = new EventSource('/stream');
            eventSource.onmessage = function(event) {
                const data = JSON.parse(event.data);
                updateTables(data.tables);
                if (data.rates) {
                    updateRates(data.rates);
                }
            };
            
            eventSource.onerror = function() {
                console.log('SSE connection error. Reconnecting...');
                eventSource.close();
                setTimeout(connectSSE, 5000);
            };
        };
        
        connectSSE();
    }

    function updateRates(rates) {
        RATE_PER_HOUR = rates.standard_rate;
        PEAK_RATE = rates.peak_rate;
        PEAK_START = rates.peak_start;
        PEAK_END = rates.peak_end;
        MINIMUM_MINUTES = rates.minimum_minutes;
        
        const rateDisplay = document.querySelector('.rate-display');
        rateDisplay.innerHTML = `Standard Rate: $${RATE_PER_HOUR}/hour <span class="text-warning ms-2">Peak Rate: $${PEAK_RATE}/hour (${PEAK_START}-${PEAK_END})</span>`;
    }

    function showStartModal(tableId) {
        selectedTableId = tableId;
        const customerNameInput = document.getElementById('customerName');
        customerNameInput.value = '';
        startModal.show();
        setTimeout(() => customerNameInput.focus(), 400);
    }

    function isInPeakHours(time) {
        const timeStr = time.getHours().toString().padStart(2, '0') + ':' + 
                       time.getMinutes().toString().padStart(2, '0');
        const currentTime = timeStr;
        const peakStart = PEAK_START;
        const peakEnd = PEAK_END;
        
        // Handle overnight peak hours if needed
        if (peakEnd < peakStart) {
            return currentTime >= peakStart || currentTime <= peakEnd;
        }
        return currentTime >= peakStart && currentTime <= peakEnd;
    }

    function calculateCost(startTime, currentTime, table) {
        const elapsedMs = Math.max(0, currentTime - startTime);
        let elapsedMinutes = elapsedMs / (1000 * 60);
        
        // Apply minimum time charge
        const actualMinutes = Math.max(MINIMUM_MINUTES, elapsedMinutes);
        
        // Calculate cost considering peak/off-peak transitions
        const startHour = startTime.getHours();
        const currentHour = currentTime.getHours();
        let totalCost = 0;
        
        // If the session spans across different rate periods
        if (startHour !== currentHour) {
            for (let hour = startHour; hour <= currentHour; hour++) {
                const checkTime = new Date(startTime);
                checkTime.setHours(hour);
                const rate = isInPeakHours(checkTime) ? PEAK_RATE : RATE_PER_HOUR;
                
                // Calculate minutes in this hour
                let minutesInHour;
                if (hour === startHour) {
                    minutesInHour = 60 - startTime.getMinutes();
                } else if (hour === currentHour) {
                    minutesInHour = currentTime.getMinutes();
                } else {
                    minutesInHour = 60;
                }
                
                totalCost += (minutesInHour / 60) * rate;
            }
        } else {
            // Session within same hour
            const rate = table.isPeakRate ? PEAK_RATE : RATE_PER_HOUR;
            totalCost = (actualMinutes / 60) * rate;
        }
        
        return {
            cost: totalCost,
            actualMinutes: actualMinutes,
            isPeakTime: isInPeakHours(currentTime)
        };
    }

    function startTimer(tableId) {
        const table = tables[tableId];
        const tableEl = table.element;
        
        table.timer = setInterval(() => {
            const now = new Date();
            const isPeakTime = isInPeakHours(now);
            
            // Update rate if it changed
            if (table.isPeakRate !== isPeakTime) {
                table.isPeakRate = isPeakTime;
            }
            
            const result = calculateCost(table.startTime, now, table);
            
            const timerElement = tableEl.querySelector('.timer');
            const elapsedSeconds = (now - table.startTime) / 1000;
            timerElement.textContent = formatDuration(elapsedSeconds);
            
            const costElement = tableEl.querySelector('.cost');
            costElement.textContent = result.cost.toFixed(2);
            
            // Update peak time indicator
            costElement.classList.toggle('text-warning', result.isPeakTime);
            costElement.title = result.isPeakTime ? 'Peak hour rate applied' : 'Standard rate applied';
            
            // Store last rate check
            table.lastRateCheck = now;
            table.isPeakRate = result.isPeakTime;
        }, 1000);
    }

    function showSessionSummary(sessionData) {
        // Format actual duration
        const actualMinutes = sessionData.actual_duration;
        const actualHours = Math.floor(actualMinutes / 60);
        const actualMins = actualMinutes % 60;
        const actualDurationText = `${actualHours}h ${actualMins.toString().padStart(2, '0')}m`;

        // Format charged duration (same as actual if no minimum applied)
        const chargedMinutes = Math.max(actualMinutes, sessionData.minimum_minutes);
        const chargedHours = Math.floor(chargedMinutes / 60);
        const chargedMins = chargedMinutes % 60;
        const chargedDurationText = `${chargedHours}h ${chargedMins.toString().padStart(2, '0')}m`;

        document.getElementById('actualDuration').textContent = actualDurationText;
        document.getElementById('summaryTime').textContent = chargedDurationText;

        // Show minimum time notice if applicable
        const minimumTimeNotice = document.getElementById('minimumTimeNotice');
        if (chargedMinutes > actualMinutes) {
            minimumTimeNotice.textContent = `Minimum ${sessionData.minimum_minutes} minutes charge applied`;
            minimumTimeNotice.classList.remove('d-none');
        } else {
            minimumTimeNotice.classList.add('d-none');
        }

        document.getElementById('summaryCost').textContent = sessionData.final_cost.toFixed(2);
        
        summaryModal.show();
    }

    async function startSession() {
        const customerName = document.getElementById('customerName').value.trim();
        if (!customerName) return;

        const tableEl = tables[selectedTableId].element;
        const startButton = tableEl.querySelector('.btn-start');
        
        try {
            startButton.classList.add('loading');
            tableEl.classList.add('loading');

            const response = await fetch(`/table/${selectedTableId}/start`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                },
                body: `customer_name=${encodeURIComponent(customerName)}`
            });

            const data = await response.json();
            if (data.status === 'success') {
                startModal.hide();
                const table = tables[selectedTableId];
                table.startTime = new Date();
                table.lastRateCheck = new Date();
                table.isPeakRate = isInPeakHours(table.startTime);
                startTimer(selectedTableId);
            } else {
                alert(data.message || 'Failed to start session');
            }
        } catch (error) {
            console.error('Error starting session:', error);
            alert('Failed to start session. Please try again.');
        } finally {
            startButton.classList.remove('loading');
            tableEl.classList.remove('loading');
        }
    }

    async function stopSession(tableId) {
        const table = tables[tableId];
        const tableEl = table.element;
        const stopButton = tableEl.querySelector('.btn-stop');
        
        try {
            stopButton.classList.add('loading');
            tableEl.classList.add('loading');
            
            const response = await fetch(`/table/${tableId}/end`, {
                method: 'POST'
            });
            
            const data = await response.json();
            if (data.status === 'success') {
                clearInterval(table.timer);
                table.timer = null;
                table.startTime = null;
                table.lastRateCheck = null;
                
                showSessionSummary(data);
                
                // Reset table display
                tableEl.querySelector('.timer').textContent = '0h 00m';
                tableEl.querySelector('.cost').textContent = '0.00';
                tableEl.querySelector('.customer-name').textContent = '';
                tableEl.classList.remove('occupied');
            } else {
                alert('Failed to end session: ' + (data.message || 'Unknown error'));
            }
        } catch (error) {
            console.error('Error ending session:', error);
            alert('Failed to end session. Please try again.');
        } finally {
            stopButton.classList.remove('loading');
            tableEl.classList.remove('loading');
        }
    }

    function updateTables(tablesData) {
        tablesData.forEach(tableData => {
            const table = tables[tableData.id];
            if (!table) return;

            const tableEl = table.element;
            const isOccupied = tableData.is_occupied;

            tableEl.dataset.status = isOccupied ? 'occupied' : 'available';
            tableEl.querySelector('.status-text').textContent = isOccupied ? 'Occupied' : 'Available';

            const customerInfo = tableEl.querySelector('.customer-info');
            if (isOccupied) {
                customerInfo.classList.remove('d-none');
                setTimeout(() => customerInfo.style.opacity = '1', 50);
            } else {
                customerInfo.style.opacity = '0';
                setTimeout(() => customerInfo.classList.add('d-none'), 300);
            }

            tableEl.querySelector('.btn-start').classList.toggle('d-none', isOccupied);
            tableEl.querySelector('.btn-stop').classList.toggle('d-none', !isOccupied);

            if (isOccupied) {
                tableEl.querySelector('.customer-name').textContent = tableData.customer_name;

                if (!table.timer && tableData.start_time) {
                    table.startTime = new Date(tableData.start_time);
                    table.lastRateCheck = new Date();
                    table.isPeakRate = isInPeakHours(table.startTime);
                    startTimer(tableData.id);
                }
            }
        });
    }
    
    function formatDuration(seconds) {
        if (typeof seconds === 'number') {
            const hours = Math.floor(seconds / 3600);
            const minutes = Math.floor((seconds % 3600) / 60);
            const secs = Math.floor(seconds % 60);
            
            // Format with leading zeros and consistent spacing
            return `${hours}h ${minutes.toString().padStart(2, '0')}m ${secs.toString().padStart(2, '0')}s`;
        }
        // For when minutes are passed directly
        const hours = Math.floor(seconds / 60);
        const mins = Math.floor(seconds % 60);
        return `${hours}h ${mins.toString().padStart(2, '0')}m`;
    }

    function createTableCard(table) {
        const template = document.createElement('div');
        template.innerHTML = `
            <div class="card" data-table-id="${table.id}" data-status="available">
                <div class="card-body">
                    <h5 class="card-title text-center">Table ${table.table_number}</h5>
                    <svg class="table-icon" viewBox="0 0 300 200">
                        <use href="#pool-table-template" />
                    </svg>
                    <!-- Rest of your card content -->
                </div>
            </div>
        `;
        return template.firstElementChild;
    }
});
