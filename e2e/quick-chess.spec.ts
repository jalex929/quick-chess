import { expect, test, type Page } from "@playwright/test";

const sq = (page: Page, square: string) => page.locator(`[data-square=${square}]`);

/** Tap-tap a move (works on desktop and phone). */
async function move(page: Page, from: string, to: string) {
  await sq(page, from).click();
  await sq(page, to).click();
}

/** Start from a saved game, as if the page had been reloaded mid-game. */
async function seed(page: Page, settings: object, moves: string[]) {
  await page.goto("./");
  await page.evaluate(
    ([settings, moves]) => {
      localStorage.setItem(
        "quick-chess:game",
        JSON.stringify({
          settings: {
            mode: "pass",
            level: "easy",
            side: "w",
            clock: null,
            passView: "face",
            pieceFacing: "owner",
            ...settings,
          },
          human: "w",
          moves,
          clock: null,
          ending: null,
          startedAt: Date.now(),
        }),
      );
    },
    [settings, moves] as const,
  );
  await page.reload();
}

test.beforeEach(async ({ page }) => {
  await page.goto("./");
  await page.evaluate(() => localStorage.clear());
  await page.reload();
});

test("start a bot game in one tap, move, and the bot answers", async ({ page }) => {
  await page.getByRole("button", { name: /Start game/ }).click();
  await move(page, "e2", "e4");
  await expect(sq(page, "e4")).toHaveAttribute("aria-label", /white pawn/);
  // The bot (Black) replies: two moves in the list.
  await expect(page.locator(".moves__list li")).toHaveCount(1);
  await expect(page.locator(".moves__black").first()).not.toBeEmpty({ timeout: 8000 });
  await expect(page.locator(".status")).toHaveText("Your move");
});

test("undo takes back your move and the bot's reply", async ({ page }) => {
  await page.getByRole("button", { name: /Start game/ }).click();
  await move(page, "g1", "f3");
  await expect(page.locator(".moves__black").first()).not.toBeEmpty({ timeout: 8000 });
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(page.getByText("No moves yet.")).toBeVisible();
  await expect(sq(page, "g1")).toHaveAttribute("aria-label", /white knight/);
});

test("drag and drop a piece", async ({ page, isMobile }) => {
  test.skip(isMobile, "mouse drag");
  await page.getByRole("button", { name: /Start game/ }).click();
  const from = (await sq(page, "d2").boundingBox())!;
  const to = (await sq(page, "d4").boundingBox())!;
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 8 });
  await page.mouse.up();
  await expect(sq(page, "d4")).toHaveAttribute("aria-label", /white pawn/);
});

test("play by keyboard: arrows to move around, Enter to pick up and put down", async ({
  page,
  isMobile,
}) => {
  test.skip(isMobile, "keyboard");
  await page.getByRole("radio", { name: /Pass & play/ }).check();
  await page.getByRole("button", { name: /Start game/ }).click();
  await sq(page, "e2").focus();
  await page.keyboard.press("Enter");
  await expect(sq(page, "e2")).toHaveAttribute("aria-selected", "true");
  await expect(sq(page, "e4")).toHaveAttribute("aria-label", /can move here/);
  await page.keyboard.press("ArrowUp");
  await page.keyboard.press("ArrowUp");
  await expect(sq(page, "e4")).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(sq(page, "e4")).toHaveAttribute("aria-label", /white pawn/);
  await expect(page.getByRole("status").filter({ hasText: "pawn to e4" })).toHaveCount(1);
});

test("checkmate ends the game with a result card and PGN", async ({ page }) => {
  await page.getByRole("radio", { name: /Pass & play/ }).check();
  await page.getByRole("radio", { name: /Stays put/ }).check();
  await page.getByRole("button", { name: /Start game/ }).click();
  await move(page, "f2", "f3");
  await move(page, "e7", "e5");
  await move(page, "g2", "g4");
  await move(page, "d8", "h4");
  const hud = page.getByRole("region", { name: "Black wins" });
  await expect(hud).toContainText("Checkmate.");
  await page.getByRole("button", { name: "Hide result" }).first().click();
  await expect(hud).toHaveCount(0);
  await expect(sq(page, "e1")).toHaveAttribute("aria-label", /in check/);
  // Back to the main menu from the finished game.
  await page.getByRole("button", { name: "Main menu" }).click();
  await expect(page.getByRole("button", { name: /Start game/ })).toBeVisible();
});

test("promotion asks which piece", async ({ page }) => {
  await seed(page, {}, ["h2h4", "g7g5", "h4g5", "h7h6", "g5h6", "g8f6", "h6h7", "f6g8"]);
  await move(page, "h7", "g8");
  await page.getByRole("dialog").getByRole("button", { name: "Knight" }).click();
  await expect(sq(page, "g8")).toHaveAttribute("aria-label", /white knight/);
});

test("an unfinished game comes back after a reload", async ({ page }) => {
  await page.getByRole("radio", { name: /Pass & play/ }).check();
  await page.getByRole("button", { name: /Start game/ }).click();
  await move(page, "e2", "e4");
  await move(page, "c7", "c5");
  await page.reload();
  await expect(sq(page, "c5")).toHaveAttribute("aria-label", /black pawn/);
  await expect(page.locator(".moves__list li")).toHaveCount(1);
});

test("clocks start after the first move, and pause and resume", async ({ page }) => {
  await page.getByRole("radio", { name: /Pass & play/ }).check();
  await page.getByRole("radio", { name: "3 + 2" }).check();
  await page.getByRole("button", { name: /Start game/ }).click();
  const timers = page.getByRole("timer");
  await expect(timers).toHaveCount(2);
  await expect(timers.first()).toHaveText("3:00");
  await move(page, "e2", "e4");
  // Black's time is now running.
  await expect(page.locator(".player__clock--running")).toHaveCount(1);
  await page.getByRole("button", { name: "Pause" }).click();
  await expect(page.getByRole("dialog", { name: "Game paused" })).toBeVisible();
  await expect(page.locator(".player__clock--running")).toHaveCount(0);
  await page.getByRole("dialog").getByRole("button", { name: "Resume" }).click();
  await expect(page.locator(".player__clock--running")).toHaveCount(1);
});

test("resign asks first, then ends the game", async ({ page }) => {
  await page.getByRole("button", { name: /Start game/ }).click();
  await page.getByRole("button", { name: "Resign" }).click();
  await page.getByRole("button", { name: "Keep playing" }).click();
  await page.getByRole("button", { name: "Resign" }).click();
  await page.getByRole("button", { name: "Yes, resign" }).click();
  await expect(page.getByRole("heading", { name: "The bot wins" })).toBeVisible();
});

test("nothing scrolls sideways and Start is on screen", async ({ page }) => {
  await expect(page.getByRole("button", { name: /Start game/ })).toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBe(0);
  await page.getByRole("button", { name: /Start game/ }).click();
  await expect(sq(page, "h1")).toBeInViewport();
  await expect(sq(page, "a8")).toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBe(0);
});

test("moves slide, captures glitch out, and the sound toggle is remembered", async ({ page }) => {
  await page.getByRole("radio", { name: /Pass & play/ }).check();
  await page.getByRole("button", { name: /Start game/ }).click();
  await move(page, "e2", "e4");
  await expect(sq(page, "e4").locator(".piece-wrap--slide")).toHaveCount(1);
  await move(page, "d7", "d5");
  await move(page, "e4", "d5");
  await expect(sq(page, "d5").locator(".captured-ghost")).toHaveCount(1);

  const sound = page.getByRole("button", { name: "Sound effects" });
  await expect(sound).toHaveAttribute("aria-pressed", "false");
  await sound.click();
  await expect(sound).toHaveAttribute("aria-pressed", "true");
  await page.reload();
  await expect(page.getByRole("button", { name: "Sound effects" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
});

test("Share GIF makes an animated replay of the finished game", async ({ page, isMobile }) => {
  test.skip(isMobile, "desktop downloads the file; phones open the share sheet");
  await page.getByRole("radio", { name: /Pass & play/ }).check();
  await page.getByRole("button", { name: /Start game/ }).click();
  await move(page, "f2", "f3");
  await move(page, "e7", "e5");
  await move(page, "g2", "g4");
  await move(page, "d8", "h4");
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Share GIF" }).click();
  const file = await download;
  expect(file.suggestedFilename()).toBe("quick-chess-black-wins.gif");
  const bytes = await (await file.createReadStream()).toArray();
  const buffer = Buffer.concat(bytes);
  expect(buffer.subarray(0, 6).toString("ascii")).toBe("GIF89a");
  expect(buffer.length).toBeGreaterThan(50_000);
  await expect(page.getByRole("button", { name: "GIF saved ✓" })).toBeVisible();
});

/** The rotation the board applies to one side's pieces, in degrees. */
async function angle(page: Page, color: "w" | "b") {
  return page
    .locator(`.board .piece-svg--${color}`)
    .first()
    .evaluate((el) => getComputedStyle(el).rotate);
}

test("pieces face options: their player, whose turn, one way, sideways", async ({ page }) => {
  await page.getByRole("radio", { name: /Pass & play/ }).check();
  // The facing choice only appears when the board stays put.
  await expect(page.getByRole("radio", { name: /Sideways/ })).toHaveCount(0);
  await page.getByRole("radio", { name: /Stays put/ }).check();
  await expect(page.getByRole("radio", { name: /Their player/ })).toBeChecked();

  await page.getByRole("button", { name: /Start game/ }).click();
  expect(await angle(page, "b")).toBe("180deg");
  expect(["none", "0deg"]).toContain(await angle(page, "w"));

  for (const [option, w, b] of [
    ["Sideways", "90deg", "90deg"],
    ["One way", "0deg", "0deg"],
  ] as const) {
    await page.getByRole("button", { name: "New game" }).click();
    await page.getByRole("radio", { name: new RegExp(option) }).check();
    await page.getByRole("button", { name: /Start game/ }).click();
    expect(["none", w]).toContain(await angle(page, "w"));
    expect(["none", b]).toContain(await angle(page, "b"));
  }

  // Whose turn: everything turns toward Black after White moves.
  await page.getByRole("button", { name: "New game" }).click();
  await page.getByRole("radio", { name: /Whose turn/ }).check();
  await page.getByRole("button", { name: /Start game/ }).click();
  await move(page, "e2", "e4");
  await expect.poll(() => angle(page, "w")).toBe("180deg");
  await expect.poll(() => angle(page, "b")).toBe("180deg");
});

test("a draw offer shows on the answering player's side, turned to face them", async ({ page }) => {
  await page.getByRole("radio", { name: /Pass & play/ }).check();
  await page.getByRole("radio", { name: /Stays put/ }).check();
  await page.getByRole("button", { name: /Start game/ }).click();
  // White offers: Black (at the top) answers, so the prompt is at the top, upside down.
  await page.getByRole("button", { name: "Offer draw" }).click();
  const offer = page.locator(".draw-offer");
  await expect(offer).toHaveClass(/draw-offer--top/);
  await expect(page.getByRole("dialog", { name: "Black: draw?" })).toBeVisible();
  await page.getByRole("button", { name: "Decline" }).click();
  await expect(offer).toHaveCount(0);

  // Black offers: White answers at the bottom, the right way up.
  await move(page, "e2", "e4");
  await page.getByRole("button", { name: "Offer draw" }).click();
  await expect(offer).toHaveClass(/draw-offer--bottom/);
  await page.getByRole("button", { name: "Accept draw" }).click();
  await expect(page.getByRole("heading", { name: "Draw agreed" })).toBeVisible();
});
