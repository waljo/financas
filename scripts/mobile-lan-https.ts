import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import path from "node:path";
import { networkInterfaces } from "node:os";

function pickLocalIp() {
  const nets = networkInterfaces();
  for (const list of Object.values(nets)) {
    if (!list) continue;
    for (const netInfo of list) {
      if (netInfo.family === "IPv4" && !netInfo.internal) {
        return netInfo.address;
      }
    }
  }
  return "127.0.0.1";
}

function getArgValue(flag: string) {
  const index = process.argv.indexOf(flag);
  if (index < 0) return null;
  return process.argv[index + 1] ?? null;
}

function resolvePath(value: string) {
  if (path.isAbsolute(value)) return value;
  return path.resolve(process.cwd(), value);
}

function readRequiredFile(filePath: string, label: string) {
  try {
    return readFileSync(filePath);
  } catch {
    console.error(`Nao foi possivel ler ${label}: ${filePath}`);
    console.error("Gere certificados com mkcert e informe --cert e --key.");
    process.exit(1);
  }
}

const targetPort = Number(getArgValue("--targetPort") ?? process.env.PORT ?? "3000");
const httpsPort = Number(getArgValue("--httpsPort") ?? process.env.HTTPS_PORT ?? "3443");
const certPath = resolvePath(
  getArgValue("--cert") ?? process.env.MOBILE_HTTPS_CERT_PATH ?? "./localhost+2.pem"
);
const keyPath = resolvePath(
  getArgValue("--key") ?? process.env.MOBILE_HTTPS_KEY_PATH ?? "./localhost+2-key.pem"
);

const cert = readRequiredFile(certPath, "certificado");
const key = readRequiredFile(keyPath, "chave privada");

const ip = pickLocalIp();

console.log("Iniciando Next.js em LAN + proxy HTTPS local...");
console.log(`HTTP dev server:  http://${ip}:${targetPort}`);
console.log(`HTTPS Android:    https://${ip}:${httpsPort}`);
console.log("Se houver erro de certificado no Android, instale o CA do mkcert no aparelho.\n");

const nextDev = spawn("npx", ["next", "dev", "--hostname", "0.0.0.0", "--port", String(targetPort)], {
  stdio: "inherit",
  env: process.env
});

const proxyServer = https.createServer({ key, cert }, (req, res) => {
  const targetRequest = http.request(
    {
      hostname: "127.0.0.1",
      port: targetPort,
      path: req.url,
      method: req.method,
      headers: {
        ...req.headers,
        host: `127.0.0.1:${targetPort}`
      }
    },
    (targetResponse) => {
      res.writeHead(targetResponse.statusCode ?? 502, targetResponse.headers);
      targetResponse.pipe(res);
    }
  );

  targetRequest.on("error", (error) => {
    res.writeHead(502, { "Content-Type": "text/plain; charset=utf-8" });
    res.end(`Proxy HTTPS falhou: ${error.message}`);
  });

  req.pipe(targetRequest);
});

proxyServer.on("upgrade", (req, socket, head) => {
  const targetSocket = net.connect(targetPort, "127.0.0.1", () => {
    const requestLines = [`${req.method} ${req.url} HTTP/${req.httpVersion}`];

    Object.entries(req.headers).forEach(([keyName, value]) => {
      if (Array.isArray(value)) {
        value.forEach((entry) => requestLines.push(`${keyName}: ${entry}`));
      } else if (typeof value === "string") {
        requestLines.push(`${keyName}: ${value}`);
      }
    });

    requestLines.push("\r\n");
    targetSocket.write(requestLines.join("\r\n"));

    if (head && head.length > 0) {
      targetSocket.write(head);
    }

    socket.pipe(targetSocket).pipe(socket);
  });

  targetSocket.on("error", () => {
    socket.destroy();
  });

  socket.on("error", () => {
    targetSocket.destroy();
  });
});

proxyServer.listen(httpsPort, "0.0.0.0", () => {
  console.log(`Proxy HTTPS ativo em 0.0.0.0:${httpsPort}`);
});

function shutdown(code = 0) {
  proxyServer.close(() => {
    process.exit(code);
  });

  if (!nextDev.killed) {
    nextDev.kill("SIGTERM");
  }

  setTimeout(() => process.exit(code), 1200).unref();
}

nextDev.on("exit", (code) => {
  shutdown(code ?? 0);
});

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));
