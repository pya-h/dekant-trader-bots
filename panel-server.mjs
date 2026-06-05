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

// Seed the panel's default bot URL with the proxy target so the settings modal
// starts from what this script was launched with. The placeholder is a quoted JS
// string literal; JSON.stringify keeps the replacement properly escaped.
const panelHtml = readFileSync(join(__dirname, "panel.html"), "utf8").replaceAll(
  "'__PANEL_BOT_URL__'",
  () => JSON.stringify(TARGET)
);

const server = createServer((req, res) => {
  // Serve panel
  if (req.url === "/" || req.url === "/panel") {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(panelHtml);
    return;
  }

  // Per-request target override: the panel sends the operator-selected bot URL in
  // the `x-proxy-target` header so the server can be switched from the UI without
  // restarting this proxy. Falls back to the launch target when absent/invalid.
  let target = targetUrl;
  const override = req.headers["x-proxy-target"];
  if (typeof override === "string" && override.length > 0) {
    try {
      target = new URL(override);
    } catch {
      // ignore malformed override, keep default target
    }
  }
  const useHttps = target.protocol === "https:";

  // Strip the control header and rewrite host for the chosen target.
  const headers = { ...req.headers, host: target.host };
  delete headers["x-proxy-target"];

  const opts = {
    hostname: target.hostname,
    port: target.port || (useHttps ? 443 : 80),
    path: req.url,
    method: req.method,
    headers,
  };

  const proxyReq = (useHttps ? httpsRequest : httpRequest)(opts, (proxyRes) => {
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
