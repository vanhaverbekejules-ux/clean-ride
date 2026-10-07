```js
const express = require("express");
const path = require("path");
const crypto = require("crypto");
const { Pool } = require("pg");

const app = express();

const PORT = process.env.PORT || 10000;

const BASE_URL =
  process.env.BASE_URL || "https://clean-ride.onrender.com";

const OWNER_EMAIL =
  process.env.OWNER_EMAIL || "clean-ride@hotmail.com";

const MAIL_FROM =
  process.env.MAIL_FROM || "clean-ride@hotmail.com";

const BREVO_API_KEY =
  process.env.BREVO_API_KEY || "";

const TEAM_PASSWORD =
  process.env.TEAM_PASSWORD || "";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL
    ? { rejectUnauthorized: false }
    : false
});

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

/* =====================================================
   WEBSITE
===================================================== */

app.get("/", function (req, res) {
  res.sendFile(path.join(__dirname, "index.html"));
});

app.get("/team.html", function (req, res) {
  res.sendFile(path.join(__dirname, "team.html"));
});

app.use(express.static(__dirname));

/* =====================================================
   DATABASE
===================================================== */

async function initDatabase() {
  if (!process.env.DATABASE_URL) {
    console.log("⚠️ DATABASE_URL ontbreekt.");
    return;
  }

  var requestsTable = [
    "CREATE TABLE IF NOT EXISTS requests (",
    "id SERIAL PRIMARY KEY,",
    "name TEXT,",
    "email TEXT,",
    "phone TEXT,",
    "bike TEXT,",
    "service TEXT,",
    "mud BOOLEAN DEFAULT FALSE,",
    "price NUMERIC,",
    "date TEXT,",
    "message TEXT,",
    "status TEXT DEFAULT 'pending',",
    "created_at TIMESTAMP DEFAULT NOW(),",
    "decision_token TEXT UNIQUE",
    ")"
  ].join(" ");

  var costsTable = [
    "CREATE TABLE IF NOT EXISTS costs (",
    "id SERIAL PRIMARY KEY,",
    "description TEXT,",
    "amount NUMERIC,",
    "created_at TIMESTAMP DEFAULT NOW()",
    ")"
  ].join(" ");

  await pool.query(requestsTable);
  await pool.query(costsTable);

  console.log("✅ Database klaar.");
}

/* =====================================================
   PRIJZEN
===================================================== */

function getAmount(service, mud) {
  var price = 0;

  if (service === "Basic Wash") {
    price = 7;
  } else if (service === "Grondige Reiniging") {
    price = 11;
  } else if (service === "Ultimate Clean") {
    price = 15;
  }

  if (mud === true) {
    price += 2;
  }

  return price;
}

/* =====================================================
   HTML VEILIG MAKEN
===================================================== */

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

/* =====================================================
   BREVO EMAIL
===================================================== */

async function sendBrevoEmail(to, subject, html) {
  if (!BREVO_API_KEY) {
    console.log("⚠️ BREVO_API_KEY ontbreekt.");
    return false;
  }

  try {
    var response = await fetch(
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

    if (!response.ok) {
      var errorText = await response.text();
      console.error("❌ Brevo fout:", errorText);
      return false;
    }

    console.log("✅ E-mail verzonden naar:", to);
    return true;
  } catch (error) {
    console.error("❌ E-mail fout:", error);
    return false;
  }
}

/* =====================================================
   EMAIL NAAR CLEAN RIDE
===================================================== */

async function sendOwnerRequestEmail(request) {
  var acceptUrl =
    BASE_URL +
    "/api/decision?id=" +
    encodeURIComponent(request.id) +
    "&action=accept&token=" +
    encodeURIComponent(request.decision_token);

  var rejectUrl =
    BASE_URL +
    "/api/decision?id=" +
    encodeURIComponent(request.id) +
    "&action=reject&token=" +
    encodeURIComponent(request.decision_token);

  var html =
    "<h2>Nieuwe Clean Ride aanvraag 🚲</h2>" +
    "<p><strong>Naam:</strong> " +
    escapeHtml(request.name) +
    "</p>" +
    "<p><strong>E-mail:</strong> " +
    escapeHtml(request.email) +
    "</p>" +
    "<p><strong>Telefoon:</strong> " +
    escapeHtml(request.phone) +
    "</p>" +
    "<p><strong>Fiets:</strong> " +
    escapeHtml(request.bike) +
    "</p>" +
    "<p><strong>Service:</strong> " +
    escapeHtml(request.service) +
    "</p>" +
    "<p><strong>Modder:</strong> " +
    (request.mud ? "Ja" : "Nee") +
    "</p>" +
    "<p><strong>Prijs:</strong> €" +
    request.price +
    "</p>" +
    "<p><strong>Datum:</strong> " +
    escapeHtml(request.date) +
    "</p>" +
    "<p><strong>Opmerking:</strong> " +
    escapeHtml(request.message) +
    "</p>" +
    "<hr>" +
    "<p><a href=\"" +
    acceptUrl +
    "\">✅ AANVRAAG ACCEPTEREN</a></p>" +
    "<p><a href=\"" +
    rejectUrl +
    "\">❌ AANVRAAG WEIGEREN</a></p>";

  return sendBrevoEmail(
    OWNER_EMAIL,
    "Nieuwe Clean Ride aanvraag",
    html
  );
}

/* =====================================================
   EMAIL NAAR KLANT
===================================================== */

async function sendCustomerDecisionEmail(request, accepted) {
  var html;

  if (accepted) {
    html =
      "<h2>Je aanvraag is bevestigd! 🚲</h2>" +
      "<p>Hallo " +
      escapeHtml(request.name) +
      ",</p>" +
      "<p>Bedankt voor je aanvraag bij Clean Ride.</p>" +
      "<p>We hebben je aanvraag geaccepteerd.</p>" +
      "<p><strong>Service:</strong> " +
      escapeHtml(request.service) +
      "<br><strong>Prijs:</strong> €" +
      request.price +
      "<br><strong>Datum:</strong> " +
      escapeHtml(request.date) +
      "</p>" +
      "<p>Betaling gebeurt achteraf.</p>" +
      "<p>Tot snel bij Clean Ride! 🚲</p>";
  } else {
    html =
      "<h2>Clean Ride</h2>" +
      "<p>Hallo " +
      escapeHtml(request.name) +
      ",</p>" +
      "<p>Bedankt voor je aanvraag bij Clean Ride.</p>" +
      "<p>Helaas kunnen we je aanvraag momenteel niet aannemen, omdat we op dat moment te druk zijn.</p>" +
      "<p>Hopelijk kunnen we je een volgende keer wel helpen!</p>";
  }

  var subject = accepted
    ? "Clean Ride – aanvraag bevestigd"
    : "Clean Ride – aanvraag";

  return sendBrevoEmail(
    request.email,
    subject,
    html
  );
}

/* =====================================================
   NIEUWE AANVRAAG
===================================================== */

app.post("/api/request", async function (req, res) {
  try {
    var name = req.body.name;
    var email = req.body.email;
    var phone = req.body.phone || "";
    var bike = req.body.bike || "";
    var service = req.body.service;
    var date = req.body.date || "";
    var message = req.body.message || "";

    var mud =
      req.body.mud === true ||
      req.body.mud === "true" ||
      req.body.mud === "on" ||
      req.body.mud === "1";

    if (!name || !email || !service) {
      return res.status(400).json({
        success: false,
        message: "Vul alle verplichte velden in."
      });
    }

    var price = getAmount(service, mud);

    var decisionToken = crypto
      .randomBytes(32)
      .toString("hex");

    var result = await pool.query(
      "INSERT INTO requests " +
      "(name,email,phone,bike,service,mud,price,date,message,decision_token) " +
      "VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) " +
      "RETURNING *",
      [
        name,
        email,
        phone,
        bike,
        service,
        mud,
        price,
        date,
        message,
        decisionToken
      ]
    );

    var request = result.rows[0];

    await sendOwnerRequestEmail(request);

    return res.json({
      success: true,
      message: "Aanvraag succesvol verzonden."
    });
  } catch (error) {
    console.error("❌ Aanvraag fout:", error);

    return res.status(500).json({
      success: false,
      message: "Er ging iets mis bij het verzenden."
    });
  }
});

/* =====================================================
   ACCEPT / REJECT
===================================================== */

app.get("/api/decision", async function (req, res) {
  try {
    var id = req.query.id;
    var action = req.query.action;
    var token = req.query.token;

    if (!id || !action || !token) {
      return res.status(400).send("Ongeldige aanvraag.");
    }

    if (action !== "accept" && action !== "reject") {
      return res.status(400).send("Ongeldige actie.");
    }

    var result = await pool.query(
      "SELECT * FROM requests WHERE id = $1 AND decision_token = $2",
      [id, token]
    );

    if (result.rows.length === 0) {
      return res.status(404).send("Aanvraag niet gevonden.");
    }

    var request = result.rows[0];

    if (request.status !== "pending") {
      return res.send(
        decisionPage(
          "Deze aanvraag is al behandeld.",
          "Deze aanvraag werd eerder al geaccepteerd of geweigerd."
        )
      );
    }

    var accepted = action === "accept";

    await pool.query(
      "UPDATE requests SET status = $1 WHERE id = $2",
      [
        accepted ? "accepted" : "rejected",
        id
      ]
    );

    await sendCustomerDecisionEmail(
      request,
      accepted
    );

    return res.send(
      decisionPage(
        accepted
          ? "Aanvraag geaccepteerd ✅"
          : "Aanvraag geweigerd",
        accepted
          ? "De klant heeft een bevestigingsmail ontvangen."
          : "De klant heeft een vriendelijke afwijzingsmail ontvangen."
      )
    );
  } catch (error) {
    console.error("❌ Decision fout:", error);

    return res.status(500).send(
      decisionPage(
        "Er ging iets mis",
        "De aanvraag kon niet worden verwerkt."
      )
    );
  }
});

/* =====================================================
   DECISION PAGINA
===================================================== */

function decisionPage(title, message) {
  return (
    "<!DOCTYPE html>" +
    "<html lang=\"nl\">" +
    "<head>" +
    "<meta charset=\"UTF-8\">" +
    "<meta name=\"viewport\" content=\"width=device-width, initial-scale=1.0\">" +
    "<title>Clean Ride</title>" +
    "<style>" +
    "body{" +
    "margin:0;" +
    "min-height:100vh;" +
    "display:flex;" +
    "align-items:center;" +
    "justify-content:center;" +
    "background:#090a0d;" +
    "color:white;" +
    "font-family:Arial,sans-serif;" +
    "text-align:center;" +
    "}" +
    ".box{" +
    "background:#12151b;" +
    "padding:40px;" +
    "border-radius:20px;" +
    "max-width:600px;" +
    "margin:20px;" +
    "}" +
    "a{color:#b8ff35;}" +
    "</style>" +
    "</head>" +
    "<body>" +
    "<div class=\"box\">" +
    "<h1>" +
    escapeHtml(title) +
    "</h1>" +
    "<p>" +
    escapeHtml(message) +
    "</p>" +
    "<p><a href=\"/\">Terug naar Clean Ride</a></p>" +
    "</div>" +
    "</body>" +
    "</html>"
  );
}

/* =====================================================
   TEAM BEVEILIGING
===================================================== */

function requireTeamPassword(req, res, next) {
  var password = req.headers["x-team-password"];

  if (!TEAM_PASSWORD || password !== TEAM_PASSWORD) {
    return res.status(401).json({
      success: false,
      message: "Geen toegang."
    });
  }

  next();
}

/* =====================================================
   TEAM STATS
===================================================== */

app.get(
  "/api/team/stats",
  requireTeamPassword,
  async function (req, res) {
    try {
      var requestsResult = await pool.query(
        "SELECT * FROM requests ORDER BY created_at DESC"
      );

      var costsResult = await pool.query(
        "SELECT * FROM costs ORDER BY created_at DESC"
      );

      var requests = requestsResult.rows;
      var costs = costsResult.rows;

      var revenue = requests
        .filter(function (item) {
          return item.status === "accepted";
        })
        .reduce(function (sum, item) {
          return sum + Number(item.price || 0);
        }, 0);

      var totalCosts = costs
        .reduce(function (sum, item) {
          return sum + Number(item.amount || 0);
        }, 0);

      var profit = revenue - totalCosts;

      return res.json({
        success: true,
        revenue: revenue,
        costs: totalCosts,
        profit: profit,
        totalRequests: requests.length,
        accepted: requests.filter(function (r) {
          return r.status === "accepted";
        }).length,
        rejected: requests.filter(function (r) {
          return r.status === "rejected";
        }).length,
        pending: requests.filter(function (r) {
          return r.status === "pending";
        }).length,
        requests: requests,
        costs: costs
      });
    } catch (error) {
      console.error("❌ Team stats fout:", error);

      return res.status(500).json({
        success: false,
        message: "Kon teamgegevens niet laden."
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
  async function (req, res) {
    try {
      var description = req.body.description;
      var amount = Number(req.body.amount);

      if (!description || !amount) {
        return res.status(400).json({
          success: false,
          message: "Beschrijving en bedrag zijn verplicht."
        });
      }

      await pool.query(
        "INSERT INTO costs (description, amount) VALUES ($1, $2)",
        [
          description,
          amount
        ]
      );

      return res.json({
        success: true
      });
    } catch (error) {
      console.error("❌ Kosten fout:", error);

      return res.status(500).json({
        success: false,
        message: "Kon kost niet toevoegen."
      });
    }
  }
);

/* =====================================================
   HEALTH CHECK
===================================================== */

app.get("/health", function (req, res) {
  res.json({
    status: "ok",
    service: "Clean Ride"
  });
});

/* =====================================================
   ONBEKENDE API
===================================================== */

app.use("/api", function (req, res) {
  res.status(404).json({
    success: false,
    message: "API endpoint niet gevonden."
  });
});

/* =====================================================
   SERVER FOUT
===================================================== */

app.use(function (error, req, res, next) {
  console.error("❌ Server fout:", error);

  res.status(500).send("Interne serverfout.");
});

/* =====================================================
   START SERVER
===================================================== */

async function startServer() {
  try {
    await initDatabase();

    app.listen(PORT, function () {
      console.log("=================================");
      console.log("🚲 CLEAN RIDE SERVER");
      console.log("=================================");
      console.log("✅ Poort: " + PORT);
      console.log("✅ Website: " + BASE_URL);
      console.log("=================================");
    });
  } catch (error) {
    console.error("❌ Server kon niet starten:", error);
    process.exit(1);
  }
}

startServer();
```
