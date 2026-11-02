import { expect, test, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const shots = (page: Page, name: string) => page.screenshot({ path: `e2e/.results/${name}.png` });
const git = (root: string, ...args: string[]) => execFileSync("git", ["-C", root, ...args], { encoding: "utf8" });

async function fresh(page: Page) {
  await page.goto("/");
  const welcome = page.getByText("A live Common Lisp workbench on SBCL.");
  await expect(welcome.or(page.locator(".workspace"))).toBeVisible();
  if (await page.locator(".workspace").isVisible()) {
    await page.keyboard.press("Meta+Shift+P");
    await page.getByPlaceholder("Type a command…").fill("Close Project");
    await expect(page.locator(".palette .item.selected")).toContainText("Close Project");
    await page.keyboard.press("Enter");
  }
  await expect(welcome).toBeVisible();
  await page.evaluate(() => localStorage.setItem("zparen.tour", JSON.stringify({ done: [], dismissed: true })));
}

// Needs ocicl set up, and the network the first time ocicl fetches FiveAM.
test.skip(!existsSync(join(process.env.HOME ?? "", ".local/share/ocicl/ocicl-runtime.lisp")), "ocicl is not set up");

test("a course: start a lesson, check, pass, finish, and the next lesson arrives", async ({ page }) => {
  test.setTimeout(420_000);
  const parent = realpathSync(mkdtempSync(join(tmpdir(), "zparen-learn-e2e-")));
  const root = join(parent, "learn-lisp");
  await fresh(page);

  await page.getByRole("button", { name: "Learn Lisp…" }).click();
  await expect(page.getByRole("radio", { name: "Lisp course" })).toHaveAttribute("aria-checked", "true");
  await expect(page.getByPlaceholder("my-app")).toHaveValue("learn-lisp");
  await page.getByPlaceholder("/Users/you/projects").fill(parent);
  await shots(page, "learn-01-new-course");
  await page.getByRole("button", { name: "Create" }).click();

  const learn = page.getByTestId("learn");
  await expect(learn).toBeVisible({ timeout: 120_000 });
  await expect(page.locator(".tab.active")).toHaveText(/01-forms\.lisp/);
  await expect(page.locator(".dot.ready")).toBeVisible({ timeout: 120_000 });
  expect(git(root, "log", "--format=%s")).toContain("Start the Lisp course, with lesson 1");
  expect(readFileSync(join(root, "ocicl.csv"), "utf8")).toContain("fiveam");
  await expect(learn.getByRole("button", { name: "Start: Forms and evaluation" })).toBeVisible();
  await shots(page, "learn-02-course");

  await learn.getByRole("button", { name: "Start: Forms and evaluation" }).click();
  await expect(learn.getByText("⎇ lesson/01-forms")).toBeVisible({ timeout: 120_000 });
  expect(git(root, "branch", "--show-current").trim()).toBe("lesson/01-forms");

  // A stub is reported as not written, not as a failure.
  const twice = learn.locator(".learn-card", { hasText: "Twice" });
  await twice.getByRole("button", { name: /Check/ }).click();
  await expect(twice.locator(".learn-result")).toContainText("not written yet", { timeout: 120_000 });

  // A wrong answer fails with FiveAM's reason.
  const file = join(root, "src/01-forms.lisp");
  const stubbed = readFileSync(file, "utf8");
  writeFileSync(file, stubbed.replace("(not-written-yet 'twice x)", "(* 3 x)"));
  await expect(page.locator(".editor-host .cm-content")).toContainText("(* 3 x)");
  await twice.getByRole("button", { name: /Check/ }).click();
  await expect(twice.locator(".learn-pill")).toHaveText("✕ Not yet", { timeout: 60_000 });
  await expect(twice.locator(".learn-result")).toContainText("TWICE 2");
  await shots(page, "learn-03-failed");

  // Right answers pass, and each pass is a commit with its trailer.
  writeFileSync(
    file,
    stubbed
      .replace("(not-written-yet 'twice x)", "(* 2 x)")
      .replace("(not-written-yet 'average3 a b c)", "(/ (+ a b c) 3)")
      .replace("(not-written-yet 'sum-form a b)", "(list '+ a b)"),
  );
  await expect(page.locator(".editor-host .cm-content")).toContainText("(* 2 x)");
  for (const title of ["Twice", "Average of three", "Code as data"]) {
    const card = learn.locator(".learn-card", { hasText: title });
    await card.getByRole("button", { name: /Check/ }).click();
    await expect(card.locator(".learn-pill")).toHaveText("✓ Passed", { timeout: 60_000 });
  }
  expect(git(root, "log", "--format=%(trailers:key=Exercise,valueonly)").split(/\s+/).filter(Boolean).sort()).toEqual(["01/1", "01/2", "01/3"]);
  await shots(page, "learn-04-passed");

  await learn.getByRole("button", { name: "Finish Lesson" }).click();
  await expect(learn.getByText("Merged into main.")).toBeVisible({ timeout: 120_000 });
  expect(git(root, "branch", "--show-current").trim()).toBe("main");
  expect(git(root, "log", "--format=%s", "-2")).toMatch(/^Add lesson 2: .*\nFinish lesson 1: Forms and evaluation/);
  expect(existsSync(join(root, "src/02-functions.lisp"))).toBe(true);
  expect(readFileSync(join(root, "learn-lisp.asd"), "utf8")).toContain('(:file "02-functions")');
  if (!(await page.getByTestId("file-tree").getByText("02-functions.lisp").isVisible())) await page.getByTestId("file-tree").getByText("src").click();
  await expect(page.getByTestId("file-tree").getByText("02-functions.lisp")).toBeVisible();
  await shots(page, "learn-05-finished");

  // The course outline reads it all back from git.
  await learn.getByRole("button", { name: "Back to the course" }).click();
  await expect(learn.getByText(/1 of \d+ lessons · 3 of \d+ exercises/)).toBeVisible();
  await expect(learn.getByRole("button", { name: "Start: Functions and conditionals" })).toBeVisible();
});
