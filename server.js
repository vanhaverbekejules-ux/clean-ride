const express = require("express");
const path = require("path");
const crypto = require("crypto");
const { Pool } = require("pg");

const app = express();

/* =====================================================
   CONFIGURATIE
===================================================== */

const PORT = process.env.PORT || 10000;

const BASE_URL = (
  process.env.BASE_URL || "https://clean-ride.onrender.com"
).replace(/\/+$/, "");

const OWNER_EMAIL =
  process.env.OWNER_EMAIL || "clean-ride@hotmail.com";

const MAIL_FROM =
  process.env.MAIL_FROM || "clean-ride@hotmail.com";

const BREVO_API_KEY =
  process.env.BREVO_API_KEY || "";

const TEAM_PASSWORD =
  process.env.TEAM_PASSWORD || "";

const DATABASE_URL =
  process.env.DATABASE_URL || "";


/* =====================================================
   DATABASE
===================================================== */

const pool = DATABASE_URL
  ? new Pool({
      connectionString: DATABASE_URL,
      ssl: {
        rejectUnauthorized: false
      }
    })
  : null;


/* =====================================================
   EXPRESS
===================================================== */

app.use(express.json());
app.use(express.urlencoded({ extended: true }));


/* =====================================================
   PAGINA'S
===================================================== */

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

app.get("/team.html", (req, res) => {
  res.sendFile(path.join(__dirname, "team.html"));
});

app.use(express.static(__dirname));


/* =====================================================
   HULPFUNCTIES
===================================================== */

function databaseAvailable(res) {
  if (!pool) {
    res.status(503).json({
      success: false,
      error: "Database is niet geconfigureerd."
    });

    return false;
  }

  return true;
}


function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}


function getAmount(service, mud) {
  const prices = {
    "Basic Wash": 7,
    "Grondige Reiniging": 11,
    "Ultimate Clean": 15
  };

  const basePrice = prices[service];

  if (basePrice === undefined) {
    return null;
  }

  return basePrice + (mud ? 2 : 0);
}


function formatMoney(value) {
  return `€${Number(value || 0).toFixed(2).replace(".", ",")}`;
}


/* =====================================================
   DATABASE INITIALISEREN
===================================================== */

async function initDatabase() {
  if (!pool) {
    console.warn(
      "⚠️ DATABASE_URL ontbreekt. Databasefuncties zijn uitgeschakeld."
    );

    return;
  }

  await pool.query(`
    CREATE TABLE IF NOT EXISTS requests (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT NOT NULL,
      phone TEXT,
      bike TEXT,
      service TEXT NOT NULL,
      mud BOOLEAN DEFAULT FALSE,
      price NUMERIC DEFAULT 0,
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
      supplier TEXT,
      description TEXT NOT NULL,
      amount NUMERIC NOT NULL,
      created_at TIMESTAMP DEFAULT NOW()
    )
  `);

  /*
    Voor bestaande databases:
    supplier toevoegen als die kolom nog niet bestaat.
  */

  await pool.query(`
    ALTER TABLE costs
    ADD COLUMN IF NOT EXISTS supplier TEXT
  `);

  console.log("✅ Database gecontroleerd.");
}


/* =====================================================
   BREVO E-MAIL
===================================================== */

async function sendBrevoEmail({ to, subject, html }) {
  if (!BREVO_API_KEY) {
    console.error(
      "❌ BREVO_API_KEY ontbreekt. E-mail wordt niet verzonden."
    );

    return false;
  }

  try {
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

          subject,
          htmlContent: html
        })
      }
    );

    if (!response.ok) {
      const errorText = await response.text();

      console.error(
        "❌ Brevo fout:",
        errorText
      );

      return false;
    }

    console.log(
      `✅ E-mail verzonden naar ${to}`
    );

    return true;

  } catch (error) {
    console.error(
      "❌ E-mail fout:",
      error
    );

    return false;
  }
}


/* =====================================================
   E-MAIL NAAR CLEAN RIDE
===================================================== */

async function sendOwnerRequestEmail(request) {
  const acceptUrl =
    `${BASE_URL}/api/decision?id=${request.id}&action=accept&token=${request.decision_token}`;

  const rejectUrl =
    `${BASE_URL}/api/decision?id=${request.id}&action=reject&token=${request.decision_token}`;

  const mudText =
    request.mud ? "Ja (+€2)" : "Nee";

  const html = `
    <!DOCTYPE html>
    <html lang="nl">
    <body style="font-family:Arial,sans-serif;line-height:1.6;">

      <h2>🚲 Nieuwe Clean Ride aanvraag</h2>

      <p>
        Er is een nieuwe aanvraag binnengekomen.
      </p>

      <hr>

      <p>
        <strong>Naam:</strong>
        ${escapeHtml(request.name)}
      </p>

      <p>
        <strong>E-mail:</strong>
        ${escapeHtml(request.email)}
      </p>

      <p>
        <strong>Telefoon:</strong>
        ${escapeHtml(request.phone || "-")}
      </p>

      <p>
        <strong>Fiets:</strong>
        ${escapeHtml(request.bike || "-")}
      </p>

      <p>
        <strong>Service:</strong>
        ${escapeHtml(request.service)}
      </p>

      <p>
        <strong>Modderig:</strong>
        ${mudText}
      </p>

      <p>
        <strong>Prijs:</strong>
        ${formatMoney(request.price)}
      </p>

      <p>
        <strong>Gewenste datum:</strong>
        ${escapeHtml(request.date || "-")}
      </p>

      <p>
        <strong>Bericht:</strong><br>
        ${escapeHtml(request.message || "-")}
      </p>

      <hr>

      <p>
        <strong>Aanvraag accepteren:</strong>
      </p>

      <p>
        <a
          href="${acceptUrl}"
          style="
            display:inline-block;
            padding:12px 18px;
            background:#b8ff35;
            color:#111;
            text-decoration:none;
            border-radius:8px;
            font-weight:bold;
          "
        >
          ✅ Accepteren
        </a>
      </p>

      <p>
        <strong>Aanvraag weigeren:</strong>
      </p>

      <p>
        <a
          href="${rejectUrl}"
          style="
            display:inline-block;
            padding:12px 18px;
            background:#ff2f8a;
            color:white;
            text-decoration:none;
            border-radius:8px;
            font-weight:bold;
          "
        >
          ❌ Weigeren
        </a>
      </p>

    </body>
    </html>
  `;

  return sendBrevoEmail({
    to: OWNER_EMAIL,
    subject: "Nieuwe Clean Ride aanvraag",
    html
  });
}


/* =====================================================
   KLANTMAIL NA BESLISSING
===================================================== */

async function sendCustomerDecisionEmail(request, accepted) {
  if (accepted) {
    const html = `
      <!DOCTYPE html>
      <html lang="nl">
      <body style="font-family:Arial,sans-serif;line-height:1.6;">

        <h2>🚲 Clean Ride – aanvraag bevestigd</h2>

        <p>
          Hallo ${escapeHtml(request.name)},
        </p>

        <p>
          Goed nieuws! Je aanvraag bij Clean Ride is
          <strong>geaccepteerd</strong>.
        </p>

        <p>
          <strong>Service:</strong>
          ${escapeHtml(request.service)}
        </p>

        <p>
          <strong>Prijs:</strong>
          ${formatMoney(request.price)}
        </p>

        <p>
          <strong>Datum:</strong>
          ${escapeHtml(request.date || "-")}
        </p>

        <p>
          We nemen indien nodig nog contact met je op.
          De betalingsinformatie ontvang je daarna.
        </p>

        <p>
          Bedankt om voor Clean Ride te kiezen! 🚲
        </p>

      </body>
      </html>
    `;

    return sendBrevoEmail({
      to: request.email,
      subject: "Clean Ride – aanvraag bevestigd",
      html
    });
  }

  const html = `
    <!DOCTYPE html>
    <html lang="nl">
    <body style="font-family:Arial,sans-serif;line-height:1.6;">

      <h2>🚲 Clean Ride</h2>

      <p>
        Hallo ${escapeHtml(request.name)},
      </p>

      <p>
        Bedankt voor je aanvraag bij Clean Ride.
      </p>

      <p>
        Helaas kunnen we je aanvraag momenteel niet aannemen.
        We hebben het op dit moment te druk.
      </p>

      <p>
        Onze excuses voor het ongemak.
      </p>

      <p>
        Hopelijk kunnen we je fiets een volgende keer wel helpen.
      </p>

      <p>
        Groetjes,<br>
        Team Clean Ride
      </p>

    </body>
    </html>
  `;

  return sendBrevoEmail({
    to: request.email,
    subject: "Clean Ride – aanvraag",
    html
  });
}


/* =====================================================
   NIEUWE AANVRAAG
===================================================== */

app.post("/api/request", async (req, res) => {
  if (!databaseAvailable(res)) {
    return;
  }

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

    const cleanName = String(name || "").trim();
    const cleanEmail = String(email || "").trim();
    const cleanPhone = String(phone || "").trim();
    const cleanBike = String(bike || "").trim();
    const cleanService = String(service || "").trim();
    const cleanDate = String(date || "").trim();
    const cleanMessage = String(message || "").trim();

    const cleanMud =
      mud === true ||
      mud === "true" ||
      mud === "on" ||
      mud === "1";

    if (!cleanName || !cleanEmail || !cleanService) {
      return res.status(400).json({
        success: false,
        message:
          "Naam, e-mail en service zijn verplicht."
      });
    }

    const price =
      getAmount(cleanService, cleanMud);

    if (price === null) {
      return res.status(400).json({
        success: false,
        message:
          "Ongeldige service."
      });
    }

    const decisionToken =
      crypto.randomBytes(32).toString("hex");

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
          status,
          decision_token
        )
        VALUES
        ($1,$2,$3,$4,$5,$6,$7,$8,$9,'pending',$10)
        RETURNING *
      `,
      [
        cleanName,
        cleanEmail,
        cleanPhone,
        cleanBike,
        cleanService,
        cleanMud,
        price,
        cleanDate,
        cleanMessage,
        decisionToken
      ]
    );

    const request = result.rows[0];

    const ownerEmailSent =
      await sendOwnerRequestEmail(request);

    if (!ownerEmailSent) {
      console.error(
        "⚠️ Aanvraag opgeslagen, maar eigenaarmail kon niet worden verzonden."
      );
    }

    return res.json({
      success: true,
      message:
        "Aanvraag succesvol verzonden."
    });

  } catch (error) {
    console.error(
      "❌ Fout bij nieuwe aanvraag:",
      error
    );

    return res.status(500).json({
      success: false,
      message:
        "Er ging iets mis bij het verzenden."
    });
  }
});


/* =====================================================
   ACCEPT / REJECT
===================================================== */

app.get("/api/decision", async (req, res) => {
  if (!pool) {
    return res
      .status(503)
      .send(
        decisionPage(
          "Database niet beschikbaar.",
          false
        )
      );
  }

  try {
    const id =
      Number(req.query.id);

    const action =
      String(req.query.action || "").toLowerCase();

    const token =
      String(req.query.token || "");

    if (
      !Number.isInteger(id) ||
      !token ||
      !["accept", "reject"].includes(action)
    ) {
      return res
        .status(400)
        .send(
          decisionPage(
            "Ongeldige aanvraag.",
            false
          )
        );
    }

    const result = await pool.query(
      `
        SELECT *
        FROM requests
        WHERE id = $1
          AND decision_token = $2
        LIMIT 1
      `,
      [id, token]
    );

    if (result.rows.length === 0) {
      return res
        .status(404)
        .send(
          decisionPage(
            "Aanvraag niet gevonden.",
            false
          )
        );
    }

    const request = result.rows[0];

    if (request.status !== "pending") {
      return res
        .status(200)
        .send(
          decisionPage(
            "Deze aanvraag is al behandeld.",
            true
          )
        );
    }

    const accepted =
      action === "accept";

    const newStatus =
      accepted
        ? "accepted"
        : "rejected";

    const updateResult = await pool.query(
      `
        UPDATE requests
        SET status = $1
        WHERE id = $2
          AND decision_token = $3
          AND status = 'pending'
        RETURNING *
      `,
      [
        newStatus,
        id,
        token
      ]
    );

    if (updateResult.rows.length === 0) {
      return res
        .status(200)
        .send(
          decisionPage(
            "Deze aanvraag is al behandeld.",
            true
          )
        );
    }

    const updatedRequest =
      updateResult.rows[0];

    const customerEmailSent =
      await sendCustomerDecisionEmail(
        updatedRequest,
        accepted
      );

    if (!customerEmailSent) {
      console.error(
        "⚠️ Beslissing opgeslagen, maar klantmail kon niet worden verzonden."
      );
    }

    return res
      .status(200)
      .send(
        decisionPage(
          accepted
            ? "Aanvraag geaccepteerd!"
            : "Aanvraag geweigerd.",
          true
        )
      );

  } catch (error) {
    console.error(
      "❌ Beslissingsfout:",
      error
    );

    return res
      .status(500)
      .send(
        decisionPage(
          "Er ging iets mis.",
          false
        )
      );
  }
});


/* =====================================================
   TEAM AUTHENTICATIE
===================================================== */

function requireTeamPassword(req, res, next) {
  if (!TEAM_PASSWORD) {
    return res.status(503).json({
      success: false,
      error:
        "TEAM_PASSWORD is niet ingesteld in Render."
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
      error:
        "Onjuist teamwachtwoord."
    });
  }

  next();
}


/* =====================================================
   TEAM STATISTIEKEN
===================================================== */

app.get(
  "/api/team/stats",
  requireTeamPassword,
  async (req, res) => {
    if (!databaseAvailable(res)) {
      return;
    }

    try {
      const requestsResult =
        await pool.query(`
          SELECT
            id,
            name,
            email,
            phone,
            bike,
            service,
            mud,
            price,
            date,
            message,
            status,
            created_at
          FROM requests
          ORDER BY created_at DESC
        `);

      const costsResult =
        await pool.query(`
          SELECT
            id,
            supplier,
            description,
            amount,
            created_at
          FROM costs
          ORDER BY created_at DESC
        `);

      const requests =
        requestsResult.rows;

      const costs =
        costsResult.rows;

      const totalRequests =
        requests.length;

      const acceptedRequests =
        requests.filter(
          request =>
            request.status === "accepted"
        );

      const rejectedRequests =
        requests.filter(
          request =>
            request.status === "rejected"
        );

      const revenue =
        acceptedRequests.reduce(
          (sum, request) =>
            sum + Number(request.price || 0),
          0
        );

      const totalCosts =
        costs.reduce(
          (sum, cost) =>
            sum + Number(cost.amount || 0),
          0
        );

      const profit =
        revenue - totalCosts;

      const margin =
        revenue > 0
          ? (profit / revenue) * 100
          : 0;


      /* ===============================================
         KLANTEN
      =============================================== */

      const customerMap =
        new Map();

      for (const request of acceptedRequests) {
        const key =
          String(request.email || "")
            .trim()
            .toLowerCase();

        if (!key) {
          continue;
        }

        if (!customerMap.has(key)) {
          customerMap.set(key, {
            name: request.name || "",
            email: request.email || "",
            cleanings: 0,
            revenue: 0,
            lastVisit: request.created_at
          });
        }

        const customer =
          customerMap.get(key);

        customer.cleanings += 1;

        customer.revenue +=
          Number(request.price || 0);

        if (
          request.created_at &&
          new Date(request.created_at) >
            new Date(customer.lastVisit)
        ) {
          customer.lastVisit =
            request.created_at;
        }
      }

      const customers =
        Array.from(customerMap.values())
          .sort(
            (a, b) =>
              new Date(b.lastVisit) -
              new Date(a.lastVisit)
          );


      /* ===============================================
         DATA VOOR TEAM.HTML
      =============================================== */

      return res.json({
        success: true,

        financial: {
          revenue,
          costs: totalCosts,
          profit,
          margin
        },

        counts: {
          total: totalRequests,
          accepted:
            acceptedRequests.length,
          rejected:
            rejectedRequests.length
        },

        requests:
          requests.map(request => ({
            id: request.id,
            name: request.name,
            email: request.email,
            phone: request.phone,
            bike: request.bike,
            service: request.service,
            amount:
              Number(request.price || 0),
            status: request.status,
            createdAt:
              request.created_at
          })),

        customers,

        costsList:
          costs.map(cost => ({
            id: cost.id,
            supplier:
              cost.supplier || "",
            description:
              cost.description,
            amount:
              Number(cost.amount || 0),
            createdAt:
              cost.created_at
          }))
      });

    } catch (error) {
      console.error(
        "❌ Team stats fout:",
        error
      );

      return res.status(500).json({
        success: false,
        error:
          "Dashboard kon niet geladen worden."
      });
    }
  }
);


/* =====================================================
   TEAM KOST TOEVOEGEN
===================================================== */

app.post(
  "/api/team/cost",
  requireTeamPassword,
  async (req, res) => {
    if (!databaseAvailable(res)) {
      return;
    }

    try {
      const supplier =
        String(req.body.supplier || "")
          .trim();

      const description =
        String(req.body.description || "")
          .trim();

      const amount =
        Number(req.body.amount);

      if (!description) {
        return res.status(400).json({
          success: false,
          error:
            "Omschrijving is verplicht."
        });
      }

      if (
        !Number.isFinite(amount) ||
        amount <= 0
      ) {
        return res.status(400).json({
          success: false,
          error:
            "Voer een geldig bedrag in."
        });
      }

      await pool.query(
        `
          INSERT INTO costs
          (
            supplier,
            description,
            amount
          )
          VALUES
          ($1,$2,$3)
        `,
        [
          supplier,
          description,
          amount
        ]
      );

      return res.json({
        success: true,
        message:
          "Kosten opgeslagen."
      });

    } catch (error) {
      console.error(
        "❌ Kost opslaan fout:",
        error
      );

      return res.status(500).json({
        success: false,
        error:
          "Kosten konden niet worden opgeslagen."
      });
    }
  }
);


/* =====================================================
   DECISION PAGINA
===================================================== */

function decisionPage(message, success) {
  const color =
    success ? "#b8ff35" : "#ff2f8a";

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
          min-height: 100vh;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 20px;
          box-sizing: border-box;
          background: #090a0d;
          color: #f5f7fa;
          font-family: Arial, Helvetica, sans-serif;
        }

        .box {
          width: 100%;
          max-width: 520px;
          padding: 40px 30px;
          box-sizing: border-box;
          text-align: center;
          background: #12151b;
          border: 1px solid #272c35;
          border-radius: 24px;
          box-shadow: 0 20px 60px rgba(0,0,0,.35);
        }

        h1 {
          margin-top: 0;
          color: ${color};
        }

        p {
          color: #9ba2ad;
          line-height: 1.6;
        }

        .logo {
          font-size: 28px;
          font-weight: 900;
          margin-bottom: 25px;
        }

        .logo span {
          color: #b8ff35;
        }
      </style>
    </head>

    <body>

      <div class="box">

        <div class="logo">
          CLEAN <span>RIDE</span>
        </div>

        <h1>
          ${escapeHtml(message)}
        </h1>

        <p>
          Je kunt dit venster sluiten.
        </p>

      </div>

    </body>
    </html>
  `;
}


/* =====================================================
   HEALTH CHECK
===================================================== */

app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    service: "Clean Ride"
  });
});


/* =====================================================
   API 404
===================================================== */

app.use("/api", (req, res) => {
  res.status(404).json({
    success: false,
    error: "API-route niet gevonden."
  });
});


/* =====================================================
   ALGEMENE FOUTAFHANDELING
===================================================== */

app.use((error, req, res, next) => {
  console.error(
    "❌ Onverwachte serverfout:",
    error
  );

  if (res.headersSent) {
    return next(error);
  }

  res.status(500).json({
    success: false,
    error:
      "Er is een onverwachte serverfout opgetreden."
  });
});


/* =====================================================
   SERVER STARTEN
===================================================== */

async function startServer() {
  try {
    await initDatabase();

    app.listen(PORT, () => {
      console.log(
        `🚲 Clean Ride server draait op poort ${PORT}`
      );

      console.log(
        `🌐 Base URL: ${BASE_URL}`
      );

      console.log(
        `📊 Team: ${BASE_URL}/team.html`
      );

      console.log(
        `❤️ Health: ${BASE_URL}/health`
      );
    });

  } catch (error) {
    console.error(
      "❌ Server kon niet starten:",
      error
    );

    process.exit(1);
  }
}


startServer();
