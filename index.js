const express = require("express");
const cors = require("cors");
const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3001;

// Application State
let userData = {
  remainingBudget: 12000,
  targetPayday: 25,
  transactions: [] 
};

// Logic to move payday to Friday if it lands on a weekend
function getActualPayday(year, month, targetDay) {
  let payday = new Date(year, month, targetDay);
  let dayOfWeek = payday.getDay(); // 0 = Sunday, 6 = Saturday
  if (dayOfWeek === 0) payday.setDate(payday.getDate() - 2); 
  else if (dayOfWeek === 6) payday.setDate(payday.getDate() - 1); 
  return payday;
}

function getBudgetData() {
  const now = new Date();
  let payday = getActualPayday(now.getFullYear(), now.getMonth(), userData.targetPayday);
  if (now >= payday.setHours(23, 59, 59)) {
    payday = getActualPayday(now.getFullYear(), now.getMonth() + 1, userData.targetPayday);
  }
  const diffInMs = payday - now;
  const daysLeft = Math.max(1, Math.ceil(diffInMs / (1000 * 60 * 60 * 24)));
  return {
    dailyLimit: Math.floor(userData.remainingBudget / daysLeft),
    daysLeft,
    paydayDate: payday.toLocaleDateString('sv-SE'),
    remainingBudget: userData.remainingBudget,
    transactions: userData.transactions
  };
}

// --- FRONTEND ---
app.get("/", (req, res) => {
  res.send(`
    <html>
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <style>
          body { font-family: sans-serif; text-align: center; padding: 20px; background: #f0f2f5; }
          .container { background: white; padding: 20px; border-radius: 20px; box-shadow: 0 4px 15px rgba(0,0,0,0.1); max-width: 400px; margin: auto; }
          h1 { font-size: 50px; margin: 10px 0; color: #2ecc71; }
          .label { color: #8a8d91; text-transform: uppercase; font-size: 10px; font-weight: bold; }
          .section { margin-top: 20px; border-top: 1px solid #eee; padding-top: 15px; }
          input { padding: 12px; border: 1px solid #ddd; border-radius: 10px; width: 100%; margin-bottom: 8px; box-sizing: border-box; }
          button { padding: 12px; background: #0084ff; color: white; border: none; border-radius: 10px; font-weight: bold; width: 100%; cursor: pointer; }
          .history-item { display: flex; justify-content: space-between; padding: 10px 0; border-bottom: 1px solid #eee; text-align: left; font-size: 14px; }
          .history-meta { font-size: 10px; color: #999; }
          .filters { display: flex; gap: 5px; margin-bottom: 10px; }
          .filter-btn { background: #e4e6eb; color: #4b4b4b; padding: 5px 10px; font-size: 12px; border-radius: 5px; width: auto; }
          .active { background: #0084ff; color: white; }
        </style>
      </head>
      <body>
        <div class="container">
          <p class="label">Du kan spendera</p>
          <h1 id="daily">...</h1>
          <p id="stats" style="font-size: 14px; color: #4b4b4b;"></p>

          <div class="section">
            <p class="label">Registrera köp</p>
            <input type="text" id="desc" placeholder="Vad köpte du?">
            <input type="number" id="amt" placeholder="Belopp">
            <button onclick="saveSpend()">Spara</button>
          </div>

          <div class="section" style="text-align: left;">
            <p class="label">Historik</p>
            <div class="filters">
              <button class="filter-btn active" id="f-all" onclick="setFilter('all')">Alla</button>
              <button class="filter-btn" id="f-week" onclick="setFilter('week')">Vecka</button>
              <button class="filter-btn" id="f-month" onclick="setFilter('month')">Månad</button>
            </div>
            <div id="list"></div>
          </div>
        </div>

        <script>
          let currentFilter = 'all';
          async function update() {
            const res = await fetch('/api/overview');
            const data = await res.json();
            document.getElementById('daily').innerText = data.dailyLimit + ':-';
            document.getElementById('stats').innerHTML = data.remainingBudget + ' kr kvar totalt<br>Lön: ' + data.paydayDate;
            render(data.transactions);
          }

          function render(transactions) {
            const list = document.getElementById('list');
            list.innerHTML = '';
            const now = new Date();
            
            let filtered = transactions.filter(t => {
              const d = new Date(t.timestamp);
              if(currentFilter === 'week') return (now - d) < 7 * 24 * 60 * 60 * 1000;
              if(currentFilter === 'month') return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
              return true;
            });

            filtered.reverse().forEach(t => {
              const item = document.createElement('div');
              item.className = 'history-item';
              item.innerHTML = '<div>' + t.description + '<br><span class="history-meta">' + new Date(t.timestamp).toLocaleDateString() + '</span></div><b>-' + t.amount + ' kr</b>';
              list.appendChild(item);
            });
          }

          function setFilter(f) {
            currentFilter = f;
            document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
            document.getElementById('f-' + f).classList.add('active');
            update();
          }

          async function saveSpend() {
            const amount = document.getElementById('amt').value;
            const description = document.getElementById('desc').value || 'Utgift';
            if(!amount) return;
            await fetch('/api/spend', {
              method: 'POST',
              headers: {'Content-Type': 'application/json'},
              body: JSON.stringify({ amount: Number(amount), description })
            });
            document.getElementById('amt').value = '';
            document.getElementById('desc').value = '';
            update();
          }
          update();
        </script>
      </body>
    </html>
  `);
});

// --- API ---
app.get("/api/overview", (req, res) => res.json(getBudgetData()));
app.post("/api/spend", (req, res) => {
  const { amount, description } = req.body;
  userData.remainingBudget -= amount;
  userData.transactions.push({ amount, description, timestamp: new Date() });
  res.json({ success: true });
});

app.listen(PORT, () => console.log("Running!"));
