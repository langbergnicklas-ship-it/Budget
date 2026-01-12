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

/**
 * Logic to find the actual payday. 
 * If the date falls on a weekend, it moves to the preceding Friday.
 */
function getActualPayday(year, month, targetDay) {
  let payday = new Date(year, month, targetDay);
  let dayOfWeek = payday.getDay(); // 0 = Sunday, 6 = Saturday

  if (dayOfWeek === 0) { // Sunday
    payday.setDate(payday.getDate() - 2); 
  } else if (dayOfWeek === 6) { // Saturday
    payday.setDate(payday.getDate() - 1); 
  }
  return payday;
}

/**
 * Calculates budget details based on the current date and remaining funds.
 */
function getBudgetData() {
  const now = new Date();
  let payday = getActualPayday(now.getFullYear(), now.getMonth(), userData.targetPayday);

  // If payday has passed this month, look at next month
  if (now >= payday.setHours(23, 59, 59)) {
    payday = getActualPayday(now.getFullYear(), now.getMonth() + 1, userData.targetPayday);
  }

  const diffInMs = payday - now;
  const daysLeft = Math.max(1, Math.ceil(diffInMs / (1000 * 60 * 60 * 24)));
  const dailyLimit = Math.floor(userData.remainingBudget / daysLeft);

  return {
    dailyLimit,
    daysLeft,
    paydayDate: payday.toLocaleDateString('sv-SE'),
    remainingBudget: userData.remainingBudget,
    transactions: userData.transactions
  };
}

// --- FRONTEND (User Interface) ---
app.get("/", (req, res) => {
  res.send(`
    <html>
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <style>
          body { font-family: -apple-system, sans-serif; text-align: center; padding: 20px; background: #f8f9fa; color: #333; }
          .container { background: white; padding: 25px; border-radius: 20px; box-shadow: 0 4px 15px rgba(0,0,0,0.05); max-width: 400px; margin: auto; }
          h1 { font-size: 48px; margin: 10px 0; color: #2ecc71; }
          .label { color: #adb5bd; text-transform: uppercase; font-size: 10px; font-weight: bold; letter-spacing: 1px; }
          .section { margin-top: 25px; border-top: 1px solid #f1f3f5; padding-top: 20px; }
          input { padding: 12px; border: 1px solid #dee2e6; border-radius: 10px; width: 100%; margin-bottom: 10px; box-sizing: border-box; }
          button { padding: 12px; background: #007bff; color: white; border: none; border-radius: 10px; font-weight: bold; width: 100%; cursor: pointer; }
          .history-item { display: flex; justify-content: space-between; padding: 12px 0; border-bottom: 1px solid #f1f3f5; text-align: left; }
          .history-meta { font-size: 11px; color: #adb5bd; }
        </style>
      </head>
      <body>
        <div class="container">
          <p class="label">Du kan spendera</p>
          <h1 id="dailyDisplay">...</h1>
          <p class="label">kr per dag</p>
          <p id="statsDisplay" style="font-size: 14px; margin: 15px 0; color: #495057;"></p>

          <div class="section">
            <p class="label">Ny utgift</p>
            <input type="text" id="descInput" placeholder="Vad köpte du?">
            <input type="number" id="amountInput" placeholder="Belopp">
            <button onclick="handleSpend()">Spara utgift</button>
          </div>

          <div class="section" style="text-align: left;">
            <p class="label">Historik</p>
            <div id="historyList"></div>
          </div>
        </div>

        <script>
          async function fetchData() {
            const res = await fetch('/api/overview');
            const data = await res.json();
            
            document.getElementById('dailyDisplay').innerText = data.dailyLimit + ':-';
            document.getElementById('statsDisplay').innerHTML = 
              '<b>' + data.remainingBudget + ' kr</b> kvar totalt<br>' +
              'Nästa lön: ' + data.paydayDate + ' (' + data.daysLeft + ' dagar kvar)';
            
            const list = document.getElementById('historyList');
            list.innerHTML = '';
            data.transactions.slice().reverse().forEach(t => {
              const item = document.createElement('div');
              item.className = 'history-item';
              item.innerHTML = '<div>' + t.description + '<br><span class="history-meta">' + new Date(t.timestamp).toLocaleDateString() + '</span></div>' +
                                '<b>-' + t.amount + ' kr</b>';
              list.appendChild(item);
            });
          }

          async function handleSpend() {
            const amount = document.getElementById('amountInput').value;
            const description = document.getElementById('descInput').value || 'Utgift';
            if(!amount) return;

            await fetch('/api/spend', {
              method: 'POST',
              headers: {'Content-Type': 'application/json'},
              body: JSON.stringify({ amount: Number(amount), description })
            });

            document.getElementById('amountInput').value = '';
            document.getElementById('descInput').value = '';
            fetchData();
          }

          fetchData();
        </script>
      </body>
    </html>
  `);
});

// --- API Endpoints ---
app.get("/api/overview", (req, res) => {
  res.json(getBudgetData());
});

app.post("/api/spend", (req, res) => {
  const { amount, description } = req.body;
  userData.remainingBudget -= amount;
  userData.transactions.push({
    amount,
    description,
    timestamp: new Date()
  });
  res.json({ success: true });
});

app.listen(PORT, () => console.log(\`Server running on port \${PORT}\`));
