# Elixir Salon Management

Attendance, team, clients, services and expenses for one salon. React front end, Express + SQLite back end, all in one folder. Data lives in one file: `server/salon.db`.

## Running it while developing

```
npm install
npm run dev        # app on http://localhost:5173, API on :4000
```

## Setting it up on the salon MacBook

You need Node.js 20 or newer (the "LTS" download from https://nodejs.org).

1. Copy this whole folder to the salon Mac (leave out `node_modules`). To bring your existing data along, make a backup first with `./deploy/backup.sh` and copy that file to `server/salon.db` on the salon Mac (do not copy `salon.db` directly while the app is running).
2. Open Terminal in the folder and run this as the normal user (not with `sudo`):
   ```
   ./deploy/install-mac.sh
   ```
   It builds the app, starts it, makes it start by itself whenever the Mac is logged in (and restart if it stops), keeps the Mac awake while plugged in, and takes a database backup every night at 2:00 AM.
3. Open http://localhost:4000 on that Mac. The first time you open **Team & shifts** it asks you to **create an admin PIN** (4 to 8 digits). Nothing else needs it.
4. For the front-desk tablet, use the address the installer prints, like `http://192.168.1.8:4000` (it is also in `~/Library/Logs/ElixirSalon/app.log`). The tablet must be on the same Wi-Fi.

Do these once on the salon Mac:

- **Keep it plugged in with the lid open.** Closing the lid of a MacBook puts it to sleep and the app stops. (The screen can be dimmed or off.)
- **Give it a fixed address.** In your router, reserve the same IP address for this Mac, otherwise the tablet's link can stop working after a restart.
- **Turn on automatic login** for the Mac user (System Settings > Users & Groups) so the app comes back after a power cut (macOS does not offer this if FileVault disk encryption is on; in that case log in once after each restart).
- When macOS asks "Do you want node to accept incoming network connections?", click **Allow**.

## Day to day

- **Attendance** is open to everyone: staff tap Check in / Check out. The server records the time itself, so the tablet's clock does not matter.
- **Services, Expenses, Appointments and Clients** are open, with no PIN, so the receptionist can enter and fix them during the day. The money totals (revenue, profit, monthly spend, and each client's total spent) are hidden behind an **Enter PIN to view** button until the admin PIN is entered. Individual amounts (a visit's bill, a single expense) stay visible because the receptionist needs them.
- **Team & shifts** (adding or editing staff, the monthly attendance report and attendance time corrections) needs the admin PIN, so staff cannot change attendance records or shifts. Use **Lock admin** in the sidebar when you are done. A PIN session ends when you close the browser tab or after 12 hours without use; five wrong PINs lock the PIN screen for one minute.
- Forgot the PIN? In the folder, run `npm run reset-pin`, then open Team & shifts and create a new one. Your data is not affected.
- **Who did each service:** every line of a service has an optional team member. Leave it blank if you don't want to record it. To review someone's work (for incentives), unlock **Team & shifts**, press **Services done** on their card, and pick Week, Month or a Custom date range. You get every service they did with its price, and a total. Picking a team member in the Services filter also shows just the lines they did.
- **Sample data:** `npm run seed-demo` fills every screen with fictional data so you can look around. `npm run clear-demo` removes only that sample data and leaves anything you entered yourself.

## Backups

Each night a copy is saved to `~/SalonBackups/salon-YYYY-MM-DD.db` (the last 60 days are kept). To also protect against the laptop itself failing, turn on Time Machine or copy that folder to a USB drive or cloud folder now and then. Run a backup any time with `./deploy/backup.sh`.

To restore a backup:

```
./deploy/install-mac.sh --uninstall
rm -f server/salon.db-wal server/salon.db-shm
cp ~/SalonBackups/salon-2026-10-25.db server/salon.db      # pick the date you want
./deploy/install-mac.sh
```

## Updating the app later

Copy the new files over the old ones (keep `server/salon.db`) and run `./deploy/install-mac.sh` again. To remove the service: `./deploy/install-mac.sh --uninstall` (your data is kept).

## Good to know

- The salon network is plain HTTP. Use a Wi-Fi network with a password, and do not expose port 4000 to the internet.
- If a page looks outdated after an update, refresh the browser (Cmd+Shift+R).
- Logs: `~/Library/Logs/ElixirSalon/`.
