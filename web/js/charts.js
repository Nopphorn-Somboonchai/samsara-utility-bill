/**
 * ============================================================================
 * Samsara Utility Bill — Chart.js Manager (charts.js)
 * จัดการกราฟสรุปทั้งบ้านพักรายเดือน และกราฟประวัติการใช้ไฟรายบุคคล
 * ============================================================================
 */

(function (global) {
  'use strict';

  const SamsaraApp = (global.SamsaraApp = global.SamsaraApp || {});

  let houseTrendChart = null;
  let residentTrendChart = null;

  function formatShortMonth(cycleId, fallbackLabel) {
    const shortMonths = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
    const match = String(cycleId || '').match(/^(\d{4})-(\d{2})$/);
    if (match) {
      const mIdx = parseInt(match[2], 10) - 1;
      const yearThShort = String(parseInt(match[1], 10) + 543).slice(-2);
      if (mIdx >= 0 && mIdx < 12) {
        return `${shortMonths[mIdx]} ${yearThShort}`;
      }
    }
    return fallbackLabel || cycleId;
  }

  function destroyAllCharts() {
    if (houseTrendChart) {
      houseTrendChart.destroy();
      houseTrendChart = null;
    }
    if (residentTrendChart) {
      residentTrendChart.destroy();
      residentTrendChart = null;
    }
  }

  /**
   * กราฟที่ 1: แนวโน้มค่าไฟรวม (บาท) และจำนวนหน่วยไฟที่ใช้ทั้งบ้านพักรายเดือนตลอดปี
   */
  function renderHouseTrendChart(canvasEl, monthlySummary) {
    if (!canvasEl || typeof global.Chart === 'undefined') return;

    if (houseTrendChart) {
      houseTrendChart.destroy();
      houseTrendChart = null;
    }

    const labels = monthlySummary.map((m) => formatShortMonth(m.cycle_id, m.month_label));
    const electricCosts = monthlySummary.map((m) => m.total_electric);
    const totalUnits = monthlySummary.map((m) => m.total_units);

    houseTrendChart = new global.Chart(canvasEl, {
      type: 'bar',
      data: {
        labels,
        datasets: [
          {
            type: 'bar',
            label: 'ค่าไฟรวม (บาท)',
            data: electricCosts,
            backgroundColor: '#1D5C92',
            borderRadius: 6,
            maxBarThickness: 36,
            yAxisID: 'yBaht'
          },
          {
            type: 'line',
            label: 'หน่วยไฟรวม (หน่วย)',
            data: totalUnits,
            borderColor: '#D97706',
            backgroundColor: '#D97706',
            borderWidth: 2,
            pointRadius: 4,
            pointHoverRadius: 6,
            tension: 0.25,
            yAxisID: 'yUnits'
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: {
          mode: 'index',
          intersect: false
        },
        plugins: {
          legend: {
            position: 'bottom',
            labels: {
              usePointStyle: true,
              boxWidth: 10,
              padding: 16,
              color: '#334155',
              font: {
                family: "'Sarabun', sans-serif",
                size: 13
              }
            }
          },
          tooltip: {
            backgroundColor: '#0F172A',
            padding: 12,
            cornerRadius: 8,
            titleFont: {
              family: "'Prompt', sans-serif",
              size: 13
            },
            bodyFont: {
              family: "'Sarabun', sans-serif",
              size: 13
            },
            callbacks: {
              label(ctx) {
                const val = Number(ctx.parsed.y || 0).toLocaleString('th-TH');
                return ctx.datasetIndex === 0
                  ? ` ค่าไฟรวม: ${val} บาท`
                  : ` ใช้ไฟรวม: ${val} หน่วย`;
              }
            }
          }
        },
        scales: {
          x: {
            grid: { display: false },
            ticks: {
              color: '#475569',
              font: { family: "'Sarabun', sans-serif", size: 12 }
            }
          },
          yBaht: {
            type: 'linear',
            position: 'left',
            beginAtZero: true,
            grid: { color: '#E2E8F0' },
            ticks: {
              color: '#475569',
              font: { family: "'Sarabun', sans-serif", size: 12 },
              callback(value) {
                return Number(value).toLocaleString('th-TH');
              }
            },
            title: {
              display: true,
              text: 'บาท',
              color: '#64748B',
              font: { family: "'Sarabun', sans-serif", size: 12 }
            }
          },
          yUnits: {
            type: 'linear',
            position: 'right',
            beginAtZero: true,
            grid: { drawOnChartArea: false },
            ticks: {
              color: '#B45309',
              font: { family: "'Sarabun', sans-serif", size: 12 }
            },
            title: {
              display: true,
              text: 'หน่วย',
              color: '#B45309',
              font: { family: "'Sarabun', sans-serif", size: 12 }
            }
          }
        }
      }
    });
  }

  /**
   * กราฟที่ 2: ประวัติการใช้ไฟรายบุคคล (รองรับทั้งผู้พักปัจจุบันและผู้ย้ายออกแล้ว)
   */
  function renderResidentTrendChart(canvasEl, recordsForResident) {
    if (!canvasEl || typeof global.Chart === 'undefined') return;

    if (residentTrendChart) {
      residentTrendChart.destroy();
      residentTrendChart = null;
    }

    const labels = recordsForResident.map((r) => formatShortMonth(r.cycle_id, r.month_label));
    const unitsData = recordsForResident.map((r) => r.units_used);
    const totalData = recordsForResident.map((r) => r.total_cost);

    residentTrendChart = new global.Chart(canvasEl, {
      type: 'bar',
      data: {
        labels,
        datasets: [
          {
            type: 'bar',
            label: 'หน่วยไฟที่ใช้ (หน่วย)',
            data: unitsData,
            backgroundColor: '#2C77BD',
            borderRadius: 6,
            maxBarThickness: 36,
            yAxisID: 'yUnits'
          },
          {
            type: 'line',
            label: 'ยอดรวมน้ำและไฟ (บาท)',
            data: totalData,
            borderColor: '#047857',
            backgroundColor: '#047857',
            borderWidth: 2,
            pointRadius: 4,
            pointHoverRadius: 6,
            tension: 0.25,
            yAxisID: 'yBaht'
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: {
          mode: 'index',
          intersect: false
        },
        plugins: {
          legend: {
            position: 'bottom',
            labels: {
              usePointStyle: true,
              boxWidth: 10,
              padding: 16,
              color: '#334155',
              font: {
                family: "'Sarabun', sans-serif",
                size: 13
              }
            }
          },
          tooltip: {
            backgroundColor: '#0F172A',
            padding: 12,
            cornerRadius: 8,
            titleFont: {
              family: "'Prompt', sans-serif",
              size: 13
            },
            bodyFont: {
              family: "'Sarabun', sans-serif",
              size: 13
            },
            callbacks: {
              label(ctx) {
                const val = Number(ctx.parsed.y || 0).toLocaleString('th-TH');
                return ctx.datasetIndex === 0
                  ? ` ใช้ไฟ: ${val} หน่วย`
                  : ` ยอดรวมบิล: ${val} บาท`;
              }
            }
          }
        },
        scales: {
          x: {
            grid: { display: false },
            ticks: {
              color: '#475569',
              font: { family: "'Sarabun', sans-serif", size: 12 }
            }
          },
          yUnits: {
            type: 'linear',
            position: 'left',
            beginAtZero: true,
            grid: { color: '#E2E8F0' },
            ticks: {
              color: '#475569',
              font: { family: "'Sarabun', sans-serif", size: 12 }
            },
            title: {
              display: true,
              text: 'หน่วย',
              color: '#64748B',
              font: { family: "'Sarabun', sans-serif", size: 12 }
            }
          },
          yBaht: {
            type: 'linear',
            position: 'right',
            beginAtZero: true,
            grid: { drawOnChartArea: false },
            ticks: {
              color: '#047857',
              font: { family: "'Sarabun', sans-serif", size: 12 },
              callback(value) {
                return Number(value).toLocaleString('th-TH');
              }
            },
            title: {
              display: true,
              text: 'บาท',
              color: '#047857',
              font: { family: "'Sarabun', sans-serif", size: 12 }
            }
          }
        }
      }
    });
  }

  SamsaraApp.destroyAllCharts = destroyAllCharts;
  SamsaraApp.renderHouseTrendChart = renderHouseTrendChart;
  SamsaraApp.renderResidentTrendChart = renderResidentTrendChart;
})(typeof window !== 'undefined' ? window : globalThis);
