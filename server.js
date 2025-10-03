// server.js — Bitget forwarder (health, auth, contracts, leverage, order)
import express from "express";
import crypto from "crypto";

const app = express();
app.use(express.json());

const {
  PORT = 3000,
  FWD_TOKEN,
  BG_API_KEY,
  BG_API_SECRET,
  BG_PASSPHRASE,
  PRODUCT = "umcbl",
  BASE_URL = "https://api.bitget.com",
} = process.env;

function needToken(req, res, next) {
  const t = req.query.token || req.headers["x-fwd-token"];
  if (!FWD_TOKEN || t !== FWD_TOKEN) {
    return res.status(401).json({ ok: false, error: "bad token" });
  }
  next();
}

const ts = () => (Date.now() / 1000).toFixed(3);
function sign({ timestamp, method, path, body = "" }) {
  const msg = `${timestamp}${method}${path}${body}`;
  return crypto.createHmac("sha256", BG_API_SECRET).update(msg).digest("base64");
}
function authHeaders({ method, path, body = "" }) {
  const timestamp = ts();
  const bodyStr = body ? JSON.stringify(body) : "";
  const signature = sign({ timestamp, method, path, body: bodyStr });
  return {
    "ACCESS-KEY": BG_API_KEY,
    "ACCESS-SIGN": signature,
    "ACCESS-TIMESTAMP": timestamp,
    "ACCESS-PASSPHRASE": BG_PASSPHRASE,
    "Content-Type": "application/json",
  };
}

app.get("/health", (_req, res) => res.type("text/plain").send("OK"));

app.get("/auth", needToken, async (_req, res) => {
  try {
    const q = `productType=${encodeURIComponent(PRODUCT)}`;
    const path = `/api/mix/v1/account/account?${q}`;
    const r = await fetch(`${BASE_URL}${path}`, {
      method: "GET",
      headers: authHeaders({ method: "GET", path }),
    });
    const txt = await r.text();
    let data; try { data = JSON.parse(txt); } catch { data = { raw: txt }; }
    res.status(r.status).json({ ok: r.ok, status: r.status, data });
  } catch (e) { res.status(500).json({ ok: false, error: String(e) }); }
});

app.get("/contracts", needToken, async (req, res) => {
  try {
    const product = req.query.product || PRODUCT;
    const q = `productType=${encodeURIComponent(product)}`;
    const path = `/api/mix/v1/market/contracts?${q}`;
    const r = await fetch(`${BASE_URL}${path}`, {
      method: "GET",
      headers: authHeaders({ method: "GET", path }),
    });
    const txt = await r.text();
    let data; try { data = JSON.parse(txt); } catch { data = { raw: txt }; }
    res.status(r.status).json(data);
  } catch (e) { res.status(500).json({ ok: false, error: String(e) }); }
});

// NOVO: definir alavancagem
app.post("/leverage", needToken, async (req, res) => {
  try {
    const { symbol, leverage, holdSide, marginCoin = "USDT" } = req.body || {};
    const body = {
      symbol,
      productType: PRODUCT,
      marginCoin,
      leverage: String(leverage),
      holdSide, // "long" ou "short"
    };
    const path = "/api/mix/v1/account/setLeverage";
    const r = await fetch(`${BASE_URL}${path}`, {
      method: "POST",
      headers: authHeaders({ method: "POST", path, body }),
      body: JSON.stringify(body),
    });
    const txt = await r.text();
    let data; try { data = JSON.parse(txt); } catch { data = { raw: txt }; }
    res.status(r.status).json({ ok: r.ok, status: r.status, data });
  } catch (e) { res.status(500).json({ ok: false, error: String(e) }); }
});

app.post("/order", needToken, async (req, res) => {
  try {
    const body = req.body || {};
    const path = "/api/mix/v1/order/placeOrder";
    const r = await fetch(`${BASE_URL}${path}`, {
      method: "POST",
      headers: authHeaders({ method: "POST", path, body }),
      body: JSON.stringify(body),
    });
    const txt = await r.text();
    let data; try { data = JSON.parse(txt); } catch { data = { raw: txt }; }
    res.status(r.status).json({ ok: r.ok, status: r.status, data });
  } catch (e) { res.status(500).json({ ok: false, error: String(e) }); }
});

app.listen(PORT, () => console.log(`bitget-forwarder live on :${PORT}`));
