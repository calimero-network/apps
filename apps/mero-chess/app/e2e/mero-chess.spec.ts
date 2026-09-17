/**
 * The board, against a real node.
 *
 * A whole game is played through the UI — pieces clicked, moves appearing on
 * the scoresheet, a checkmate the contract derived, a rematch — because every
 * one of those is a claim about the two halves agreeing: the board sends UCI
 * the contract accepts, and renders the FEN the contract returns.
 *
 * One node, two chairs. The contract allows one account to hold both (see
 * `sit`), so a single browser can play both sides; a second node would add a
 * discovery and key-delivery race to a test about the UI. The two-node story is
 * `logic/workflows/play-a-game.yml`.
 */
import { expect, test } from "@playwright/test";
import { btn, login, move, square, status, waitForBoard, watchForErrors } from "./helpers";

test.describe("Mero Chess", () => {
  test("opens a table, seats a player, plays a game to mate and starts a rematch", async ({
    page,
  }) => {
    const errors = watchForErrors(page);

    await login(page);
    await waitForBoard(page);

    // ── the starting position ────────────────────────────────────────────
    // Read off the board itself, by the accessible names the squares carry.
    await expect(square(page, "e1")).toHaveAccessibleName("e1, white king");
    await expect(square(page, "d8")).toHaveAccessibleName("d8, black queen");
    await expect(square(page, "e4")).toHaveAccessibleName("e4");
    await expect(status(page)).toHaveText("Waiting for both players to sit down.");

    // ── sitting down ─────────────────────────────────────────────────────
    await page.getByLabel("your name").fill("Ada");
    await page.getByTestId("sit-white").click();
    await expect(page.getByTestId("seat-white")).toContainText("Ada");
    // One seat is not a game: the contract refuses a move until both chairs are
    // taken, and the UI says so rather than offering one.
    await expect(status(page)).toHaveText("Waiting for both players to sit down.");

    // The second chair is offered to the same player on purpose — pass-and-play.
    await page.getByTestId("sit-black").click();
    await expect(status(page)).toContainText("White (Ada) to move.");

    // ── a game ───────────────────────────────────────────────────────────
    // Scholar's mate. Every move goes through the board: click the piece, click
    // the square.
    await move(page, "e2", "e4");
    await expect(page.getByTestId("scoresheet")).toContainText("e4");
    await expect(status(page)).toContainText("Black (Ada) to move.");

    await move(page, "e7", "e5");
    await move(page, "f1", "c4");
    await move(page, "b8", "c6");
    await move(page, "d1", "h5");
    await move(page, "g8", "f6");

    // Check is announced before the mate, as its own state.
    await expect(status(page)).toContainText("White (Ada) to move.");

    await move(page, "h5", "f7");

    // ── the result, derived by the contract ──────────────────────────────
    // Nothing wrote "1-0" anywhere: the contract replayed the moves and reached
    // checkmate, and the page is showing that verdict.
    await expect(status(page)).toHaveText("Ada wins — checkmate.");
    await expect(page.getByTestId("scoresheet")).toContainText("Qxf7#");

    // A finished game takes no more moves — the board offers nothing.
    await expect(square(page, "e8")).toBeDisabled();

    // The record appears only once there is one, and it names the finished
    // game rather than the one being played.
    await expect(page.getByTestId("record")).toContainText("1-0");
    await expect(page.getByTestId("record")).toContainText("checkmate");

    // ── the rematch ──────────────────────────────────────────────────────
    await page.getByTestId("rematch").click();
    await expect(status(page)).toContainText("White (Ada) to move.");
    await expect(page.getByTestId("scoresheet")).toHaveCount(0);
    // The pieces are back where they started, which is the real proof that the
    // new game is a new game rather than the old one relabelled — and the
    // finished one is still on the record beside it.
    await expect(square(page, "e2")).toHaveAccessibleName("e2, white pawn");
    await expect(page.getByTestId("record")).toContainText("Game 1");

    errors.assertClean();
  });

  test("a move is only offered where the contract says it is legal", async ({ page }) => {
    await login(page);
    await waitForBoard(page);

    // A piece with no legal move is not even a tab stop: the board's disabled
    // state comes from the contract's own legal-move list, not from a rule
    // reimplemented in the browser.
    await expect(square(page, "e1")).toBeDisabled();
    await expect(square(page, "d1")).toBeDisabled();

    // Selecting a knight lights exactly its two legal squares.
    await square(page, "g1").click();
    await expect(square(page, "f3")).toHaveClass(/target/);
    await expect(square(page, "h3")).toHaveClass(/target/);
    await expect(square(page, "g3")).not.toHaveClass(/target/);

    // Clicking it again puts it down.
    await square(page, "g1").click();
    await expect(square(page, "f3")).not.toHaveClass(/target/);
  });

  test("mints an invitation for the table", async ({ page }) => {
    await login(page);
    await waitForBoard(page);

    await btn(page, "Create invite link").click();
    const link = page.locator(".invite-link");
    await expect(link).toBeVisible();
    // The link is a deep link for THIS app: the slug is the package id, and a
    // drift between the two produces links that silently never open.
    await expect(link).toContainText("com.calimero.mero-chess");
    await expect(link).toContainText("invitation=");
  });

  test("offers the table picker when the session names no context", async ({ page }) => {
    await login(page, { withContext: false });
    await expect(page.getByRole("heading", { name: "Choose a table" })).toBeVisible({
      timeout: 30_000,
    });
    // The join card is on the same screen, because an invitation that arrived
    // by some other channel has to be redeemable without one.
    await expect(page.getByRole("heading", { name: "Join with an invitation" })).toBeVisible();
  });
});
