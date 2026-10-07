```js
const express = require("express");
const path = require("path");
const crypto = require("crypto");
const { Pool } = require("pg");

const app = express();

const PORT = process.env.PORT || 10000;

const BASE_URL =
  process.env.BASE_URL || `http://localhost:${PORT}`;

const OWNER_EMAIL =
  process.env.OWNER_EMAIL || "clean-ride@hotmail.com";

const MAIL_FROM =
  process.env.MAIL_FROM || OWNER_EMAIL;

const BREVO_API_KEY =
  process.env.BREVO_API_KEY || "";

const TEAM_PASSWORD =
  process.env.TEAM_PASSWORD || "";


// =====================================================
// DATABASE
// =====================================================

if (!process.env.DATABASE_URL) {
  console.error("❌ DATABASE_URL ontbreekt in Render.");
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL
    ? { rejectUnauthorized: false }
    : false
});


// =====================================================
// EXPRESS
// =====================================================

app.use(express.json());
app.use(express.urlencoded({ extended: true }));


// =====================================================
// WEBSITE
// =====================================================

// Homepage
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});


// Team Clean Ride
// Deze route staat bewust vóór express.static.
app.get("/team.html", (req, res) => {
  res.sendFile(path.join(__dirname, "team.html"), (err) => {
    if (err) {
      console.error("❌ team.html kon niet worden geladen:", err);

      if (!res.headersSent) {
        res.status(404).send(`
<!DOCTYPE html>
<html lang="nl">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Team Clean Ride</title>
</head>
<body style="
  margin:0;
  min-height:100vh;
  display:flex;
  align-items:center;
  justify-content:center;
  background:#090a0d;
  color:white;
  font-family:Arial,sans-serif;
  text-align:center;
">
  <div>
    <h1 style="color:#b8ff35;">Team Clean Ride</h1>
    <p>De Team-pagina kon niet worden gevonden.</p>
    <p style="color:#ff2f8a;">
      Controleer of <strong>team.html</strong> in je GitHub-project staat.
    </p>
  </div>
</body>
</html>
        `);
      }
    }
  });
});


// Alle andere websitebestanden
app.use(express.static(__dirname));


// =====================================================
// DATABASE TABELLEN
// =====================================================

async function initDatabase() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS requests (
      id SERIAL PRIMARY KEY,
      request_token TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      email TEXT NOT NULL,
      phone TEXT,
      service TEXT NOT NULL,
      message TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      amount NUMERIC(10,2) NOT NULL DEFAULT 0,
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      decided_at TIMESTAMP
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS costs (
      id SERIAL PRIMARY KEY,
      supplier TEXT NOT NULL,
      description TEXT NOT NULL,
      amount NUMERIC(10,2) NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    );
  `);

  console.log("✅ Database klaar.");
}


// =====================================================
// BEDRAG BEREKENEN
// =====================================================

function getAmount(service) {
  const text = String(service || "").toLowerCase();

  let amount = 0;

  if (text.includes("abonnement")) {
    amount = 100;
  } else if (text.includes("ultimate")) {
    amount = 15;
  } else if (text.includes("grondige")) {
    amount = 11;
  } else if (text.includes("basic")) {
    amount = 7;
  }

  if (
    text.includes("modder") ||
    text.includes("mud")
  ) {
    amount += 2;
  }

  return amount;
}


// =====================================================
// HTML VEILIG MAKEN
// =====================================================

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}


// =====================================================
// BREVO
// =====================================================

async function sendBrevoEmail({ to, subject, html }) {
  if (!BREVO_API_KEY) {
    throw new Error("BREVO_API_KEY ontbreekt.");
  }

  const response = await fetch(
    "https://api.brevo.com/v3/smtp/email",
    {
      method: "POST",

      headers: {
        accept: "application/json",
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

        subject: subject,
        htmlContent: html
      })
    }
  );

  const responseText = await response.text();

  if (!response.ok) {
    console.error(
      "❌ Brevo fout:",
      response.status,
      responseText
    );

    throw new Error(
      `Brevo fout ${response.status}`
    );
  }

  console.log("✅ Mail verstuurd naar:", to);

  return true;
}


// =====================================================
// EMAIL NAAR EIGENAAR
// =====================================================

async function sendOwnerRequestEmail(request) {
  const acceptUrl =
    `${BASE_URL}/api/decision?token=${encodeURIComponent(
      request.request_token
    )}&decision=accept`;

  const rejectUrl =
    `${BASE_URL}/api/decision?token=${encodeURIComponent(
      request.request_token
    )}&decision=reject`;

  const html = `
<!DOCTYPE html>
<html lang="nl">
<head>
<meta charset="UTF-8">
<title>Nieuwe Clean Ride aanvraag</title>
</head>

<body style="
  margin:0;
  padding:20px;
  background:#f5f5f5;
  font-family:Arial,sans-serif;
">

<div style="
  max-width:650px;
  margin:auto;
  background:white;
  padding:25px;
  border-radius:15px;
">

<h1 style="color:#ff2f8a;">
Nieuwe Clean Ride aanvraag
</h1>

<p>
Er is een nieuwe aanvraag binnengekomen.
</p>

<hr>

<p>
<strong>Naam:</strong><br>
${escapeHtml(request.name)}
</p>

<p>
<strong>E-mail:</strong><br>
${escapeHtml(request.email)}
</p>

<p>
<strong>Telefoon:</strong><br>
${escapeHtml(request.phone || "-")}
</p>

<p>
<strong>Service:</strong><br>
${escapeHtml(request.service)}
</p>

<p>
<strong>Bedrag:</strong><br>
€${Number(request.amount).toFixed(2)}
</p>

<p>
<strong>Opmerking:</strong><br>
${escapeHtml(request.message || "-")}
</p>

<hr>

<p>
<strong>Wat wil je doen?</strong>
</p>

<p>
<a
  href="${acceptUrl}"
  style="
    display:inline-block;
    padding:14px 20px;
    background:#b8ff35;
    color:#111;
    text-decoration:none;
    border-radius:10px;
    font-weight:bold;
  "
>
✅ Accepteren
</a>
</p>

<p>
<a
  href="${rejectUrl}"
  style="
    display:inline-block;
    padding:14px 20px;
    background:#ff2f8a;
    color:white;
    text-decoration:none;
    border-radius:10px;
    font-weight:bold;
  "
>
❌ Weigeren
</a>
</p>

</div>

</body>
</html>
`;

  await sendBrevoEmail({
    to: OWNER_EMAIL,
    subject: `Nieuwe Clean Ride aanvraag — ${request.name}`,
    html
  });
}


// =====================================================
// EMAIL NAAR KLANT
// =====================================================

async function sendCustomerDecisionEmail(request, decision) {
  const accepted = decision === "accept";

  const subject = accepted
    ? "Clean Ride — aanvraag geaccepteerd"
    : "Clean Ride — aanvraag";

  const html = accepted
    ? `
<!DOCTYPE html>
<html lang="nl">
<body style="font-family:Arial,sans-serif;">

<h2 style="color:#b8ff35;">
Goed nieuws!
</h2>

<p>
Hallo ${escapeHtml(request.name)},
</p>

<p>
Bedankt voor je aanvraag bij <strong>Clean Ride</strong>.
</p>

<p>
We hebben je aanvraag geaccepteerd.
</p>

<p>
<strong>Service:</strong><br>
${escapeHtml(request.service)}
</p>

<p>
<strong>Bedrag:</strong><br>
€${Number(request.amount).toFixed(2)}
</p>

<p>
We nemen indien nodig nog contact met je op voor de praktische afspraken.
</p>

<p>
Tot binnenkort! 🚲
</p>

<p>
<strong>Clean Ride</strong><br>
clean-ride@hotmail.com
</p>

</body>
</html>
`
    : `
<!DOCTYPE html>
<html lang="nl">
<body style="font-family:Arial,sans-serif;">

<h2>
Clean Ride
</h2>

<p>
Hallo ${escapeHtml(request.name)},
</p>

<p>
Bedankt voor je aanvraag bij Clean Ride.
</p>

<p>
Helaas kunnen we deze aanvraag momenteel niet aannemen.
</p>

<p>
We zijn waarschijnlijk te druk of kunnen het gevraagde moment niet aanbieden.
</p>

<p>
Je bent natuurlijk altijd welkom om later opnieuw een aanvraag te sturen.
</p>

<p>
Met vriendelijke groeten,<br>
<strong>Clean Ride</strong>
</p>

</body>
</html>
`;

  await sendBrevoEmail({
    to: request.email,
    subject: subject,
    html: html
  });
}


// =====================================================
// NIEUWE AANVRAAG
// =====================================================

app.post("/api/request", async (req, res) => {
  try {
    const {
      name,
      email,
      phone,
      service,
      message
    } = req.body;

    if (!name || !email || !service) {
      return res.status(400).json({
        success: false,
        error: "Naam, e-mail en service zijn verplicht."
      });
    }

    const requestToken =
      crypto.randomBytes(32).toString("hex");

    const amount =
      getAmount(service);

    const result = await pool.query(
      `
      INSERT INTO requests
      (
        request_token,
        name,
        email,
        phone,
        service,
        message,
        amount
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7)
      RETURNING *
      `,
      [
        requestToken,
        name,
        email,
        phone || "",
        service,
        message || "",
        amount
      ]
    );

    const request = result.rows[0];

    try {
      await sendOwnerRequestEmail(request);
    } catch (mailError) {
      console.error(
        "⚠️ Aanvraag opgeslagen, maar eigenaar-mail mislukt:",
        mailError.message
      );
    }

    return res.json({
      success: true,
      message: "Aanvraag ontvangen."
    });

  } catch (error) {
    console.error("❌ /api/request:", error);

    return res.status(500).json({
      success: false,
      error: "Er ging iets mis op de server."
    });
  }
});


// =====================================================
// ACCEPT / REJECT
// =====================================================

app.get("/api/decision", async (req, res) => {
  try {
    const {
      token,
      decision
    } = req.query;

    if (!token) {
      return res.status(400).send(
        decisionPage(
          "❌ Ongeldige aanvraag",
          "De aanvraagtoken ontbreekt."
        )
      );
    }

    if (
      decision !== "accept" &&
      decision !== "reject"
    ) {
      return res.status(400).send(
        decisionPage(
          "❌ Ongeldige actie",
          "Deze actie bestaat niet."
        )
      );
    }

    const result = await pool.query(
      `
      SELECT *
      FROM requests
      WHERE request_token = $1
      `,
      [token]
    );

    if (result.rows.length === 0) {
      return res.status(404).send(
        decisionPage(
          "❌ Niet gevonden",
          "Deze aanvraag bestaat niet meer."
        )
      );
    }

    const request = result.rows[0];

    if (
      request.status === "accepted" ||
      request.status === "rejected"
    ) {
      return res.send(
        decisionPage(
          "ℹ️ Al verwerkt",
          `Deze aanvraag is al ${
            request.status === "accepted"
              ? "geaccepteerd"
              : "geweigerd"
          }.`
        )
      );
    }

    const newStatus =
      decision === "accept"
        ? "accepted"
        : "rejected";

    await pool.query(
      `
      UPDATE requests
      SET
        status = $1,
        decided_at = NOW()
      WHERE request_token = $2
      `,
      [
        newStatus,
        token
      ]
    );

    try {
      await sendCustomerDecisionEmail(
        request,
        decision
      );
    } catch (mailError) {
      console.error(
        "⚠️ Status aangepast, maar klantmail mislukt:",
        mailError.message
      );
    }

    return res.send(
      decisionPage(
        decision === "accept"
          ? "✅ Aanvraag geaccepteerd"
          : "❌ Aanvraag geweigerd",

        decision === "accept"
          ? `De aanvraag van ${escapeHtml(
              request.name
            )} is geaccepteerd. De klant krijgt een e-mail.`
          : `De aanvraag van ${escapeHtml(
              request.name
            )} is geweigerd. De klant krijgt een e-mail.`
      )
    );

  } catch (error) {
    console.error(
      "❌ /api/decision:",
      error
    );

    return res.status(500).send(
      decisionPage(
        "❌ Er ging iets mis",
        "De actie kon niet worden uitgevoerd."
      )
    );
  }
});


// =====================================================
// DECISION PAGINA
// =====================================================

function decisionPage(title, message) {
  return `
<!DOCTYPE html>
<html lang="nl">

<head>
<meta charset="UTF-8">

<meta
  name="viewport"
  content="width=device-width, initial-scale=1.0"
>

<title>Clean Ride</title>

<style>

body {
  margin: 0;
  padding: 30px;
  font-family: Arial, sans-serif;
  background: #090a0d;
  color: white;
  text-align: center;
}

.box {
  max-width: 600px;
  margin: 80px auto;
  background: #12151b;
  padding: 35px;
  border-radius: 20px;
}

h1 {
  color: #b8ff35;
}

p {
  color: #a9afb9;
  font-size: 18px;
  line-height: 1.6;
}

</style>

</head>

<body>

<div class="box">

<h1>${title}</h1>

<p>${message}</p>

</div>

</body>

</html>
`;
}


// =====================================================
// TEAM AUTHENTICATIE
// =====================================================

function requireTeamPassword(req, res, next) {
  if (!TEAM_PASSWORD) {
    return res.status(500).json({
      success: false,
      error: "TEAM_PASSWORD ontbreekt in Render."
    });
  }

  const password =
    req.headers["x-team-password"];

  if (
    !password ||
    password !== TEAM_PASSWORD
  ) {
    return res.status(401).json({
      success: false,
      error: "Onjuist wachtwoord."
    });
  }

  next();
}


// =====================================================
// TEAM STATISTIEKEN
// =====================================================

app.get(
  "/api/team/stats",
  requireTeamPassword,
  async (req, res) => {

    try {

      const revenueResult = await pool.query(`
        SELECT COALESCE(
          SUM(amount) FILTER (
            WHERE status = 'accepted'
          ),
          0
        ) AS revenue
        FROM requests
      `);

      const costsResult = await pool.query(`
        SELECT COALESCE(
          SUM(amount),
          0
        ) AS costs
        FROM costs
      `);

      const countsResult = await pool.query(`
        SELECT
          COUNT(*) FILTER (
            WHERE status = 'accepted'
          ) AS accepted,

          COUNT(*) FILTER (
            WHERE status = 'rejected'
          ) AS rejected,

          COUNT(*) AS total

        FROM requests
      `);

      const customersResult = await pool.query(`
        SELECT
          name,
          email,

          COUNT(*) FILTER (
            WHERE status = 'accepted'
          ) AS cleanings,

          COALESCE(
            SUM(amount) FILTER (
              WHERE status = 'accepted'
            ),
            0
          ) AS revenue,

          MAX(created_at) FILTER (
            WHERE status = 'accepted'
          ) AS last_visit

        FROM requests

        GROUP BY name, email

        ORDER BY last_visit DESC NULLS LAST
      `);

      const requestsResult = await pool.query(`
        SELECT
          id,
          name,
          email,
          phone,
          service,
          message,
          status,
          amount,
          created_at,
          decided_at

        FROM requests

        ORDER BY created_at DESC

        LIMIT 100
      `);

      const costsListResult = await pool.query(`
        SELECT
          id,
          supplier,
          description,
          amount,
          created_at

        FROM costs

        ORDER BY created_at DESC

        LIMIT 100
      `);

      const revenue =
        Number(
          revenueResult.rows[0].revenue || 0
        );

      const costs =
        Number(
          costsResult.rows[0].costs || 0
        );

      const profit =
        revenue - costs;

      return res.json({

        success: true,

        financial: {
          revenue,
          costs,
          profit,

          margin:
            revenue > 0
              ? (profit / revenue) * 100
              : 0
        },

        counts: {
          accepted:
            Number(
              countsResult.rows[0].accepted || 0
            ),

          rejected:
            Number(
              countsResult.rows[0].rejected || 0
            ),

          total:
            Number(
              countsResult.rows[0].total || 0
            )
        },

        customers:
          customersResult.rows.map(
            customer => ({
              name: customer.name,
              email: customer.email,

              cleanings:
                Number(
                  customer.cleanings || 0
                ),

              revenue:
                Number(
                  customer.revenue || 0
                ),

              lastVisit:
                customer.last_visit
            })
          ),

        requests:
          requestsResult.rows.map(
            request => ({
              id: request.id,
              name: request.name,
              email: request.email,
              phone: request.phone,
              service: request.service,
              message: request.message,
              status: request.status,

              amount:
                Number(
                  request.amount || 0
                ),

              createdAt:
                request.created_at,

              decidedAt:
                request.decided_at
            })
          ),

        costsList:
          costsListResult.rows.map(
            cost => ({
              id: cost.id,
              supplier: cost.supplier,
              description: cost.description,

              amount:
                Number(
                  cost.amount || 0
                ),

              createdAt:
                cost.created_at
            })
          )
      });

    } catch (error) {

      console.error(
        "❌ /api/team/stats:",
        error
      );

      return res.status(500).json({
        success: false,
        error: "Dashboard kon niet geladen worden."
      });
    }
  }
);


// =====================================================
// TEAM KOST TOEVOEGEN
// =====================================================

app.post(
  "/api/team/cost",
  requireTeamPassword,
  async (req, res) => {

    try {

      const {
        supplier,
        description,
        amount
      } = req.body;

      const numericAmount =
        Number(amount);

      if (
        !supplier ||
        !description ||
        !Number.isFinite(numericAmount) ||
        numericAmount <= 0
      ) {
        return res.status(400).json({
          success: false,
          error:
            "Vul leverancier, omschrijving en een geldig bedrag in."
        });
      }

      const result = await pool.query(
        `
        INSERT INTO costs
        (
          supplier,
          description,
          amount
        )
        VALUES ($1,$2,$3)
        RETURNING *
        `,
        [
          supplier,
          description,
          numericAmount
        ]
      );

      return res.json({
        success: true,
        cost: result.rows[0]
      });

    } catch (error) {

      console.error(
        "❌ /api/team/cost:",
        error
      );

      return res.status(500).json({
        success: false,
        error: "Kosten konden niet worden opgeslagen."
      });
    }
  }
);


// =====================================================
// HEALTH CHECK
// =====================================================

app.get("/health", async (req, res) => {
  try {

    await pool.query("SELECT 1");

    return res.json({
      success: true,
      status: "ok",
      database: "ok"
    });

  } catch (error) {

    console.error(
      "❌ Health check:",
      error
    );

    return res.status(500).json({
      success: false,
      status: "error",
      database: "error"
    });
  }
});


// =====================================================
// API 404
// =====================================================

app.use("/api", (req, res) => {
  return res.status(404).json({
    success: false,
    error: "API route niet gevonden."
  });
});


// =====================================================
// ALGEMENE FOUTAFHANDELING
// =====================================================

app.use((err, req, res, next) => {

  console.error(
    "❌ Server error:",
    err
  );

  if (res.headersSent) {
    return next(err);
  }

  return res.status(500).json({
    success: false,
    error: "Interne serverfout."
  });
});


// =====================================================
// SERVER STARTEN
// =====================================================

async function startServer() {

  try {

    await initDatabase();

    app.listen(
      PORT,
      "0.0.0.0",
      () => {

        console.log("");
        console.log("=================================");
        console.log("🚲 CLEAN RIDE SERVER");
        console.log("=================================");
        console.log(`✅ Poort: ${PORT}`);
        console.log(`✅ Website: ${BASE_URL}`);
        console.log("✅ Database verbonden");
        console.log("✅ Server gestart");
        console.log("=================================");
        console.log("");

      }
    );

  } catch (error) {

    console.error(
      "❌ SERVER KON NIET STARTEN:"
    );

    console.error(error);

    process.exit(1);
  }
}


startServer();
```
