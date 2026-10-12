# 🐞 Bug Report Improver

A Chrome extension that builds a complete bug report from **what really happened on the page**, not just from what you typed.

Built for **SDET AI Buildathon 1.0 – Plugin Mania** (Functional Testing / Test Reporting).

## The problem

Bug reports reach developers incomplete: vague steps, no expected result, no console errors, no API failures, no screenshot. Developers then spend time asking questions and trying to reproduce the issue.

Most "bug report helpers" only rewrite the text you type. This one **captures the evidence automatically**.

## What makes it different

| Feature | What it does |
|---|---|
| 🎥 **Auto-recorded steps** | Watches clicks, field changes, form submits and page navigation, then writes the *Steps to Reproduce* from what actually happened. No more "I forget what I clicked". |
| 🧯 **Error and network capture** | Records JavaScript exceptions, `console.error`, failed resources and failed API calls (HTTP ≥ 400, or no response). |
| 📸 **Screenshot on open** | Captures the page the moment you open the popup. Copy it or download it for the ticket. |
| ⚖️ **Evidence-based severity** | Severity combines your wording with hard evidence. An HTTP 500 or an uncaught JS error means at least High. |
| 🔍 **Likely cause hints** | "500 on `POST /api/checkout` → check backend logs", "uncaught TypeError at app.js:88", "repeated clicks → UI gave no feedback", "no errors captured → silent front-end logic issue". |
| ✅ **Report quality score** | Scores the report 0–100 and asks the exact questions a developer would ask (expected result? how often? which build?). |
| 🧪 **Playwright regression test** | Turns the recorded steps into a ready-to-run Playwright test that **fails while the bug exists** (it asserts there are no JS errors and no failing API calls). |
| 📋 **Jira / Markdown output** | One click to switch format, plus a history of the last 15 reports. |
| ✨ **Optional Claude mode** | Sends the facts and evidence to Claude for a polished write-up. It never invents steps or errors. |

Everything except Claude mode works **offline**, with no account or key.

## Install (Developer mode)

1. Download or clone this repository.
2. Open `chrome://extensions`.
3. Turn on **Developer mode**.
4. Click **Load unpacked** and select this folder.
5. **Reload any tab you want to record** (the recorder starts when a page loads).

## How to use

1. Open the app you are testing and reproduce the bug normally.
2. Click the 🐞 icon. The banner shows what was recorded (actions / errors / failed requests).
3. Optionally type a short note, for example `checkout not working, should go to payment page`. The note can be empty if the recorder caught the problem.
4. Click **Generate report**, then:
   - **Report** tab: copy as Markdown or Jira.
   - **Evidence** tab: review the recorded steps and errors, and copy or download the screenshot.
   - **Test** tab: copy the Playwright regression test.
5. Check the **quality meter**. If it lists missing questions, answer them in the report.

## Example

Note: `checkout not working`

Recorded automatically:

```
1. Open https://shop.com/cart
2. Click button "Checkout"
3. Enter "a@b.com" in "Email" field
4. Click button "Place order" → /checkout
Failed request:  POST /api/checkout → 500
Console error:   TypeError: Cannot read properties of undefined (reading 'total')
```

Result: Severity **High** (HTTP 500 on `POST /api/checkout`), likely-cause hints, and a Playwright test that fails until the bug is fixed.

## Privacy and safety

- The recorder keeps data **only in the current tab** (`sessionStorage`) and reads it only when you open the popup. Nothing is sent anywhere automatically.
- **Password-like fields are never stored** (password, token, OTP, card, CVV, etc. are masked as `***`).
- Network URLs are stored **without query strings**, so tokens in URLs are not recorded.
- Evidence leaves your browser only if you click **Improve with Claude**. Your API key is stored locally in `chrome.storage.local`.
- Use **Clear recorded trail** on the Evidence tab to wipe the recording.

## Project structure

```
manifest.json   Chrome extension config (Manifest V3)
collector.js    In-page recorder (actions, JS errors, failed requests)
improver.js     Analysis + renderers (report, Jira, quality score, Playwright test)
popup.html/css  Popup UI
popup.js        UI logic, screenshot, history, optional Claude call
```

## Permissions

- `activeTab`: read the current tab and take the screenshot when you open the popup
- `scripting`: read the recorded evidence from the page
- `storage`: history and the optional API key
- `https://api.anthropic.com/*`: only used in Claude mode

## Tech

Plain JavaScript, HTML and CSS. No build step and no dependencies.

## Roadmap

- Push the report straight to Jira / GitHub Issues
- Attach the screenshot automatically
- Record request/response bodies (with masking)
- Duplicate-bug detection
