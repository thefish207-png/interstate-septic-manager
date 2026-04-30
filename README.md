# Interstate Septic Manager

All-in-one business management for septic & sewer companies. Schedule, dispatch, invoice, and track every job from one app.

---

## Install (Windows)

1. **Download the latest installer:**
   👉 **[Click here for the latest release](https://github.com/thefish207-png/interstate-septic-manager/releases/latest)**

2. Under **Assets**, click `Interstate-Septic-Manager-Setup-X.X.X.exe` to download it.

3. Run the installer.
   - Windows will say **"Windows protected your PC"** — that's normal for new apps.
   - Click **More info** → **Run anyway**.
   - Follow the install prompts (default options are fine).

4. Launch **Interstate Septic Manager** from your Start menu or desktop shortcut.

5. **Sign in** with the username and password Tyler sent you.

That's it. The app auto-updates whenever a new version ships — you'll see a banner at the bottom-right when an update is ready.

---

## Need help?

- Forgot your password or need an account? Ask Tyler.
- Bug or feature request? Mention it to Tyler or open an issue here on GitHub.

---

## For developers

Source-only setup (run from this repo instead of the installer):

```bash
git clone https://github.com/thefish207-png/interstate-septic-manager.git
cd interstate-septic-manager
npm install
npm start
```

Build a Windows installer locally:

```bash
npm run build:win
```

Publish a new release to GitHub (requires `GH_TOKEN`):

```bash
npm run release
```
