const logoPath = "../public/serenity-hue-logo-black.png";

const reports = {
  product: {
    title: "Product Performance Report",
    subtitle: "Sales insights · product growth · a more radiant tomorrow",
    note: "Beauty drives a brighter tomorrow",
    kpis: [
      ["bag", "Net Product Sales", "$728,450", "+18.3%"],
      ["box", "Net Units Sold", "56,320", "+22.1%"],
      ["bars", "Average Sell-Through", "78%", "+6.4 pp"],
      ["tag", "Active SKUs", "24", "+4 new"]
    ]
  },
  customer: {
    title: "Customer Performance Report",
    subtitle: "Real customers · lasting relationships · a more radiant tomorrow",
    note: "Beauty builds brighter connections",
    kpis: [
      ["users", "Total Active Customers", "12,480", "+24.6%"],
      ["user-plus", "New Customers", "4,320", "+28.1%"],
      ["repeat", "Repeat Customers", "8,160", "+22.4%"],
      ["coins", "Average Customer Spend", "$58.40", "+12.8%"],
      ["bag", "Average Order Value", "$42.70", "+10.3%"]
    ]
  },
  orders: {
    title: "Orders & Sales Report",
    subtitle: "Orders · channels · customer love · a more radiant tomorrow",
    note: "Real orders · brighter people",
    kpis: [
      ["bag", "Net Merchandise Sales", "$728,450", "+18.3%"],
      ["cart", "Paid Orders", "14,562", "+21.6%"],
      ["bars", "Average Order Value", "$50.04", "+2.1%"],
      ["box", "Net Units Sold", "56,320", "+22.1%"]
    ]
  },
  ads: {
    title: "TikTok Ads Report",
    subtitle: "Creative beauty · real connections · a more radiant tomorrow",
    note: "TikTok ads drive beauty discoveries",
    kpis: [
      ["megaphone", "Ad Spend", "$98,450", "+24.3%"],
      ["bag", "TikTok-Attributed Revenue", "$728,450", "+28.7%"],
      ["cart", "Attributed Purchases", "5,420", "+32.1%"],
      ["bars", "ROAS", "7.40×", "+3.1 pp"],
      ["eye", "Impressions", "4.85M", "+19.6%"],
      ["cursor", "Clicks", "86,320", "+27.8%"]
    ]
  },
  affiliate: {
    title: "TikTok Affiliate Report",
    subtitle: "Creators · content · conversions · a more radiant tomorrow",
    note: "Real creators · real beauty impact",
    kpis: [
      ["bag", "Affiliate-Attributed Net Sales", "$495,346", "+32.4%"],
      ["coins", "Estimated Commission", "$74,302", "+31.8%"],
      ["cart", "Attributed Orders", "8,420", "+27.6%"],
      ["box", "Attributed Units", "11,952", "+29.1%"],
      ["users", "Active Creators", "58", "+26.1%"],
      ["play", "Published Videos", "312", "+41.8%"]
    ]
  }
};

function icon(name) {
  const icons = {
    bag: '<path d="M5 8h10l1 9H4l1-9Z"/><path d="M7 8V6a3 3 0 0 1 6 0v2"/>',
    box: '<path d="m4 6 6-3 6 3-6 3-6-3Z"/><path d="M4 6v7l6 3 6-3V6"/><path d="M10 9v7"/>',
    bars: '<path d="M4 16V9h3v7H4Zm5 0V5h3v11H9Zm5 0V2h3v14h-3Z"/>',
    tag: '<path d="m3 9 6-6h6l2 2v6l-6 6-8-8Z"/><circle cx="13" cy="6" r="1"/>',
    users: '<circle cx="8" cy="7" r="3"/><circle cx="15" cy="8" r="2.4"/><path d="M2 17c.7-3 2.8-4.5 6-4.5s5.3 1.5 6 4.5M13 13c2.5 0 4.2 1.2 5 3.5"/>',
    "user-plus": '<circle cx="8" cy="7" r="3"/><path d="M2 17c.7-3 2.8-4.5 6-4.5s5.3 1.5 6 4.5M15 6v5M12.5 8.5h5"/>',
    repeat: '<path d="M4 7h10l-2-2M16 13H6l2 2"/><path d="M14 5l2 2-2 2M6 11l-2 2 2 2"/>',
    coins: '<circle cx="7" cy="7" r="3"/><circle cx="12" cy="11" r="3"/><path d="M4 7v4M9 11v4M15 11v4"/>',
    cart: '<circle cx="7" cy="16" r="1"/><circle cx="14" cy="16" r="1"/><path d="M2 3h2l2 10h9l2-7H5"/>',
    megaphone: '<path d="m3 10 10-4v8L3 11v-1Z"/><path d="M13 8h3v4h-3M5 12l1 4h2l-1-4"/>',
    eye: '<path d="M2 10s3-5 8-5 8 5 8 5-3 5-8 5-8-5-8-5Z"/><circle cx="10" cy="10" r="2"/>',
    cursor: '<path d="m4 3 4 14 2-6 6-2L4 3Z"/>',
    play: '<path d="m7 4 9 6-9 6V4Z"/>'
  };
  return '<svg viewBox="0 0 20 20" aria-hidden="true">' + (icons[name] || icons.bars) + "</svg>";
}

function kpiCard(item) {
  return '<div class="kpi-card"><div class="kpi-top"><span class="kpi-icon">' + icon(item[0]) + '</span><span class="kpi-label">' + item[1] + '</span></div><div class="kpi-value">' + item[2] + '</div><div class="kpi-delta">▲ ' + item[3] + ' <span>vs. previous period</span></div></div>';
}

function panel(title, kicker, body, span) {
  return '<section class="panel span-' + (span || 4) + '"><div class="panel-head"><div><h2 class="panel-title">' + title + '</h2><div class="panel-kicker">' + kicker + '</div></div></div>' + body + '</section>';
}

function bars(rows) {
  return '<div class="bars">' + rows.map(function(row) {
    return '<div class="bar-row"><div class="bar-label">' + row[0] + '</div><div class="bar-track"><div class="bar-fill ' + (row[3] || '') + '" style="width:' + row[1] + '%"></div></div><div class="bar-value">' + row[2] + '</div></div>';
  }).join("") + "</div>";
}

function ranking(rows) {
  return '<div>' + rows.map(function(row, index) {
    return '<div class="rank-row"><div class="rank">' + (index + 1) + '</div><div><div class="rank-name">' + row[0] + '</div><div class="rank-line" style="--width:' + row[1] + '%"></div></div><div class="rank-total">' + row[2] + '</div></div>';
  }).join("") + "</div>";
}

function lineChart(points, secondPoints) {
  const width = 520;
  const height = 130;
  const padX = 26;
  const padY = 17;
  const all = points.concat(secondPoints || []);
  const max = Math.max.apply(null, all) * 1.08;
  const x = function(i) { return padX + i * ((width - padX * 2) / (points.length - 1)); };
  const y = function(value) { return height - padY - (value / max) * (height - padY * 2); };
  const path = points.map(function(v, i) { return (i ? "L" : "M") + x(i).toFixed(1) + " " + y(v).toFixed(1); }).join(" ");
  const area = path + " L " + x(points.length - 1).toFixed(1) + " " + (height - padY) + " L " + x(0).toFixed(1) + " " + (height - padY) + " Z";
  const alt = secondPoints ? secondPoints.map(function(v, i) { return (i ? "L" : "M") + x(i).toFixed(1) + " " + y(v).toFixed(1); }).join(" ") : "";
  const labels = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  const grids = [0.2, 0.45, 0.7, 0.95].map(function(rate) {
    const gy = padY + (height - padY * 2) * rate;
    return '<line class="chart-grid" x1="' + padX + '" x2="' + (width - padX) + '" y1="' + gy + '" y2="' + gy + '"/>';
  }).join("");
  const dots = points.map(function(v, i) { return '<circle class="chart-dot" cx="' + x(i) + '" cy="' + y(v) + '" r="2.8"/>'; }).join("");
  const xLabels = labels.slice(0, points.length).map(function(label, i) { return '<text class="chart-axis" x="' + x(i) + '" y="126" text-anchor="middle">' + label + '</text>'; }).join("");
  return '<div class="chart"><svg viewBox="0 0 ' + width + ' ' + height + '" role="img" aria-label="Trend chart">' + grids + '<path class="chart-area" d="' + area + '"/><path class="chart-line" d="' + path + '"/>' + (secondPoints ? '<path class="chart-line alt" d="' + alt + '"/>' : "") + dots + xLabels + '</svg></div>';
}

function donut(primary, center, keyA, keyB) {
  return '<div class="donut-layout"><div class="donut" style="background:conic-gradient(var(--plum) 0 ' + primary + '%, #db86b4 ' + primary + '% 100%)" data-center="' + center + '"></div><div class="donut-key"><div><strong>' + keyA[0] + '</strong><span>' + keyA[1] + '</span></div><div><strong>' + keyB[0] + '</strong><span>' + keyB[1] + '</span></div></div></div>';
}

function matrix(rows) {
  const header = ["", "50ml", "100ml", "200ml", "Travel", "Total"];
  return '<div class="matrix">' + header.map(function(x) { return '<div><strong>' + x + '</strong></div>'; }).join("") + rows.map(function(row) {
    return '<div class="matrix-label">' + row[0] + '</div>' + row.slice(1).map(function(value) { return '<div class="heat-' + Math.min(4, Math.max(1, Math.round(value / 25))) + '">' + value + '%</div>'; }).join("");
  }).join("") + "</div>";
}

function heatmap() {
  const rows = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  let html = '<div class="heatmap"><div></div>';
  ["12a","4a","8a","12p","4p","8p","12a","4a","8a","12p","4p","8p"].forEach(function(x) { html += '<div class="heat-label">' + x + '</div>'; });
  rows.forEach(function(label, r) {
    html += '<div class="heat-label">' + label + '</div>';
    for (let c = 0; c < 12; c += 1) {
      const value = Math.min(4, Math.max(1, Math.round((Math.sin((c + r) * 0.7) + 1.4) * 1.5)));
      html += '<div class="heat-' + value + '"></div>';
    }
  });
  return html + "</div>";
}

function scatter(labels) {
  const dots = [[14,76],[29,61],[42,49],[53,34],[67,25],[80,13]];
  return '<div class="scatter">' + dots.map(function(pos, i) {
    return '<span class="scatter-dot ' + (i === dots.length - 1 ? "dark" : "") + '" style="left:' + pos[0] + '%;bottom:' + pos[1] + '%"></span><span class="scatter-label" style="left:' + (pos[0] + 2) + '%;bottom:' + (pos[1] + 5) + '%">' + labels[i] + '</span>';
  }).join("") + '</div><div class="small-note">Each point represents a campaign or creator in the selected period.</div>';
}

function header(report) {
  return '<header class="report-header"><div><img class="brand-logo" src="' + logoPath + '" alt="Serenity Hue by Shabina" /></div><div class="brand-copy">Skincare that<br />brings out a calmer,<br />brighter you.</div><div class="brand-mantra">Beauty<br />in Balance</div><div class="report-period"><div class="period-label">Report period</div><div class="period-value">Jan — Dec 2024</div><div class="period-note">' + report.note + '</div></div><div class="report-heading"><h1>Serenity Hue<br />' + report.title + '</h1><p>' + report.subtitle + '</p></div></header>';
}

function footer() {
  return '<div class="closing-lockup"><div class="closing-script">More Beauty<br />Ahead</div><div class="closing-copy">Same kinder<br />brighter you</div></div><footer class="footer"><span>Serenity Hue by Shabina</span><span class="footer-center">Beauty drives a brighter tomorrow</span><span>Jan — Dec 2024</span></footer>';
}

function productReport(report) {
  return header(report) +
    '<div class="kpi-grid">' + report.kpis.map(kpiCard).join("") + '</div>' +
    '<div class="report-grid">' +
      panel("Top-Selling Products", "By units sold", bars([["Glow Veil Serum",96,"12,480"],["Silk Reset Cleanser",72,"9,230","soft"],["Petal Dew Toner",58,"8,420","soft"],["Velvet Cloud Cream",53,"7,960","soft"],["Moonmilk Mask",42,"6,750","soft"]]), 5) +
      panel("Product Revenue Ranking", "By net sales", ranking([["Glow Veil Serum",91,"$186,720"],["Velvet Cloud Cream",71,"$132,860"],["Silk Reset Cleanser",63,"$118,430"],["Satin SPF Mist",51,"$96,170"],["Petal Dew Toner",43,"$78,320"]]), 4) +
      panel("Channel Contribution", "By net sales", donut(68,"68%","Shopify|$495,346".split("|"),"TikTok Shop|$233,104".split("|")), 3) +
      panel("Product Sales Trend", "Monthly net sales (USD)", '<div class="panel-head"><span></span><div class="trend-note">▲ +18.3%<small>vs. previous year</small></div></div>' + lineChart([50,41,43,60,53,62,72,81,90,92,107,116]), 7) +
      panel("Variant Performance", "Sell-through rate by variant", matrix([["Glow Veil Serum",92,88,76,68,84],["Silk Reset Cleanser",85,82,74,62,76],["Petal Dew Toner",78,80,69,58,71],["Velvet Cloud Cream",90,86,81,66,81],["Moonmilk Mask",72,68,61,54,64]]), 5) +
      panel("Stock Coverage", "Weeks of coverage", bars([["Glow Veil Serum",92,"14 weeks","green"],["Silk Reset Cleanser",76,"11 weeks","green"],["Petal Dew Toner",54,"6 weeks","orange"],["Velvet Cloud Cream",70,"10 weeks","green"],["Moonmilk Mask",45,"5 weeks","orange"],["Satin SPF Mist",27,"3 weeks","red"]]), 5) +
      panel("Physical vs Channel Stock", "Units", bars([["Glow Veil Serum",86,"4,800 / 3,200"],["Silk Reset Cleanser",72,"3,600 / 2,400","soft"],["Petal Dew Toner",61,"2,800 / 2,100","soft"],["Velvet Cloud Cream",67,"3,200 / 2,600","soft"],["Moonmilk Mask",48,"1,900 / 1,800","soft"]]), 4) +
      panel("Attention Notes", "Visible data boundaries", '<div class="callout">Low stock items <strong>2</strong><br /><br />Unmapped product lines <strong>3</strong></div><div class="small-note">Illustrative preview data. Production values will come from the reporting view model.</div>', 3) +
    '</div>' + footer();
}

function customerReport(report) {
  return header(report) +
    '<div class="kpi-grid five">' + report.kpis.map(kpiCard).join("") + '</div>' +
    '<div class="report-grid">' +
      panel("New vs Repeat Customers", "Share of total customers", donut(66,"12,480","New customers|4,320 (34%)".split("|"),"Repeat customers|8,160 (66%)".split("|")) + '<div class="callout">Loyal customers are the heart of a brighter tomorrow.</div>', 4) +
      panel("Top Customers by Spend", "Total spend (USD)", ranking([["Ayesha Malik",88,"$1,248"],["Sana Rauf",70,"$980"],["Hira Siddiqui",62,"$870"],["Noor Fatima",54,"$760"],["Alina Hussain",47,"$690"]]), 5) +
      panel("Shopify vs TikTok Customers", "Share of total customers", donut(58,"12,480","Shopify|7,238 (58%)".split("|"),"TikTok Shop|5,242 (42%)".split("|")) + '<div class="callout">Different platforms.<br />The same brighter people.</div>', 3) +
      panel("Customer Activity Trend", "Monthly active customers", '<div class="panel-head"><span></span><div class="trend-note">▲ +24.6%<small>vs. previous year</small></div></div>' + lineChart([7,6.8,8.1,8.6,9.5,9.4,10.1,10.8,11.1,11.7,12.4,12.48]), 7) +
      panel("Repeat-Customer Contribution", "Share of revenue & orders", donut(72,"72%","Revenue|$524,484".split("|"),"from repeat customers|".split("|")) + '<div class="small-note">Revenue and orders from repeat customers remain visible as separate measures.</div>', 5) +
      panel("Customer Value Distribution", "By total spend per customer", bars([["Under $25",82,"3,494"],["$25 — $50",100,"4,244"],["$51 — $100",65,"2,746"],["$101 — $200",42,"1,372"],["Over $200",20,"624","soft"]]), 4) +
      panel("Channel Preference", "Preferred shopping channel", bars([["Shopify",85,"58%"],["TikTok Shop",64,"42%","soft"],["Website",30,"18%","soft"],["Instagram",20,"12%","soft"],["Other",8,"4%","soft"]]), 4) +
      panel("Customer Health Indicators", "Derived only where definitions exist", '<div class="status-list">' + [["Customer retention rate","65%","green"],["VIP customers","5%","soft"],["At risk / lapsed","12%","orange"]].map(function(r) { return '<div class="status-row"><div class="status-label">' + r[0] + '</div><div class="status-track"><div class="status-fill ' + r[2] + '" style="width:' + parseInt(r[1],10) + '%"></div></div><div class="status-value">' + r[1] + '</div></div>'; }).join("") + '</div><div class="small-note">Preview-only indicators; production definitions must be approved before integration.</div>', 4) +
    '</div>' + footer();
}

function ordersReport(report) {
  return header(report) +
    '<div class="kpi-grid">' + report.kpis.map(kpiCard).join("") + '</div>' +
    '<div class="report-grid">' +
      panel("Orders by Channel", "Total orders & share", bars([["Shopify",100,"9,842 · 67.6%"],["TikTok Shop",48,"4,720 · 32.4%","soft"]]), 5) +
      panel("Monthly Sales Trend", "Net merchandise sales (USD)", '<div class="panel-head"><span></span><div class="trend-note">▲ +18.3%<small>vs. previous year</small></div></div>' + lineChart([50,43,47,60,55,63,73,81,88,91,106,116]), 7) +
      panel("Order Status", "By number of orders", '<div class="status-list">' + [["Paid","14,562 · 78.3%",100,""],["Cancelled","1,024 · 5.5%",25,"soft"],["Refunded","892 · 4.8%",21,"soft"],["Pending","2,124 · 11.4%",33,"soft"]].map(function(r) { return '<div class="status-row"><div class="status-label">' + r[0] + '</div><div class="status-track"><div class="status-fill ' + r[3] + '" style="width:' + r[2] + '%"></div></div><div class="status-value">' + r[1] + '</div></div>'; }).join("") + '</div>', 4) +
      panel("Refund Impact", "Net sales impact (USD)", bars([["Gross sales",100,"$728,450"],["Returns & refunds",14,"($28,620)","red"],["Chargebacks",5,"($6,340)","red"],["Net sales",95,"$693,490"]]), 4) +
      panel("Fulfillment Status", "Of paid orders", bars([["Fulfilled",88,"12,862 · 88.4%"],["Processing",22,"1,142 · 7.8%","soft"],["On hold",10,"320 · 2.2%","soft"],["Failed",7,"238 · 1.6%","red"]]), 4) +
      panel("Shipment Status", "Of fulfilled orders", bars([["Delivered",87,"11,246 · 87.4%"],["In transit",26,"1,216 · 9.5%","soft"],["Out for delivery",12,"362 · 2.8%","soft"],["Exception",5,"38 · 0.3%","red"]]), 4) +
      panel("Order Activity Heatmap", "Orders by day & hour", heatmap() + '<div class="legend"><span class="legend-item"><i class="legend-dot light"></i>Low</span><span class="legend-item"><i class="legend-dot pink"></i>Moderate</span><span class="legend-item"><i class="legend-dot"></i>High</span><span class="legend-item"><i class="legend-dot" style="background:#7d2868"></i>Peak</span></div>', 5) +
      panel("Quick Comparison", "Vs. previous period", '<table class="mini-table"><tr><th>Metric</th><th>Current</th><th>Change</th></tr><tr><td>Orders</td><td>14,562</td><td class="status-value">▲ 21.6%</td></tr><tr><td>Net sales</td><td>$728,450</td><td class="status-value">▲ 18.3%</td></tr><tr><td>AOV</td><td>$50.04</td><td class="status-value">▲ 2.1%</td></tr><tr><td>Units sold</td><td>56,320</td><td class="status-value">▲ 22.1%</td></tr></table><div class="callout">2,124 pending orders<br /><small>Needs attention</small></div>', 3) +
    '</div>' + footer();
}

function adsReport(report) {
  return header(report) +
    '<div class="kpi-grid six">' + report.kpis.map(kpiCard).join("") + '</div>' +
    '<div class="report-grid">' +
      panel("Spend vs. Attributed Revenue Trend", "Monthly TikTok Ads performance", lineChart([52,64,80,94,96,111,126,143,151,164,183,214],[278,314,349,405,388,431,475,510,562,570,632,728]) + '<div class="legend"><span class="legend-item"><i class="legend-dot pink"></i>Ad spend</span><span class="legend-item"><i class="legend-dot"></i>Attributed revenue</span></div>', 7) +
      panel("Spend vs. Revenue", "Campaign performance", scatter(["Glow Burst","Dew Ritual","Velvet Reset","Satin Shield","Moonlit Repair","Top campaign"]), 5) +
      panel("Campaign Ranking", "By TikTok-attributed revenue", ranking([["Glow Burst",94,"$242,310"],["Dew Ritual",74,"$178,450"],["Velvet Reset",61,"$126,780"],["Satin Shield",49,"$98,320"],["Moonlit Repair",42,"$82,590"]]), 4) +
      panel("Ad-Group Performance", "Spend · purchases · ROAS", '<table class="mini-table"><tr><th>Ad group</th><th>Spend</th><th>Purchases</th><th>ROAS</th></tr><tr><td>Glow Burst</td><td>$32,450</td><td>1,860</td><td class="status-value">7.47×</td></tr><tr><td>Dew Ritual</td><td>$21,680</td><td>1,240</td><td class="status-value">8.23×</td></tr><tr><td>Velvet Reset</td><td>$16,240</td><td>980</td><td class="status-value">7.81×</td></tr><tr><td>Satin Shield</td><td>$15,320</td><td>760</td><td style="color:var(--orange)">6.42×</td></tr></table>', 4) +
      panel("ROAS Trend", "Monthly TikTok Ads ROAS", '<div class="trend-note">7.40×<small>Dec 2024</small></div>' + lineChart([4.1,4.6,5.3,5.0,6.0,6.5,7.0,6.8,7.5,7.2,8.1,7.4]), 4) +
      panel("Impressions → Clicks → Purchases", "TikTok Ads funnel (attributed)", '<div class="funnel"><div class="funnel-step"><span>Impressions</span><div class="funnel-bar" style="--width:100%"></div><strong>4.85M</strong></div><div class="funnel-step"><span>Clicks</span><div class="funnel-bar" style="--width:58%"></div><strong>86,320</strong></div><div class="funnel-step"><span>Purchases</span><div class="funnel-bar" style="--width:26%"></div><strong>5,420</strong></div></div><div class="small-note">CTR 1.78% · click-to-purchase rate 6.3%</div>', 5) +
      panel("Campaign Efficiency Matrix", "ROAS vs. CPC", '<table class="mini-table"><tr><th>Campaign</th><th>ROAS</th><th>CPC</th><th>Purchases</th></tr><tr><td>Dew Ritual</td><td>8.23×</td><td>$0.92</td><td>1,240</td></tr><tr><td>Glow Burst</td><td>7.47×</td><td>$1.04</td><td>1,860</td></tr><tr><td>Velvet Reset</td><td>7.81×</td><td>$0.88</td><td>980</td></tr><tr><td>Moonlit Repair</td><td>6.47×</td><td>$1.10</td><td>580</td></tr></table>', 3) +
    '</div>' + footer();
}

function affiliateReport(report) {
  return header(report) +
    '<div class="kpi-grid six">' + report.kpis.map(kpiCard).join("") + '</div>' +
    '<div class="report-grid">' +
      panel("Creator Leaderboard", "By affiliate-attributed net sales", ranking([["@glowwithsana",100,"$128,450"],["@skincarebyhina",75,"$96,320"],["@dewywithnoor",61,"$78,610"],["@beautywithayla",49,"$62,340"],["@softskinmira",39,"$48,920"]]), 5) +
      panel("Best-Performing Affiliate Products", "By attributed net sales", ranking([["Glow Veil Serum",100,"$186,720"],["Silk Reset Cleanser",62,"$102,580"],["Velvet Cloud Cream",48,"$78,450"],["Petal Dew Toner",40,"$66,320"],["Satin SPF Mist",35,"$61,276"]]), 4) +
      panel("Key Affiliate Metrics", "Provider-reported", '<div class="callout"><strong>Top creator</strong><br />@glowwithsana<br /><br /><strong>Avg. conversion per creator</strong><br />2.8%<br /><br /><strong>Estimated commission rate</strong><br />15.0%</div>', 3) +
      panel("Videos vs Attributed Sales", "Published videos and attributed net sales", lineChart([20,25,30,32,36,42,48,53,61,67,73,84],[30,35,40,46,48,55,59,66,72,78,86,96]) + '<div class="legend"><span class="legend-item"><i class="legend-dot pink"></i>Published videos</span><span class="legend-item"><i class="legend-dot"></i>Attributed net sales</span></div>', 7) +
      panel("Creator Efficiency", "Attributed net sales vs. published videos", scatter(["@softskinmira","@beautywithayla","@dewywithnoor","@skincarebyhina","@glowwithsana","Top creator"]), 5) +
      panel("Product by Creator Matrix", "Affiliate-attributed net sales", '<table class="mini-table"><tr><th>Creator</th><th>Glow Veil</th><th>Silk Reset</th><th>Velvet Cloud</th><th>Petal Dew</th></tr><tr><td>@glowwithsana</td><td>$48.2K</td><td>$26.4K</td><td>$20.1K</td><td>$18.6K</td></tr><tr><td>@skincarebyhina</td><td>$36.1K</td><td>$22.8K</td><td>$14.7K</td><td>$12.6K</td></tr><tr><td>@dewywithnoor</td><td>$28.4K</td><td>$18.9K</td><td>$13.2K</td><td>$10.4K</td></tr><tr><td>@beautywithayla</td><td>$22.6K</td><td>$14.1K</td><td>$11.9K</td><td>$8.8K</td></tr></table>', 5) +
      panel("Affiliate Trend", "Affiliate-attributed net sales", lineChart([210,190,205,288,265,312,349,390,428,463,481,552]), 4) +
      panel("Reconciled vs Unreconciled GMV", "TikTok affiliate GMV (USD)", donut(70,"$612K","Reconciled GMV|$428,736 · 70%".split("|"),"Unreconciled GMV|$183,744 · 30%".split("|")) + '<div class="small-note">Unreconciled GMV is estimated and may be adjusted by TikTok at a later date.</div>', 3) +
    '</div>' + footer();
}

function renderReport(key) {
  const report = reports[key] || reports.product;
  let content = "";
  if (key === "customer") content = customerReport(report);
  else if (key === "orders") content = ordersReport(report);
  else if (key === "ads") content = adsReport(report);
  else if (key === "affiliate") content = affiliateReport(report);
  else content = productReport(report);
  document.getElementById("report-root").innerHTML = '<article class="report-page">' + content + '</article>';
  document.querySelectorAll(".report-nav button").forEach(function(button) {
    button.classList.toggle("active", button.dataset.report === key);
  });
  document.title = "Serenity Hue — " + report.title;
}

function readReport() {
  const params = new URLSearchParams(window.location.search);
  return params.get("report") || window.location.hash.replace("#", "") || "product";
}

document.querySelectorAll(".report-nav button").forEach(function(button) {
  button.addEventListener("click", function() {
    const key = button.dataset.report;
    window.history.replaceState({}, "", "?report=" + key);
    renderReport(key);
  });
});

document.getElementById("print-report").addEventListener("click", function() {
  window.print();
});

renderReport(readReport());
