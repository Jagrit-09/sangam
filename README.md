# Sangam

Sangam is a web app for people in Delhi NCR who want to go to college fests, small gigs and concerts but don't want to go alone. You can find an event, see who else is going, match with them, chat, and plan the trip there. On the day, a live map of the venue shows what the crowd is reporting.

## Features

- **Events:** browse and search upcoming college fests, gigs and concerts. Anyone with an account can post one, pinning the venue on a map.
- **Travel buddies:** RSVP to an event, then swipe through the other people going. If you both like each other, it's a match.
- **Chat:** matched people can message each other in real time.
- **Getting there:** choose where you're starting from (a metro station or your location) and get the nearest station, the walk, and estimated metro, auto and cab fares.
- **Live ground map:** tap the venue layout to drop a ping (medical, washroom, stalls, emergency, crowd energy). Everyone viewing sees it instantly, and pings expire after 45 minutes.
- **Accounts and safety:** email and password sign-up with a profile, scrypt password hashing, rate limits on login and posting, block and report, and account deletion.

## Tech

| Part | What I used |
|---|---|
| Backend | Python 3, standard library only (`http.server`, `sqlite3`, `hashlib`) |
| Database | SQLite |
| Real-time | Server-Sent Events, for live pings and chat |
| Frontend | HTML, CSS and JavaScript with no framework, hash-based routing |
| Maps | Leaflet with free tile providers (no API key) |

There are no third-party Python packages to install.

## How it works

```
server/
  app.py        HTTP server, routes, rate limits, live streams
  db.py         data layer (SQLite) and validation
  transit.py    metro, auto and cab estimates (data/metro.json)
  security.py   password hashing, rate limiter
  sse.py        Server-Sent Events channels
  config.py     settings
public/         the website (HTML, CSS, JS)
tests/          API tests
data/           sample events and profiles, metro station list
```

A few decisions worth explaining:

- **Matching:** a swipe is stored per (user, person, event). A match is created only when the other person has already liked you at the same event.
- **Live updates:** the browser opens an `EventSource` connection to the server. When someone posts a ping or a chat message, the server pushes it to everyone subscribed to that channel.
- **Transit estimates:** the nearest station is found with the haversine distance over a built-in station list. Fares use Delhi Metro distance slabs and typical auto and cab rates. They are estimates, not a route planner.
- **Event data:** BookMyShow, District and Instagram don't offer public APIs, so listings are posted by users. The sample events are labelled "Sample".

## Run it locally

You need Python 3.9 or newer.

```bash
git clone https://github.com/YOUR-USERNAME/sangam.git
cd sangam
python server/app.py
```

Then open http://localhost:3000.

On Windows you can also double-click `run.bat`.

Run the tests with:

```bash
python -m unittest discover -s tests -v
```

## Configuration

Copy `.env.example` to `.env` to change settings.

| Variable | Default | Meaning |
|---|---|---|
| `PORT` | 3000 | Port to listen on |
| `HOST` | 127.0.0.1 | Use `0.0.0.0` to make the site reachable from other devices |
| `SHOW_DEMO_DATA` | true | Show sample events and demo profiles. The demo profiles like you back and reply with canned lines so matching and chat can be tried alone. |
| `COOKIE_SECURE` | false | Set to `true` when served over HTTPS |

## Limitations

- Metro coordinates are approximate and fares are estimates.
- There is no email verification or password reset yet.
- SQLite and a single process are fine for a demo or a small community, not a large public launch.

## License

MIT
