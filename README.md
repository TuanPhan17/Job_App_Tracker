# JobTrack

A clean, private job application tracker that runs entirely in your browser. There's no account, no server, and no build step: your data stays on your own computer.

## Features

- **Dashboard**: totals, interview rate, a pipeline breakdown, upcoming and overdue follow-ups, and your most recent applications.
- **Applications table**: search across company, role, location, next step, and notes. Filter by status, sort five ways, and change a status right from the row.
- **Pipeline board**: a Kanban view with a column per stage. Drag a card to another column to update its status.
- **Follow-up reminders**: follow-up dates are labeled *Overdue*, *Today*, *Tomorrow*, or *In N days* so nothing slips.
- **Undo delete**: deleting an application shows an Undo button for a few seconds.
- **Backup and restore**: download all your applications as a JSON file and restore them later or on another computer.
- **CSV export**: open your applications in Excel or Google Sheets.
- **Responsive**: works on desktop, tablet, and phone.

## Running it

Open `index.html` in any modern browser. That's it.

Or serve the folder locally, which is handy while editing:

```bash
python3 -m http.server 8000
```

Then visit <http://localhost:8000>.

## Project structure

```
index.html   Page structure, icons, and the add/edit dialog
style.css    All styling, with design tokens (colors, radius, shadows) at the top
app.js       Application logic: storage, rendering, events, import/export
```

Status colors live only in `style.css` (the `[data-tone]` rules), so changing a color there updates it everywhere.

## How data is stored

Applications are saved in the browser's `localStorage` under the key `jobtrack.applications.v2`. That means:

- Data is private to the browser and computer you use.
- Clearing your browser's site data erases it, so use **Download backup** now and then.
- Restoring a backup validates every entry. Missing fields get safe defaults, unknown statuses become *Applied*, and links that aren't `http`/`https` are dropped.

## Tech

Plain HTML, CSS, and JavaScript, with no frameworks or dependencies. The only external resource is the [Inter](https://rsms.me/inter/) font from Google Fonts, and the app falls back to the system font if it can't load.
