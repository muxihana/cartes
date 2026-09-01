const baseUrl = (process.env.CARTES_HOST_URL || "http://127.0.0.1:3210").replace(/\/$/, "");

try {
  const response = await fetch(`${baseUrl}/api/health`, { headers: { Accept: "application/json" } });
  const payload = await response.json();
  if (!response.ok || payload.ok !== true || payload.service !== "cartes-host") {
    throw new Error(payload.error || `HTTP ${response.status}`);
  }
  console.log(`Cartes Host 正常：${baseUrl}（${payload.version}）`);
} catch (error) {
  const detail = error instanceof Error ? error.message : String(error);
  console.error(`Cartes Host 無法使用：${baseUrl}（${detail}）`);
  process.exitCode = 1;
}
