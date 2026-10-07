```js
const express = require("express");
const path = require("path");
const crypto = require("crypto");
const { Pool } = require("pg");

const app = express();

const PORT = process.env.PORT || 10000;
const BASE_URL = process.env.BASE_URL || "https://clean-ride.onrender.com";

const OWNER_EMAIL = process.env.OWNER_EMAIL || "clean-ride@hotmail.com";
const MAIL_FROM = process.env.MAIL_FROM || "clean-ride@hotmail.com";
const BREVO_API_KEY = process.env.BREVO_API_KEY || "";
const TEAM_PASSWORD = process.env.TEAM_PASSWORD || "";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL
    ? { rejectUnauthorized: false }
    : false
});

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

/* =========================
   WEBSITE
========================= */

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

app.get("/team.html", (req, res) => {
  res.sendFile(path.join(__dirname, "team.html"));
});

app.use(express.static(__dirname));

/* =========================
   DATABASE
========================= */

async function initDatabase() {
  if (!process.env.DATABASE_URL) {
    console.log("⚠️ DATABASE_URL ontbreekt.");
    return;
  }

  await pool.query(`
    CREATE TABLE IF NOT EXISTS requests (
      id SERIAL PRIMARY KEY,
      name TEXT,
      email TEXT,
      phone TEXT,
      bike TEXT,
      service TEXT,
      mud BOOLEAN DEFAULT FALSE,
      price NUMERIC,
      date TEXT,
      message TEXT,
      status TEXT DEFAULT 'pending',
      created_at TIMESTAMP DEFAULT NOW(),
      decision_token TEXT UNIQUE
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS costs (
      id SERIAL PRIMARY KEY,
      description TEXT,
      amount NUMERIC,
      created_at TIMESTAMP DEFAULT NOW()
    )
  `);

  console.log("✅ Database klaar.");
}

/* =========================
   PRIJZEN
========================= */

function getAmount(service, mud) {
  let price = 0;

  if (service === "Basic Wash") price = 7;
  if (service === "Grondige Reiniging") price = 11;
  if (service === "Ultimate Clean") price = 15;

  if (mud === true) {
    price += 2;
  }

  return price;
}

/* =========================
   HTML ESCAPE
========================= */

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

/* =========================
   BREVO
========================= */

async function sendBrevoEmail({ to, subject, html }) {
  if (!BREVO_API_KEY) {
    console.log("⚠️ BREVO_API_KEY ontbreekt.");
    return false;
  }

  const response = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: {
      "accept": "application/json",
      "api-key": BREVO_API_KEY,
      "content-type": "application/json"
    },
    body: JSON.stringify({
      sender: {
        name: "Clean Ride",
        email: MAIL_FROM
      },
      to: [
        {
          email: to
        }
      ],
      subject,
      htmlContent: html
    })
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error("Brevo fout:", errorText);
    return false;
  }

  return true;
}

/* =========================
   OWNER EMAIL
========================= */

async function sendOwnerRequestEmail(request) {
  const acceptUrl =
    `${BASE_URL}/api/decision?id=${request.id}` +
    `&action=accept&token=${request.decision_token}`;

  const rejectUrl =
    `${BASE_URL}/api/decision?id=${request.id}` +
    `&action=reject&token=${request.decision_token}`;

  const html = `
    <h2>Nieuwe Clean Ride aanvraag</h2>

    <p><strong>Naam:</strong> ${escapeHtml(request.name)}</p>
    <p><strong>E-mail:</strong> ${escapeHtml(request.email)}</p>
    <p><strong>Telefoon:</strong> ${escapeHtml(request.phone)}</p>
    <p><strong>Fiets:</strong> ${escapeHtml(request.bike)}</p>
    <p><strong>Service:</strong> ${escapeHtml(request.service)}</p>
    <p><strong>Moddertoeslag:</strong> ${request.mud ? "Ja" : "Nee"}</p>
    <p><strong>Prijs:</strong> €${request.price}</p>
    <p><strong>Gewenste datum:</strong> ${escapeHtml(request.date)}</p>
    <p><strong>Opmerking:</strong> ${escapeHtml(request.message)}</p>

    <hr>

    <p>
      <a href="${acceptUrl}">
        ✅ Aanvraag accepteren
      </a>
    </p>

    <p>
      <a href="${rejectUrl}">
        ❌ Aanvraag weigeren
      </a>
    </p>
  `;

  return sendBrevoEmail({
    to: OWNER_EMAIL,
    subject: "Nieuwe Clean Ride aanvraag",
    html
  });
}

/* =========================
   CUSTOMER EMAIL
========================= */

async function sendCustomerDecisionEmail(request, accepted) {
  const subject = accepted
    ? "Clean Ride – aanvraag bevestigd"
    : "Clean Ride – aanvraag";

  const html = accepted
    ? `
      <h2>Je aanvraag is bevestigd! 🚲</h2>
      <p>Hallo ${escapeHtml(request.name)},</p>
      <p>
        Bedankt voor je aanvraag bij Clean Ride.
        We hebben je aanvraag geaccepteerd.
      </p>
      <p>
        <strong>Service:</strong> ${escapeHtml(request.service)}<br>
        <strong>Prijs:</strong> €${request.price}<br>
        <strong>Datum:</strong> ${escapeHtml(request.date)}
      </p>
      <p>
        Betaling gebeurt achteraf.
      </p>
      <p>
        Tot snel bij Clean Ride!
      </p>
    `
    : `
      <h2>Clean Ride</h2>
      <p>Hallo ${escapeHtml(request.name)},</p>
      <p>
        Bedankt voor je aanvraag bij Clean Ride.
      </p>
      <p>
        Helaas kunnen we je aanvraag momenteel niet aannemen,
        omdat we op dat moment te druk zijn.
      </p>
      <p>
        Hopelijk kunnen we je een volgende keer wel helpen!
      </p>
    `;

  return sendBrevoEmail({
    to: request.email,
    subject,
    html
  });
}

/* =========================
   NIEUWE AANVRAAG
========================= */

app.post("/api/request", async (req, res) => {
  try {
    const {
      name,
      email,
      phone,
      bike,
      service,
      mud,
      date,
      message
    } = req.body;

    if (!name || !email || !service) {
      return res.status(400).json({
        success: false,
        message: "Vul alle verplichte velden in."
      });
    }

    const mudBoolean =
      mud === true ||
      mud === "true" ||
      mud === "on" ||
      mud === "1";

    const price = getAmount(service, mudBoolean);

    const decisionToken = crypto.randomBytes(32).toString("hex");

    const result = await pool.query(
      `
      INSERT INTO requests
      (
        name,
        email,
        phone,
        bike,
        service,
        mud,
        price,
        date,
        message,
        decision_token
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
      RETURNING *
      `,
      [
        name,
        email,
        phone || "",
        bike || "",
        service,
        mudBoolean,
        price,
        date || "",
        message || "",
        decisionToken
      ]
    );

    const request = result.rows[0];

    await sendOwnerRequestEmail(request);

    res.json({
      success: true,
      message: "Aanvraag succesvol verzonden."
    });
  } catch (error) {
    console.error("Aanvraag fout:", error);

    res.status(500).json({
      success: false,
      message: "Er ging iets mis bij het verzenden."
    });
  }
});

/* =========================
   ACCEPT / REJECT
========================= */

app.get("/api/decision", async (req, res) => {
  try {
    const { id, action, token } = req.query;

    if (!id || !action || !token) {
      return res.status(400).send("Ongeldige aanvraag.");
    }

    if (!["accept", "reject"].includes(action)) {
      return res.status(400).send("Ongeldige actie.");
    }

    const result = await pool.query(
      "SELECT * FROM requests WHERE id = $1 AND decision_token = $2",
      [id, token]
    );

    if (result.rows.length === 0) {
      return res.status(404).send("Aanvraag niet gevonden.");
    }

    const request = result.rows[0];

    if (request.status !== "pending") {
      return decisionPage(
        "Deze aanvraag is al behandeld.",
        "De aanvraag werd eerder al geaccepteerd of geweigerd."
      );
    }

    const accepted = action === "accept";

    await pool.query(
      `
      UPDATE requests
      SET status = $1
      WHERE id = $2
      `,
      [accepted ? "accepted" : "rejected", id]
    );

    await sendCustomerDecisionEmail(request, accepted);

    return decisionPage(
      accepted
        ? "Aanvraag geaccepteerd ✅"
        : "Aanvraag geweigerd",
      accepted
        ? "De klant heeft een bevestigingsmail ontvangen."
        : "De klant heeft een vriendelijke afwijzingsmail ontvangen."
    );
  } catch (error) {
    console.error("Decision fout:", error);

    res.status(500).send("Er ging iets mis.");
  }
});

function decisionPage(title, text) {
  return `
    <!DOCTYPE html>
    <html lang="nl">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Clean Ride</title>
      <style>
        body {
          margin: 0;
          min-height: 100vh;
          display: flex;
          align-items: center;
          justify-content: center;
          background: #090a0d;
          color: white;
          font-family: Arial, sans-serif;
          text-align: center;
        }

        .box {
          max-width: 600px;
          margin: 20px;
          padding: 40px;
          border-radius: 20px;
          background: #12151b;
        }

        h1 {
          margin-top: 0;
        }

        a {
          color: #b8ff35;
        }
      </style>
    </head>

    <body>
      <div class="box">
        <h1>${escapeHtml(title)}</h1>
        <p>${escapeHtml(text)}</p>
        <p>
          <a href="/">Terug naar Clean Ride</a>
        </p>
      </div>
    </body>
    </html>
  `;
}

/* =========================
   TEAM AUTH
========================= */

function requireTeamPassword(req, res, next) {
  const password = req.headers["x-team-password"];

  if (!TEAM_PASSWORD || password !== TEAM_PASSWORD) {
    return res.status(401).json({
      success: false,
      message: "Geen toegang."
    });
  }

  next();
}

/* =========================
   TEAM STATS
========================= */

app.get("/api/team/stats", requireTeamPassword, async (req, res) => {
  try {
    const requestsResult = await pool.query(`
      SELECT *
      FROM requests
      ORDER BY created_at DESC
    `);

    const costsResult = await pool.query(`
      SELECT *
      FROM costs
      ORDER BY created_at DESC
    `);

    const requests = requestsResult.rows;
    const costs = costsResult.rows;

    const revenue = requests
      .filter(r => r.status === "accepted")
      .reduce((sum, r) => sum + Number(r.price || 0), 0);

    const totalCosts = costs
      .reduce((sum, c) => sum + Number(c.amount || 0), 0);

    const profit = revenue - totalCosts;

    res.json({
      success: true,
      revenue,
      costs: totalCosts,
      profit,
      totalRequests: requests.length,
      accepted: requests.filter(r => r.status === "accepted").length,
      rejected: requests.filter(r => r.status === "rejected").length,
      pending: requests.filter(r => r.status === "pending").length,
      requests,
      costs
    });
  } catch (error) {
    console.error("Team stats fout:", error);

    res.status(500).json({
      success: false,
      message: "Kon teamgegevens niet laden."
    });
  }
});

/* =========================
   TEAM KOST TOEVOEGEN
========================= */

app.post("/api/team/cost", requireTeamPassword, async (req, res) => {
  try {
    const { description, amount } = req.body;

    if (!description || !amount) {
      return res.status(400).json({
        success: false,
        message: "Beschrijving en bedrag zijn verplicht."
      });
    }

    await pool.query(
      `
      INSERT INTO costs
      (description, amount)
      VALUES ($1, $2)
      `,
      [description, Number(amount)]
    );

    res.json({
      success: true
    });
  } catch (error) {
    console.error("Kosten fout:", error);

    res.status(500).json({
      success: false,
      message: "Kon kost niet toevoegen."
    });
  }
});

/* =========================
   HEALTH
========================= */

app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    service: "Clean Ride"
  });
});

/* =========================
   API 404
========================= */

app.use("/api", (req, res) => {
  res.status(404).json({
    success: false,
    message: "API endpoint niet gevonden."
  });
});

/* =========================
   FOUTAFHANDELING
========================= */

app.use((error, req, res, next) => {
  console.error("Server fout:", error);

  res.status(500).send("Interne serverfout.");
});

/* =========================
   START
========================= */

async function startServer() {
  try {
    await initDatabase();

    app.listen(PORT, () => {
      console.log("");
      console.log("=================================");
      console.log("🚲 CLEAN RIDE SERVER");
      console.log("=================================");
      console.log(`✅ Poort: ${PORT}`);
      console.log(`✅ Website: ${BASE_URL}`);
      console.log("=================================");
    });
  } catch (error) {
    console.error("❌ Server kon niet starten:", error);
    process.exit(1);
  }
}

startServer();
```
