#!/usr/bin/env node

import { startCartesHost } from "./host-server.js";

const configuredPort = Number(process.env.CARTES_HOST_PORT ?? "3210");
if (!Number.isInteger(configuredPort) || configuredPort < 1 || configuredPort > 65535) {
  throw new Error("CARTES_HOST_PORT 必須是 1 到 65535 的整數。");
}

const host = await startCartesHost({ port: configuredPort });
console.log(`Cartes shared table host: ${host.url}`);

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    void host.close().finally(() => process.exit(0));
  });
}
