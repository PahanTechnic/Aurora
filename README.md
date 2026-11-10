# AURORA '26 — Party Advance Manager

A responsive React + Vite app for managing the AURORA '26 batch party attendee list, drinks preferences, advance payments, outstanding balances, PDF receipts, and a Google Sheets sync endpoint.

## Features

- Add, edit, search, filter, and delete attendee records.
- Record attendee name, birth year, drinks preference, and advance payment.
- Automatically calculate the attendee total and outstanding amount.
- Separate counts and fee totals for **With drinks** and **Without drinks**.
- Configure each group's per-person fee in Settings (both start at Rs. 4,400).
- Download an individual A5 PDF payment receipt with the AURORA '26 artwork (receipt text is rendered in-browser to preserve Sinhala names when the Sinhala web font is available).
- Export a party collection report PDF.
- Save records in the current browser using `localStorage`.
- Optional Google Sheets sync for add, edit, and delete actions using Google Apps Script.
- Responsive layout for desktop, tablet, and mobile.

## Run locally

Install Node.js (LTS), unzip the project, open a terminal in the project folder, then run:

```bash
npm install
npm run dev
```

Open the local URL printed by Vite, usually `http://localhost:5173`.

To build the production files:

```bash
npm run build
```

The production build is created in the `dist/` folder. You can deploy it to Vercel, Netlify, or another static host.

## Google Sheets setup

1. Create a new Google Sheet.
2. Copy the spreadsheet ID from its URL. In a URL like `https://docs.google.com/spreadsheets/d/SPREADSHEET_ID/edit`, the ID is the part between `/d/` and `/edit`.
3. Open **Extensions → Apps Script** in that Sheet.
4. Copy the complete contents of `google-apps-script/Code.gs` into the Apps Script editor.
5. Replace `YOUR_SPREADSHEET_ID` with your actual spreadsheet ID.
6. Save the script, then choose **Deploy → New deployment → Web app**.
7. Set **Execute as: Me**. For a simple event-only setup, set access to **Anyone**, deploy, and complete Google's authorisation flow.
8. Copy the Web App URL ending in `/exec`.
9. Open this app's **Settings**, paste the URL into **Apps Script Web App URL**, and save.

The Apps Script automatically creates an `Attendees` sheet and header row. It inserts new records, updates existing records by record ID, and deletes matching records.

### Important Google Sheets note

The browser sends writes using a `no-cors` request to avoid a cross-origin preflight. The browser therefore cannot read the Apps Script response or verify a write. The UI confirms that a request was sent, not that Google has acknowledged every write. For initial testing, add one attendee and check the `Attendees` tab in your Sheet. The Apps Script execution log is also available in Apps Script under **Executions**.

The web app endpoint is accessible to anyone who has its URL when deployed with access set to **Anyone**. Keep the URL private, use it only for event records, and restrict or remove the deployment after the event. Do not store sensitive information in this sheet.

## Amount calculation

- Total amount = configured fee for the selected drinks preference.
- Outstanding amount = `max(0, total amount - advance amount)`.
- Advance payment cannot be greater than the attendee's total.
- Both drinks options initially use Rs. 4,400. Adjust the two fee fields in **Settings** if the drinks and no-drinks groups have different charges.
- A fee change affects new or edited records. Existing records retain the total stored at the time they were saved until edited.

## Local data and backups

Without a Google Sheets URL, records are stored only in the current browser profile. Clearing browser site data or moving to another device can remove or hide those records. Configure Google Sheets and test it with a sample attendee before entering the complete guest list.

## Project structure

```text
aurora-26-party-manager/
├── public/
│   └── assets/
│       ├── aurora-26-main.png
│       ├── aurora-26-emblem.png
│       └── school-entrance.jpg
├── src/
│   ├── App.jsx
│   ├── main.jsx
│   └── styles.css
├── google-apps-script/
│   └── Code.gs
├── index.html
├── package.json
└── README.md
```
