const express = require("express");
const cors = require("cors");
const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3001;

// Din data (startvärden)
let userData = {
  remainingBudget: 12000,
  targetPayday: 25, // Den vanliga lönedagen
};

// --- LOGIK FÖR ATT HITTA RÄTT LÖNEDAG ---
function getActualPayday(year, month, targetDay) {
  let date = new Date(year, month, targetDay);
  let dayOfWeek = date.getDay(); // 0 = Söndag, 6 = Lördag

  if (dayOfWeek === 0) { // Söndag
    date.setDate(date.getDate() - 2); // Flytta till fredag
  } else if (dayOfWeek === 6) { // Lördag
    date.setDate(date.getDate() - 1); // Flytta till fredag
  }
  return date;
}

function calculateBudgetInfo() {
  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth();

  // 1. Kolla lönedag denna månad
  let payday = getActualPayday(currentYear, currentMonth, userData.targetPayday);

  // 2. Om lönen redan har kommit, kolla nästa månads lönedag
  if (now >= payday.setHours(23, 59, 59)) {
    payday = getActualPayday(currentYear, currentMonth + 1, userData.targetPayday);
  }

  // 3. Räkna ut antal dagar kvar (minst 1 dag för att undvika delat med noll)
  const diffTime = payday - now;
  const daysLeft = Math.max(1, Math.ceil(diffTime / (1000 * 60 * 60 * 24)));
  const dailyBudget = Math.floor(userData.remainingBudget / daysLeft);

  return { 
    dailyBudget, 
    daysLeft, 
    paydayDate: payday.toLocaleDateString('sv-SE'),
    remainingBudget: userData.remainingBudget 
  };
}

// --- HEMISDAN (FRONTEND) ---
app.get("/", (req, res) => {
  res.send(`
    <html>
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <style>
          body { font-family: -apple-system, sans-serif; text-align: center; padding: 20px; background: #f0f2f5; color: #1c1e21; }
          .card { background: white; padding: 30px; border-radius: 20px; box-shadow: 0 8px 20px rgba(0,0,0,0.1); max-width: 350px; margin: auto; }
          h1 { font-size: 50px; margin: 10px 0; color: #2ecc71; }
          .label { color: #8a8d91; text-transform: uppercase; font-size: 11px; font-weight: bold; }
          .input-group { margin-top: 20px; border-top: 1px solid #eee; padding-top: 20px; }
          input { padding: 10px; border: 1px solid #ddd; border-radius: 8px; width: 100px; margin-bottom: 10px; font-size: 16px; }
          button { padding: 10px 15px; background: #0084ff; color: white; border: none; border-radius: 8px; font-weight: bold; cursor: pointer; }
          .settings { margin-top: 30px; font-size: 12px; color: #65676b; }
        </style>
      </head>
      <body>
        <div class="card">
          <p class="label">Du kan spendera</p>
          <h1 id="daily">...</h1>
          <p class="label">kr idag</p>
          <p id="sub-info" style="font-size: 14px; margin-top: 15px;"></p>

          <div class="input-group">
            <p class="label">Registrera köp</p>
            <input type="number" id="spendInput" placeholder="0">
            <button onclick="sendAction('/spend', 'amount')">Dra av</button>
          </div>

          <div class="settings">
            <p>Inställningar</p>
            <input type="number" id="budgetInput" placeholder="Ny budget">
            <button onclick="sendAction('/set-budget', 'budget')" style="background:#42b72a">Sätt</button>
          </div>
        </div>

        <script>
          function refresh() {
            fetch('/overview').then(r => r.json()).then(data => {
              document.getElementById('daily').innerText = data.dailyBudget + ':-';
              document.getElementById('sub-info').innerHTML = 
                '<b>' + data.remainingBudget + ' kr</b> kvar totalt<br>' +
                'Nästa lön: ' + data.paydayDate + ' (' + data.daysLeft + ' dagar)';
            });
          }

          function sendAction(route, key) {
            const val = document.getElementById(route === '/spend' ? 'spendInput' : 'budgetInput').value;
            if(!val) return;
            fetch(route, {
              method: 'POST',
              headers: {'Content-Type': 'application/json'},
              body: JSON.stringify({ [key]: Number(val) })
            }).then(() => {
              document.getElementById('spendInput').value = '';
              document.getElementById('budgetInput').value = '';
              refresh();
            });
          }
          refresh();
        </script>
      </body>
    </html>
  `);
});

// --- API-RUTTER ---
app.get("/overview", (req, res) => {
  res.json(calculateBudgetInfo());
});

app.post("/spend", (req, res) => {
  userData.remainingBudget -= req.body.amount;
  res.json({ success: true });
});

app.post("/set-budget", (req, res) => {
  userData.remainingBudget = req.body.budget;
  res.json({ success: true });
});

app.listen(PORT, () => console.log("Budget-app redo!"));
