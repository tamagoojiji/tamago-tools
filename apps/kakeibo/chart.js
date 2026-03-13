/**
 * かんたん家計簿 Chart.js ラッパー
 * Chart.js CDN を使用
 */
var KakeiboChart = (function () {
  "use strict";

  var pieChart = null;
  var barChart = null;
  var lineChart = null;

  var CATEGORY_COLORS = {
    "食費": "#FF6384",
    "日用品": "#36A2EB",
    "交通費": "#FFCE56",
    "住居費": "#4BC0C0",
    "水道光熱費": "#9966FF",
    "通信費": "#FF9F40",
    "保険": "#C9CBCF",
    "医療費": "#7BC8A4",
    "教育費": "#E7E9ED",
    "趣味・娯楽": "#F7464A",
    "衣服・美容": "#D4A5A5",
    "交際費": "#A3D977",
    "子ども": "#FFB6C1",
    "ペット": "#DEB887",
    "車両費": "#87CEEB",
    "その他": "#BDBDBD"
  };

  function getColor(category) {
    return CATEGORY_COLORS[category] || "#BDBDBD";
  }

  // カテゴリ別円グラフ
  function renderPie(canvasId, categoryData) {
    var canvas = document.getElementById(canvasId);
    if (!canvas) return;

    if (pieChart) pieChart.destroy();

    var labels = categoryData.map(function (d) { return d.category; });
    var values = categoryData.map(function (d) { return d.total; });
    var colors = categoryData.map(function (d) { return getColor(d.category); });

    pieChart = new Chart(canvas, {
      type: "doughnut",
      data: {
        labels: labels,
        datasets: [{
          data: values,
          backgroundColor: colors,
          borderWidth: 2,
          borderColor: "#fff"
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: true,
        plugins: {
          legend: {
            position: "bottom",
            labels: { font: { size: 11 }, padding: 12 }
          },
          tooltip: {
            callbacks: {
              label: function (ctx) {
                var total = ctx.dataset.data.reduce(function (a, b) { return a + b; }, 0);
                var pct = Math.round(ctx.raw / total * 100);
                return ctx.label + ": ¥" + ctx.raw.toLocaleString() + " (" + pct + "%)";
              }
            }
          }
        }
      }
    });
  }

  // 日別棒グラフ
  function renderBar(canvasId, dailyData) {
    var canvas = document.getElementById(canvasId);
    if (!canvas) return;

    if (barChart) barChart.destroy();

    var labels = dailyData.map(function (d) { return d.label; });
    var values = dailyData.map(function (d) { return d.total; });

    barChart = new Chart(canvas, {
      type: "bar",
      data: {
        labels: labels,
        datasets: [{
          data: values,
          backgroundColor: "rgba(245, 166, 35, 0.7)",
          borderColor: "#F5A623",
          borderWidth: 1,
          borderRadius: 4
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: true,
        plugins: { legend: { display: false } },
        scales: {
          x: {
            grid: { display: false },
            ticks: { font: { size: 10 } }
          },
          y: {
            beginAtZero: true,
            ticks: {
              font: { size: 10 },
              callback: function (v) { return "¥" + v.toLocaleString(); }
            }
          }
        }
      }
    });
  }

  // 累計折れ線グラフ（予算比較）
  function renderLine(canvasId, dailyData, budgetTotal) {
    var canvas = document.getElementById(canvasId);
    if (!canvas) return;

    if (lineChart) lineChart.destroy();

    var labels = dailyData.map(function (d) { return d.label; });
    var cumulative = [];
    var sum = 0;
    for (var i = 0; i < dailyData.length; i++) {
      sum += dailyData[i].total;
      cumulative.push(sum);
    }

    var datasets = [{
      label: "累計支出",
      data: cumulative,
      borderColor: "#F5A623",
      backgroundColor: "rgba(245, 166, 35, 0.1)",
      fill: true,
      tension: 0.3,
      pointRadius: 2
    }];

    if (budgetTotal > 0) {
      datasets.push({
        label: "予算",
        data: labels.map(function () { return budgetTotal; }),
        borderColor: "#E74C3C",
        borderDash: [6, 4],
        pointRadius: 0,
        fill: false
      });
    }

    lineChart = new Chart(canvas, {
      type: "line",
      data: { labels: labels, datasets: datasets },
      options: {
        responsive: true,
        maintainAspectRatio: true,
        plugins: {
          legend: {
            position: "bottom",
            labels: { font: { size: 11 } }
          }
        },
        scales: {
          x: {
            grid: { display: false },
            ticks: { font: { size: 10 } }
          },
          y: {
            beginAtZero: true,
            ticks: {
              font: { size: 10 },
              callback: function (v) { return "¥" + v.toLocaleString(); }
            }
          }
        }
      }
    });
  }

  function destroyAll() {
    if (pieChart) { pieChart.destroy(); pieChart = null; }
    if (barChart) { barChart.destroy(); barChart = null; }
    if (lineChart) { lineChart.destroy(); lineChart = null; }
  }

  return {
    renderPie: renderPie,
    renderBar: renderBar,
    renderLine: renderLine,
    destroyAll: destroyAll,
    getColor: getColor
  };
})();
