// server.js  — Bitget Forwarder (Render)
// Node >=18 (tem fetch global)
// npm deps: express

import express from "express";
import crypto from "crypto";

const app = express();
app.use(express.json({ limit: "512kb" }));

// ====== ENV ======
const API_BASE = "https://api.bitget.com";
const API_KEY = process.env.API_KEY || "";
const API_SECRET = process.env.API_SECRET || "";
const API_PASSPHRASE = process.env.API_PASSPHRASE || "";
const FWD_TOKEN = process.env.FWD_TOKEN || "";

// ====== Utils ======
const ok = (res, data) => res.status(200).json(data);
const fail = (res, status, msg) => res.status(status).json({ ok: false, error: msg });

function auth(req, res, next) {
  const tok = req.query.token || req.headers["x-fwd-token"];
  if (!FWD_TOKEN || tok === FWD_TOKEN) return next();
  return fail(res, 401, "bad token");
}

/**
 * Bitget assinatura:
 * sign = HMAC_SHA256(secret, timestamp + method + pathWithQuery + body).toString('base64')
 */
function makeSign(method, pathWithQuery, bodyStr = "") {
  const ts = Date.now().toString();
  const prehash = ts + method.toUpperCase() + pathWithQuery + bodyStr;
  const sign = crypto.createHmac("sha256", API_SECRET).update(prehash).digest("base64");
  return { ts, sign };
}

async function signedFetch(path, method = "GET", bodyObj, queryObj) {
  const url = new URL(API_BASE + path);
  if (queryObj) {
    for (const [k, v] of Object.entries(queryObj)) {
      if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
    }
  }
  const bodyStr = bodyObj ? JSON.stringify(bodyObj) : "";
  const { ts, sign } = makeSign(method, url.pathname + url.search, bodyStr);
  const headers = {
    "ACCESS-KEY": API_KEY,
    "ACCESS-SIGN": sign,
    "ACCESS-TIMESTAMP": ts,
    "ACCESS-PASSPHRASE": API_PASSPHRASE,
    "Content-Type": "application/json",
  };
  const r = await fetch(url.toString(), {
    method,
    headers,
    body: bodyStr || undefined,
  });
  return r;
}

// ====== ROUTES ======

// Health (útil para Render logs e CF cron)
app.get("/health", (req, res) => {
  res.type("text/plain").send("ok:true");
});

// Market contracts (sem auth da Bitget, mas protegemos por token)
app.get("/contracts", auth, async (req, res) => {
  try {
    const productType = (req.query.product || "umcbl").toString();
    const u = new URL(API_BASE + "/api/mix/v1/market/contracts");
    u.searchParams.set("productType", productType);
    const r = await fetch(u);
    const text = await r.text();
    res.status(r.status).type("application/json").send(text);
  } catch (e) {
    fail(res, 500, String(e));
  }
});

// Posições (verifica se já tens posição aberta)
app.get("/positions", auth, async (req, res) => {
  try {
    const symbol = req.query.symbol;
    const marginCoin = (req.query.marginCoin || "USDT").toString();
    if (!symbol) return fail(res, 400, "symbol required");
    const r = await signedFetch("/api/mix/v1/position/singlePosition", "GET", null, {
      symbol,
      marginCoin,
    });
    const text = await r.text();
    res.status(r.status).type("application/json").send(text);
  } catch (e) {
    fail(res, 500, String(e));
  }
});

// Define leverage (50x, etc.)
app.post("/leverage", auth, async (req, res) => {
  try {
    const { symbol, marginCoin = "USDT", leverage, holdSide = "long" } = req.body || {};
    if (!symbol || !leverage) return fail(res, 400, "symbol and leverage required");

    const body = {
      symbol,
      marginCoin,
      leverage: String(leverage),
      holdSide, // "long" | "short" | "both"
    };

    const r = await signedFetch("/api/mix/v1/account/setLeverage", "POST", body);
    const text = await r.text();
    res.status(r.status).type("application/json").send(text);
  } catch (e) {
    fail(res, 500, String(e));
  }
});

// Envia uma ordem de mercado com TP/SL
app.post("/order", auth, async (req, res) => {
  try {
    // pass-through seguro (Bitget espera strings em vários campos)
    const {
      symbol,
      marginCoin = "USDT",
      size,
      side, // "open_long" | "open_short" | "close_long" | "close_short"
      orderType = "market",
      timeInForceValue = "normal",
      reduceOnly = false,
      presetTakeProfitPrice,
      presetStopLossPrice,
      clientOid,
      openType = "isolated", // "isolated" | "crossed"
      leverage,              // opcional (costuma ir no setLeverage)
    } = req.body || {};

    if (!symbol || !size || !side) return fail(res, 400, "symbol, size and side are required");

    const body = {
      symbol,
      marginCoin,
      size: String(size),
      side,
      orderType,
      timeInForceValue,
      reduceOnly: Boolean(reduceOnly),
      openType,
      clientOid: clientOid || `srv-${Date.now()}`,
    };

    if (leverage) body.leverage = String(leverage);
    if (presetTakeProfitPrice !== undefined) body.presetTakeProfitPrice = String(presetTakeProfitPrice);
    if (presetStopLossPrice !== undefined) body.presetStopLossPrice = String(presetStopLossPrice);

    const r = await signedFetch("/api/mix/v1/order/placeOrder", "POST", body);
    const text = await r.text();
    res.status(r.status).type("application/json").send(text);
  } catch (e) {
    fail(res, 500, String(e));
  }
});

// Fallback
app.use((req, res) => res.status(404).json({ ok: false, error: "not found" }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("bitget-forwarder listening on", PORT);
});
