// server.js — Bitget forwarder com /auth, /contracts e /order
import express from "express";
import crypto from "crypto";
import fetch from "node-fetch";

const app = express();
app.use(express.json());

const {
  PORT = 3000,
  FWD_TOKEN,             // token shared com o Worker
  BG_API_KEY,
  BG_API_SECRET,
  BG_PASSPHRASE,
  PRODUCT = "umcbl",
  BASE_URL = "https://api.bitget.com", // mainnet
} = process.env;

function needToken(req, res, next) {
  const t = req.query.token || req.headers["x-fwd-token"];
  if (!FWD_TOKEN || t !== FWD_TOKEN) {
    return res.status(401).json({ ok: false, error: "bad token" });
  }
  return next();
}

function ts() {
  // Bitget pede segundos com 3 casas (ms) ou ISO curto; ambos funcionam.
  // Vamos usar segundos com milissegundos (ex.: 1700000000.123).
  const n = Date.now();
  return (n / 1000).toFixed(3);
}

function sign({ timestamp, method, path, body = "" }) {
  const msg = `${timestamp}${method}${path}${body}`;
  return crypto
    .createHmac("sha256", BG_API_SECRET)
    .update(msg)
    .digest("base64");
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

// Saúde simples
app.get("/health", (_req, res) => {
  res.type("text/plain").send("OK");
});

// 🔐 Teste de credenciais: consulta conta de futures
app.get("/auth", needToken, async (req, res) => {
  try {
    const q = `productType=${encodeURIComponent(PRODUCT)}`;
    const path = `/api/mix/v1/account/account?${q}`;
    const r = await fetch(`${BASE_URL}${path}`, {
      method: "GET",
      headers: authHeaders({ method: "GET", path }),
    });
    const text = await r.text();
    let data;
    try { data = JSON.parse(text); } catch { data = { raw: text }; }
    return res.status(r.status).json({ ok: r.ok, status: r.status, data });
  } catch (e) {
    return res.status(500).json({ ok: false, error: String(e) });
  }
});

// 📜 Lista de contracts (cache a cargo do Worker)
app.get("/contracts", needToken, async (req, res) => {
  try {
    const product = req.query.product || PRODUCT;
    const q = `productType=${encodeURIComponent(product)}`;
    const path = `/api/mix/v1/market/contracts?${q}`;
    const r = await fetch(`${BASE_URL}${path}`, {
      method: "GET",
      headers: authHeaders({ method: "GET", path }),
    });
    const text = await r.text();
    let data;
    try { data = JSON.parse(text); } catch { data = { raw: text }; }
    return res.status(r.status).json(data);
  } catch (e) {
    return res.status(500).json({ ok: false, error: String(e) });
  }
});

// 🛒 Enviar ordem
app.post("/order", needToken, async (req, res) => {
  try {
    const body = req.body || {};
    // Espera algo como:
    // { symbol, marginCoin:"USDT", size, side, orderType:"market",
    //   timeInForceValue:"normal", reduceOnly:false,
    //   presetTakeProfitPrice, presetStopLossPrice, clientOid, leverage }
    const path = "/api/mix/v1/order/placeOrder";
    const r = await fetch(`${BASE_URL}${path}`, {
      method: "POST",
      headers: authHeaders({ method: "POST", path, body }),
      body: JSON.stringify(body),
    });
    const text = await r.text();
    let data;
    try { data = JSON.parse(text); } catch { data = { raw: text }; }
    return res.status(r.status).json({ ok: r.ok, status: r.status, data });
  } catch (e) {
    return res.status(500).json({ ok: false, error: String(e) });
  }
});

app.listen(PORT, () => {
  console.log(`bitget-forwarder live on :${PORT}`);
});
