import express from "express";
import cors from "cors";
import crypto from "crypto";
import axios from "axios";

const app = express();
app.use(cors());
app.use(express.json());

// ----- ENV obrigatórias (definir no Render) -----
const BITGET_KEY        = process.env.BITGET_KEY;
const BITGET_SECRET     = process.env.BITGET_SECRET;
const BITGET_PASSPHRASE = process.env.BITGET_PASSPHRASE;
const BITGET_PRODUCT    = (process.env.BITGET_PRODUCT || "umcbl").toLowerCase();
const TOKEN             = process.env.FWD_TOKEN;   // shared secret com o Worker

// util: assinar pedidos Bitget v2
function sign({method, path, query = "", body = ""}) {
  const ts = Date.now().toString();
  const pre = ts + method.toUpperCase() + path + (query || "") + (body || "");
  const mac = crypto.createHmac("sha256", BITGET_SECRET).update(pre).digest("base64");
  return { ts, mac };
}

async function callBitget({method, path, query = "", bodyObj}) {
  const body = bodyObj ? JSON.stringify(bodyObj) : "";
  const { ts, mac } = sign({ method, path, query, body });
  const url = "https://api.bitget.com" + path + (query || "");

  const headers = {
    "ACCESS-KEY":        BITGET_KEY,
    "ACCESS-SIGN":       mac,
    "ACCESS-TIMESTAMP":  ts,
    "ACCESS-PASSPHRASE": BITGET_PASSPHRASE,
    "Content-Type":      "application/json",
    "X-Channel":         "api",
  };

  const r = await axios({
    url, method, headers,
    data: body || undefined,
    timeout: 10000
  });
  return r.data;
}

// auth simples
function auth(req, res, next) {
  if (!TOKEN) return res.status(500).json({ ok:false, error:"FWD_TOKEN missing" });
  if (req.get("x-auth") !== TOKEN) return res.status(401).json({ ok:false, error:"bad token" });
  next();
}

app.get("/health", (_, res) => res.json({ ok:true }));

// tempo público (debug)
app.get("/bitget/time", auth, async (_, res) => {
  try {
    const data = await callBitget({ method:"GET", path:"/api/v2/public/time" });
    res.json({ ok:true, data });
  } catch (e) {
    res.status(502).json({ ok:false, error:String(e) });
  }
});

// colocar ordem (recebe já tudo calculado pelo Worker)
app.post("/bitget/order", auth, async (req, res) => {
  try {
    const o = req.body?.order;
    if (!o) return res.status(400).json({ ok:false, error:"missing order" });

    // endpoint & payload v2
    const path = "/api/v2/mix/order/place-order";
    const body = {
      symbol: o.symbol,                // ex: ETHUSDT_UMCBL
      marginCoin: "USDT",
      productType: BITGET_PRODUCT,     // umcbl
      clientOid: o.externalOid,        // id do TV
      size: String(o.vol),             // contratos
      side: (o.side === 1 ? "buy" : "sell"),
      orderType: "market",             // market/limit (ajusta se preferires)
      leverage: String(o.leverage),
      // preset TP/SL
      presetTakeProfitPrice: String(o.takeProfitPrice),
      presetStopLossPrice:  String(o.stopLossPrice),
      // open/close:
      //  type 5 -> open, openType 1 -> isolated
      // na v2 isto é deduzido pelo lado + posição: aqui vamos abrir
    };

    const data = await callBitget({ method:"POST", path, bodyObj: body });
    res.json({ ok:true, data });
  } catch (e) {
    res.status(502).json({ ok:false, error:String(e) });
  }
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log("forwarder listening on", PORT));
