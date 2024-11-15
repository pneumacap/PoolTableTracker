document.addEventListener('DOMContentLoaded', function() {
    const RATE_PER_HOUR = 30;
    const tables = {};
    let startModal;
    let selectedTableId;

    // Initialize tables and SSE
    initializeTables();
    initializeSSE();
    initializeModal();

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

    function initializeModal() {
        startModal = new bootstrap.Modal(document.getElementById('startSessionModal'));
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
        }
    }

    async function stopSession(tableId) {
        const response = await fetch(`/table/${tableId}/stop`, {
            method: 'POST'
        });
        
        const data = await response.json();
        if (data.status === 'success') {
            clearInterval(tables[tableId].timer);
            tables[tableId].timer = null;
            tables[tableId].startTime = null;
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

                // Start or update timer
                if (!table.timer) {
                    table.startTime = new Date(tableData.start_time);
                    startTimer(tableData.id);
                }
            }
        });
    }

    function startTimer(tableId) {
        const table = tables[tableId];
        const tableEl = table.element;

        table.timer = setInterval(() => {
            const now = new Date();
            const diff = now - table.startTime; // Time difference in milliseconds
            
            // Calculate hours, minutes, and seconds using proper division and modulo
            const totalSeconds = Math.floor(diff / 1000);
            const hours = Math.floor(totalSeconds / 3600);
            const minutes = Math.floor((totalSeconds % 3600) / 60);
            const seconds = totalSeconds % 60;

            // Update timer display with padded values
            tableEl.querySelector('.timer').textContent = 
                `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;

            // Update cost (using the exact time difference for accurate calculation)
            const hoursFraction = diff / (1000 * 60 * 60); // Convert milliseconds to hours
            const cost = (hoursFraction * RATE_PER_HOUR).toFixed(2);
            tableEl.querySelector('.cost').textContent = cost;
        }, 1000);
    }
});
