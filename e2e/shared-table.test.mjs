import assert from "node:assert/strict";
import test from "node:test";

import { chromium } from "playwright-core";

import { CartesHostClient } from "../dist/src/host-client.js";
import { startCartesHost } from "../dist/src/host-server.js";
import { MultiplayerTableStore } from "../dist/src/multiplayer-store.js";

const THREE_SEAT_DECK = ["♠5", "♥6", "♦7", "♣9", "♦6", "♣5", "♠4", "♥8", "♠2", "♥3"];

test("the real browser UI stays usable when Agents leave or are removed", async (context) => {
  const store = new MultiplayerTableStore(() => THREE_SEAT_DECK);
  const host = await startCartesHost({ port: 0, store });
  const browser = await chromium.launch(browserLaunchOptions());
  const page = await browser.newPage();
  context.after(async () => {
    await browser.close();
    await host.close();
  });

  await page.goto(host.url);
  await page.getByLabel("你的名字").fill("阿童");
  await page.getByRole("button", { name: "建立共桌牌局" }).click();
  await page.locator("#tablePanel").waitFor({ state: "visible" });
  const joinCode = (await page.locator("#joinCode").innerText()).trim();

  const firstClient = new CartesHostClient(host.url);
  const secondClient = new CartesHostClient(host.url);
  const first = await firstClient.joinAgent(joinCode, "小葵");
  const second = await secondClient.joinAgent(joinCode, "阿宇");
  await waitForSeatCount(page, 3);

  await page.getByRole("button", { name: "開始牌局" }).click();
  await page.getByText("輪到 阿童", { exact: true }).waitFor();
  assert.equal(await page.locator('[aria-label="暗牌"]').count(), 1, "the unrevealed dealer card stays hidden");
  await page.getByRole("button", { name: "停牌" }).click();
  await page.getByText("輪到 小葵", { exact: true }).waitFor();

  await secondClient.waitForEvents(second.agent_token, 0);
  const departure = await firstClient.leaveAgent(first.agent_token);
  assert.equal(departure.left, true);
  const secondNotice = await secondClient.waitForEvents(second.agent_token, 0);
  assert.equal(secondNotice.events.some((event) => event.kind === "seat_left" && event.actor_name === "小葵"), true);
  assert.equal(secondNotice.table.active_seat_id, second.table.viewer_seat_id);
  await waitForSeatCount(page, 2);
  await page.getByText("輪到 阿宇", { exact: true }).waitFor();

  const ended = await secondClient.agentAction(
    second.agent_token,
    "stand",
    secondNotice.table.version,
    "e2e-agent-stand-after-leave",
  );
  assert.equal(ended.phase, "ended");
  await page.getByText("本局結束，可以再開一局", { exact: true }).waitFor();

  const returned = await firstClient.joinAgent(joinCode, "小葵");
  assert.notEqual(returned.table.viewer_seat_id, departure.seat_id);
  await waitForSeatCount(page, 3);
  const returnedRow = page.locator(".roster-row").filter({ hasText: "小葵" });
  page.once("dialog", (dialog) => dialog.accept());
  await returnedRow.getByRole("button", { name: "移除" }).click();
  await waitForSeatCount(page, 2);
  await assert.rejects(() => firstClient.getAgentView(returned.agent_token), /憑證無效/);
  assert.equal(await page.locator(".roster-row").filter({ hasText: "小葵" }).count(), 0);
});

function browserLaunchOptions() {
  const executablePath = process.env.CARTES_BROWSER_EXECUTABLE;
  if (executablePath) return { executablePath, headless: true };
  return { channel: process.env.CARTES_BROWSER_CHANNEL || "chrome", headless: true };
}

async function waitForSeatCount(page, expected) {
  await page.waitForFunction(
    (count) => document.querySelector("#seatCount")?.textContent === String(count),
    expected,
  );
}
