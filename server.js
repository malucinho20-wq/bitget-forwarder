import express from "express";
import cors from "cors";
import crypto from "crypto";
import fetch from "node-fetch";

const app = express();
app.use(cors());
app.use(express.json());

const FWD_TOKEN         = process.env.FWD_TOKEN || "";
const BITGET_KEY        = process.env.BITGET_KEY || "";
const BITGET_SECRET     = process.env.BITGET_SECRET || "";
const BITGET_PASSPHRASE = process.env.BITGET_PASSPHRASE || "";
const PRODUCT           = (process.env.BITGET_PRODUCT || "umcbl").toLowerCase();
const BITGET_BASE       = "https://api.bitget.com";

// --- auth: aceita header x-fwd-token, Authorization: Bearer, ou ?token= ---
function checkAuth(req, res, next) {
  const hdr = req.headers["x-fwd-token"];
  const ber = (req.headers["authorization"] || "").replace(/^Bearer\s+/i, "");
  const qry = req.query.token;
  const tok = hdr || ber || qry;
  if (!FWD_TOKEN || tok !== FWD_TOKEN) return res.status(401).json({ ok:false, error:"bad token" });
  next();
}

function sign(method, path, query = "", body = "") {
  const ts = (Date.now() / 1000).toFixed(3);
  const pre = ts + method.toUpperCase() + path + (query ? `?${query}` : "") + body;
  const sig = crypto.createHmac("sha256", BITGET_SECRET).update(pre).digest("base64");
  return { ts, sig };
}

app.get("/health", (req,res) => res.json({ ok:true, service:"bitget-forwarder", time:new Date().toISOString() }));

// --- handlers reutilizáveis ---
async function handleContracts(req, res) {
  try {
    const path = "/api/mix/v1/market/contracts";
    const query = `productType=${encodeURIComponent(PRODUCT)}`;
    const r = await fetch(`${BITGET_BASE}${path}?${query}`);
    const data = await r.json();
    res.json(data);
  } catch (e) {
    res.status(500).json({ ok:false, error:String(e) });
  }
}

async function handleOrder(req, res) {
  try {
    const body = req.body || {};
    const path = "/api/mix/v1/order/placeOrder";

    const payload = {
      symbol: body.symbol,
      marginCoin: body.marginCoin || "USDT",
      size: String(body.size),
      side: body.side,
      orderType: body.orderType || "market",
      timeInForceValue: body.timeInForceValue || "normal",
      reduceOnly: !!body.reduceOnly,
      presetTakeProfitPrice: body.presetTakeProfitPrice ? String(body.presetTakeProfitPrice) : undefined,
      presetStopLossPrice : body.presetStopLossPrice  ? String(body.presetStopLossPrice)  : undefined,
      leverage: String(body.leverage || "50"),
      clientOid: body.clientOid || `fwd-${Date.now()}`
    };

    const bodyStr = JSON.stringify(payload);
    const { ts, sig } = sign("POST", path, "", bodyStr);

    const r = await fetch(`${BITGET_BASE}${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "ACCESS-KEY":        BITGET_KEY,
        "ACCESS-SIGN":       sig,
        "ACCESS-TIMESTAMP":  ts,
        "ACCESS-PASSPHRASE": BITGET_PASSPHRASE,
        "locale": "en-US"
      },
      body: bodyStr
    });

    const text = await r.text();
    res.status(r.status).type("application/json").send(text);
  } catch (e) {
    res.status(500).json({ ok:false, error:String(e) });
  }
}

// --- publica as duas variantes de rota: com e sem /api ---
app.get (["/contracts", "/api/contracts"], checkAuth, handleContracts);
app.post(["/order",     "/api/order"    ], checkAuth, handleOrder);

const port = process.env.PORT || 3000;
app.listen(port, () => console.log("bitget-forwarder listening on", port));
