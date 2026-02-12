import { networkInterfaces } from "node:os";
import { spawn } from "node:child_process";

function pickLocalIp() {
  const nets = networkInterfaces();
  for (const list of Object.values(nets)) {
    if (!list) continue;
    for (const net of list) {
      if (net.family === "IPv4" && !net.internal) {
        return net.address;
      }
    }
  }
  return "127.0.0.1";
}

const port = Number(process.env.PORT ?? "3000");
const ip = pickLocalIp();

console.log(`Servidor LAN disponível em: http://${ip}:${port}`);
console.log("Use esse endereço no Android (mesma rede Wi-Fi).\n");

const child = spawn("npx", ["next", "dev", "--hostname", "0.0.0.0", "--port", String(port)], {
  stdio: "inherit",
  env: process.env
});

child.on("exit", (code) => {
  process.exit(code ?? 0);
});
