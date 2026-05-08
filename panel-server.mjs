#!/usr/bin/env node
// Tiny local server that serves panel.html and proxies API calls to the bot.
// Usage:  node panel-server.mjs                        → proxies to https://bot.dekant.xyz
//         node panel-server.mjs http://localhost:3001   → proxies to localhost
//         PORT=9000 node panel-server.mjs               → listen on port 9000

import { createServer, request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = parseInt(process.env.PORT || "9009", 10);
const TARGET = (process.argv[2] || "https://bot.dekant.xyz").replace(/\/+$/, "");
const targetUrl = new URL(TARGET);
const isHttps = targetUrl.protocol === "https:";

const panelHtml = readFileSync(join(__dirname, "panel.html"));

const server = createServer((req, res) => {
  // Serve panel
  if (req.url === "/" || req.url === "/panel") {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(panelHtml);
    return;
  }

  // Proxy everything else to the bot
  const opts = {
    hostname: targetUrl.hostname,
    port: targetUrl.port || (isHttps ? 443 : 80),
    path: req.url,
    method: req.method,
    headers: { ...req.headers, host: targetUrl.host },
  };

  const proxyReq = (isHttps ? httpsRequest : httpRequest)(opts, (proxyRes) => {
    res.writeHead(proxyRes.statusCode, proxyRes.headers);
    proxyRes.pipe(res);
  });

  proxyReq.on("error", (err) => {
    res.writeHead(502, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "proxy_error", message: err.message }));
  });

  req.pipe(proxyReq);
});

server.listen(PORT, () => {
  console.log(`\n  Panel:  http://localhost:${PORT}`);
  console.log(`  Proxy → ${TARGET}\n`);
});
