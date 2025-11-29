(function (window, document) {
  "use strict";

  const range = document.getElementById('range');
  const tbody = document.getElementById('tbody');
  const updatedAt = document.getElementById('updatedAt');
  const REFRESH_MS = 15000;
  let refreshTimer = null;

  async function loadReports(showTimestamp = true) {
    try {
      const r = await fetch(`/api/reports?range=${encodeURIComponent(range.value)}&_=${Date.now()}`, { cache: 'no-store' });
      if (!r.ok) throw new Error('Failed');
      const rows = await r.json();
      tbody.innerHTML = '';
      rows.forEach(row => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
          <td>${row.bucket}</td>
          <td>${Number(row.avg_soil_moisture||0).toFixed(1)}</td>
          <td>${Number(row.avg_temperature||0).toFixed(1)}</td>
          <td>${Number(row.avg_humidity||0).toFixed(1)}</td>
          <td>${Number(row.total_liters||0).toFixed(1)}</td>
        `;
        tbody.appendChild(tr);
      });
      if (showTimestamp && updatedAt) {
        updatedAt.textContent = `Last updated: ${new Date().toLocaleTimeString()}`;
      }
    } catch(e) {
      tbody.innerHTML = '<tr><td colspan="5">Failed to load report</td></tr>';
      if (updatedAt) updatedAt.textContent = 'Last updated: error';
    }
  }

  function kickOffAutoRefresh() {
    if (refreshTimer) clearInterval(refreshTimer);
    refreshTimer = setInterval(loadReports, REFRESH_MS);
  }

  // Refresh button
  document.getElementById('refresh').addEventListener('click', () => loadReports(true));

  // CSV download
  document.getElementById('downloadCsv').addEventListener('click', () => {
    window.location.href = `/api/reports?range=${encodeURIComponent(range.value)}&export=csv`;
  });

  // PDF download - fixed to use blob download
  document.getElementById('downloadPdf').addEventListener('click', async () => {
    try {
      const response = await fetch(`/api/reports?range=${encodeURIComponent(range.value)}&export=pdf`, {
        cache: 'no-store'
      });
      
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      
      // Get blob from response
      const blob = await response.blob();
      
      // Create download link
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'report.pdf';
      document.body.appendChild(a);
      a.click();
      
      // Cleanup
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (error) {
      console.error('PDF download failed:', error);
      alert('Failed to download PDF. Please try again.');
    }
  });

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) {
      loadReports(true);
    }
  });

  if (window.AppShell) {
    window.AppShell.onStatus(() => loadReports(false));
    window.AppShell.rebindToggles();
  }

  loadReports(true);
  kickOffAutoRefresh();
})(window, document);

