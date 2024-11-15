document.addEventListener('DOMContentLoaded', function() {
    const RATE_PER_HOUR = 30;
    const MINIMUM_MINUTES = 30;
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
                startTime: null
            };

            // Add event listeners
            tableEl.querySelector('.btn-start').addEventListener('click', () => showStartModal(tableId));
            tableEl.querySelector('.btn-stop').addEventListener('click', () => stopSession(tableId));
        });
    }

    function initializeModals() {
        startModal = new bootstrap.Modal(document.getElementById('startSessionModal'));
        summaryModal = new bootstrap.Modal(document.getElementById('sessionSummaryModal'));
        document.getElementById('confirmStart').addEventListener('click', startSession);
    }

    function initializeSSE() {
        const eventSource = new EventSource('/stream');
        eventSource.onmessage = function(event) {
            const tablesData = JSON.parse(event.data);
            updateTables(tablesData);
        };
    }

    function showStartModal(tableId) {
        selectedTableId = tableId;
        document.getElementById('customerName').value = '';
        startModal.show();
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
        const customerName = document.getElementById('customerName').value;
        if (!customerName) return;

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
            startTimer(selectedTableId);
        }
    }

    async function stopSession(tableId) {
        const table = tables[tableId];
        const tableEl = table.element;
        
        const response = await fetch(`/table/${tableId}/stop`, {
            method: 'POST'
        });
        
        const data = await response.json();
        if (data.status === 'success') {
            clearInterval(table.timer);
            table.timer = null;
            table.startTime = null;
            
            const actualDuration = data.actual_duration;
            const finalCost = data.final_cost;
            const minimumApplied = data.minimum_applied;
            
            showSummaryModal(
                formatDuration(actualDuration * 60),
                finalCost,
                actualDuration,
                minimumApplied
            );
        }
    }

    function updateTables(tablesData) {
        tablesData.forEach(tableData => {
            const table = tables[tableData.id];
            if (!table) return;

            const tableEl = table.element;
            const isOccupied = tableData.is_occupied;

            // Update status
            tableEl.dataset.status = isOccupied ? 'occupied' : 'available';
            tableEl.querySelector('.status-text').textContent = isOccupied ? 'Occupied' : 'Available';

            // Update customer info visibility
            const customerInfo = tableEl.querySelector('.customer-info');
            customerInfo.classList.toggle('d-none', !isOccupied);

            // Update buttons
            tableEl.querySelector('.btn-start').classList.toggle('d-none', isOccupied);
            tableEl.querySelector('.btn-stop').classList.toggle('d-none', !isOccupied);

            if (isOccupied) {
                // Update customer name
                tableEl.querySelector('.customer-name').textContent = tableData.customer_name;

                // Start or update timer if not already running
                if (!table.timer && tableData.start_time) {
                    table.startTime = new Date(tableData.start_time);
                }
            }
        });
    }

    function startTimer(tableId) {
        const table = tables[tableId];
        const tableEl = table.element;

        table.timer = setInterval(() => {
            const now = new Date();
            const elapsedTime = Math.max(0, now - table.startTime);
            const elapsedMinutes = elapsedTime / (1000 * 60);
            const actualMinutes = Math.max(MINIMUM_MINUTES, elapsedMinutes);
            
            tableEl.querySelector('.timer').textContent = formatDuration(elapsedTime / 1000);
            
            const cost = (actualMinutes / 60) * RATE_PER_HOUR;
            tableEl.querySelector('.cost').textContent = cost.toFixed(2);
        }, 1000);
    }
    
    function formatDuration(totalSeconds) {
        const hours = Math.floor(totalSeconds / 3600);
        const minutes = Math.floor((totalSeconds % 3600) / 60);
        const seconds = Math.floor(totalSeconds % 60);
        return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
    }
});
