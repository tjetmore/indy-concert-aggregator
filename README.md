# Indiana Concert Aggregator

A Next.js App Router app that aggregates concerts for Ruoff Music Center and Everwise Amphitheater at White River State Park using the Ticketmaster Discovery API.

## Setup

1. Install dependencies:

```bash
npm install
```

2. Add your Ticketmaster API key in `.env.local`:

```bash
TICKETMASTER_API_KEY=your_key_here
```

3. Discover venue IDs (prints IDs to the console):

```bash
npm run find:venues
```

4. Update the constants in `src/lib/ticketmaster.ts` with the IDs printed by the script.

5. Run the dev server:

```bash
npm run dev
```

Open `http://localhost:3000`.
