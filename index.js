const express = require("express");
const cors = require("cors");

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3001;

// Tillfällig data (senare databas)
let userData = {
  monthlyBudget: 12000,
  remainingBudget: 12000,
  payday: 25,
};

function daysUntilPayday(today, payday) {
  if (today <= payday) return payday - today;
  return 30 - today + payday;
}

app.get("/overview", (req, res) => {
  const today = new Date().getDate();
  const daysLeft = daysUntilPayday(today, userData.payday);
  const dailyBudget = Math.floor(userData.remainingBudget / daysLeft);

  res.json({
    remainingBudget: userData.remainingBudget,
    daysLeft,
    dailyBudget,
  });
});

app.post("/budget", (req, res) => {
  const { monthlyBudget, payday } = req.body;

  userData.monthlyBudget = monthlyBudget;
  userData.remainingBudget = monthlyBudget;
  userData.payday = payday;

  res.json({ message: "Budget sparad" });
});

app.post("/spend", (req, res) => {
  const { amount } = req.body;
  userData.remainingBudget -= amount;

  res.json({ remainingBudget: userData.remainingBudget });
});

app.listen(PORT, () => {
  console.log(`Server körs på port ${PORT}`);
});
