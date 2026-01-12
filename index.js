const express = require("express");
const cors = require("cors");
const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3001;

let userData = {
  monthlyBudget: 12000,
  remainingBudget: 12000,
  payday: 25,
};

// Startsidan - det snygga "ansiktet"
app.get("/", (req, res) => {
  res.send(`
    <html>
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <style>
          body { font-family: sans-serif; text-align: center; padding-top: 50px; background: #f4f4f9; color: #2c3e50; }
          .card { background: white; display: inline-block; padding: 40px; border-radius: 25px; box-shadow: 0 10px 25px rgba(0,0,0,0.1); }
          h1 { font-size: 60px; margin: 10px 0; color: #2ecc71; }
          p { margin: 0; color: #7f8c8d; text-transform: uppercase; letter-spacing: 1px; font-size: 12px; }
          .info { margin-top: 20px; padding-top: 20px; border-top: 1px solid #eee; color: #bdc3c7; text-transform: none; font-size: 14px; }
        </style>
      </head>
      <body>
        <div class="card">
          <p>Dagsbudget just nu</p>
          <h1 id="amount">...</h1>
          <p>kronor per dag</p>
          <div class="info" id="info">Hämtar data...</div>
        </div>
        <script>
          fetch('/overview')
            .then(res => res.json())
            .then(data => {
              document.getElementById('amount').innerText = data.dailyBudget + ':-';
              document.getElementById('info').innerText = data.remainingBudget + ' kr kvar till lön (dag ' + data.payday + ')';
            });
        </script>
      </body>
    </html>
  `);
});

// Backend-logik för att räkna
app.get("/overview", (req, res) => {
  const today = new Date().getDate();
  let daysLeft = userData.payday - today;
  if (daysLeft <= 0) daysLeft = 1; 

  const dailyBudget = Math.floor(userData.remainingBudget / daysLeft);
  res.json({ 
    remainingBudget: userData.remainingBudget, 
    daysLeft, 
    dailyBudget,
    payday: userData.payday 
  });
});

app.listen(PORT, () => {
  console.log("Server is running!");
});
