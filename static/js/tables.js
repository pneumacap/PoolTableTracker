document.addEventListener('DOMContentLoaded', function() {
    let RATE_PER_HOUR = 30.0;
    let PEAK_RATE = 45.0;
    let PEAK_START = '17:00';
    let PEAK_END = '22:00';
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
            const elapsedTime = now - table.startTime;
            timerElement.textContent = formatDuration(elapsedTime / 1000);
            
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

    function showSummaryModal(finalTime, finalCost, actualDuration, minimumApplied) {
        document.getElementById('summaryTime').textContent = finalTime;
        document.getElementById('summaryCost').textContent = finalCost.toFixed(2);
        
        const minimumNotice = document.getElementById('minimumTimeNotice');
        if (minimumApplied) {
            minimumNotice.textContent = `Minimum ${MINIMUM_MINUTES} minutes charge applied`;
            minimumNotice.classList.remove('d-none');
        } else {
            minimumNotice.classList.add('d-none');
        }
        
        document.getElementById('actualDuration').textContent = 
            `${Math.floor(actualDuration / 60)}h ${actualDuration % 60}m`;
            
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
            
            const response = await fetch(`/table/${tableId}/stop`, {
                method: 'POST'
            });
            
            const data = await response.json();
            if (data.status === 'success') {
                clearInterval(table.timer);
                table.timer = null;
                table.startTime = null;
                table.lastRateCheck = null;
                
                showSummaryModal(
                    formatDuration(data.actual_duration * 60),
                    data.final_cost,
                    data.actual_duration,
                    data.minimum_applied
                );
            } else {
                alert(data.message || 'Failed to stop session');
            }
        } catch (error) {
            console.error('Error stopping session:', error);
            alert('Failed to stop session. Please try again.');
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
    
    function formatDuration(totalSeconds) {
        const hours = Math.floor(totalSeconds / 3600);
        const minutes = Math.floor((totalSeconds % 3600) / 60);
        const seconds = Math.floor(totalSeconds % 60);
        return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
    }
});
